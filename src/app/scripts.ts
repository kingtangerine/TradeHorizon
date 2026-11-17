// The user's own scripts ("My scripts" in the Indicators window). Synced with the account like other user data:
// an array of objects with an id, so devices merge per script.
import { MAX_SOURCE_LENGTH } from '../chart/script'
import { reportProblem } from './errorReport'

/** A saved user script: its source plus a display name and last-edit time (ms since epoch). */
export interface UserScript {
  readonly id: string
  readonly name: string
  readonly source: string
  readonly updatedAtMs: number
}

/** localStorage key holding this user's scripts (synced with the account). */
export function scriptsKey(userId: string): string {
  return `trade-horizon:user:${userId}:scripts:v1`
}

/** Most scripts a user can keep; extra entries are dropped when parsing. */
export const MAX_SCRIPTS = 50

/** Validates stored or synced data into a script list, dropping malformed or oversized entries; never throws. */
export function parseScripts(value: unknown): UserScript[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is UserScript =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as UserScript).id === 'string' &&
        (item as UserScript).id.length > 0 &&
        typeof (item as UserScript).name === 'string' &&
        typeof (item as UserScript).source === 'string' &&
        (item as UserScript).source.length <= MAX_SOURCE_LENGTH,
    )
    .map((item) => ({
      id: item.id,
      name: item.name.slice(0, 60) || 'My script',
      source: item.source,
      updatedAtMs: Number(item.updatedAtMs) || 0,
    }))
    .slice(0, MAX_SCRIPTS)
}

/** Where unreadable saved scripts are copied before the app starts over with an empty list. */
export function unreadableScriptsKey(userId: string): string {
  return `${scriptsKey(userId)}:unreadable`
}

/** Reads the user's scripts from localStorage; an unreadable value is kept under the ":unreadable" key, reported, and yields []. */
export function loadScripts(userId: string): UserScript[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(scriptsKey(userId))
  } catch {
    return [] // Storage is blocked (e.g. private mode): nothing was saved here, so nothing can be lost.
  }
  if (raw === null) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (Array.isArray(value)) return parseScripts(value)
  } catch {
    // Not JSON: handled below like any other unreadable value.
  }
  // The app saves the list right after loading it, which would overwrite the unreadable copy with an empty one.
  // Keep the original so it can be recovered, and report it instead of failing silently.
  try {
    localStorage.setItem(unreadableScriptsKey(userId), raw)
  } catch {
    /* storage full: the report still records it */
  }
  reportProblem('Saved scripts could not be read; the original was kept under the ":unreadable" key', 'scripts')
  return []
}

/** Stores the user's scripts in localStorage; silently does nothing when storage is full or blocked. */
export function saveScripts(userId: string, scripts: readonly UserScript[]): void {
  try {
    localStorage.setItem(scriptsKey(userId), JSON.stringify(scripts))
  } catch {
    /* storage full: kept for this session */
  }
}
