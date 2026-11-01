import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackupService } from './backup.mjs'
import { MIGRATIONS, openDatabase } from './database.mjs'
import { importLegacyJson } from './migrate.mjs'

const dirs = []
const stores = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'th-db-'))
  dirs.push(dir)
  const store = openDatabase(join(dir, 'tradehorizon.db'))
  stores.push(store)
  return { dir, store }
}

const quiet = { log() {}, warn() {} }
const account = (id, email, extra = {}) => ({ id, email, displayName: id, passwordHash: 'salt:hash', createdAtMs: 1000, ...extra })

describe('database: accounts and sessions', () => {
  it('creates, finds and counts accounts; emails are unique', () => {
    const { store } = fresh()
    store.users.create(account('u1', 'a@x.com'))
    expect(store.users.byEmail('a@x.com')).toMatchObject({ id: 'u1', displayName: 'u1', passwordHash: 'salt:hash', createdAtMs: 1000 })
    expect(store.users.get('nope')).toBeUndefined()
    expect(() => store.users.create(account('u2', 'a@x.com'))).toThrow()
    store.users.setLastLogin('u1', 5000)
    store.users.setPassword('u1', 'new:hash')
    expect(store.users.get('u1')).toMatchObject({ lastLoginAtMs: 5000, passwordHash: 'new:hash' })
    expect(store.users.count()).toBe(1)
  })

  it('finds the user of a live session only, and signs out', () => {
    const { store } = fresh()
    store.users.create(account('u1', 'a@x.com'))
    store.sessions.create('t1', 'u1', 10_000, 0)
    store.sessions.create('t2', 'u1', 10_000, 0)
    expect(store.sessions.user('t1', 5000)?.id).toBe('u1')
    expect(store.sessions.user('t1', 20_000)).toBeUndefined()
    store.sessions.removeOthers('u1', 't1')
    expect(store.sessions.user('t2', 5000)).toBeUndefined()
    expect(store.sessions.countForUser('u1', 5000)).toBe(1)
    store.sessions.remove('t1')
    expect(store.sessions.countActive(5000)).toBe(0)
  })

  it('deleting an account removes its sessions and data', () => {
    const { store } = fresh()
    store.users.create(account('u1', 'a@x.com'))
    store.sessions.create('t1', 'u1', 10_000, 0)
    store.data.write('u1', 'layouts:v1', '[]', 0)
    store.users.remove('u1')
    expect(store.counts()).toMatchObject({ users: 0, items: 0 })
    expect(store.sessions.user('t1', 5000)).toBeUndefined()
  })
})

describe('database: synced data', () => {
  it('follows the same revision rules as before (ok, conflict, outdated, unchanged)', () => {
    const { store } = fresh()
    store.users.create(account('u1', 'a@x.com'))
    const first = store.data.write('u1', 'layouts:v1', 'A', 0, 10, { id: 'pc-1234', name: 'PC' })
    expect(first).toMatchObject({ status: 'ok', item: { value: 'A', rev: 1, updatedAtMs: 10, by: 'pc-1234', byName: 'PC' } })
    expect(store.data.write('u1', 'theme:v1', 'dark', 0).item.rev).toBe(2)
    expect(store.data.write('u1', 'layouts:v1', 'B', 1).item.rev).toBe(3)
    expect(store.data.write('u1', 'layouts:v1', 'stale', 1)).toMatchObject({ status: 'conflict', item: { value: 'B', rev: 3 } })
    expect(store.data.write('u1', 'layouts:v1', 'x', undefined).status).toBe('outdated')
    expect(store.data.write('u1', 'layouts:v1', 'B', 3).item.rev).toBe(3) // same value: no new revision
    expect(store.data.get('u1', 'layouts:v1').value).toBe('B')
  })

  it('lists changes since a revision, the latest revision, sizes and server writes', () => {
    const { store } = fresh()
    store.users.create(account('u1', 'a@x.com'))
    store.users.create(account('u2', 'b@x.com'))
    store.data.write('u1', 'a', '1', 0)
    store.data.write('u1', 'b', 'ü', 0)
    store.data.store('u1', 'alerts:v1', '[]', 99)
    expect(Object.keys(store.data.since('u1', 1)).sort()).toEqual(['alerts:v1', 'b'])
    expect(store.data.latestRev('u1')).toBe(3)
    expect(store.data.get('u1', 'alerts:v1')).toMatchObject({ rev: 3, by: 'server' })
    expect(store.data.bytes('u1')).toBe(1 + 2 + 2) // bytes, not characters
    expect(store.data.usersWithKey('alerts:v1')).toEqual(['u1'])
    expect(store.data.latestRev('u2')).toBe(0)
    expect(store.data.keyCount('u1')).toBe(3)
  })
})

describe('moving the old JSON files into the database', () => {
  function legacyFiles(dir, { users, sessions = [], data = {} }) {
    writeFileSync(join(dir, 'users.json'), JSON.stringify({ users, sessions }))
    mkdirSync(join(dir, 'userdata'))
    for (const [userId, items] of Object.entries(data)) writeFileSync(join(dir, 'userdata', `${userId}.json`), JSON.stringify(items))
  }

  it('imports accounts, live sessions and every item, keeps revisions, and keeps the old files renamed', () => {
    const { dir, store } = fresh()
    legacyFiles(dir, {
      users: [account('u1', 'A@X.com', { lastLoginAtMs: 7 }), account('u2', 'b@x.com')],
      sessions: [{ tokenHash: 'live', userId: 'u1', expiresAtMs: 9e15 }, { tokenHash: 'old', userId: 'u1', expiresAtMs: 1 }],
      data: {
        u1: { 'layouts:v1': { value: '[{"id":"l"}]', updatedAtMs: 5, rev: 4, by: 'pc-1234', byName: 'PC' }, 'theme:v1': { value: 'dark', updatedAtMs: 6 } },
        orphan: { 'theme:v1': { value: 'light', updatedAtMs: 1 } },
      },
    })
    const result = importLegacyJson(store, dir, { now: 1000, log: quiet })
    expect(result).toMatchObject({ imported: true, users: 2, items: 2, sessions: 1 })
    expect(result.skipped).toEqual(['data without an account: orphan.json'])
    expect(store.users.byEmail('a@x.com')).toMatchObject({ id: 'u1', lastLoginAtMs: 7 })
    expect(store.sessions.user('live', 2000)?.id).toBe('u1')
    expect(store.data.get('u1', 'layouts:v1')).toMatchObject({ rev: 4, by: 'pc-1234', byName: 'PC' })
    expect(store.data.get('u1', 'theme:v1').rev).toBe(5) // item that had no revision gets the next one
    expect(existsSync(join(dir, 'users.json'))).toBe(false)
    const names = readdirSync(dir)
    expect(names.some((name) => name.startsWith('users.json.migrated-'))).toBe(true)
    expect(names.some((name) => name.startsWith('userdata.migrated-'))).toBe(true)
    // Running again does nothing: the database already has the accounts.
    expect(importLegacyJson(store, dir, { log: quiet })).toMatchObject({ imported: false })
  })

  it('keeps the first account when two share an email, and refuses to start on an unreadable users.json', () => {
    const one = fresh()
    legacyFiles(one.dir, { users: [account('u1', 'a@x.com'), account('u2', 'A@x.com')] })
    expect(importLegacyJson(one.store, one.dir, { log: quiet })).toMatchObject({ imported: true, users: 1 })

    const two = fresh()
    writeFileSync(join(two.dir, 'users.json'), '{ not json')
    expect(() => importLegacyJson(two.store, two.dir, { log: quiet })).toThrow(/Cannot read/)
    expect(existsSync(join(two.dir, 'users.json'))).toBe(true)
    expect(two.store.users.count()).toBe(0)
  })

  it('does nothing without old files', () => {
    const { dir, store } = fresh()
    expect(importLegacyJson(store, dir, { log: quiet })).toEqual({ imported: false, reason: 'no old JSON files' })
  })
})

describe('backups', () => {
  it('copies the database, keeps the newest copies and only runs when due', () => {
    const { dir, store } = fresh()
    store.users.create(account('u1', 'a@x.com'))
    let time = Date.UTC(2026, 10, 1)
    const backups = createBackupService({ store, dir: join(dir, 'backups'), keep: 2, everyMs: 1000, log: quiet, now: () => time })
    for (let index = 0; index < 3; index += 1) { backups.run(); time += 2000 }
    const status = backups.status()
    expect(status.count).toBe(2)
    expect(status.newest.name).toMatch(/^tradehorizon-\d{8}-\d{6}\.db$/)

    // The copy is a working database with the account in it.
    const copy = openDatabase(join(dir, 'backups', status.newest.name))
    stores.push(copy)
    expect(copy.users.byEmail('a@x.com')?.id).toBe('u1')

    const before = backups.status().lastBackupAtMs
    backups.runIfDue() // last one was 2000 ms ago, every 1000 ms: due
    expect(backups.status().lastBackupAtMs).toBeGreaterThan(before)
    const after = backups.status().lastBackupAtMs
    backups.runIfDue() // same time: not due
    expect(backups.status().lastBackupAtMs).toBe(after)
  })
})

describe('schema upgrades', () => {
  it('upgrades a database made by v0.19 (schema 1) without losing anything, and marks temporary passwords', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const dir = mkdtempSync(join(tmpdir(), 'th-db-'))
    dirs.push(dir)
    const file = join(dir, 'tradehorizon.db')
    const old = new DatabaseSync(file)
    old.exec(MIGRATIONS[1])
    old.exec('PRAGMA user_version = 1')
    old.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run('u1', 'a@x.com', 'Ann', 'salt:hash', 5)
    old.prepare('INSERT INTO user_data (user_id, key, value, updated_at, rev) VALUES (?, ?, ?, ?, ?)').run('u1', 'layouts:v1', '[]', 6, 1)
    old.close()

    const store = openDatabase(file)
    stores.push(store)
    expect(store.users.get('u1')).toMatchObject({ email: 'a@x.com', passwordTemporary: false })
    expect(store.data.get('u1', 'layouts:v1')).toMatchObject({ value: '[]', rev: 1 })
    store.users.setPassword('u1', 'temp:hash', true)
    expect(store.users.get('u1')).toMatchObject({ passwordHash: 'temp:hash', passwordTemporary: true })
    store.users.setPassword('u1', 'own:hash')
    expect(store.users.get('u1').passwordTemporary).toBe(false)
  })
})
