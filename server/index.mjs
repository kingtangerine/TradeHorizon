// TradeHorizon server: accounts, synced user data, cached market data and server-side price alerts.
// Dev:  `npm run server` (Vite proxies /api to it).  Prod: `npm run build && npm start`
// serves dist/ and /api from one port.
//   Environment: PORT, HOST, TH_DATA_DIR, TH_TRUST_PROXY=1 (behind nginx/Cloudflare), TH_VAPID_SUBJECT.
import { createServer } from 'node:http'
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { accessSync, constants as fsConstants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALERTS_KEY, createAlertService, createPushService } from './alerts.mjs'
import { applySecurityHeaders, clientIp, createThrottle, readBody, send, sendCompressed } from './http.mjs'
import { createMarketService } from './markets.mjs'
import { createStaticHandler } from './static.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.TH_DATA_DIR ?? join(root, 'server', 'data')
const dataFile = join(dataDir, 'users.json')
const distDir = join(root, 'dist')
const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const version = (() => {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version } catch { return 'unknown' }
})()
const startedAtMs = Date.now()

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

// Credential endpoints: 20 attempts per minute per client IP.
const isThrottled = createThrottle(20, 60_000)
const throttled = (req) => isThrottled(clientIp(req))
// Browser error reports: a handful per minute per IP.
const errorReportThrottled = createThrottle(10, 60_000)

// Per-user synced data (layouts, drawings, alerts, workspace): one JSON file per user, last write wins.
const userDataDir = join(dataDir, 'userdata')
mkdirSync(userDataDir, { recursive: true })
const userData = new Map()
const DATA_KEY = /^[a-z0-9:_-]{1,64}$/i
const MAX_VALUE_BYTES = 5_000_000
const MAX_KEYS = 50

function readUserFile(userId) {
  try { return JSON.parse(readFileSync(join(userDataDir, `${userId}.json`), 'utf8')) } catch { return {} }
}

function loadUserData(userId) {
  let data = userData.get(userId)
  if (!data) {
    data = readUserFile(userId)
    userData.set(userId, data)
  }
  return data
}

function saveUserData(userId) {
  const file = join(userDataDir, `${userId}.json`)
  writeFileSync(`${file}.tmp`, JSON.stringify(userData.get(userId)))
  renameSync(`${file}.tmp`, file)
}

// Services
const markets = createMarketService({ dataDir })
const push = createPushService({
  dataDir,
  subject: process.env.TH_VAPID_SUBJECT ?? 'https://github.com/kingtangerine/TradeHorizon',
})
const alerts = createAlertService({
  store: {
    listUserIds: () => readdirSync(userDataDir).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)),
    // Reads without caching, so scanning every user at start-up does not keep every user's data in memory.
    getAlertsValue: (userId) => (userData.get(userId) ?? readUserFile(userId))[ALERTS_KEY]?.value,
    setAlertsValue: (userId, value) => {
      loadUserData(userId)[ALERTS_KEY] = { value, updatedAtMs: Date.now() }
      saveUserData(userId)
    },
  },
  exchangeOf: (symbol) => markets.exchangeOf(symbol),
  notify: (userId, payload) => push.send(userId, payload),
})

async function handleData(req, res) {
  const user = sessionUser(req)
  if (!user) return send(res, 401, { error: 'Session expired.' })
  const data = loadUserData(user.id)
  if (req.method === 'GET') return sendCompressed(req, res, 200, { items: data })
  if (req.method === 'PUT') {
    const body = await readBody(req, MAX_VALUE_BYTES + 1000)
    const key = String(body.key ?? '')
    if (!DATA_KEY.test(key) || typeof body.value !== 'string') return send(res, 400, { error: 'Invalid data.' })
    if (body.value.length > MAX_VALUE_BYTES) return send(res, 413, { error: 'Data too large.' })
    if (!(key in data) && Object.keys(data).length >= MAX_KEYS) return send(res, 400, { error: 'Too many items.' })
    const updatedAtMs = Date.now()
    data[key] = { value: body.value, updatedAtMs }
    saveUserData(user.id)
    if (key === ALERTS_KEY) alerts.updateUserAlerts(user.id, body.value)
    return send(res, 200, { updatedAtMs })
  }
  return send(res, 404, { error: 'Not found.' })
}

async function handleApi(req, res, path) {
  if (path === '/api/data') return handleData(req, res)

  // Public market data, cached here so browsers do not each download it from the exchanges.
  if (path === '/api/markets' && req.method === 'GET') {
    const catalog = markets.getCatalog()
    if (catalog.listings.length === 0) return send(res, 503, { error: 'Market list is still loading.' })
    return sendCompressed(req, res, 200, catalog, 'public, max-age=300')
  }
  if ((path === '/api/cg/global' || path === '/api/cg/markets') && req.method === 'GET') {
    try {
      return await sendCompressed(req, res, 200, await markets.coingecko(path.slice('/api/cg/'.length)), 'public, max-age=60')
    } catch {
      return send(res, 502, { error: 'Market-cap data is unavailable right now.' })
    }
  }

  // Web push for server-side alerts
  if (path === '/api/push/key' && req.method === 'GET') return send(res, 200, { publicKey: push.publicKey })
  if (path === '/api/push/subscribe' && req.method === 'POST') {
    const user = sessionUser(req)
    if (!user) return send(res, 401, { error: 'Session expired.' })
    const body = await readBody(req, 5_000)
    const problem = push.subscribe(user.id, body.subscription)
    return problem ? send(res, 400, { error: problem }) : send(res, 200, { ok: true })
  }
  if (path === '/api/push/unsubscribe' && req.method === 'POST') {
    const user = sessionUser(req)
    if (!user) return send(res, 401, { error: 'Session expired.' })
    const body = await readBody(req, 5_000)
    if (typeof body.endpoint === 'string') push.unsubscribe(user.id, body.endpoint)
    return send(res, 200, { ok: true })
  }
  if (path === '/api/alerts/events' && req.method === 'GET') {
    const user = sessionUser(req)
    if (!user) return send(res, 401, { error: 'Session expired.' })
    const since = Number(new URL(req.url, 'http://localhost').searchParams.get('since')) || 0
    return send(res, 200, { events: alerts.eventsSince(user.id, since), pushDevices: push.count(user.id) })
  }

  // Lightweight browser error reports (written to the server log).
  if (path === '/api/client-error' && req.method === 'POST') {
    if (errorReportThrottled(clientIp(req))) return send(res, 429, { error: 'Too many reports.' })
    const body = await readBody(req, 4_000)
    const clip = (value, max) => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, max)
    console.error(`[client-error] ${clip(body.message, 300)} | ${clip(body.source, 200)} | v${clip(body.version, 20)} | ${clip(body.stack, 600)}`)
    return send(res, 204, {})
  }

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

function health() {
  let dataWritable = true
  try { accessSync(dataDir, fsConstants.W_OK) } catch { dataWritable = false }
  const catalog = markets.getCatalog()
  return {
    ok: dataWritable,
    version,
    uptimeSec: Math.round((Date.now() - startedAtMs) / 1000),
    dataWritable,
    marketsLoaded: catalog.listings.length > 0,
    marketsAgeMin: catalog.fetchedAtMs ? Math.round((Date.now() - catalog.fetchedAtMs) / 60_000) : null,
  }
}

const serveStatic = createStaticHandler(distDir)

const server = createServer(async (req, res) => {
  applySecurityHeaders(req, res)
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  try {
    if (path === '/healthz') {
      const status = health()
      return send(res, status.ok ? 200 : 503, status)
    }
    if (path.startsWith('/api/')) await handleApi(req, res, path)
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, path)
    else send(res, 405, { error: 'Method not allowed.' })
  } catch (error) {
    if (!res.headersSent) send(res, 400, { error: error instanceof Error ? error.message : 'Request failed.' })
  }
})

server.listen(port, host, () => {
  console.log(`TradeHorizon ${version} listening on http://${host}:${port}  (data: ${dataDir})`)
  markets.start()
  alerts.start()
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    markets.stop()
    alerts.stop()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
