// Revisions for a user's synced data. Every stored item carries a `rev`, taken from one counter per user
// that only goes up. A write must say which revision its copy was based on; if the item changed since then
// the write is refused with the current copy, so the app can merge instead of overwriting (see src/app/syncMerge.ts).
// Readers ask for "everything after revision N" to pick up other devices' changes cheaply.

/** One stored item of a user's synced data (a layout list, the drawings, the alerts, ...). */
export interface DataItem {
  value: string
  updatedAtMs: number
  rev: number
  /** Id of the device that saved it ('server' for the server itself). */
  by?: string
  byName?: string
}

/** Every item of one user, by key ('layouts:v1', 'theme:v1', ...). */
export type UserData = Record<string, DataItem>

/** An item from the old JSON files: older ones have no revision yet (see ensureRevisions). */
export interface LegacyItem {
  value: string
  updatedAtMs?: number
  rev?: number
  by?: string
  byName?: string
}

/** The device a write came from. */
export interface Device {
  id: string
  name: string
}

/** What decideWrite says about a device's write. */
export type WriteDecision =
  { status: 'outdated' } | { status: 'conflict'; item: DataItem } | { status: 'ok'; item: DataItem } | { status: 'store' }

/** The answer to a device's write, once it has been stored if it had to be. */
export type WriteResult = Exclude<WriteDecision, { status: 'store' }>

/** One item in the sync check: everything about it but its value. */
export interface ItemDescription {
  rev: number
  updatedAtMs: number
  size: number
  hash: string
  by: string | null
  byName: string | null
}

/** Gives revisions to items stored before revisions existed. Returns true when something changed. */
export function ensureRevisions(data: Record<string, LegacyItem>): boolean {
  let rev = latestRevision(data)
  let changed = false
  for (const item of Object.values(data)) {
    if (typeof item?.rev === 'number') continue
    item.rev = ++rev
    changed = true
  }
  return changed
}

/** The highest revision among the items, or 0 when none has one. */
export function latestRevision(data: Record<string, LegacyItem>): number {
  let rev = 0
  for (const item of Object.values(data)) if (typeof item?.rev === 'number' && item.rev > rev) rev = item.rev
  return rev
}

/** Items written after revision `since` (all of them for 0). */
export function itemsSince(data: UserData, since = 0): UserData {
  return Object.fromEntries(Object.entries(data).filter(([, item]) => item.rev > since))
}

/** Stores a value as a new revision (no checks: used by the server itself, e.g. when an alert fires). */
export function storeValue(
  data: UserData,
  key: string,
  value: string,
  now = Date.now(),
  by: Device = { id: 'server', name: 'TradeHorizon server' },
): DataItem {
  const item: DataItem = { value, updatedAtMs: now, rev: latestRevision(data) + 1, by: by.id, byName: by.name }
  data[key] = item
  return item
}

/**
 * A write from a device. `baseRev` is the revision its copy started from (0 for an item it never had).
 * - `ok`: stored as a new revision
 * - `conflict`: the item changed since `baseRev`; `item` is the current copy to merge with
 * - `outdated`: no `baseRev`, i.e. a tab still running the app from before revisions; refused so it cannot overwrite newer data
 */
export function writeValue(
  data: UserData,
  key: string,
  value: string,
  baseRev: unknown,
  now = Date.now(),
  by: Device = { id: 'unknown', name: 'Unknown device' },
): WriteResult {
  const decision = decideWrite(data[key], value, baseRev)
  if (decision.status !== 'store') return decision
  return { status: 'ok', item: storeValue(data, key, value, now, by) }
}

/**
 * The rule for a device's write, shared by every storage (the JSON objects here and the SQLite database):
 * `outdated` / `conflict` (with the current item) are refused, `ok` (with the current item) needs no change,
 * and `store` means the value must be stored as a new revision.
 */
export function decideWrite(current: DataItem | undefined, value: string, baseRev: unknown): WriteDecision {
  if (typeof baseRev !== 'number' || !Number.isSafeInteger(baseRev) || baseRev < 0) return { status: 'outdated' }
  if ((current?.rev ?? 0) !== baseRev) {
    if (current) return { status: 'conflict', item: current }
    // The item does not exist (any more): nothing to merge with, so the write simply creates it.
  }
  if (current && current.value === value) return { status: 'ok', item: current }
  return { status: 'store' }
}

/** The device a write came from, as sent by the app ({ id, name }); anything odd is replaced. */
export function deviceFrom(raw: unknown): Device {
  const value = raw as { id?: unknown; name?: unknown } | null | undefined // each field is checked below
  const id = typeof value?.id === 'string' && /^[\w-]{6,64}$/.test(value.id) ? value.id : 'unknown'
  const name = typeof value?.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : 'Unknown device'
  return { id, name }
}

/** Same FNV-1a fingerprint as src/app/syncMerge.ts, so the app can compare its copy without downloading ours. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** What the server holds for a user, without the values: for the app's sync check. */
export function describeData(data: UserData): Record<string, ItemDescription> {
  return Object.fromEntries(
    Object.entries(data).map(([key, item]): [string, ItemDescription] => [
      key,
      {
        rev: item.rev,
        updatedAtMs: item.updatedAtMs,
        size: item.value.length,
        hash: fingerprint(item.value),
        by: item.by ?? null,
        byName: item.byName ?? null,
      },
    ]),
  )
}
