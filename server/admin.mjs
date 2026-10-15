// Admin helpers: who is an administrator, and summaries of a user's stored data for the admin page.
// Summaries are sizes, counts and dates only, never the content of layouts, drawings or alerts.
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs'
import { join } from 'node:path'

/** TH_ADMIN_EMAILS="a@x.com, b@y.com" -> Set of lower-case emails. */
export function adminEmails(value) {
  return new Set(String(value ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))
}

const parse = (raw) => { try { return JSON.parse(raw) } catch { return undefined } }
const arrayLength = (value) => (Array.isArray(value) ? value.length : 0)

/** Counts per kind of stored item (what the user has, not what it says). */
export function countItems(key, raw) {
  const value = parse(raw)
  switch (key) {
    case 'layouts:v1': return { layouts: arrayLength(value) }
    case 'drawings:v1': return { drawings: arrayLength(value?.drawings) }
    case 'alerts:v1': {
      const list = Array.isArray(value) ? value : []
      return { alerts: list.length, activeAlerts: list.filter((alert) => alert?.enabled && !alert?.triggeredAtMs).length }
    }
    case 'workspace:v1': return { openTabs: arrayLength(value?.tabs) }
    case 'watchlists:v1': return { watchlistSymbols: (Array.isArray(value?.lists) ? value.lists : []).reduce((sum, list) => sum + arrayLength(list?.items), 0) }
    case 'layout-folders:v1': return { layoutFolders: arrayLength(value?.groups) }
    case 'rect-templates:v1': return { templates: arrayLength(value?.templates) }
    default: return {}
  }
}

/** One user's stored data, summarised for the users table. */
export function summarizeUserData(data) {
  const counts = { layouts: 0, drawings: 0, alerts: 0, activeAlerts: 0, openTabs: 0, watchlistSymbols: 0, layoutFolders: 0, templates: 0 }
  const devices = new Map()
  let bytes = 0
  let lastSyncAtMs = 0
  for (const [key, item] of Object.entries(data)) {
    if (typeof item?.value !== 'string') continue
    bytes += item.value.length
    lastSyncAtMs = Math.max(lastSyncAtMs, item.updatedAtMs ?? 0)
    for (const [name, count] of Object.entries(countItems(key, item.value))) counts[name] += count
    if (item.by && item.by !== 'server') {
      const seen = devices.get(item.by)
      if (!seen || seen.lastSaveAtMs < (item.updatedAtMs ?? 0)) devices.set(item.by, { name: item.byName ?? 'Unknown device', lastSaveAtMs: item.updatedAtMs ?? 0 })
    }
  }
  return {
    items: Object.keys(data).length,
    bytes,
    lastSyncAtMs: lastSyncAtMs || null,
    counts,
    devices: [...devices.values()].sort((a, b) => b.lastSaveAtMs - a.lastSaveAtMs),
  }
}

/** Every stored item of a user: size, last save, saving device, revision and counts (no content). */
export function describeUserItems(data) {
  return Object.entries(data).map(([key, item]) => ({
    key,
    bytes: typeof item?.value === 'string' ? item.value.length : 0,
    updatedAtMs: item?.updatedAtMs ?? null,
    rev: item?.rev ?? null,
    savedBy: item?.byName ?? (item?.by === 'server' ? 'TradeHorizon server' : null),
    counts: typeof item?.value === 'string' ? countItems(key, item.value) : {},
  })).sort((a, b) => b.bytes - a.bytes)
}

/** Total size of a folder, recursively (bytes). */
export function folderSize(path) {
  if (!existsSync(path)) return 0
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    try {
      total += entry.isDirectory() ? folderSize(full) : statSync(full).size
    } catch { /* vanished while counting */ }
  }
  return total
}

/** Free and total space of the disk holding `path`, or null where the platform cannot tell. */
export function diskSpace(path) {
  try {
    const stats = statfsSync(path)
    return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize }
  } catch {
    return null
  }
}
