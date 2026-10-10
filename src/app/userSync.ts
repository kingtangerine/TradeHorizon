import { getSessionToken } from './auth'

// Keeps every `trade-horizon:user:<id>:*` localStorage entry (workspace, layouts, drawings,
// alerts) in step with the server, so a user sees the same data on every computer.
// The rest of the app keeps reading and writing localStorage; this module mirrors it.
// Conflict rule: last write wins per key. Local edits that never reached the server win on load.

interface ServerItem {
  readonly value: string
  readonly updatedAtMs: number
}

interface KeyMeta {
  syncedAtMs: number
  dirty: boolean
}

type MetaMap = Record<string, KeyMeta>

const PUSH_DELAY_MS = 800
const PULL_TIMEOUT_MS = 5000

let stopActive: (() => void) | undefined

export interface SyncResult {
  /** True when the server had newer data that was written into this browser (the app should reload to show it). */
  readonly changed: boolean
}

/** True once this browser has synced this account before, so its local copy is a good starting point. */
export function hasSyncedBefore(userId: string): boolean {
  return Object.keys(readMeta(userId)).length > 0
}

function userPrefix(userId: string): string {
  return `trade-horizon:user:${userId}:`
}

function metaKey(userId: string): string {
  return `trade-horizon:sync:${userId}`
}

function readMeta(userId: string): MetaMap {
  try {
    const value = JSON.parse(localStorage.getItem(metaKey(userId)) ?? '{}') as unknown
    return typeof value === 'object' && value !== null ? value as MetaMap : {}
  } catch {
    return {}
  }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/**
 * Pulls the user's data from the server into localStorage, pushes anything the server
 * lacks, then keeps pushing local changes. Resolves once the initial pull is done (or
 * failed/timed out, in which case the app simply works from local data).
 */
export async function startUserSync(userId: string): Promise<SyncResult> {
  stopActive?.()
  const token = getSessionToken()
  if (!token) return { changed: false }

  const prefix = userPrefix(userId)
  const meta = readMeta(userId)
  const saveMeta = () => {
    try { localStorage.setItem(metaKey(userId), JSON.stringify(meta)) } catch { /* storage full or blocked */ }
  }
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let stopped = false

  const push = async (key: string, keepalive = false): Promise<void> => {
    const value = localStorage.getItem(key)
    if (value === null || stopped) return
    try {
      const response = await fetch('/api/data', {
        method: 'PUT',
        headers: authHeaders(token),
        body: JSON.stringify({ key: key.slice(prefix.length), value }),
        keepalive: keepalive && value.length < 60_000,
      })
      if (!response.ok) return
      const { updatedAtMs } = await response.json() as { updatedAtMs: number }
      // Only clear the flag if nothing changed while the request was in flight.
      if (localStorage.getItem(key) === value) meta[key] = { syncedAtMs: updatedAtMs, dirty: false }
      saveMeta()
    } catch { /* offline: stays dirty and is retried on the next change or load */ }
  }

  const schedulePush = (key: string) => {
    clearTimeout(timers.get(key))
    timers.set(key, setTimeout(() => { timers.delete(key); void push(key) }, PUSH_DELAY_MS))
  }

  // Watch writes from the rest of the app.
  const originalSetItem = Storage.prototype.setItem
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    originalSetItem.call(this, key, value)
    if (this === localStorage && key.startsWith(prefix)) {
      meta[key] = { syncedAtMs: meta[key]?.syncedAtMs ?? 0, dirty: true }
      saveMeta()
      schedulePush(key)
    }
  }
  const flush = () => {
    for (const [key, timer] of timers) { clearTimeout(timer); timers.delete(key); void push(key, true) }
  }
  window.addEventListener('pagehide', flush)

  stopActive = () => {
    stopped = true
    Storage.prototype.setItem = originalSetItem
    window.removeEventListener('pagehide', flush)
    timers.forEach(clearTimeout)
    stopActive = undefined
  }

  // Initial pull.
  let items: Record<string, ServerItem> | undefined
  try {
    const response = await fetch('/api/data', { headers: authHeaders(token), signal: AbortSignal.timeout(PULL_TIMEOUT_MS) })
    if (response.ok) items = (await response.json() as { items: Record<string, ServerItem> }).items
  } catch { /* offline or server down: use local data */ }
  if (!items || stopped) return { changed: false }

  let applied = 0
  const remote = new Map(Object.entries(items).map(([suffix, item]) => [prefix + suffix, item]))
  for (const [key, item] of remote) {
    const local = localStorage.getItem(key)
    const known = meta[key]
    if (known?.dirty && local !== null) continue // unsynced local edits win; pushed below
    if (local === item.value) {
      meta[key] = { syncedAtMs: item.updatedAtMs, dirty: false }
      continue
    }
    // Server is newer than what this browser last synced, or this browser never synced: take the server copy.
    if (local !== null && !known) {
      try { localStorage.setItem(`trade-horizon:backup:${key}`, local) } catch { /* ignore */ }
    }
    originalSetItem.call(localStorage, key, item.value)
    meta[key] = { syncedAtMs: item.updatedAtMs, dirty: false }
    applied += 1
  }

  // Local keys the server does not have yet (first run after this feature) and unsynced edits.
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(prefix)) continue
    if (!remote.has(key) || meta[key]?.dirty) {
      meta[key] = { syncedAtMs: meta[key]?.syncedAtMs ?? 0, dirty: true }
      schedulePush(key)
    }
  }
  saveMeta()
  return { changed: applied > 0 }
}

export function stopUserSync(): void {
  stopActive?.()
}
