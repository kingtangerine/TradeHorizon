// SQLite storage for accounts, sessions and every user's synced data (layouts, drawings, alerts, ...).
// One file (server/data/tradehorizon.db), written a row at a time instead of rewriting whole JSON files.
// Uses Node's built-in SQLite (node:sqlite, Node 22.13+), so nothing has to be installed or compiled on the server.
import type { DatabaseSync, SQLInputValue, SQLOutputValue, StatementResultingChanges } from 'node:sqlite'
import { decideWrite } from './userdata.ts'
import type { DataItem, Device, UserData, WriteResult } from './userdata.ts'

/** An account as the rest of the server sees it. */
export interface User {
  id: string
  email: string
  displayName: string
  passwordHash: string
  createdAtMs: number
  lastLoginAtMs?: number
  lastSeenAtMs?: number
  /** Set by an admin reset: the user is asked to choose their own password after signing in. */
  passwordTemporary: boolean
}

/** A new account for users.create (it starts without a temporary password). */
export interface NewUser {
  id: string
  email: string
  displayName: string
  passwordHash: string
  createdAtMs: number
  lastLoginAtMs?: number
  lastSeenAtMs?: number
}

/** A sign-in session; only the hash of its token is stored. */
export interface Session {
  tokenHash: string
  userId: string
  expiresAtMs: number
}

/** An item written as it is by the one-time import (old files may lack `updatedAtMs`). */
export interface ImportedItem {
  value: string
  updatedAtMs?: number
  rev: number
  by?: string
  byName?: string
}

/** Accounts, sign-ups and active users over the last day and week, for the admin page. */
export interface UserStats {
  total: number
  signups24h: number
  signups7d: number
  active24h: number
  active7d: number
}

/** The storage returned by openDatabase. */
export type Store = ReturnType<typeof openDatabase>

let sqlite: { DatabaseSync: typeof DatabaseSync }
try {
  sqlite = await import('node:sqlite')
} catch {
  throw new Error(`TradeHorizon needs Node.js 22.13 or newer for its built-in database (this server runs ${process.version}). Choose a newer Node.js version for the app and restart it.`)
}

/** Bumped when the tables change; each step below runs once, in order, on databases older than it. */
const SCHEMA_VERSION = 2
export const MIGRATIONS: Record<number, string> = {
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

// Rows come back as plain records of SQLite values. The shapes of the tables above, typed in one place
// (see `query` and `aggregate` in openDatabase):
type Row = Record<string, SQLOutputValue>
type UserRow = {
  id: string
  email: string
  display_name: string
  password_hash: string
  created_at: number
  last_login_at: number | null
  last_seen_at: number | null
  password_temporary: number
}
type ItemRow = {
  user_id: string
  key: string
  value: string
  updated_at: number
  rev: number
  saved_by: string | null
  saved_by_name: string | null
}

/** A prepared statement typed by the rows it returns (the columns its SELECT names). */
interface Query<R extends Row> {
  get(...params: SQLInputValue[]): R | undefined
  all(...params: SQLInputValue[]): R[]
  run(...params: SQLInputValue[]): StatementResultingChanges
}

/** A statement that always returns exactly one row (COUNT, MAX, SUM, PRAGMA). */
interface Aggregate<R extends Row> {
  get(...params: SQLInputValue[]): R
}

function toUser(row: UserRow): User
function toUser(row: UserRow | undefined): User | undefined
function toUser(row: UserRow | undefined): User | undefined {
  return row && ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAtMs: row.created_at,
    lastLoginAtMs: row.last_login_at ?? undefined,
    lastSeenAtMs: row.last_seen_at ?? undefined,
    passwordTemporary: row.password_temporary === 1,
  })
}

function toItem(row: ItemRow): DataItem
function toItem(row: ItemRow | undefined): DataItem | undefined
function toItem(row: ItemRow | undefined): DataItem | undefined {
  return row && ({
    value: row.value,
    updatedAtMs: row.updated_at,
    rev: row.rev,
    ...(row.saved_by ? { by: row.saved_by } : {}),
    ...(row.saved_by_name ? { byName: row.saved_by_name } : {}),
  })
}

const itemsOf = (rows: ItemRow[]): UserData => Object.fromEntries(rows.map((row) => [row.key, toItem(row)]))

export function openDatabase(file: string) {
  const db = new sqlite.DatabaseSync(file)
  // The one place where rows get their table's shape (R); SQLite itself only promises SQLite values.
  function query<R extends Row = Row>(sql: string): Query<R> {
    const statement = db.prepare(sql)
    return {
      get: (...params) => statement.get(...params) as R | undefined,
      all: (...params) => statement.all(...params) as R[],
      run: (...params) => statement.run(...params),
    }
  }
  function aggregate<R extends Row>(sql: string): Aggregate<R> {
    const statement = db.prepare(sql)
    return { get: (...params) => statement.get(...params) as R }
  }
  // WAL: readers never wait for the writer and a crash cannot leave half a write. NORMAL is safe with WAL.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

  const currentVersion = aggregate<{ user_version: number }>('PRAGMA user_version').get().user_version
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(`The database was created by a newer TradeHorizon (schema ${currentVersion}). Update the app instead of going back to this version.`)
  }
  for (let next = currentVersion + 1; next <= SCHEMA_VERSION; next += 1) {
    transaction(() => {
      db.exec(MIGRATIONS[next])
      db.exec(`PRAGMA user_version = ${next}`)
    })
  }

  function transaction<T>(work: () => T): T {
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
    userById: query<UserRow>('SELECT * FROM users WHERE id = ?'),
    userByEmail: query<UserRow>('SELECT * FROM users WHERE email = ?'),
    allUsers: query<UserRow>('SELECT * FROM users ORDER BY created_at'),
    countUsers: aggregate<{ n: number }>('SELECT COUNT(*) AS n FROM users'),
    insertUser: db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at, last_login_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ?, password_temporary = ? WHERE id = ?'),
    setLastLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    setLastSeen: db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
    userStats: aggregate<{ total: number, signups24h: number | null, signups7d: number | null, active24h: number | null, active7d: number | null }>(`SELECT
      COUNT(*) AS total,
      SUM(created_at > ?) AS signups24h, SUM(created_at > ?) AS signups7d,
      SUM(last_seen_at > ?) AS active24h, SUM(last_seen_at > ?) AS active7d
      FROM users`),

    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: query<UserRow>('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    userSessions: query<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY expires_at DESC'),
    countSessions: aggregate<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?'),
    countUserSessions: aggregate<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?'),

    allItems: query<ItemRow>('SELECT * FROM user_data WHERE user_id = ?'),
    itemsSince: query<ItemRow>('SELECT * FROM user_data WHERE user_id = ? AND rev > ?'),
    item: query<ItemRow>('SELECT * FROM user_data WHERE user_id = ? AND key = ?'),
    latestRev: aggregate<{ rev: number }>('SELECT COALESCE(MAX(rev), 0) AS rev FROM user_data WHERE user_id = ?'),
    countKeys: aggregate<{ n: number }>('SELECT COUNT(*) AS n FROM user_data WHERE user_id = ?'),
    bytes: aggregate<{ n: number }>('SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS n FROM user_data WHERE user_id = ?'),
    usersWithKey: query<{ user_id: string }>('SELECT user_id FROM user_data WHERE key = ?'),
    upsertItem: db.prepare(`INSERT INTO user_data (user_id, key, value, updated_at, rev, saved_by, saved_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, rev = excluded.rev,
      saved_by = excluded.saved_by, saved_by_name = excluded.saved_by_name`),
    countItems: aggregate<{ n: number }>('SELECT COUNT(*) AS n FROM user_data'),

    getMeta: query<{ value: string }>('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
  }

  /** Stores a value as the user's next revision. */
  function storeItem(userId: string, key: string, value: string, now: number, by: Device | undefined): DataItem {
    const rev = q.latestRev.get(userId).rev + 1
    q.upsertItem.run(userId, key, value, now, rev, by?.id ?? null, by?.name ?? null)
    return toItem(q.item.get(userId, key)!) // just written in this transaction
  }

  const users = {
    get: (id: string) => toUser(q.userById.get(id)),
    byEmail: (email: string) => toUser(q.userByEmail.get(email)),
    all: () => q.allUsers.all().map((row) => toUser(row)),
    count: () => q.countUsers.get().n,
    create(user: NewUser): User {
      q.insertUser.run(user.id, user.email, user.displayName, user.passwordHash, user.createdAtMs, user.lastLoginAtMs ?? null, user.lastSeenAtMs ?? null)
      return users.get(user.id)! // just inserted
    },
    /** `temporary`: set by an admin, to be replaced by the user after signing in. */
    setPassword: (id: string, passwordHash: string, temporary = false) => { q.setPassword.run(passwordHash, temporary ? 1 : 0, id) },
    setLastLogin: (id: string, atMs: number) => { q.setLastLogin.run(atMs, id) },
    setLastSeen: (id: string, atMs: number) => { q.setLastSeen.run(atMs, id) },
    /** Removes the account; its sessions and data go with it (foreign keys). */
    remove: (id: string) => { q.deleteUser.run(id) },
    stats(now: number): UserStats {
      const day = 86_400_000
      const row = q.userStats.get(now - day, now - 7 * day, now - day, now - 7 * day)
      return { total: row.total, signups24h: row.signups24h ?? 0, signups7d: row.signups7d ?? 0, active24h: row.active24h ?? 0, active7d: row.active7d ?? 0 }
    },
  }

  const sessions = {
    create(tokenHash: string, userId: string, expiresAtMs: number, now = Date.now()) {
      q.purgeSessions.run(now)
      q.insertSession.run(tokenHash, userId, expiresAtMs)
    },
    /** The signed-in user for a session, or undefined when the session is unknown or expired. */
    user: (tokenHash: string, now = Date.now()) => toUser(q.sessionUser.get(tokenHash, now)),
    remove: (tokenHash: string) => { q.deleteSession.run(tokenHash) },
    removeForUser: (userId: string) => { q.deleteUserSessions.run(userId) },
    removeOthers: (userId: string, keepTokenHash: string) => { q.deleteOtherSessions.run(userId, keepTokenHash) },
    forUser: (userId: string, now = Date.now()) => q.userSessions.all(userId, now).map((row) => ({ expiresAtMs: row.expires_at })),
    countActive: (now = Date.now()) => q.countSessions.get(now).n,
    countForUser: (userId: string, now = Date.now()) => q.countUserSessions.get(userId, now).n,
  }

  const data = {
    /** Every item of a user as { key: { value, updatedAtMs, rev, by?, byName? } } (the shape userdata.ts works with). */
    all: (userId: string) => itemsOf(q.allItems.all(userId)),
    since: (userId: string, rev: number) => itemsOf(q.itemsSince.all(userId, rev)),
    get: (userId: string, key: string) => toItem(q.item.get(userId, key)),
    value: (userId: string, key: string) => q.item.get(userId, key)?.value,
    latestRev: (userId: string) => q.latestRev.get(userId).rev,
    keyCount: (userId: string) => q.countKeys.get(userId).n,
    bytes: (userId: string) => q.bytes.get(userId).n,
    usersWithKey: (key: string) => q.usersWithKey.all(key).map((row) => row.user_id),
    /** A device's write, checked against the revision it was based on (see decideWrite). */
    write(userId: string, key: string, value: string, baseRev: unknown, now = Date.now(), by?: Device): WriteResult {
      return transaction(() => {
        const decision = decideWrite(data.get(userId, key), value, baseRev)
        if (decision.status !== 'store') return decision
        return { status: 'ok', item: storeItem(userId, key, value, now, by) }
      })
    },
    /** A write by the server itself (e.g. an alert that fired): always stored as a new revision. */
    store: (userId: string, key: string, value: string, now = Date.now(), by: Device = { id: 'server', name: 'TradeHorizon server' }) =>
      transaction(() => storeItem(userId, key, value, now, by)),
  }

  return {
    users,
    sessions,
    data,
    transaction,
    meta: {
      get: (key: string) => q.getMeta.get(key)?.value,
      set: (key: string, value: string | number) => { q.setMeta.run(key, String(value)) },
    },
    counts: () => ({ users: q.countUsers.get().n, items: q.countItems.get().n, sessions: q.countSessions.get(Date.now()).n }),
    /** Writes a consistent copy of the whole database to `targetFile` while the app keeps running. */
    backup(targetFile: string) {
      db.prepare('VACUUM INTO ?').run(targetFile)
    },
    /** Low-level insert used by the one-time import from the old JSON files. */
    importItem: (userId: string, key: string, item: ImportedItem) => {
      q.upsertItem.run(userId, key, item.value, item.updatedAtMs ?? Date.now(), item.rev, item.by ?? null, item.byName ?? null)
    },
    importSession: (session: Session) => { q.insertSession.run(session.tokenHash, session.userId, session.expiresAtMs) },
    close: () => db.close(),
  }
}
