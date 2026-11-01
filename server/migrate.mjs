// One-time move of accounts and synced data from the old JSON files (users.json + userdata/*.json) into SQLite.
// Runs at start-up only while the database has no accounts. Everything is imported in one transaction and
// counted afterwards; only then are the old files renamed (never deleted), so they stay as a backup.
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { ensureRevisions } from './userdata.mjs'

const stamp = (now) => new Date(now).toISOString().replace(/[:.]/g, '-')

/**
 * @returns { imported: false, reason } or { imported: true, users, items, sessions, skipped }
 * Throws when the old files exist but cannot be read: starting with an empty database would look like
 * every account had vanished, so the server stops with a clear error instead.
 */
export function importLegacyJson(store, dataDir, { now = Date.now(), log = console } = {}) {
  const usersFile = join(dataDir, 'users.json')
  const userDataDir = join(dataDir, 'userdata')
  if (!existsSync(usersFile) && !existsSync(userDataDir)) return { imported: false, reason: 'no old JSON files' }
  if (store.users.count() > 0) return { imported: false, reason: 'the database already has accounts' }

  let legacy = { users: [], sessions: [] }
  if (existsSync(usersFile)) {
    try {
      legacy = { users: [], sessions: [], ...JSON.parse(readFileSync(usersFile, 'utf8')) }
    } catch (error) {
      throw new Error(`Cannot read ${usersFile} to move the accounts into the database (${error.message}). Restore it from a backup, then restart.`, { cause: error })
    }
  }

  const skipped = []
  const seenEmails = new Set()
  const accounts = []
  for (const user of Array.isArray(legacy.users) ? legacy.users : []) {
    const email = String(user?.email ?? '').trim().toLowerCase()
    if (typeof user?.id !== 'string' || !email || typeof user.passwordHash !== 'string') { skipped.push(`account without id/email/password: ${user?.id ?? '?'}`); continue }
    if (seenEmails.has(email)) { skipped.push(`second account for ${email}: ${user.id}`); continue }
    seenEmails.add(email)
    accounts.push({ ...user, email })
  }
  const accountIds = new Set(accounts.map((user) => user.id))

  const files = existsSync(userDataDir) ? readdirSync(userDataDir).filter((name) => name.endsWith('.json')) : []
  const userData = []
  for (const name of files) {
    const userId = name.slice(0, -5)
    if (!accountIds.has(userId)) { skipped.push(`data without an account: ${name}`); continue }
    let data
    try {
      data = JSON.parse(readFileSync(join(userDataDir, name), 'utf8'))
    } catch (error) {
      throw new Error(`Cannot read ${join(userDataDir, name)} to move it into the database (${error.message}). Restore it from a backup or remove it, then restart.`, { cause: error })
    }
    if (typeof data !== 'object' || data === null) continue
    ensureRevisions(data)
    userData.push([userId, data])
  }

  let itemCount = 0
  let sessionCount = 0
  store.transaction(() => {
    for (const user of accounts) {
      store.users.create({
        id: user.id,
        email: user.email,
        displayName: String(user.displayName ?? user.email),
        passwordHash: user.passwordHash,
        createdAtMs: Number(user.createdAtMs) || now,
        lastLoginAtMs: user.lastLoginAtMs,
        lastSeenAtMs: user.lastSeenAtMs,
      })
    }
    for (const session of Array.isArray(legacy.sessions) ? legacy.sessions : []) {
      if (typeof session?.tokenHash !== 'string' || !accountIds.has(session.userId) || !(session.expiresAtMs > now)) continue
      store.importSession(session)
      sessionCount += 1
    }
    for (const [userId, data] of userData) {
      for (const [key, item] of Object.entries(data)) {
        if (typeof item?.value !== 'string') continue
        store.importItem(userId, key, item)
        itemCount += 1
      }
    }
    // Check before anything is renamed: the database must hold exactly what was read.
    const counts = store.counts()
    if (counts.users !== accounts.length || counts.items !== itemCount) {
      throw new Error(`Import check failed (accounts ${counts.users}/${accounts.length}, items ${counts.items}/${itemCount}); nothing was changed.`)
    }
    store.meta.set('migratedFromJsonAtMs', now)
  })

  // Keep the old files as they were, under a new name.
  const suffix = `.migrated-${stamp(now)}`
  if (existsSync(usersFile)) renameSync(usersFile, usersFile + suffix)
  if (existsSync(userDataDir)) renameSync(userDataDir, userDataDir + suffix)
  for (const reason of skipped) log.warn?.(`[database] not imported: ${reason}`)
  log.log?.(`[database] moved ${accounts.length} accounts, ${itemCount} saved items and ${sessionCount} sessions from JSON files into the database; old files kept as *${suffix}`)
  return { imported: true, users: accounts.length, items: itemCount, sessions: sessionCount, skipped }
}
