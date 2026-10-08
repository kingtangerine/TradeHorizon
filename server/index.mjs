// TradeHorizon auth server: accounts and sessions shared across devices.
// Dependency-free (node:http + node:crypto). Accounts live in server/data/users.json.
// Dev:  `npm run server` (Vite proxies /api to it).  Prod: `npm run build && npm start`
// serves dist/ and /api from one port.
import { createServer } from 'node:http'
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.TH_DATA_DIR ?? join(root, 'server', 'data')
const dataFile = join(dataDir, 'users.json')
const distDir = join(root, 'dist')
const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

mkdirSync(dataDir, { recursive: true })
let db = { users: [], sessions: [] }
if (existsSync(dataFile)) {
  try { db = { users: [], sessions: [], ...JSON.parse(readFileSync(dataFile, 'utf8')) } } catch { /* start empty */ }
}

function save() {
  const tmp = `${dataFile}.tmp`
  writeFileSync(tmp, JSON.stringify(db))
  renameSync(tmp, dataFile)
}

const derive = (password, salt) => new Promise((ok, fail) => {
  scrypt(password, salt, 64, (error, key) => (error ? fail(error) : ok(key)))
})
const tokenHash = (token) => createHash('sha256').update(token).digest('hex')
const publicUser = ({ id, email, displayName, createdAtMs }) => ({ id, email, displayName, createdAtMs })

async function makeHash(password) {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${(await derive(password, salt)).toString('hex')}`
}

async function verifyHash(password, stored) {
  const [saltHex, keyHex] = stored.split(':')
  const expected = Buffer.from(keyHex, 'hex')
  const actual = await derive(password, Buffer.from(saltHex, 'hex'))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function startSession(userId) {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.sessions = db.sessions.filter((s) => s.expiresAtMs > now)
  db.sessions.push({ tokenHash: tokenHash(token), userId, expiresAtMs: now + SESSION_TTL_MS })
  return token
}

function sessionUser(req) {
  const header = req.headers.authorization ?? ''
  if (!header.startsWith('Bearer ')) return undefined
  const hash = tokenHash(header.slice(7))
  const session = db.sessions.find((s) => s.tokenHash === hash && s.expiresAtMs > Date.now())
  return session ? db.users.find((u) => u.id === session.userId) : undefined
}

// Simple per-IP throttle for credential endpoints.
const attempts = new Map()
function throttled(req) {
  const ip = req.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000)
  recent.push(now)
  attempts.set(ip, recent)
  return recent.length > 20
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req, limit = 10_000) {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { fail(new Error('Request too large.')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { fail(new Error('Invalid request.')) }
    })
    req.on('error', fail)
  })
}

// Per-user synced data (layouts, drawings, alerts, workspace): one JSON file per user, last write wins.
const userDataDir = join(dataDir, 'userdata')
mkdirSync(userDataDir, { recursive: true })
const userData = new Map()
const DATA_KEY = /^[a-z0-9:_-]{1,64}$/i
const MAX_VALUE_BYTES = 5_000_000
const MAX_KEYS = 50

function loadUserData(userId) {
  let data = userData.get(userId)
  if (!data) {
    try { data = JSON.parse(readFileSync(join(userDataDir, `${userId}.json`), 'utf8')) } catch { data = {} }
    userData.set(userId, data)
  }
  return data
}

function saveUserData(userId) {
  const file = join(userDataDir, `${userId}.json`)
  writeFileSync(`${file}.tmp`, JSON.stringify(userData.get(userId)))
  renameSync(`${file}.tmp`, file)
}

async function handleData(req, res) {
  const user = sessionUser(req)
  if (!user) return send(res, 401, { error: 'Session expired.' })
  const data = loadUserData(user.id)
  if (req.method === 'GET') return send(res, 200, { items: data })
  if (req.method === 'PUT') {
    const body = await readBody(req, MAX_VALUE_BYTES + 1000)
    const key = String(body.key ?? '')
    if (!DATA_KEY.test(key) || typeof body.value !== 'string') return send(res, 400, { error: 'Invalid data.' })
    if (body.value.length > MAX_VALUE_BYTES) return send(res, 413, { error: 'Data too large.' })
    if (!(key in data) && Object.keys(data).length >= MAX_KEYS) return send(res, 400, { error: 'Too many items.' })
    const updatedAtMs = Date.now()
    data[key] = { value: body.value, updatedAtMs }
    saveUserData(user.id)
    return send(res, 200, { updatedAtMs })
  }
  return send(res, 404, { error: 'Not found.' })
}

async function handleApi(req, res, path) {
  if (path === '/api/data') return handleData(req, res)
  if (path === '/api/auth/me' && req.method === 'GET') {
    const user = sessionUser(req)
    return user ? send(res, 200, { user: publicUser(user) }) : send(res, 401, { error: 'Session expired.' })
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    const header = req.headers.authorization ?? ''
    if (header.startsWith('Bearer ')) {
      const hash = tokenHash(header.slice(7))
      db.sessions = db.sessions.filter((s) => s.tokenHash !== hash)
      save()
    }
    return send(res, 200, { ok: true })
  }
  if (path === '/api/auth/password' && req.method === 'POST') {
    const user = sessionUser(req)
    if (!user) return send(res, 401, { error: 'Session expired.' })
    if (throttled(req)) return send(res, 429, { error: 'Too many attempts. Wait a minute and try again.' })
    const body = await readBody(req)
    const next = String(body.newPassword ?? '')
    if (next.length < 8) return send(res, 400, { error: 'Password must contain at least 8 characters.' })
    if (!(await verifyHash(String(body.currentPassword ?? ''), user.passwordHash))) {
      return send(res, 403, { error: 'Current password is incorrect.' })
    }
    user.passwordHash = await makeHash(next)
    // Sign the account out everywhere else; this device stays signed in.
    const keep = tokenHash((req.headers.authorization ?? '').slice(7))
    db.sessions = db.sessions.filter((session) => session.userId !== user.id || session.tokenHash === keep)
    save()
    return send(res, 200, { ok: true })
  }
  if (req.method !== 'POST' || (path !== '/api/auth/signup' && path !== '/api/auth/login')) {
    return send(res, 404, { error: 'Not found.' })
  }
  if (throttled(req)) return send(res, 429, { error: 'Too many attempts. Wait a minute and try again.' })

  const body = await readBody(req)
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')

  if (path === '/api/auth/signup') {
    const displayName = String(body.displayName ?? '').trim()
    if (displayName.length < 2) return send(res, 400, { error: 'Enter a display name of at least 2 characters.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' })
    if (password.length < 8) return send(res, 400, { error: 'Password must contain at least 8 characters.' })
    if (db.users.some((u) => u.email === email)) return send(res, 409, { error: 'An account already exists for this email.' })
    const legacyId = typeof body.legacyId === 'string' && /^[0-9a-f-]{36}$/i.test(body.legacyId) && !db.users.some((u) => u.id === body.legacyId) ? body.legacyId : undefined
    const user = { id: legacyId ?? randomUUID(), email, displayName, createdAtMs: Date.now(), passwordHash: await makeHash(password) }
    db.users.push(user)
    const token = startSession(user.id)
    save()
    return send(res, 201, { user: publicUser(user), token })
  }

  const user = db.users.find((u) => u.email === email)
  // Always run a hash so unknown emails and wrong passwords take similar time.
  const ok = user ? await verifyHash(password, user.passwordHash) : (await makeHash(password), false)
  if (!user || !ok) return send(res, 401, { error: 'Email or password is incorrect.' })
  const token = startSession(user.id)
  save()
  return send(res, 200, { user: publicUser(user), token })
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
}

async function serveStatic(res, path) {
  let file = normalize(join(distDir, decodeURIComponent(path)))
  if (!file.startsWith(distDir)) file = join(distDir, 'index.html')
  let data
  try { data = await readFile(file) } catch {
    file = join(distDir, 'index.html')
    try { data = await readFile(file) } catch {
      res.writeHead(404); res.end('Run `npm run build` first.'); return
    }
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(data)
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  try {
    if (path.startsWith('/api/')) await handleApi(req, res, path)
    else await serveStatic(res, path)
  } catch (error) {
    if (!res.headersSent) send(res, 400, { error: error instanceof Error ? error.message : 'Request failed.' })
  }
}).listen(port, host, () => {
  console.log(`TradeHorizon server listening on http://${host}:${port}  (accounts: ${dataFile})`)
})
