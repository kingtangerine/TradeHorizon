import { getSessionToken } from './auth'
import { apiUrl } from '../platform/api'

// Admin API (server/index.ts, handleAdmin). The server decides who is an admin (TH_ADMIN_EMAILS).

/** How much a user has saved, per kind of item (layouts, drawings, alerts and so on). */
export interface AdminCounts {
  readonly layouts: number
  readonly drawings: number
  readonly alerts: number
  readonly activeAlerts: number
  readonly openTabs: number
  readonly watchlistSymbols: number
  readonly layoutFolders: number
  readonly templates: number
}

/** One account as listed on the admin page: profile, activity timestamps (ms), linked services and storage use. */
export interface AdminUser {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly createdAtMs: number
  readonly lastLoginAtMs: number | null
  readonly lastSeenAtMs: number | null
  readonly isAdmin: boolean
  readonly sessions: number
  readonly telegram: boolean
  readonly pushDevices: number
  readonly storageBytes: number
  readonly items: number
  readonly bytes: number
  readonly lastSyncAtMs: number | null
  readonly counts: AdminCounts
  readonly devices: ReadonlyArray<{ readonly name: string; readonly lastSaveAtMs: number }>
}

/** One stored data entry of a user (a storage key), with its size, last save and revision. */
export interface AdminUserItem {
  readonly key: string
  readonly bytes: number
  readonly updatedAtMs: number | null
  readonly rev: number | null
  readonly savedBy: string | null
  readonly counts: Readonly<Record<string, number>>
}

/** A user with their stored entries and active sessions, as returned for the admin user detail view. */
export interface AdminUserDetail {
  readonly user: AdminUser
  readonly items: readonly AdminUserItem[]
  readonly sessions: ReadonlyArray<{ readonly expiresAtMs: number }>
}

/** Server health, database, background services and user totals shown on the admin overview. */
export interface AdminOverview {
  readonly server: {
    readonly version: string
    readonly node: string
    readonly platform: string
    readonly hostname: string
    readonly pid: number
    readonly startedAtMs: number
    readonly uptimeSec: number
    readonly startsLast24h: number
    readonly memoryMb: { readonly app: number; readonly heapUsed: number }
    readonly eventLoopDelayMs: { readonly p50: number; readonly p99: number; readonly max: number }
    readonly hostMemoryMb: { readonly total: number; readonly free: number }
    readonly loadAverage: readonly number[]
    readonly dataDir: string
    readonly dataBytes: number
    readonly disk: { readonly freeBytes: number; readonly totalBytes: number } | null
    readonly envFile: readonly string[] | null
  }
  readonly database: AdminDatabase
  readonly services: {
    readonly telegram: { readonly state: string; readonly bot?: string | null; readonly problem?: string }
    readonly telegramLinkedUsers: number
    readonly pushReady: boolean
    readonly pushDevices: number
    readonly keepAlive: { readonly origin: string | null; readonly lastPingAtMs: number | null; readonly lastPingOk: boolean }
    readonly marketsLoaded: number
    readonly marketsAgeMin: number | null
    readonly alertsWatched: number
    readonly notificationQueues: Readonly<
      Record<
        'telegram' | 'push',
        {
          readonly pending: number
          readonly sent: number
          readonly retried: number
          readonly failed: number
          readonly dropped: number
          readonly pausedForSec: number
          readonly lastError: string | null
        }
      >
    >
    readonly alertPrices: {
      readonly symbols: number
      readonly live: number
      readonly polled: number
      readonly feed: Readonly<
        Record<'binance' | 'bybit', { readonly connected: boolean; readonly symbols: number; readonly lastMessageAgoSec: number | null }>
      >
    }
  }
  readonly users: {
    readonly total: number
    readonly admins: number
    readonly signups24h: number
    readonly signups7d: number
    readonly active24h: number
    readonly active7d: number
    readonly activeSessions: number
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${getSessionToken() ?? ''}`, 'Content-Type': 'application/json' },
  })
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`)
  return body
}

/** Fetches the admin overview. Rejects with the server message when the caller is not an admin or the request fails. */
export const fetchAdminOverview = () => call<AdminOverview>('/api/admin/overview')
/** Fetches every account for the admin user list. */
export const fetchAdminUsers = () => call<{ users: AdminUser[] }>('/api/admin/users').then((body) => body.users)
/** Fetches one account with its stored entries and sessions. */
export const fetchAdminUser = (id: string) => call<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`)
/** The SQLite database file and its backups, as reported to the admin page. */
export interface AdminDatabase {
  readonly file: string
  readonly bytes: number
  readonly users: number
  readonly items: number
  readonly sessions: number
  readonly migratedFromJsonAtMs: number | null
  readonly backups: {
    readonly dir: string
    readonly keep: number
    readonly count: number
    readonly lastBackupAtMs: number | null
    readonly newest: { readonly name: string; readonly bytes: number; readonly createdAtMs: number } | null
    readonly lastError: string | null
  }
}

/** Asks the server to write a database backup right away; resolves with the updated database info. */
export const backUpNow = () => call<{ ok: true; database: AdminDatabase }>('/api/admin/backup', { method: 'POST' })
/** Gives a user a new temporary password (returned in plain text) that they must change at next login. */
export const setTemporaryPassword = (id: string) =>
  call<{ password: string }>(`/api/admin/users/${encodeURIComponent(id)}/password`, { method: 'POST' })
/** Ends every session of a user, signing them out on all devices. */
export const signOutUser = (id: string) => call<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/signout`, { method: 'POST' })
/** Permanently deletes a user and their data. The server requires `confirmEmail` to match the account email. */
export const deleteUser = (id: string, confirmEmail: string) =>
  call<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/delete`, { method: 'POST', body: JSON.stringify({ confirmEmail }) })

/** Human-readable size from a byte count, e.g. "512 B", "3.4 MB" (1024-based units). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", or a date further back. */
export function formatAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return 'never'
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`
  if (seconds < 30 * 86_400) return `${Math.round(seconds / 86_400)} day${Math.round(seconds / 86_400) === 1 ? '' : 's'} ago`
  return new Date(ms).toLocaleDateString()
}

/** Compact duration from seconds, e.g. "2d 5h", "3h 12m" or "4m 30s". */
export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m ${seconds % 60}s`
}

/** Sort orders for the admin user list. */
export type AdminSort = 'active' | 'newest' | 'storage' | 'name'

/** Users whose email or display name contains `query` (case-insensitive), sorted by `sort`. Returns a new array. */
export function sortAdminUsers(users: readonly AdminUser[], sort: AdminSort, query: string): AdminUser[] {
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? users.filter((user) => user.email.toLowerCase().includes(needle) || user.displayName.toLowerCase().includes(needle))
    : [...users]
  const compare: Record<AdminSort, (a: AdminUser, b: AdminUser) => number> = {
    active: (a, b) => (b.lastSeenAtMs ?? 0) - (a.lastSeenAtMs ?? 0),
    newest: (a, b) => b.createdAtMs - a.createdAtMs,
    storage: (a, b) => b.storageBytes - a.storageBytes,
    name: (a, b) => a.displayName.localeCompare(b.displayName),
  }
  return filtered.sort(compare[sort])
}
