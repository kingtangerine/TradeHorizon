// Backup and restore of one user's saved data (layouts, drawings, alerts, workspace, groups, theme)
// as a JSON file, so work survives a server problem or can be moved between accounts.

export const BACKUP_FORMAT = 'trade-horizon-backup'
export const BACKUP_VERSION = 1
const MAX_BACKUP_BYTES = 20_000_000

export interface BackupFile {
  readonly format: typeof BACKUP_FORMAT
  readonly version: number
  readonly exportedAtMs: number
  readonly account: { readonly email: string, readonly displayName: string }
  /** localStorage entries with the `trade-horizon:user:<id>:` prefix removed. */
  readonly items: Readonly<Record<string, string>>
}

function prefixFor(userId: string): string {
  return `trade-horizon:user:${userId}:`
}

export function buildBackup(
  userId: string,
  account: { email: string, displayName: string },
  storage: Pick<Storage, 'length' | 'key' | 'getItem'> = localStorage,
  nowMs = Date.now(),
): BackupFile {
  const prefix = prefixFor(userId)
  const items: Record<string, string> = {}
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix)) continue
    const value = storage.getItem(key)
    if (value !== null) items[key.slice(prefix.length)] = value
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAtMs: nowMs, account: { email: account.email, displayName: account.displayName }, items }
}

export function parseBackup(text: string): BackupFile {
  if (text.length > MAX_BACKUP_BYTES) throw new Error('This file is too large to be a TradeHorizon backup.')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('This file is not valid JSON.') }
  const file = value as Partial<BackupFile> | null
  if (!file || file.format !== BACKUP_FORMAT || typeof file.items !== 'object' || file.items === null) {
    throw new Error('This is not a TradeHorizon backup file.')
  }
  if (typeof file.version !== 'number' || file.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of TradeHorizon.')
  }
  const items: Record<string, string> = {}
  for (const [key, item] of Object.entries(file.items)) {
    // Only plain data keys are accepted, and every stored value must itself be valid JSON.
    if (!/^[a-z0-9:_-]{1,64}$/i.test(key) || typeof item !== 'string') continue
    try { JSON.parse(item) } catch { continue }
    items[key] = item
  }
  if (Object.keys(items).length === 0) throw new Error('The backup contains no saved data.')
  return {
    format: BACKUP_FORMAT,
    version: file.version,
    exportedAtMs: typeof file.exportedAtMs === 'number' ? file.exportedAtMs : 0,
    account: { email: String(file.account?.email ?? ''), displayName: String(file.account?.displayName ?? '') },
    items,
  }
}

/** Replaces this user's saved data with the backup's. Returns how many items were restored. */
export function restoreBackup(userId: string, backup: BackupFile, storage: Pick<Storage, 'setItem'> = localStorage): number {
  const prefix = prefixFor(userId)
  let count = 0
  for (const [key, value] of Object.entries(backup.items)) {
    storage.setItem(prefix + key, value)
    count += 1
  }
  return count
}

export function backupFileName(nowMs = Date.now()): string {
  return `tradehorizon-backup-${new Date(nowMs).toISOString().slice(0, 10)}.json`
}
