import { describe, expect, it } from 'vitest'
import { formatAgo, formatBytes, formatDuration, sortAdminUsers, type AdminUser } from './admin'

const user = (id: string, extra: Partial<AdminUser>): AdminUser => ({
  id, email: `${id}@x.com`, displayName: id, createdAtMs: 0, lastLoginAtMs: null, lastSeenAtMs: null, isAdmin: false,
  sessions: 0, telegram: false, pushDevices: 0, storageBytes: 0, items: 0, bytes: 0, lastSyncAtMs: null,
  counts: { layouts: 0, drawings: 0, alerts: 0, activeAlerts: 0, openTabs: 0, watchlistSymbols: 0, layoutFolders: 0, templates: 0 },
  devices: [], ...extra,
})

describe('admin helpers', () => {
  it('formats sizes, ages and durations', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1048576)).toBe('5.0 MB')
    const now = 10_000_000_000
    expect(formatAgo(null, now)).toBe('never')
    expect(formatAgo(now - 30_000, now)).toBe('just now')
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(formatAgo(now - 86_400_000, now)).toBe('1 day ago')
    expect(formatDuration(90)).toBe('1m 30s')
    expect(formatDuration(3 * 86_400 + 7200)).toBe('3d 2h')
  })

  it('sorts and searches users', () => {
    const users = [
      user('ann', { lastSeenAtMs: 5, createdAtMs: 1, storageBytes: 10 }),
      user('bob', { lastSeenAtMs: 9, createdAtMs: 3, storageBytes: 5, displayName: 'Bob' }),
      user('cy', { lastSeenAtMs: null, createdAtMs: 2, storageBytes: 99 }),
    ]
    expect(sortAdminUsers(users, 'active', '').map((item) => item.id)).toEqual(['bob', 'ann', 'cy'])
    expect(sortAdminUsers(users, 'newest', '').map((item) => item.id)).toEqual(['bob', 'cy', 'ann'])
    expect(sortAdminUsers(users, 'storage', '').map((item) => item.id)).toEqual(['cy', 'ann', 'bob'])
    expect(sortAdminUsers(users, 'name', 'b').map((item) => item.id)).toEqual(['bob'])
  })
})
