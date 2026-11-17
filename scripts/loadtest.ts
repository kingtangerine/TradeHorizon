// Load test: many simulated users doing what the app does, against a TEST copy of the server.
//
//   1. Start a test server on its own data folder (never the real one):
//        TH_DATA_DIR=/tmp/th-load PORT=8899 node server/index.ts
//   2. Run:  node scripts/loadtest.ts --data-dir /tmp/th-load --base http://127.0.0.1:8899 --users 1000 --minutes 3
//
// Test accounts (…@loadtest.local) and their sessions are written straight into the test database, so the login
// rate limit and slow password hashing do not get in the way. The script refuses to touch a database that holds
// any other account. Each simulated user: downloads everything once, checks for changes every 15 s (like an open
// tab), saves a ~5 KB layouts item about every 45 s and a ~60 KB drawings item about every 3 minutes.
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args: Record<string, string | undefined> = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce<[string, string | undefined][]>(
      (pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs),
      [],
    ),
)
const dataDir = args['data-dir']
const base = (args.base ?? 'http://127.0.0.1:8899').replace(/\/$/, '')
const userCount = Number(args.users ?? 1000)
const minutes = Number(args.minutes ?? 3)
const rampSec = Number(args.ramp ?? 30)
if (!dataDir) {
  console.error('Usage: node scripts/loadtest.ts --data-dir <TEST data folder> --base http://127.0.0.1:8899 --users 1000 --minutes 3')
  process.exit(1)
}

// --- seed test accounts into the test database ---------------------------------------------------------------
mkdirSync(dataDir, { recursive: true })
const { openDatabase } = await import('../server/database.ts')
const store = openDatabase(join(dataDir, 'tradehorizon.db'))
const foreign = store.users.all().filter((user) => !user.email.endsWith('@loadtest.local'))
if (foreign.length > 0) {
  console.error(`Refusing: ${join(dataDir, 'tradehorizon.db')} holds ${foreign.length} real account(s). Use an empty test folder.`)
  process.exit(1)
}
const tokens: string[] = []
store.transaction(() => {
  for (let index = 0; index < userCount; index += 1) {
    const email = `user${index}@loadtest.local`
    const user =
      store.users.byEmail(email) ??
      store.users.create({ id: `loadtest-${index}`, email, displayName: `Load ${index}`, passwordHash: 'x:y', createdAtMs: Date.now() })
    const token = randomBytes(32).toString('hex')
    store.sessions.create(createHash('sha256').update(token).digest('hex'), user.id, Date.now() + 86_400_000)
    tokens.push(token)
  }
})
store.close()
console.log(`${userCount} test accounts ready. Running ${minutes} min against ${base} (users start over ${rampSec} s)…`)

// --- traffic -----------------------------------------------------------------------------------------------------
/** Answer times and error counts for one kind of request. */
interface KindStats {
  times: number[]
  errors: Map<number, number>
}
/** What the script reads from an answer: the sync revision, items and, on a conflict, the server's copy. */
interface ApiBody {
  rev?: number
  items?: Record<string, { rev: number }>
  item?: { rev: number }
}
/** What the script reads from /healthz on the test server. */
interface Health {
  eventLoopDelayMs?: { p99: number; max: number }
  memoryMb?: number
  database?: { bytes: number }
}
const stats = new Map<string, KindStats>()
const record = (kind: string, ms: number, status: number) => {
  const entry = stats.get(kind) ?? { times: [], errors: new Map<number, number>() }
  entry.times.push(ms)
  if (status >= 400 || status === 0) entry.errors.set(status, (entry.errors.get(status) ?? 0) + 1)
  stats.set(kind, entry)
}
/** One request, timed; returns { status, body } (body parsed as JSON when possible). */
async function timed(kind: string, path: string, init: RequestInit): Promise<{ status: number; body: ApiBody }> {
  const started = performance.now()
  let status = 0
  try {
    const response = await fetch(base + path, init)
    status = response.status
    const text = await response.text()
    let body: ApiBody = {}
    try {
      body = JSON.parse(text) as ApiBody
    } catch {
      /* not JSON */
    }
    return { status, body }
  } catch {
    return { status: 0, body: {} }
  } finally {
    record(kind, performance.now() - started, status)
  }
}

const padding = (bytes: number) => 'x'.repeat(bytes)
const deadline = Date.now() + minutes * 60_000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function simulatedUser(index: number, token: string) {
  await sleep((index / userCount) * rampSec * 1000)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const revs = new Map<string, number | undefined>()
  const first = await timed('download all (app start)', '/api/data?since=0', { headers })
  let since = first.body.rev ?? 0
  for (const [key, item] of Object.entries(first.body.items ?? {})) revs.set(key, item.rev)
  let nextLayouts = Date.now() + Math.random() * 45_000
  let nextDrawings = Date.now() + Math.random() * 180_000
  while (Date.now() < deadline) {
    await sleep(15_000 + (Math.random() - 0.5) * 2000)
    if (Date.now() >= deadline) break
    const poll = await timed('sync check (every 15 s)', `/api/data?since=${since}`, { headers })
    if (typeof poll.body.rev === 'number') since = poll.body.rev
    for (const [key, due, size, label] of [
      ['layouts:v1', nextLayouts, 5_000, 'save layouts (5 KB)'],
      ['drawings:v1', nextDrawings, 60_000, 'save drawings (60 KB)'],
    ] as const) {
      if (Date.now() < due) continue
      const value = JSON.stringify([{ id: `item-${Date.now()}`, name: label, padding: padding(size) }])
      const response = await timed(label, '/api/data', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ key, value, baseRev: revs.get(key) ?? 0, device: { id: `device-${index}`, name: 'Load test' } }),
      })
      // Saved: the answer carries the new revision. Conflict: the answer carries the server's copy to build on.
      if (response.status === 200) revs.set(key, response.body.rev)
      else if (response.status === 409 && response.body.item) revs.set(key, response.body.item.rev)
      if (key === 'layouts:v1') nextLayouts = Date.now() + 45_000 + Math.random() * 10_000
      else nextDrawings = Date.now() + 180_000 + Math.random() * 30_000
    }
  }
}

const started = Date.now()
const health = setInterval(async () => {
  const body = await fetch(base + '/healthz')
    .then((r) => r.json() as Promise<Health>)
    .catch(() => null)
  if (body?.eventLoopDelayMs)
    console.log(
      `  t=${Math.round((Date.now() - started) / 1000)}s server busy-wait p99 ${body.eventLoopDelayMs.p99} ms (max ${body.eventLoopDelayMs.max} ms), memory ${body.memoryMb ?? '?'} MB`,
    )
}, 30_000)
await Promise.all(tokens.map((token, index) => simulatedUser(index, token)))
clearInterval(health)

const seconds = (Date.now() - started) / 1000
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]
let total = 0
console.log(`\nResults for ${userCount} users over ${seconds.toFixed(0)} s:`)
for (const [kind, entry] of stats) {
  const sorted = [...entry.times].sort((a, b) => a - b)
  total += sorted.length
  const errors = [...entry.errors].map(([status, count]) => `${count}× ${status === 0 ? 'no answer' : status}`).join(', ')
  console.log(
    `  ${kind.padEnd(26)} ${String(sorted.length).padStart(6)} requests   p50 ${pct(sorted, 0.5).toFixed(0).padStart(4)} ms   p95 ${pct(sorted, 0.95).toFixed(0).padStart(5)} ms   p99 ${pct(sorted, 0.99).toFixed(0).padStart(5)} ms   max ${sorted.at(-1)!.toFixed(0).padStart(5)} ms${errors ? `   errors: ${errors}` : ''}`,
  )
}
console.log(`  about ${(total / seconds).toFixed(0)} requests per second in total`)
const final = await fetch(base + '/healthz')
  .then((r) => r.json() as Promise<Health>)
  .catch(() => null)
if (final)
  console.log(
    `  server afterwards: busy-wait p99 ${final.eventLoopDelayMs?.p99} ms, memory ${final.memoryMb} MB, database ${(Number(final.database?.bytes) / 1048576).toFixed(1)} MB`,
  )
