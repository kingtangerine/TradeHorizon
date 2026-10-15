import { getSessionToken } from './auth'
import { fingerprint } from './syncMerge'
import { describeHttpProblem, getDevice, getSyncStatus, syncKeyStates, type DeviceInfo, type SyncStatus } from './userSync'
import { APP_VERSION } from '../version'

// The sync check behind "Save & check sync" in the account window: compares every synced item on this device
// with the server's copy (when it was saved, from which device, what it contains) and spells out what is wrong.

export const SYNC_PROTOCOL = 2

/** Compares "0.14.0"-style versions numerically. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

export const ITEM_LABELS: Readonly<Record<string, string>> = {
  'layouts:v1': 'Saved layouts',
  'drawings:v1': 'Drawings',
  'alerts:v1': 'Price alerts',
  'workspace:v1': 'Open tabs',
  'layout-folders:v1': 'Layout folders',
  'groups:v1': 'Object tree folders',
  'watchlists:v1': 'Watchlists',
  'rect-templates:v1': 'Rectangle templates',
  'prefs:v1': 'Chart settings',
  'theme:v1': 'Theme',
}

export interface CopySummary {
  /** e.g. "20 layouts" */
  readonly text: string
  /** Item names (layouts, watchlists…) when the value is a list, to see exactly what differs. */
  readonly names?: readonly string[]
  readonly ids?: readonly string[]
}

export interface SyncCheckRow {
  readonly name: string
  readonly label: string
  readonly local?: CopySummary & { readonly size: number, readonly rev: number, readonly unsent: boolean }
  readonly server?: CopySummary & { readonly size: number, readonly rev: number, readonly updatedAtMs: number, readonly byName: string | null, readonly byThisDevice: boolean }
  readonly verdict: 'same' | 'different' | 'only-here' | 'only-server'
  /** For lists: names only on one side. */
  readonly onlyHere?: readonly string[]
  readonly onlyServer?: readonly string[]
}

export interface SyncCheckReport {
  readonly checkedAtMs: number
  readonly device: DeviceInfo
  readonly appVersion: string
  readonly serverVersion?: string
  readonly serverProtocol?: number
  /** Device clock minus server clock. */
  readonly clockOffsetMs?: number
  readonly status: SyncStatus
  readonly rows: readonly SyncCheckRow[]
  readonly problems: readonly string[]
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

type Named = { id?: unknown, name?: unknown, symbol?: unknown }
const namesOf = (list: readonly Named[]) => list.map((item, index) => String(item.name ?? item.symbol ?? item.id ?? `#${index + 1}`))
const idsOf = (list: readonly Named[]) => list.map((item, index) => String(item.id ?? item.name ?? index))

/** A short description of a stored value, per kind of item. */
export function summarizeCopy(name: string, raw: string): CopySummary {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return { text: raw.slice(0, 40) } }
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const list = (items: unknown, word: string): CopySummary => {
    const array = Array.isArray(items) ? items as Named[] : []
    return { text: plural(array.length, word), names: namesOf(array), ids: idsOf(array) }
  }
  switch (name) {
    case 'layouts:v1': return list(value, 'layout')
    case 'alerts:v1': return { ...list(value, 'alert'), names: (Array.isArray(value) ? value : []).map((alert: Record<string, unknown>) => `${String(alert.symbol)} ${alert.direction === 'below' ? '≤' : '≥'} ${String(alert.targetPrice)}`) }
    case 'drawings:v1': return { ...list(record.drawings, 'drawing'), names: undefined }
    case 'workspace:v1': {
      const tabs = Array.isArray(record.tabs) ? record.tabs as Array<Record<string, unknown>> : []
      return { text: plural(tabs.length, 'tab'), names: tabs.map((tab) => `${String(tab.symbol)} ${String(tab.interval)}`) }
    }
    case 'layout-folders:v1':
    case 'groups:v1': return list(record.groups, 'folder')
    case 'watchlists:v1': {
      const lists = Array.isArray(record.lists) ? record.lists as Array<Record<string, unknown>> : []
      const symbols = lists.reduce((sum, item) => sum + (Array.isArray(item.items) ? item.items.length : 0), 0)
      return { text: `${plural(lists.length, 'list')}, ${plural(symbols, 'symbol')}`, names: namesOf(lists as Named[]), ids: idsOf(lists as Named[]) }
    }
    case 'rect-templates:v1': return list(record.templates, 'template')
    default: return { text: Array.isArray(value) ? plural(value.length, 'item') : raw.length > 60 ? `${raw.length} characters` : raw }
  }
}

function difference(a: CopySummary, b: CopySummary): { onlyA: string[], onlyB: string[] } | undefined {
  if (!a.ids || !b.ids || !a.names || !b.names) return undefined
  const bIds = new Set(b.ids)
  const aIds = new Set(a.ids)
  return {
    onlyA: a.ids.flatMap((id, index) => (bIds.has(id) ? [] : [a.names![index]])),
    onlyB: b.ids.flatMap((id, index) => (aIds.has(id) ? [] : [b.names![index]])),
  }
}

interface ServerDescription {
  protocol: number
  version: string
  serverTimeMs: number
  items: Record<string, { rev: number, updatedAtMs: number, size: number, hash: string, by: string | null, byName: string | null }>
}

export async function runSyncCheck(userId: string): Promise<SyncCheckReport> {
  const device = getDevice()
  const problems: string[] = []
  const headers = { Authorization: `Bearer ${getSessionToken() ?? ''}` }
  const requestStartMs = Date.now()
  const base = { checkedAtMs: requestStartMs, device, appVersion: APP_VERSION, status: getSyncStatus() }

  let description: ServerDescription | undefined
  let values: Record<string, { value: string }> = {}
  try {
    const [statusResponse, dataResponse] = await Promise.all([
      fetch('/api/sync/status', { headers, cache: 'no-store' }),
      fetch('/api/data?since=0', { headers, cache: 'no-store' }),
    ])
    if (statusResponse.ok) description = await statusResponse.json() as ServerDescription
    else problems.push(statusResponse.status === 404
      ? describeHttpProblem(404)
      : `The sync check itself failed. ${describeHttpProblem(statusResponse.status)}`)
    if (dataResponse.ok) values = ((await dataResponse.json()) as { items: Record<string, { value: string }> }).items
    else problems.push(`Downloading your data failed. ${describeHttpProblem(dataResponse.status)}`)
  } catch {
    problems.push('Could not reach the TradeHorizon server from this device (offline, blocked, or the server is down).')
    return { ...base, rows: [], problems }
  }

  const clockOffsetMs = description ? Math.round((requestStartMs + Date.now()) / 2 - description.serverTimeMs) : undefined
  if (description) {
    if (description.version !== APP_VERSION) {
      problems.push(compareVersions(description.version, APP_VERSION) > 0
        ? `This page runs v${APP_VERSION} but the server has v${description.version}. Reload this page (Ctrl+F5).`
        : `This page runs v${APP_VERSION} but the server runs v${description.version}: the new files are there but the Node process was not restarted (or the update did not finish). On the server: git pull, npm ci, npm run build, then restart Node.`)
    } else if (description.protocol !== SYNC_PROTOCOL) {
      problems.push('The server speaks a different sync version. Update and restart the server, then reload this page.')
    }
    if (clockOffsetMs !== undefined && Math.abs(clockOffsetMs) > 120_000) {
      problems.push(`This device's clock is ${Math.round(Math.abs(clockOffsetMs) / 60_000)} minutes ${clockOffsetMs > 0 ? 'ahead of' : 'behind'} the server. Sync does not depend on it, but saved times shown here will look off.`)
    }
  }

  const prefix = `trade-horizon:user:${userId}:`
  const states = syncKeyStates(userId)
  const names = new Set<string>([...Object.keys(description?.items ?? values)])
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(prefix)) names.add(key.slice(prefix.length))
  }

  const rows: SyncCheckRow[] = [...names].sort((a, b) => (ITEM_LABELS[a] ? 0 : 1) - (ITEM_LABELS[b] ? 0 : 1) || a.localeCompare(b)).map((name) => {
    const raw = localStorage.getItem(prefix + name)
    const remote = description?.items[name]
    const remoteValue = values[name]?.value
    const local = raw === null ? undefined : { ...summarizeCopy(name, raw), size: raw.length, rev: states[name]?.rev ?? 0, unsent: states[name]?.dirty ?? false }
    const server = remote || remoteValue !== undefined
      ? {
          ...(remoteValue !== undefined ? summarizeCopy(name, remoteValue) : { text: `${remote?.size ?? 0} characters` }),
          size: remote?.size ?? remoteValue?.length ?? 0,
          rev: remote?.rev ?? 0,
          updatedAtMs: remote?.updatedAtMs ?? 0,
          byName: remote?.byName ?? null,
          byThisDevice: remote?.by === device.id,
        }
      : undefined
    const same = raw !== null && (remote ? fingerprint(raw) === remote.hash : remoteValue === raw)
    const verdict: SyncCheckRow['verdict'] = !server ? 'only-here' : !local ? 'only-server' : same ? 'same' : 'different'
    const diff = local && server ? difference(local, server) : undefined
    return { name, label: ITEM_LABELS[name] ?? name, local, server, verdict, onlyHere: diff?.onlyA, onlyServer: diff?.onlyB }
  })

  for (const row of rows) {
    if (row.verdict === 'same' || !ITEM_LABELS[row.name]) continue
    if (row.verdict === 'only-here') problems.push(`${row.label} exist only on this device: the server never received them. ${getSyncStatus().error ?? ''}`.trim())
    else if (row.verdict === 'only-server') problems.push(`${row.label} are on the server but not on this device yet; they arrive with the next check (or reload the page).`)
    else if (row.name !== 'workspace:v1') {
      problems.push(row.local?.unsent
        ? `${row.label}: this device has changes the server has not accepted yet. ${getSyncStatus().error ?? 'They are being sent.'}`
        : `${row.label}: this device holds a different copy than the server (saved ${new Date(row.server!.updatedAtMs).toLocaleTimeString()} by ${row.server!.byName ?? 'an unknown device'}). It should update within 15 seconds; if this stays, send me this report.`)
    }
  }
  const status = getSyncStatus()
  if (status.error && !problems.some((problem) => problem.includes(status.error!))) problems.push(status.error)

  return { ...base, status, serverVersion: description?.version, serverProtocol: description?.protocol, clockOffsetMs, rows, problems }
}

/** Plain text of a check, for copying into a message. */
export function formatSyncReport(report: SyncCheckReport): string {
  const time = (ms: number) => new Date(ms).toLocaleString()
  const lines = [
    `TradeHorizon sync check — ${time(report.checkedAtMs)}`,
    `Device: ${report.device.name} (${report.device.id.slice(0, 8)})`,
    `App v${report.appVersion} · server ${report.serverVersion ? `v${report.serverVersion}` : 'unknown'} · protocol ${report.serverProtocol ?? 'unknown'} · clock offset ${report.clockOffsetMs === undefined ? '?' : `${Math.round(report.clockOffsetMs / 1000)}s`}`,
    `Status: ${report.status.state}, ${report.status.pending} waiting, last download ${report.status.lastDownloadAtMs ? time(report.status.lastDownloadAtMs) : 'never'}, last upload ${report.status.lastUploadAtMs ? time(report.status.lastUploadAtMs) : 'never'}`,
    '',
    ...report.rows.map((row) => [
      `${row.label}: ${row.verdict.toUpperCase()}`,
      `  this device: ${row.local ? `${row.local.text}, ${row.local.size} chars, based on rev ${row.local.rev}${row.local.unsent ? ', NOT SENT' : ''}` : '—'}`,
      `  server:      ${row.server ? `${row.server.text}, ${row.server.size} chars, rev ${row.server.rev}, saved ${time(row.server.updatedAtMs)} by ${row.server.byName ?? '?'}${row.server.byThisDevice ? ' (this device)' : ''}` : '—'}`,
      ...(row.onlyHere?.length ? [`  only here:   ${row.onlyHere.join(', ')}`] : []),
      ...(row.onlyServer?.length ? [`  only server: ${row.onlyServer.join(', ')}`] : []),
    ].join('\n')),
    '',
    report.problems.length ? `Problems:\n${report.problems.map((problem) => `- ${problem}`).join('\n')}` : 'No problems found: this device matches the server.',
  ]
  return lines.join('\n')
}
