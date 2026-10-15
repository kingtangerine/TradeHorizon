import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatSyncReport, runSyncCheck, type SyncCheckReport, type SyncCheckRow } from './syncCheck'
import { getDevice, getSyncStatus, setDeviceName, subscribeSyncStatus, syncNow, type SyncStatus } from './userSync'

const time = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString() : 'never')

export function syncStatusText(status: SyncStatus): string {
  switch (status.state) {
    case 'off': return 'Sync is off'
    case 'starting': return 'Connecting…'
    case 'saving': return `Saving ${status.pending} change${status.pending === 1 ? '' : 's'}…`
    case 'offline': return 'Offline: changes are kept and sent later'
    case 'error': return 'Sync problem'
    default: return `Synced · checked ${time(status.lastDownloadAtMs)}`
  }
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus)
}

const VERDICT_TEXT: Record<SyncCheckRow['verdict'], string> = {
  same: '✓ Same',
  different: '✗ Different',
  'only-here': '✗ Only here',
  'only-server': '✗ Only on server',
}

/** Account window section: sync status, this device's name, and the "Save & check sync" report. */
export function SyncPanel({ userId }: { userId: string }) {
  const status = useSyncStatus()
  const [deviceName, setName] = useState(() => getDevice().name)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<SyncCheckReport>()
  const [copied, setCopied] = useState(false)

  useEffect(() => { setCopied(false) }, [report])

  const check = async () => {
    setBusy(true)
    try {
      await syncNow()
      setReport(await runSyncCheck(userId))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!report) return
    try { await navigator.clipboard.writeText(formatSyncReport(report)); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <section className="sync-panel">
      <h3>Sync between devices</h3>
      <p className={`sync-state sync-${status.state}`}>
        <i aria-hidden="true" /> {syncStatusText(status)}
        {status.lastUploadAtMs && <small> · last saved {time(status.lastUploadAtMs)}</small>}
      </p>
      {status.error && <p className="sync-error" role="alert">{status.error}</p>}

      <label className="sync-device">
        <span>This device</span>
        <input
          value={deviceName}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setName(setDeviceName(deviceName).name)}
          aria-label="Name of this device"
        />
      </label>

      <button type="button" className="sync-check-button" disabled={busy} onClick={() => void check()}>
        {busy ? 'Saving and checking…' : 'Save & check sync'}
      </button>

      {report && (
        <div className="sync-report">
          <p className="sync-report-head">
            Checked {time(report.checkedAtMs)} · app v{report.appVersion} · server {report.serverVersion ? `v${report.serverVersion}` : 'unknown'}
          </p>
          {report.problems.length === 0
            ? <p className="sync-ok">Everything on this device matches the server.</p>
            : <ul className="sync-problems">{report.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
          <table>
            <thead>
              <tr><th>Item</th><th>This device</th><th>Server</th><th /></tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.name} className={row.verdict === 'same' || row.name === 'workspace:v1' ? '' : 'differs'}>
                  <td>{row.label}</td>
                  <td>
                    {row.local ? row.local.text : '—'}
                    {row.local?.unsent && <small> · not sent</small>}
                    {row.onlyHere && row.onlyHere.length > 0 && <small className="sync-names">Only here: {row.onlyHere.join(', ')}</small>}
                  </td>
                  <td>
                    {row.server ? row.server.text : '—'}
                    {row.server && row.server.updatedAtMs > 0 && <small>saved {new Date(row.server.updatedAtMs).toLocaleString()} by {row.server.byThisDevice ? 'this device' : row.server.byName ?? 'unknown device'}</small>}
                    {row.onlyServer && row.onlyServer.length > 0 && <small className="sync-names">Only on server: {row.onlyServer.join(', ')}</small>}
                  </td>
                  <td>{row.name === 'workspace:v1' && row.verdict !== 'same' ? <span className="sync-own" title="Open tabs belong to each device; another device's tabs are taken over when the app starts.">Own tabs</span> : VERDICT_TEXT[row.verdict]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="sync-copy" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy report'}</button>
        </div>
      )}
    </section>
  )
}
