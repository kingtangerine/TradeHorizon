import { useMemo, useState, type ReactNode } from 'react'
import { groupAlerts, isTriggered, type AlertDirection, type AlertFilter, type PriceAlert } from './alerts'
import { BellIcon, ChevronIcon, CloseIcon, EyeIcon, EyeOffIcon, PauseIcon, PlayIcon, SearchIcon, TrashIcon } from './Icons'
import type { CryptoMarket } from '../chart/markets'

interface AlertsPanelProps {
  alerts: readonly PriceAlert[]
  market: CryptoMarket
  /** Latest price of the chart's symbol, for the "distance" column and the form placeholder. */
  lastPrice?: number
  linesVisible: boolean
  onToggleLines(): void
  onCreate(direction: AlertDirection, targetPrice: number): void
  onToggle(id: string): void
  onDelete(id: string): void
  onClearTriggered(): void
  onOpenSymbol(symbol: string): void
  onClose(): void
  /** One-line state of browser and Telegram notifications, shown on the collapsed section. */
  notificationSummary: string
  notifications: ReactNode
}

const FILTERS: ReadonlyArray<{ value: AlertFilter, label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'triggered', label: 'Triggered' },
  { value: 'all', label: 'All' },
]

const shortSymbol = (symbol: string) => symbol.replace(/(USDT|USDC|FDUSD|BUSD)$/, '')

function formatTime(ms: number): string {
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Price alerts side panel. Stays tidy with many alerts: filtered, searchable and grouped per coin. */
export function AlertsPanel({
  alerts, market, lastPrice, linesVisible, onToggleLines, onCreate, onToggle, onDelete, onClearTriggered, onOpenSymbol, onClose,
  notificationSummary, notifications,
}: AlertsPanelProps) {
  const [filter, setFilter] = useState<AlertFilter>('active')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [direction, setDirection] = useState<AlertDirection>('above')
  const [price, setPrice] = useState('')

  const counts = useMemo(() => {
    const triggered = alerts.filter(isTriggered).length
    return { active: alerts.length - triggered, triggered, all: alerts.length }
  }, [alerts])
  const groups = useMemo(() => groupAlerts(alerts, filter, query, market.symbol), [alerts, filter, query, market.symbol])
  const precision = market.pricePrecision

  const toggleGroup = (symbol: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(symbol)) next.delete(symbol)
    else next.add(symbol)
    return next
  })

  const distance = (alert: PriceAlert) => {
    if (alert.symbol !== market.symbol || !lastPrice || isTriggered(alert)) return undefined
    const percent = ((alert.targetPrice - lastPrice) / lastPrice) * 100
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(Math.abs(percent) < 1 ? 2 : 1)}%`
  }

  return (
    <aside className="alerts-panel" aria-label="Price alerts">
      <header>
        <div><BellIcon /><strong>Price alerts</strong>{counts.active > 0 && <span className="alerts-count">{counts.active}</span>}</div>
        <span className="alerts-header-actions">
          <button
            type="button"
            className={linesVisible ? 'alerts-lines-toggle on' : 'alerts-lines-toggle'}
            aria-pressed={linesVisible}
            title={linesVisible ? 'Hide alert lines on the chart' : 'Show alert lines on the chart'}
            onClick={onToggleLines}
          >
            {linesVisible ? <EyeIcon /> : <EyeOffIcon />}<span>On chart</span>
          </button>
          <button type="button" onClick={onClose} aria-label="Close alerts"><CloseIcon /></button>
        </span>
      </header>

      <form
        className="alert-create-form"
        onSubmit={(event) => {
          event.preventDefault()
          const target = Number(price)
          if (!Number.isFinite(target) || target <= 0) return
          onCreate(direction, target)
          setPrice('')
        }}
      >
        <strong>New alert · {shortSymbol(market.symbol)}</strong>
        <div className="alert-create-row">
          <select value={direction} onChange={(event) => setDirection(event.target.value as AlertDirection)} aria-label="Trigger">
            <option value="above">Crosses above</option>
            <option value="below">Crosses below</option>
          </select>
          <input
            type="number"
            min="0"
            step="any"
            required
            aria-label={market.kind === 'dominance' ? 'Target level' : `Target price (${market.quoteAsset})`}
            placeholder={lastPrice !== undefined ? String(lastPrice) : 'Price'}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
          <button type="submit" title="Create alert"><BellIcon /> Add</button>
        </div>
        <small className="alert-note">
          Tip: right-click the chart or use the + next to the price scale to place an alert, then drag its line to move it.
          {market.kind === 'dominance' && ' Index alerts only fire while TradeHorizon is open.'}
        </small>
      </form>

      <details className="alert-notifications">
        <summary><span>Notifications</span><small>{notificationSummary}</small><ChevronIcon /></summary>
        {notifications}
      </details>

      <div className="alerts-toolbar">
        <div className="alerts-filter" role="tablist" aria-label="Show alerts">
          {FILTERS.map((item) => (
            <button
              type="button"
              role="tab"
              key={item.value}
              aria-selected={filter === item.value}
              className={filter === item.value ? 'active' : ''}
              onClick={() => setFilter(item.value)}
            >
              {item.label} <small>{counts[item.value]}</small>
            </button>
          ))}
        </div>
        {alerts.length > 6 && (
          <label className="alerts-search">
            <SearchIcon />
            <input value={query} placeholder="Search coin" aria-label="Search alerts by coin" onChange={(event) => setQuery(event.target.value)} />
          </label>
        )}
        {filter === 'triggered' && counts.triggered > 0 && (
          <button type="button" className="alerts-clear" onClick={onClearTriggered}>Clear triggered</button>
        )}
      </div>

      <div className="alerts-list">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.symbol)
          return (
            <section className="alert-group" key={group.symbol}>
              <header>
                <button type="button" className="alert-group-toggle" aria-expanded={!isCollapsed} onClick={() => toggleGroup(group.symbol)}>
                  <ChevronIcon className={isCollapsed ? 'collapsed' : undefined} />
                  <strong>{shortSymbol(group.symbol)}</strong>
                  <small>{group.alerts.length}</small>
                  {group.symbol === market.symbol && <em>On chart</em>}
                </button>
                {group.symbol !== market.symbol && (
                  <button type="button" className="alert-group-open" onClick={() => onOpenSymbol(group.symbol)} title={`Open the ${shortSymbol(group.symbol)} chart`}>
                    Open chart
                  </button>
                )}
              </header>
              {!isCollapsed && group.alerts.map((alert) => {
                const triggered = isTriggered(alert)
                const away = distance(alert)
                return (
                  <div className={triggered ? 'alert-row triggered' : alert.enabled ? 'alert-row' : 'alert-row paused'} key={alert.id}>
                    <span className={`alert-direction ${alert.direction}`} aria-label={alert.direction === 'above' ? 'Crosses above' : 'Crosses below'}>
                      {alert.direction === 'above' ? '▲' : '▼'}
                    </span>
                    <div>
                      <strong>{alert.targetPrice.toLocaleString('en-US', { maximumFractionDigits: alert.symbol === market.symbol ? precision : 8 })}</strong>
                      <span>
                        {triggered
                          ? `Triggered ${formatTime(alert.triggeredAtMs!)}${alert.triggeredPrice !== undefined ? ` at ${alert.triggeredPrice.toLocaleString('en-US', { maximumFractionDigits: 8 })}` : ''}`
                          : alert.enabled ? 'Active' : 'Paused'}
                        {away && <b> · {away}</b>}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="icon"
                      onClick={() => onToggle(alert.id)}
                      title={triggered ? 'Re-arm' : alert.enabled ? 'Pause' : 'Resume'}
                      aria-label={triggered ? 'Re-arm alert' : alert.enabled ? 'Pause alert' : 'Resume alert'}
                    >
                      {alert.enabled ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <button type="button" className="icon delete" onClick={() => onDelete(alert.id)} aria-label="Delete alert" title="Delete">
                      <TrashIcon />
                    </button>
                  </div>
                )
              })}
            </section>
          )
        })}
        {groups.length === 0 && (
          <div className="alerts-empty">
            {alerts.length === 0
              ? 'No price alerts yet.'
              : query.trim() ? `No alerts for “${query.trim()}”.` : filter === 'triggered' ? 'Nothing has triggered yet.' : 'No active alerts.'}
          </div>
        )}
      </div>
    </aside>
  )
}
