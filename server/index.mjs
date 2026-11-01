// TradeHorizon server: accounts, synced user data, cached market data and server-side price alerts.
// Dev:  `npm run server` (Vite proxies /api to it).  Prod: `npm run build && npm start`
// serves dist/ and /api from one port.
//   Environment: PORT, HOST, TH_DATA_DIR, TH_TRUST_PROXY=1 (behind nginx/Cloudflare), TH_VAPID_SUBJECT, TH_TELEGRAM_TOKEN (bot token from @BotFather, enables Telegram alerts),
//   TH_ADMIN_EMAILS (comma-separated emails of the accounts that may open the admin page),
//   TH_PUBLIC_URL (optional: the site's address for the keep-alive ping; otherwise learned from requests),
//   TH_BACKUP_KEEP (how many daily database backups to keep, default 14).
// Storage: SQLite database server/data/tradehorizon.db (accounts, sessions, synced data), daily copies in server/data/backups.
import { createServer } from 'node:http'
import { freemem, hostname, loadavg, totalmem } from 'node:os'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { accessSync, constants as fsConstants, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALERTS_KEY, createAlertService, createPushService } from './alerts.mjs'
import { applySecurityHeaders, clientIp, createThrottle, readBody, send, sendCompressed } from './http.mjs'
import { createMarketService } from './markets.mjs'
import { createStaticHandler } from './static.mjs'
import { createTelegramService } from './telegram.mjs'
import { loadEnvFile } from './envfile.mjs'
import { adminEmails, describeUserItems, diskSpace, folderSize, summarizeUserData } from './admin.mjs'
import { createKeepAlive, recordStart, startsWithinDay } from './keepalive.mjs'
import { describeData, deviceFrom } from './userdata.mjs'
import { openDatabase } from './database.mjs'
import { importLegacyJson } from './migrate.mjs'
import { createBackupService } from './backup.mjs'
import { createPriceFeed } from './priceFeed.mjs'
import { makeHash, temporaryPassword, verifyHash } from './passwords.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Settings can also come from a .env file in the app folder (hosts like Plesk do not always pass environment variables).
const envFile = loadEnvFile(join(root, '.env'))
const dataDir = process.env.TH_DATA_DIR ?? join(root, 'server', 'data')
const databaseFile = join(dataDir, 'tradehorizon.db')
const distDir = join(root, 'dist')
const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const version = (() => {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version } catch { return 'unknown' }
})()
const startedAtMs = Date.now()
/** Bumped when the sync API changes; the app compares it to warn about a server that was not restarted. */
const SYNC_PROTOCOL = 2

mkdirSync(dataDir, { recursive: true })
// When this process started (kept for /healthz: frequent starts mean the host keeps stopping the app).
const processStarts = recordStart(dataDir)
// Hosts like Plesk stop an idle app, which would stop price alerts and the Telegram bot: ping ourselves.
const keepAlive = createKeepAlive({ publicUrl: process.env.TH_PUBLIC_URL, trustProxy: process.env.TH_TRUST_PROXY === '1' })
// Accounts, sessions and synced data live in SQLite. The first start after the update moves the old JSON files in.
const store = openDatabase(databaseFile)
const migration = importLegacyJson(store, dataDir)
const backups = createBackupService({ store, dir: join(dataDir, 'backups'), keep: Number(process.env.TH_BACKUP_KEEP) || 14 })

const tokenHash = (token) => createHash('sha256').update(token).digest('hex')
/** Accounts allowed on the admin page (TH_ADMIN_EMAILS). Decided here only: the app just hides the button. */
const admins = adminEmails(process.env.TH_ADMIN_EMAILS)
const isAdmin = (user) => admins.has(user.email)
const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  createdAtMs: user.createdAtMs,
  ...(isAdmin(user) ? { isAdmin: true } : {}),
  ...(user.passwordTemporary ? { mustChangePassword: true } : {}),
})



function startSession(userId) {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  store.sessions.create(tokenHash(token), userId, now + SESSION_TTL_MS, now)
  return token
}

function sessionUser(req) {
  const header = req.headers.authorization ?? ''
  if (!header.startsWith('Bearer ')) return undefined
  const now = Date.now()
  const user = store.sessions.user(tokenHash(header.slice(7)), now)
  // "Last active" for the admin page, noted at most once a minute per user.
  if (user && now - (user.lastSeenAtMs ?? 0) > 60_000) store.users.setLastSeen(user.id, now)
  return user
}

// Credential endpoints: 20 attempts per minute per client IP.
const isThrottled = createThrottle(20, 60_000)
const throttled = (req) => isThrottled(clientIp(req))
// Browser error reports: a handful per minute per IP.
const errorReportThrottled = createThrottle(10, 60_000)
const telegramThrottled = createThrottle(10, 60_000)

// Per-user synced data (layouts, drawings, alerts, workspace): one database row per item, with revisions.
const DATA_KEY = /^[a-z0-9:_-]{1,64}$/i
const MAX_VALUE_BYTES = 5_000_000
const MAX_KEYS = 50


// Services
const markets = createMarketService({ dataDir })
const push = createPushService({
  dataDir,
  subject: process.env.TH_VAPID_SUBJECT ?? 'https://github.com/kingtangerine/TradeHorizon',
})
const telegram = createTelegramService({
  dataDir,
  token: process.env.TH_TELEGRAM_TOKEN?.trim(),
  apiBase: process.env.TH_TELEGRAM_API || undefined, // tests only: a stand-in for api.telegram.org
  userName: (userId) => store.users.get(userId)?.displayName,
})
// Live prices for the coins that have alerts (one WebSocket per exchange); polling covers the rest.
const priceFeed = createPriceFeed({ onPrice: (symbol, price) => alerts.onLivePrice(symbol, price) })
const alerts = createAlertService({
  feed: priceFeed,
  store: {
    listUserIds: () => store.data.usersWithKey(ALERTS_KEY),
    getAlertsValue: (userId) => store.data.value(userId, ALERTS_KEY),
    setAlertsValue: (userId, value) => { store.data.store(userId, ALERTS_KEY, value) },
  },
  exchangeOf: (symbol) => markets.exchangeOf(symbol),
  // Every channel the user has set up; one failing channel never blocks the others.
  notify: async (userId, payload) => { await Promise.allSettled([push.send(userId, payload), telegram.send(userId, payload)]) },
})

async function handleData(req, res) {
  const user = sessionUser(req)
  if (!user) return send(res, 401, { error: 'Session expired.' })
  if (req.method === 'GET') {
    // ?since=N returns only what changed after revision N (the app asks every few seconds).
    const since = Number(new URL(req.url, 'http://localhost').searchParams.get('since')) || 0
    return sendCompressed(req, res, 200, { items: store.data.since(user.id, since), rev: store.data.latestRev(user.id) })
  }
  if (req.method === 'PUT') {
    const body = await readBody(req, MAX_VALUE_BYTES + 1000)
    const key = String(body.key ?? '')
    if (!DATA_KEY.test(key) || typeof body.value !== 'string') return send(res, 400, { error: 'Invalid data.' })
    if (body.value.length > MAX_VALUE_BYTES) return send(res, 413, { error: 'Data too large.' })
    const previousValue = store.data.value(user.id, key)
    if (previousValue === undefined && store.data.keyCount(user.id) >= MAX_KEYS) return send(res, 400, { error: 'Too many items.' })
    const result = store.data.write(user.id, key, body.value, body.baseRev, Date.now(), deviceFrom(body.device))
    if (result.status === 'outdated') return send(res, 409, { error: 'TradeHorizon was updated. Reload the page.', outdated: true })
    if (result.status === 'conflict') return send(res, 409, { error: 'Changed on another device.', item: result.item })
    if (key === ALERTS_KEY) {
      alerts.updateUserAlerts(user.id, body.value)
      alerts.relayTriggered(user.id, previousValue, body.value)
    }
    return send(res, 200, { rev: result.item.rev, updatedAtMs: result.item.updatedAtMs })
  }
  return send(res, 404, { error: 'Not found.' })
}

// --- Admin page (TH_ADMIN_EMAILS) ------------------------------------------------------------------------


function adminUserRow(user) {
  const now = Date.now()
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAtMs: user.createdAtMs,
    lastLoginAtMs: user.lastLoginAtMs ?? null,
    lastSeenAtMs: user.lastSeenAtMs ?? null,
    isAdmin: isAdmin(user),
    sessions: store.sessions.countForUser(user.id, now),
    telegram: telegram.status(user.id).linked,
    pushDevices: push.count(user.id),
    storageBytes: store.data.bytes(user.id),
    ...summarizeUserData(store.data.all(user.id)),
  }
}

function adminOverview() {
  const now = Date.now()
  const memory = process.memoryUsage()
  const megabytes = (bytes) => Math.round(bytes / 1048576)
  const catalog = markets.getCatalog()
  return {
    server: {
      version,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      hostname: hostname(),
      pid: process.pid,
      startedAtMs,
      uptimeSec: Math.round((now - startedAtMs) / 1000),
      startsLast24h: startsWithinDay(processStarts),
      memoryMb: { app: megabytes(memory.rss), heapUsed: megabytes(memory.heapUsed) },
      hostMemoryMb: { total: megabytes(totalmem()), free: megabytes(freemem()) },
      loadAverage: loadavg().map((value) => Math.round(value * 100) / 100),
      dataDir,
      dataBytes: folderSize(dataDir),
      disk: diskSpace(dataDir),
      envFile: envFile.found ? envFile.keys : null,
    },
    database: databaseStatus(),
    services: {
      telegram: telegram.diagnostics(),
      telegramLinkedUsers: telegram.linkedCount(),
      pushReady: Boolean(push.publicKey),
      pushDevices: push.totalDevices(),
      keepAlive: keepAlive.status(),
      marketsLoaded: catalog.listings.length,
      marketsAgeMin: catalog.fetchedAtMs ? Math.round((now - catalog.fetchedAtMs) / 60_000) : null,
      alertsWatched: alerts.activeCount(),
      alertPrices: { ...alerts.watchStatus(), feed: priceFeed.status() },
      notificationQueues: { telegram: telegram.queueStatus(), push: push.queueStatus() },
    },
    users: {
      ...store.users.stats(now),
      admins: store.users.all().filter(isAdmin).length,
      activeSessions: store.sessions.countActive(now),
    },
  }
}

/** Removes an account and everything stored for it. */
function deleteAccount(userId) {
  store.users.remove(userId) // sessions and synced data go with it
  telegram.unlink(userId)
  push.removeUser(userId)
  alerts.updateUserAlerts(userId, '[]')
}

async function handleAdmin(req, res, path) {
  const admin = sessionUser(req)
  if (!admin) return send(res, 401, { error: 'Session expired.' })
  if (!isAdmin(admin)) return send(res, 403, { error: 'Administrators only.' })

  if (path === '/api/admin/overview' && req.method === 'GET') return send(res, 200, adminOverview())
  if (path === '/api/admin/users' && req.method === 'GET') return sendCompressed(req, res, 200, { users: store.users.all().map(adminUserRow) })
  if (path === '/api/admin/backup' && req.method === 'POST') {
    try {
      const copy = backups.run()
      console.log(`[admin] ${admin.email} made a database backup: ${copy.name}`)
      return send(res, 200, { ok: true, backup: copy, database: databaseStatus() })
    } catch (error) {
      return send(res, 500, { error: `Backup failed: ${error.message}` })
    }
  }

  const match = /^\/api\/admin\/users\/([\w-]{6,64})(?:\/(signout|delete|password))?$/.exec(path)
  const target = match ? store.users.get(match[1]) : undefined
  if (!target) return send(res, 404, { error: 'No such user.' })

  if (!match[2] && req.method === 'GET') {
    const now = Date.now()
    return send(res, 200, {
      user: adminUserRow(target),
      items: describeUserItems(store.data.all(target.id)),
      sessions: store.sessions.forUser(target.id, now),
    })
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found.' })
  if (match[2] === 'signout') {
    store.sessions.removeForUser(target.id)
    return send(res, 200, { ok: true })
  }
  if (match[2] === 'password') {
    if (target.id === admin.id) return send(res, 400, { error: 'Use Change password in your account window for your own account.' })
    const password = temporaryPassword()
    store.users.setPassword(target.id, await makeHash(password), true)
    store.sessions.removeForUser(target.id)
    console.log(`[admin] ${admin.email} set a temporary password for ${target.email}`)
    return send(res, 200, { password })
  }
  // delete
  const body = await readBody(req)
  if (target.id === admin.id) return send(res, 400, { error: 'You cannot delete your own account from the admin page.' })
  if (String(body.confirmEmail ?? '').trim().toLowerCase() !== target.email) return send(res, 400, { error: "Type the account's email address to confirm." })
  deleteAccount(target.id)
  console.log(`[admin] ${admin.email} deleted the account ${target.email}`)
  return send(res, 200, { ok: true })
}

async function handleApi(req, res, path) {
  if (path === '/api/data') return handleData(req, res)
  if (path.startsWith('/api/admin/')) return handleAdmin(req, res, path)
  // Sync check: what the server holds for this user (times, sizes, fingerprints, which device), no values.
  if (path === '/api/sync/status' && req.method === 'GET') {
    const user = sessionUser(req)
    if (!user) return send(res, 401, { error: 'Session expired.' })
    return send(res, 200, { protocol: SYNC_PROTOCOL, version, serverTimeMs: Date.now(), rev: store.data.latestRev(user.id), items: describeData(store.data.all(user.id)) })
  }

  // Public market data, cached here so browsers do not each download it from the exchanges.
  if (path === '/api/markets' && req.method === 'GET') {
    const catalog = markets.getCatalog()
    if (catalog.listings.length === 0) return send(res, 503, { error: 'Market list is still loading.' })
    return sendCompressed(req, res, 200, catalog, 'public, max-age=300')
  }
  if (path === '/api/cg/caps' && req.method === 'GET') {
    try {
      return await sendCompressed(req, res, 200, await markets.marketCaps(), 'public, max-age=600')
    } catch {
      return send(res, 502, { error: 'Market-cap data is unavailable right now.' })
    }
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

  // Telegram alerts: link a chat to the account with a one-time code, see the state, unlink, send a test.
  if (path.startsWith('/api/telegram/')) {
    const user = sessionUser(req)
    if (!user) return send(res, 401, { error: 'Session expired.' })
    if (path === '/api/telegram/status' && req.method === 'GET') return send(res, 200, telegram.status(user.id))
    if (req.method !== 'POST') return send(res, 404, { error: 'Not found.' })
    if (!telegram.enabled) return send(res, 503, { error: 'Telegram alerts are not set up on this server.' })
    if (path === '/api/telegram/link') {
      if (telegramThrottled(clientIp(req))) return send(res, 429, { error: 'Too many attempts. Wait a minute and try again.' })
      const link = telegram.createLink(user.id)
      return link ? send(res, 200, link) : send(res, 503, { error: 'The Telegram bot is still starting. Try again in a few seconds.' })
    }
    if (path === '/api/telegram/unlink') { telegram.unlink(user.id); return send(res, 200, { ok: true }) }
    if (path === '/api/telegram/test') {
      if (telegramThrottled(clientIp(req))) return send(res, 429, { error: 'Too many attempts. Wait a minute and try again.' })
      if (!telegram.status(user.id).linked) return send(res, 409, { error: 'Telegram is not connected.' })
      const results = await telegram.send(user.id, { title: 'TradeHorizon test alert', body: 'If you can read this, Telegram alerts work.' })
      const failed = results.find((result) => !result.ok)
      return failed ? send(res, 502, { error: `Telegram did not accept the message: ${failed.error}` }) : send(res, 200, { ok: true })
    }
    return send(res, 404, { error: 'Not found.' })
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
      store.sessions.remove(tokenHash(header.slice(7)))
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
    store.users.setPassword(user.id, await makeHash(next))
    // Sign the account out everywhere else; this device stays signed in.
    store.sessions.removeOthers(user.id, tokenHash((req.headers.authorization ?? '').slice(7)))
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
    if (store.users.byEmail(email)) return send(res, 409, { error: 'An account already exists for this email.' })
    const legacyId = typeof body.legacyId === 'string' && /^[0-9a-f-]{36}$/i.test(body.legacyId) && !store.users.get(body.legacyId) ? body.legacyId : undefined
    const passwordHash = await makeHash(password)
    // Checked again after the slow password hash: another sign-up for the same email may have finished meanwhile.
    if (store.users.byEmail(email)) return send(res, 409, { error: 'An account already exists for this email.' })
    const now = Date.now()
    const user = store.users.create({ id: legacyId ?? randomUUID(), email, displayName, createdAtMs: now, passwordHash, lastLoginAtMs: now })
    const token = startSession(user.id)
    return send(res, 201, { user: publicUser(user), token })
  }

  const user = store.users.byEmail(email)
  // Always run a hash so unknown emails and wrong passwords take similar time.
  const ok = user ? await verifyHash(password, user.passwordHash) : (await makeHash(password), false)
  if (!user || !ok) return send(res, 401, { error: 'Email or password is incorrect.' })
  store.users.setLastLogin(user.id, Date.now())
  const token = startSession(user.id)
  return send(res, 200, { user: publicUser(user), token })
}

function databaseStatus() {
  const fileSize = (suffix) => { try { return statSync(databaseFile + suffix).size } catch { return 0 } }
  return {
    file: databaseFile,
    bytes: fileSize('') + fileSize('-wal'),
    ...store.counts(),
    migratedFromJsonAtMs: Number(store.meta.get('migratedFromJsonAtMs')) || null,
    backups: backups.status(),
  }
}

function health() {
  let dataWritable = true
  try { accessSync(dataDir, fsConstants.W_OK) } catch { dataWritable = false }
  const catalog = markets.getCatalog()
  return {
    ok: dataWritable,
    version,
    uptimeSec: Math.round((Date.now() - startedAtMs) / 1000),
    // More than a few a day means the host keeps stopping the app (alerts are not checked while it is stopped).
    startsLast24h: startsWithinDay(processStarts),
    keepAlive: keepAlive.status(),
    dataWritable,
    database: (() => {
      const status = databaseStatus()
      return { users: status.users, items: status.items, bytes: status.bytes, lastBackupAtMs: status.backups.lastBackupAtMs, backups: status.backups.count, backupError: status.backups.lastError }
    })(),
    alerts: { active: alerts.activeCount(), ...alerts.watchStatus(), feed: priceFeed.status() },
    notificationQueues: { telegram: telegram.queueStatus(), push: push.queueStatus() },
    syncProtocol: SYNC_PROTOCOL,
    pushReady: Boolean(push.publicKey),
    telegramReady: Boolean(telegram.botUsername()),
    telegram: telegram.diagnostics(),
    // Changes between requests: the app was restarted, or Passenger runs more than one copy.
    pid: process.pid,
    // Names (never values) of the settings found in the .env file, or null when there is none.
    envFile: envFile.found ? envFile.keys : null,
    marketsLoaded: catalog.listings.length > 0,
    marketsAgeMin: catalog.fetchedAtMs ? Math.round((Date.now() - catalog.fetchedAtMs) / 60_000) : null,
  }
}

const serveStatic = createStaticHandler(distDir)

const server = createServer(async (req, res) => {
  applySecurityHeaders(req, res)
  keepAlive.observe(req)
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
  console.log(`TradeHorizon ${version} listening on http://${host}:${port}  (database: ${databaseFile}${migration.imported ? `, just moved ${migration.users} accounts in from the JSON files` : ''})`)
  backups.start()
  markets.start()
  alerts.start()
  telegram.start()
  keepAlive.start()
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    markets.stop()
    alerts.stop()
    priceFeed.stop()
    telegram.stop()
    push.stop()
    keepAlive.stop()
    backups.stop()
    server.close(() => { store.close(); process.exit(0) })
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
