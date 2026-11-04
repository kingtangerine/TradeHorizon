// The user's own scripts ("My scripts" in the Indicators window). Synced with the account like other user data:
// an array of objects with an id, so devices merge per script.
import { MAX_SOURCE_LENGTH } from '../chart/script'

export interface UserScript {
  readonly id: string
  readonly name: string
  readonly source: string
  readonly updatedAtMs: number
}

export function scriptsKey(userId: string): string {
  return `trade-horizon:user:${userId}:scripts:v1`
}

export const MAX_SCRIPTS = 50

export function parseScripts(value: unknown): UserScript[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is UserScript => (
    typeof item === 'object' && item !== null &&
    typeof (item as UserScript).id === 'string' && (item as UserScript).id.length > 0 &&
    typeof (item as UserScript).name === 'string' &&
    typeof (item as UserScript).source === 'string' && (item as UserScript).source.length <= MAX_SOURCE_LENGTH
  )).map((item) => ({ id: item.id, name: item.name.slice(0, 60) || 'My script', source: item.source, updatedAtMs: Number(item.updatedAtMs) || 0 })).slice(0, MAX_SCRIPTS)
}

export function loadScripts(userId: string): UserScript[] {
  try { return parseScripts(JSON.parse(localStorage.getItem(scriptsKey(userId)) ?? '[]')) } catch { return [] }
}

export function saveScripts(userId: string, scripts: readonly UserScript[]): void {
  try { localStorage.setItem(scriptsKey(userId), JSON.stringify(scripts)) } catch { /* storage full: kept for this session */ }
}
