// Revisions for a user's synced data. Every stored item carries a `rev`, taken from one counter per user
// that only goes up. A write must say which revision its copy was based on; if the item changed since then
// the write is refused with the current copy, so the app can merge instead of overwriting (see src/app/syncMerge.ts).
// Readers ask for "everything after revision N" to pick up other devices' changes cheaply.

/** Gives revisions to items stored before revisions existed. Returns true when something changed. */
export function ensureRevisions(data) {
  let rev = latestRevision(data)
  let changed = false
  for (const item of Object.values(data)) {
    if (typeof item?.rev === 'number') continue
    item.rev = ++rev
    changed = true
  }
  return changed
}

export function latestRevision(data) {
  let rev = 0
  for (const item of Object.values(data)) if (typeof item?.rev === 'number' && item.rev > rev) rev = item.rev
  return rev
}

/** Items written after revision `since` (all of them for 0). */
export function itemsSince(data, since = 0) {
  return Object.fromEntries(Object.entries(data).filter(([, item]) => item.rev > since))
}

/** Stores a value as a new revision (no checks: used by the server itself, e.g. when an alert fires). */
export function storeValue(data, key, value, now = Date.now()) {
  const item = { value, updatedAtMs: now, rev: latestRevision(data) + 1 }
  data[key] = item
  return item
}

/**
 * A write from a device. `baseRev` is the revision its copy started from (0 for an item it never had).
 * - `ok`: stored as a new revision
 * - `conflict`: the item changed since `baseRev`; `item` is the current copy to merge with
 * - `outdated`: no `baseRev`, i.e. a tab still running the app from before revisions; refused so it cannot overwrite newer data
 */
export function writeValue(data, key, value, baseRev, now = Date.now()) {
  if (typeof baseRev !== 'number' || !Number.isSafeInteger(baseRev) || baseRev < 0) return { status: 'outdated' }
  const current = data[key]
  if ((current?.rev ?? 0) !== baseRev) {
    if (current) return { status: 'conflict', item: current }
    // The item does not exist (any more): nothing to merge with, so the write simply creates it.
  }
  if (current && current.value === value) return { status: 'ok', item: current }
  return { status: 'ok', item: storeValue(data, key, value, now) }
}
