import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteUser,
  fetchAdminOverview,
  fetchAdminUser,
  fetchAdminUsers,
  formatAgo,
  formatBytes,
  formatDuration,
  signOutUser,
  sortAdminUsers,
  type AdminOverview,
  type AdminSort,
  type AdminUser,
  type AdminUserDetail,
} from './admin'
import { ITEM_LABELS } from './syncCheck'
import { CloseIcon, RefreshIcon, SearchIcon } from './Icons'

const SORTS: ReadonlyArray<{ value: AdminSort, label: string }> = [
  { value: 'active', label: 'Last active' },
  { value: 'newest', label: 'Newest' },
  { value: 'storage', label: 'Storage used' },
  { value: 'name', label: 'Name' },
]

type Tone = 'ok' | 'warn' | 'bad' | undefined

/** "1 layout", "3 layouts" (labels are given in the plural). */
const countLabel = (count: number, plural: string) => `${count} ${count === 1 ? plural.replace(/s$/, '') : plural}`

function Stat({ label, value, note, tone }: { label: string, value: string | number, note?: string, tone?: Tone }) {
  return (
    <div className={tone ? `admin-stat ${tone}` : 'admin-stat'}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

function OverviewTab({ overview }: { overview: AdminOverview }) {
  const { server, services, users } = overview
  const disk = server.disk
  const diskUsed = disk ? 1 - disk.freeBytes / disk.totalBytes : 0
  const hostUsed = 1 - server.hostMemoryMb.free / server.hostMemoryMb.total
  return (
    <div className="admin-overview">
      <section>
        <h2>Users</h2>
        <div className="admin-stats">
          <Stat label="Registered" value={users.total} note={`${users.admins} admin${users.admins === 1 ? '' : 's'}`} />
          <Stat label="Active today" value={users.active24h} note={`${users.active7d} in the last 7 days`} />
          <Stat label="New sign-ups" value={users.signups7d} note={`${users.signups24h} in the last 24 h`} />
          <Stat label="Signed-in sessions" value={users.activeSessions} />
        </div>
      </section>

      <section>
        <h2>Server</h2>
        <div className="admin-stats">
          <Stat label="Version" value={`v${server.version}`} note={`Node ${server.node} · ${server.platform}`} />
          <Stat label="Running for" value={formatDuration(server.uptimeSec)} note={`since ${new Date(server.startedAtMs).toLocaleString()} · PID ${server.pid}`} />
          <Stat
            label="Starts in 24 h"
            value={server.startsLast24h}
            tone={server.startsLast24h > 5 ? 'bad' : server.startsLast24h > 2 ? 'warn' : 'ok'}
            note={server.startsLast24h > 2 ? 'The host keeps restarting the app' : 'Stable'}
          />
          <Stat label="App memory" value={`${server.memoryMb.app} MB`} note={`${server.memoryMb.heapUsed} MB in use by JavaScript`} />
          <Stat
            label="Server memory"
            value={`${Math.round(hostUsed * 100)}% used`}
            tone={hostUsed > 0.9 ? 'bad' : hostUsed > 0.75 ? 'warn' : 'ok'}
            note={`${server.hostMemoryMb.free} MB free of ${server.hostMemoryMb.total} MB`}
          />
          <Stat label="Load (1 / 5 / 15 min)" value={server.loadAverage.join(' / ')} note={server.hostname} />
        </div>
      </section>

      <section>
        <h2>Storage</h2>
        <div className="admin-stats">
          <Stat label="TradeHorizon data" value={formatBytes(server.dataBytes)} note={server.dataDir} />
          {disk && (
            <Stat
              label="Disk"
              value={`${formatBytes(disk.freeBytes)} free`}
              tone={diskUsed > 0.95 ? 'bad' : diskUsed > 0.85 ? 'warn' : 'ok'}
              note={`${Math.round(diskUsed * 100)}% of ${formatBytes(disk.totalBytes)} used`}
            />
          )}
          <Stat label=".env settings" value={server.envFile ? server.envFile.length : 'none'} note={server.envFile?.join(', ') ?? 'No .env file found'} />
        </div>
      </section>

      <section>
        <h2>Services</h2>
        <div className="admin-stats">
          <Stat
            label="Telegram bot"
            value={services.telegram.state}
            tone={services.telegram.state === 'ready' ? 'ok' : services.telegram.state === 'off' ? undefined : 'bad'}
            note={services.telegram.problem ?? `${services.telegram.bot ?? ''} · ${services.telegramLinkedUsers} user${services.telegramLinkedUsers === 1 ? '' : 's'} connected`}
          />
          <Stat label="Browser notifications" value={services.pushReady ? 'ready' : 'off'} tone={services.pushReady ? 'ok' : 'warn'} note={`${services.pushDevices} device${services.pushDevices === 1 ? '' : 's'} subscribed`} />
          <Stat
            label="Keep-alive"
            value={services.keepAlive.lastPingOk ? 'working' : services.keepAlive.lastPingAtMs ? 'failing' : 'waiting'}
            tone={services.keepAlive.lastPingOk ? 'ok' : services.keepAlive.lastPingAtMs ? 'bad' : 'warn'}
            note={`${services.keepAlive.origin ?? 'address not known yet'} · last ping ${formatAgo(services.keepAlive.lastPingAtMs)}`}
          />
          <Stat label="Alerts being watched" value={services.alertsWatched} note="Checked every 10 seconds" />
          <Stat
            label="Market list"
            value={services.marketsLoaded}
            tone={services.marketsLoaded > 0 ? 'ok' : 'bad'}
            note={services.marketsAgeMin === null ? 'not loaded yet' : `pairs, refreshed ${services.marketsAgeMin} min ago`}
          />
        </div>
      </section>
    </div>
  )
}

function UserDetail({ id, me, onChanged, onClose }: { id: string, me: string, onChanged(): void, onClose(): void }) {
  const [detail, setDetail] = useState<AdminUserDetail>()
  const [error, setError] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let live = true
    setDetail(undefined)
    setError('')
    fetchAdminUser(id).then((next) => { if (live) setDetail(next) }, (failure: Error) => { if (live) setError(failure.message) })
    return () => { live = false }
  }, [id])

  const run = async (action: () => Promise<unknown>, done: string, close = false) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setNotice(done)
      onChanged()
      if (close) onClose()
      else setDetail(await fetchAdminUser(id))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const user = detail?.user
  return (
    <aside className="admin-detail" aria-label="User details">
      <header>
        <div>
          <strong>{user?.displayName ?? 'Loading…'}</strong>
          <span>{user?.email}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details"><CloseIcon /></button>
      </header>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-notice" role="status">{notice}</p>}
      {user && detail && (
        <>
          <dl className="admin-facts">
            <div><dt>Joined</dt><dd>{new Date(user.createdAtMs).toLocaleString()}</dd></div>
            <div><dt>Last login</dt><dd>{user.lastLoginAtMs ? new Date(user.lastLoginAtMs).toLocaleString() : 'not recorded'}</dd></div>
            <div><dt>Last active</dt><dd>{formatAgo(user.lastSeenAtMs)}</dd></div>
            <div><dt>Last synced</dt><dd>{formatAgo(user.lastSyncAtMs)}</dd></div>
            <div><dt>Signed in on</dt><dd>{detail.sessions.length} session{detail.sessions.length === 1 ? '' : 's'}</dd></div>
            <div><dt>Storage</dt><dd>{formatBytes(user.storageBytes)} in {user.items} items</dd></div>
            <div><dt>Telegram</dt><dd>{user.telegram ? 'connected' : 'not connected'}</dd></div>
            <div><dt>Browser push</dt><dd>{user.pushDevices} device{user.pushDevices === 1 ? '' : 's'}</dd></div>
            <div><dt>Account ID</dt><dd><code>{user.id}</code></dd></div>
          </dl>

          <h3>Devices</h3>
          {user.devices.length === 0
            ? <p className="admin-muted">No device has saved data with a name yet.</p>
            : <ul className="admin-devices">{user.devices.map((device) => <li key={device.name + device.lastSaveAtMs}><span>{device.name}</span><small>last save {formatAgo(device.lastSaveAtMs)}</small></li>)}</ul>}

          <h3>Stored data</h3>
          <table className="admin-items">
            <thead><tr><th>Item</th><th>Holds</th><th>Size</th><th>Saved</th></tr></thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.key}>
                  <td>{ITEM_LABELS[item.key] ?? item.key}</td>
                  <td>{Object.entries(item.counts).map(([name, count]) => countLabel(count, name.replace(/([A-Z])/g, ' $1').toLowerCase())).join(', ') || '—'}</td>
                  <td>{formatBytes(item.bytes)}</td>
                  <td>{formatAgo(item.updatedAtMs)}{item.savedBy && <small>{item.savedBy}</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Actions</h3>
          <div className="admin-actions">
            <button type="button" disabled={busy || detail.sessions.length === 0} onClick={() => void run(() => signOutUser(user.id), 'Signed out on every device.')}>
              Sign out everywhere
            </button>
            {user.id !== me && (
              <div className="admin-delete">
                <label>
                  <span>Delete this account and all its data. Type <b>{user.email}</b> to confirm:</span>
                  <input value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} placeholder={user.email} aria-label="Confirm email" />
                </label>
                <button
                  type="button"
                  className="danger"
                  disabled={busy || confirmEmail.trim().toLowerCase() !== user.email}
                  onClick={() => void run(() => deleteUser(user.id, confirmEmail), 'Account deleted.', true)}
                >
                  Delete account
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  )
}

/** Admin page: server health, storage and services, and every registered account. */
export function AdminPage({ myUserId, onClose }: { myUserId: string, onClose(): void }) {
  const [tab, setTab] = useState<'overview' | 'users'>('overview')
  const [overview, setOverview] = useState<AdminOverview>()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AdminSort>('active')
  const [selected, setSelected] = useState<string>()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextOverview, nextUsers] = await Promise.all([fetchAdminOverview(), fetchAdminUsers()])
      setOverview(nextOverview)
      setUsers(nextUsers)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load the admin data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => sortAdminUsers(users, sort, query), [users, sort, query])
  const totals = useMemo(() => users.reduce((sum, user) => ({
    storage: sum.storage + user.storageBytes,
    layouts: sum.layouts + user.counts.layouts,
    drawings: sum.drawings + user.counts.drawings,
    alerts: sum.alerts + user.counts.activeAlerts,
  }), { storage: 0, layouts: 0, drawings: 0, alerts: 0 }), [users])

  return (
    <section className="admin-page" aria-labelledby="admin-title">
      <div className="admin-inner">
        <header className="admin-header">
          <h1 id="admin-title">Admin</h1>
          <div className="admin-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
            <button type="button" role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users <small>{users.length}</small></button>
          </div>
          <button type="button" className="admin-refresh" onClick={() => void load()} disabled={loading}><RefreshIcon /> {loading ? 'Loading…' : 'Refresh'}</button>
          <button type="button" className="admin-close" onClick={onClose} aria-label="Back to charts"><CloseIcon /></button>
        </header>
        {error && <p className="admin-error" role="alert">{error}</p>}

        {tab === 'overview' && overview && <OverviewTab overview={overview} />}

        {tab === 'users' && (
          <>
            <div className="admin-users-bar">
              <label className="admin-search">
                <SearchIcon />
                <input value={query} placeholder="Search name or email" aria-label="Search users" onChange={(event) => setQuery(event.target.value)} />
              </label>
              <select value={sort} onChange={(event) => setSort(event.target.value as AdminSort)} aria-label="Sort users">
                {SORTS.map((item) => <option value={item.value} key={item.value}>Sort: {item.label}</option>)}
              </select>
              <span className="admin-muted">
                {formatBytes(totals.storage)} stored · {countLabel(totals.layouts, 'layouts')} · {countLabel(totals.drawings, 'drawings')} · {countLabel(totals.alerts, 'active alerts')}
              </span>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-users">
                <thead>
                  <tr><th>User</th><th>Joined</th><th>Last active</th><th>Devices</th><th>Layouts</th><th>Drawings</th><th>Alerts</th><th>Storage</th><th>Notify</th></tr>
                </thead>
                <tbody>
                  {shown.map((user) => (
                    <tr key={user.id} className={selected === user.id ? 'selected' : ''} onClick={() => setSelected(user.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(user.id) }}>
                      <td>
                        <strong>{user.displayName}{user.isAdmin && <em>admin</em>}</strong>
                        <small>{user.email}</small>
                      </td>
                      <td>{new Date(user.createdAtMs).toLocaleDateString()}</td>
                      <td>{formatAgo(user.lastSeenAtMs)}</td>
                      <td title={user.devices.map((device) => device.name).join(', ')}>{user.devices.length}</td>
                      <td>{user.counts.layouts}</td>
                      <td>{user.counts.drawings}</td>
                      <td>{user.counts.activeAlerts}<small> / {user.counts.alerts}</small></td>
                      <td>{formatBytes(user.storageBytes)}</td>
                      <td>{[user.telegram ? 'Telegram' : '', user.pushDevices ? `Push ×${user.pushDevices}` : ''].filter(Boolean).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && <p className="admin-muted admin-empty">{users.length === 0 ? 'No users yet.' : 'No user matches that search.'}</p>}
            </div>
          </>
        )}
      </div>
      {selected && <UserDetail id={selected} me={myUserId} onChanged={() => void load()} onClose={() => setSelected(undefined)} />}
    </section>
  )
}
