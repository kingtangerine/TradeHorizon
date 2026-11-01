// SQLite storage for accounts, sessions and every user's synced data (layouts, drawings, alerts, ...).
// One file (server/data/tradehorizon.db), written a row at a time instead of rewriting whole JSON files.
// Uses Node's built-in SQLite (node:sqlite, Node 22.13+), so nothing has to be installed or compiled on the server.
import { decideWrite } from './userdata.mjs'

let sqlite
try {
  sqlite = await import('node:sqlite')
} catch {
  throw new Error(`TradeHorizon needs Node.js 22.13 or newer for its built-in database (this server runs ${process.version}). Choose a newer Node.js version for the app and restart it.`)
}

/** Bumped when the tables change; each step below runs once, in order, on databases older than it. */
const SCHEMA_VERSION = 2
export const MIGRATIONS = {
  1: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER,
      last_seen_at INTEGER
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE INDEX sessions_expiry ON sessions(expires_at);
    CREATE TABLE user_data (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      rev INTEGER NOT NULL,
      saved_by TEXT,
      saved_by_name TEXT,
      PRIMARY KEY (user_id, key)
    );
    CREATE INDEX user_data_rev ON user_data(user_id, rev);
    CREATE INDEX user_data_key ON user_data(key);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // An admin-set temporary password: the user is asked to choose their own after signing in.
  2: 'ALTER TABLE users ADD COLUMN password_temporary INTEGER NOT NULL DEFAULT 0;',
}

const toUser = (row) => row && ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  passwordHash: row.password_hash,
  createdAtMs: row.created_at,
  lastLoginAtMs: row.last_login_at ?? undefined,
  lastSeenAtMs: row.last_seen_at ?? undefined,
  passwordTemporary: row.password_temporary === 1,
})

const toItem = (row) => row && ({
  value: row.value,
  updatedAtMs: row.updated_at,
  rev: row.rev,
  ...(row.saved_by ? { by: row.saved_by } : {}),
  ...(row.saved_by_name ? { byName: row.saved_by_name } : {}),
})

const itemsOf = (rows) => Object.fromEntries(rows.map((row) => [row.key, toItem(row)]))

export function openDatabase(file) {
  const db = new sqlite.DatabaseSync(file)
  // WAL: readers never wait for the writer and a crash cannot leave half a write. NORMAL is safe with WAL.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

  const currentVersion = db.prepare('PRAGMA user_version').get().user_version
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(`The database was created by a newer TradeHorizon (schema ${currentVersion}). Update the app instead of going back to this version.`)
  }
  for (let next = currentVersion + 1; next <= SCHEMA_VERSION; next += 1) {
    transaction(() => {
      db.exec(MIGRATIONS[next])
      db.exec(`PRAGMA user_version = ${next}`)
    })
  }

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    allUsers: db.prepare('SELECT * FROM users ORDER BY created_at'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    insertUser: db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at, last_login_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ?, password_temporary = ? WHERE id = ?'),
    setLastLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    setLastSeen: db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
    userStats: db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(created_at > ?) AS signups24h, SUM(created_at > ?) AS signups7d,
      SUM(last_seen_at > ?) AS active24h, SUM(last_seen_at > ?) AS active7d
      FROM users`),

    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    userSessions: db.prepare('SELECT expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY expires_at DESC'),
    countSessions: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?'),
    countUserSessions: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?'),

    allItems: db.prepare('SELECT * FROM user_data WHERE user_id = ?'),
    itemsSince: db.prepare('SELECT * FROM user_data WHERE user_id = ? AND rev > ?'),
    item: db.prepare('SELECT * FROM user_data WHERE user_id = ? AND key = ?'),
    latestRev: db.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM user_data WHERE user_id = ?'),
    countKeys: db.prepare('SELECT COUNT(*) AS n FROM user_data WHERE user_id = ?'),
    bytes: db.prepare('SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS n FROM user_data WHERE user_id = ?'),
    usersWithKey: db.prepare('SELECT user_id FROM user_data WHERE key = ?'),
    upsertItem: db.prepare(`INSERT INTO user_data (user_id, key, value, updated_at, rev, saved_by, saved_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, rev = excluded.rev,
      saved_by = excluded.saved_by, saved_by_name = excluded.saved_by_name`),
    countItems: db.prepare('SELECT COUNT(*) AS n FROM user_data'),

    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
  }

  /** Stores a value as the user's next revision. */
  function storeItem(userId, key, value, now, by) {
    const rev = q.latestRev.get(userId).rev + 1
    q.upsertItem.run(userId, key, value, now, rev, by?.id ?? null, by?.name ?? null)
    return toItem(q.item.get(userId, key))
  }

  const users = {
    get: (id) => toUser(q.userById.get(id)),
    byEmail: (email) => toUser(q.userByEmail.get(email)),
    all: () => q.allUsers.all().map(toUser),
    count: () => q.countUsers.get().n,
    create(user) {
      q.insertUser.run(user.id, user.email, user.displayName, user.passwordHash, user.createdAtMs, user.lastLoginAtMs ?? null, user.lastSeenAtMs ?? null)
      return users.get(user.id)
    },
    /** `temporary`: set by an admin, to be replaced by the user after signing in. */
    setPassword: (id, passwordHash, temporary = false) => { q.setPassword.run(passwordHash, temporary ? 1 : 0, id) },
    setLastLogin: (id, atMs) => { q.setLastLogin.run(atMs, id) },
    setLastSeen: (id, atMs) => { q.setLastSeen.run(atMs, id) },
    /** Removes the account; its sessions and data go with it (foreign keys). */
    remove: (id) => { q.deleteUser.run(id) },
    stats(now) {
      const day = 86_400_000
      const row = q.userStats.get(now - day, now - 7 * day, now - day, now - 7 * day)
      return { total: row.total, signups24h: row.signups24h ?? 0, signups7d: row.signups7d ?? 0, active24h: row.active24h ?? 0, active7d: row.active7d ?? 0 }
    },
  }

  const sessions = {
    create(tokenHash, userId, expiresAtMs, now = Date.now()) {
      q.purgeSessions.run(now)
      q.insertSession.run(tokenHash, userId, expiresAtMs)
    },
    /** The signed-in user for a session, or undefined when the session is unknown or expired. */
    user: (tokenHash, now = Date.now()) => toUser(q.sessionUser.get(tokenHash, now)),
    remove: (tokenHash) => { q.deleteSession.run(tokenHash) },
    removeForUser: (userId) => { q.deleteUserSessions.run(userId) },
    removeOthers: (userId, keepTokenHash) => { q.deleteOtherSessions.run(userId, keepTokenHash) },
    forUser: (userId, now = Date.now()) => q.userSessions.all(userId, now).map((row) => ({ expiresAtMs: row.expires_at })),
    countActive: (now = Date.now()) => q.countSessions.get(now).n,
    countForUser: (userId, now = Date.now()) => q.countUserSessions.get(userId, now).n,
  }

  const data = {
    /** Every item of a user as { key: { value, updatedAtMs, rev, by?, byName? } } (the shape userdata.mjs works with). */
    all: (userId) => itemsOf(q.allItems.all(userId)),
    since: (userId, rev) => itemsOf(q.itemsSince.all(userId, rev)),
    get: (userId, key) => toItem(q.item.get(userId, key)),
    value: (userId, key) => q.item.get(userId, key)?.value,
    latestRev: (userId) => q.latestRev.get(userId).rev,
    keyCount: (userId) => q.countKeys.get(userId).n,
    bytes: (userId) => q.bytes.get(userId).n,
    usersWithKey: (key) => q.usersWithKey.all(key).map((row) => row.user_id),
    /** A device's write, checked against the revision it was based on (see decideWrite). */
    write(userId, key, value, baseRev, now = Date.now(), by) {
      return transaction(() => {
        const decision = decideWrite(data.get(userId, key), value, baseRev)
        if (decision.status !== 'store') return decision
        return { status: 'ok', item: storeItem(userId, key, value, now, by) }
      })
    },
    /** A write by the server itself (e.g. an alert that fired): always stored as a new revision. */
    store: (userId, key, value, now = Date.now(), by = { id: 'server', name: 'TradeHorizon server' }) =>
      transaction(() => storeItem(userId, key, value, now, by)),
  }

  return {
    users,
    sessions,
    data,
    transaction,
    meta: {
      get: (key) => q.getMeta.get(key)?.value,
      set: (key, value) => { q.setMeta.run(key, String(value)) },
    },
    counts: () => ({ users: q.countUsers.get().n, items: q.countItems.get().n, sessions: q.countSessions.get(Date.now()).n }),
    /** Writes a consistent copy of the whole database to `targetFile` while the app keeps running. */
    backup(targetFile) {
      db.prepare('VACUUM INTO ?').run(targetFile)
    },
    /** Low-level insert used by the one-time import from the old JSON files. */
    importItem: (userId, key, item) => {
      q.upsertItem.run(userId, key, item.value, item.updatedAtMs ?? Date.now(), item.rev, item.by ?? null, item.byName ?? null)
    },
    importSession: (session) => { q.insertSession.run(session.tokenHash, session.userId, session.expiresAtMs) },
    close: () => db.close(),
  }
}
