import { getSessionToken } from './auth'
import { baseOfRaw, mergeRaw, type Base } from './syncMerge'

// Keeps every `trade-horizon:user:<id>:*` localStorage entry (workspace, layouts, drawings, alerts…) in step
// with the server, so a user sees the same data on every device. The rest of the app keeps reading and writing
// localStorage; this module mirrors it.
//
// How it stays correct with several devices:
//   - Every server item has a revision. An upload says which revision it was based on; if another device
//     changed the item in the meantime the server refuses and returns its copy (409).
//   - The two copies are then merged item by item (syncMerge.ts) against the last version both had in common,
//     so additions on both devices are kept and deletions are respected. Nothing is overwritten wholesale.
//   - While the app is open it asks for "changes since revision N" every few seconds and when the tab comes
//     back, and tells the app (subscribeRemoteData) which items changed so it can show them without a reload.
//   - Writes made while the first download is still running are held back until it has been merged in.

type RemoteDataListener = (keys: readonly string[]) => void

const remoteListeners = new Set<RemoteDataListener>()
/** Changes seen while nobody was listening yet (the first download can finish before the app has mounted). */
const unseenKeys = new Set<string>()

/**
 * Calls `listener` with the items another device changed (key suffixes such as `layouts:v1`) after they
 * were merged into localStorage. Changes that arrived before anyone subscribed are delivered at once.
 */
export function subscribeRemoteData(listener: RemoteDataListener): () => void {
  remoteListeners.add(listener)
  if (unseenKeys.size > 0) {
    const keys = [...unseenKeys]
    unseenKeys.clear()
    listener(keys)
  }
  return () => { remoteListeners.delete(listener) }
}

interface ServerItem {
  readonly value: string
  readonly updatedAtMs: number
  readonly rev: number
}

interface KeyState {
  /** Server revision the local copy is based on (0: never synced). */
  rev: number
  /** Fingerprints of that server copy, for merging. */
  base?: Base
  /** Local edits not yet accepted by the server. */
  dirty: boolean
}

interface SyncMeta {
  /** Highest revision seen in a download: the next poll asks for changes after it. */
  rev: number
  keys: Record<string, KeyState>
}

const PUSH_DELAY_MS = 700
const POLL_MS = 15_000
const STARTUP_TIMEOUT_MS = 8000
const REQUEST_TIMEOUT_MS = 15_000
/**
 * The open tabs belong to the session on this device. They are never merged (tabs from both devices would
 * pile up): another device's tabs are taken over when the app starts, and while you work this device's win.
 */
const STARTUP_ONLY = new Set(['workspace:v1'])

let stopActive: (() => void) | undefined

const metaKey = (userId: string) => `trade-horizon:sync2:${userId}`
const legacyMetaKey = (userId: string) => `trade-horizon:sync:${userId}`
const userPrefix = (userId: string) => `trade-horizon:user:${userId}:`

/** True once this browser has synced this account before, so its local copy is a good starting point. */
export function hasSyncedBefore(userId: string): boolean {
  try {
    return localStorage.getItem(metaKey(userId)) !== null || localStorage.getItem(legacyMetaKey(userId)) !== null
  } catch {
    return false
  }
}

function readMeta(userId: string): SyncMeta {
  try {
    const value = JSON.parse(localStorage.getItem(metaKey(userId)) ?? 'null') as Partial<SyncMeta> | null
    if (value && typeof value.rev === 'number' && typeof value.keys === 'object' && value.keys) return { rev: value.rev, keys: value.keys }
  } catch { /* start fresh */ }
  return { rev: 0, keys: {} }
}

/**
 * Downloads and merges the user's data, then keeps uploading local changes and picking up other devices'
 * changes until stopped. Resolves once the first download is merged (or failed/timed out, in which case the
 * app works from local data and the next poll catches up).
 */
export async function startUserSync(userId: string): Promise<void> {
  stopActive?.()
  unseenKeys.clear()
  const token = getSessionToken()
  if (!token) return

  const prefix = userPrefix(userId)
  const meta = readMeta(userId)
  /** Items with edits that never reached the server before this page load (e.g. made offline last time). */
  const dirtyAtStart = new Set(Object.entries(meta.keys).filter(([, known]) => known.dirty).map(([key]) => key))
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const retryDelays = new Map<string, number>()
  let ready = false
  let stopped = false
  let metaTimer: ReturnType<typeof setTimeout> | undefined

  const originalSetItem = Storage.prototype.setItem
  const writeLocal = (key: string, value: string) => originalSetItem.call(localStorage, key, value)
  const suffix = (key: string) => key.slice(prefix.length)
  const state = (key: string): KeyState => (meta.keys[key] ??= { rev: 0, dirty: false })

  const saveMeta = () => {
    clearTimeout(metaTimer)
    metaTimer = undefined
    try { writeLocal(metaKey(userId), JSON.stringify(meta)) } catch { /* storage full: rebuilt on the next start */ }
  }
  const saveMetaSoon = () => {
    if (metaTimer === undefined) metaTimer = setTimeout(saveMeta, 500)
  }

  const announce = (keys: string[]) => {
    if (keys.length === 0 || stopped) return
    const names = keys.map(suffix)
    if (remoteListeners.size === 0) names.forEach((name) => unseenKeys.add(name))
    else for (const listener of remoteListeners) listener(names)
  }

  // One request at a time, so a download and an upload of the same item never interleave.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  const request = (path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) => fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: init.keepalive ? undefined : AbortSignal.timeout(timeoutMs),
  })

  /** Takes in a server copy, merging it with unsynced local edits. Returns true when the local copy changed. */
  const absorb = (key: string, item: ServerItem, startup = false): boolean => {
    const known = state(key)
    const local = localStorage.getItem(key)
    let next = item.value
    if (local !== null && local !== item.value) {
      if (STARTUP_ONLY.has(suffix(key))) {
        // Latest session wins: the other device's at start-up (unless this one has an unsent session), this one's later.
        if (!startup || dirtyAtStart.has(key)) next = local
      } else if (known.dirty || !known.base) {
        // Local edits (or a copy never synced, e.g. from before this version): merge item by item.
        next = mergeRaw(known.base, local, item.value)
      }
      // Otherwise there are no local edits since the last sync and the server copy is simply newer.
    }
    known.rev = item.rev
    known.base = baseOfRaw(item.value)
    known.dirty = next !== item.value
    const changed = next !== local
    if (changed) writeLocal(key, next)
    if (known.dirty) schedulePush(key, 0)
    saveMetaSoon()
    return changed
  }

  const retryLater = (key: string) => {
    const delay = Math.min(60_000, (retryDelays.get(key) ?? 1500) * 2)
    retryDelays.set(key, delay)
    schedulePush(key, delay)
  }

  const push = async (key: string, keepalive = false): Promise<void> => {
    const value = localStorage.getItem(key)
    const known = meta.keys[key]
    if (value === null || !known?.dirty || stopped) return
    let response: Response
    try {
      response = await request('/api/data', {
        method: 'PUT',
        body: JSON.stringify({ key: suffix(key), value, baseRev: known.rev }),
        keepalive: keepalive && value.length < 60_000,
      })
    } catch {
      retryLater(key) // offline: try again later; the edit stays marked as unsynced
      return
    }
    if (stopped) return
    if (response.status === 409) {
      const body = await response.json().catch(() => ({})) as { item?: ServerItem }
      if (stopped) return
      // Another device changed this item first: merge its copy in (which uploads the result if it differs).
      if (body.item) { if (absorb(key, body.item)) announce([key]) } else retryLater(key)
      return
    }
    if (!response.ok) { retryLater(key); return }
    const { rev } = await response.json() as { rev: number }
    if (stopped) return
    retryDelays.delete(key)
    known.rev = rev
    known.base = baseOfRaw(value)
    // Edited again while the upload was under way: upload the newer copy too.
    known.dirty = localStorage.getItem(key) !== value
    if (known.dirty) schedulePush(key)
    saveMetaSoon()
  }

  function schedulePush(key: string, delay = PUSH_DELAY_MS) {
    if (!ready || stopped) return // held until the first download is merged; then every unsynced key is uploaded
    clearTimeout(timers.get(key))
    timers.set(key, setTimeout(() => { timers.delete(key); void serial(() => push(key)) }, delay))
  }

  /** Downloads changes (all items at start-up, since the last revision afterwards) and merges them in. */
  const pull = async (startup: boolean): Promise<string[]> => {
    const response = await request(`/api/data?since=${startup ? 0 : meta.rev}`, {}, startup ? STARTUP_TIMEOUT_MS : REQUEST_TIMEOUT_MS)
    if (!response.ok) throw new Error(`sync download failed (${response.status})`)
    const body = await response.json() as { items: Record<string, ServerItem>, rev?: number }
    // A sync that was stopped meanwhile (sign-out, or a newer start) must not touch storage any more.
    if (stopped) return []
    const changed: string[] = []
    for (const [name, item] of Object.entries(body.items)) {
      if (typeof item?.rev !== 'number' || typeof item.value !== 'string') continue
      if (!startup && STARTUP_ONLY.has(name)) continue
      if (absorb(prefix + name, item, startup)) changed.push(prefix + name)
    }
    // Older servers send no revision counter; then every poll simply asks for everything.
    if (typeof body.rev === 'number') meta.rev = Math.max(startup ? 0 : meta.rev, body.rev)
    saveMetaSoon()
    return changed
  }

  // Watch writes from the rest of the app. Rewriting an unchanged value is not an edit.
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    if (this !== localStorage || !key.startsWith(prefix)) { originalSetItem.call(this, key, value); return }
    const previous = this.getItem(key)
    originalSetItem.call(this, key, value)
    if (previous === value || stopped) return
    state(key).dirty = true
    saveMetaSoon()
    schedulePush(key)
  }

  const flush = () => {
    saveMeta()
    for (const [key, timer] of timers) { clearTimeout(timer); timers.delete(key); void push(key, true) }
  }

  const poll = () => {
    if (!ready || stopped || document.visibilityState === 'hidden') return
    void serial(() => pull(false)).then(announce, () => undefined)
  }
  const onVisible = () => { if (document.visibilityState === 'visible') poll() }
  const onOnline = () => {
    for (const [key, known] of Object.entries(meta.keys)) if (known.dirty) schedulePush(key, 0)
    poll()
  }
  const pollTimer = setInterval(poll, POLL_MS)
  window.addEventListener('pagehide', flush)
  window.addEventListener('focus', poll)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)

  stopActive = () => {
    stopped = true
    Storage.prototype.setItem = originalSetItem
    clearInterval(pollTimer)
    timers.forEach(clearTimeout)
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('focus', poll)
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    saveMeta()
    stopActive = undefined
  }

  // First download.
  let changed: string[] = []
  try {
    changed = await serial(() => pull(true))
  } catch { /* offline or server down: work from local data; polling catches up */ }
  if (stopped) return

  // Local items the server does not have yet, or edits it has not accepted: upload them now.
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(prefix) && (!meta.keys[key] || meta.keys[key].rev === 0)) state(key).dirty = true
  }
  ready = true
  saveMeta()
  try { localStorage.removeItem(legacyMetaKey(userId)) } catch { /* ignore */ }
  for (const [key, known] of Object.entries(meta.keys)) if (known.dirty) schedulePush(key, 0)
  announce(changed)
}

export function stopUserSync(): void {
  stopActive?.()
}
