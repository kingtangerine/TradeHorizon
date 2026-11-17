import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { groupAlerts, isTriggered, type AlertCondition, type AlertDirection, type AlertFilter, type AlertOptions, type PriceAlert } from './alerts'
import { MAX_MESSAGE_LENGTH, MOVE_WINDOWS_MS, describeAlert, isExpired } from '../../server/alertRules.ts'
import { BellIcon, ChevronIcon, CloseIcon, EyeIcon, EyeOffIcon, PauseIcon, PlayIcon, SearchIcon, TrashIcon } from './Icons'
import type { CryptoMarket } from '../chart/markets'

interface AlertsPanelProps {
  /** Alt+A: start the form at this price and put the cursor in it. */
  initialPrice?: string
  alerts: readonly PriceAlert[]
  market: CryptoMarket
  /** Latest price of the chart's symbol, for the "distance" column and the form placeholder. */
  lastPrice?: number
  linesVisible: boolean
  onToggleLines(): void
  onCreate(options: AlertOptions): void
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

type FormKind = 'crossingUp' | 'crossingDown' | 'greater' | 'less' | 'enterChannel' | 'exitChannel' | 'moveUp' | 'moveDown'

/** The form's condition list, as TradingView words it. */
const FORM_KINDS: Readonly<Record<FormKind, { label: string, condition: AlertCondition, direction?: AlertDirection }>> = {
  crossingUp: { label: 'Crossing up', condition: 'crossing', direction: 'above' },
  crossingDown: { label: 'Crossing down', condition: 'crossing', direction: 'below' },
  greater: { label: 'Greater than', condition: 'greater', direction: 'above' },
  less: { label: 'Less than', condition: 'less', direction: 'below' },
  enterChannel: { label: 'Entering channel', condition: 'enterChannel', direction: 'above' },
  exitChannel: { label: 'Exiting channel', condition: 'exitChannel', direction: 'above' },
  moveUp: { label: 'Moving up %', condition: 'movePercent', direction: 'above' },
  moveDown: { label: 'Moving down %', condition: 'movePercent', direction: 'below' },
}

/** "BYBIT:SOLUSDT.P" -> "BYBIT SOL.P": the coin, and the exchange when it is not Binance. */
const shortSymbol = (symbol: string) => {
  const exchange = /^([A-Z]+):/.exec(symbol)?.[1]
  const coin = symbol.replace(/^[A-Z]+:/, '').replace(/(USDT|USDC|FDUSD|BUSD)(.P)?$/, '$2')
  return exchange ? `${exchange} ${coin}` : coin
}

function formatTime(ms: number): string {
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Price alerts side panel. Stays tidy with many alerts: filtered, searchable and grouped per coin. */
export function AlertsPanel({
  alerts, market, lastPrice, linesVisible, onToggleLines, onCreate, onToggle, onDelete, onClearTriggered, onOpenSymbol, onClose,
  notificationSummary, notifications, initialPrice,
}: AlertsPanelProps) {
  const [filter, setFilter] = useState<AlertFilter>('active')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [direction, setDirection] = useState<AlertDirection>('above')
  // TradingView-style conditions: "kind" folds the condition and, for crossings and moves, the direction.
  const [kind, setKind] = useState<FormKind>('crossingUp')
  const [upper, setUpper] = useState('')
  const [percent, setPercent] = useState('3')
  const [windowMs, setWindowMs] = useState(3_600_000)
  const [frequency, setFrequency] = useState<'once' | 'everyTime'>('once')
  const [expiry, setExpiry] = useState(0)
  const [message, setMessage] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [price, setPrice] = useState(initialPrice ?? '')
  const priceRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (initialPrice !== undefined) { priceRef.current?.focus(); priceRef.current?.select() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [notificationsOpen, setNotificationsOpen] = useState(true)

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
          const spec = FORM_KINDS[kind]
          const target = spec.condition === 'movePercent' ? (lastPrice ?? 0) : Number(price)
          if (spec.condition !== 'movePercent' && (!Number.isFinite(target) || target <= 0)) return
          const top = Number(upper)
          if ((spec.condition === 'enterChannel' || spec.condition === 'exitChannel') && !(Number.isFinite(top) && top > 0)) return
          const size = Number(percent)
          if (spec.condition === 'movePercent' && !(size > 0 && size <= 100)) return
          onCreate({
            targetPrice: target,
            // A crossing's side is where the target sits from the price, unless the form says otherwise.
            direction: spec.direction ?? direction,
            ...(spec.condition !== 'crossing' ? { condition: spec.condition } : {}),
            ...(spec.condition === 'enterChannel' || spec.condition === 'exitChannel' ? { upperPrice: top } : {}),
            ...(spec.condition === 'movePercent' ? { percent: size, windowMs } : {}),
            ...(frequency === 'everyTime' ? { frequency } : {}),
            ...(expiry > 0 ? { expiresAtMs: Date.now() + expiry } : {}),
            ...(message.trim() ? { message: message.trim().slice(0, MAX_MESSAGE_LENGTH) } : {}),
          })
          setPrice('')
          setUpper('')
          setMessage('')
        }}
      >
        <strong>New alert · {shortSymbol(market.symbol)}</strong>
        <div className="alert-create-row">
          <select value={kind} onChange={(event) => { const next = event.target.value as FormKind; setKind(next); setDirection(FORM_KINDS[next].direction ?? 'above') }} aria-label="Condition">
            {(Object.keys(FORM_KINDS) as FormKind[]).map((item) => <option value={item} key={item}>{FORM_KINDS[item].label}</option>)}
          </select>
          {FORM_KINDS[kind].condition === 'movePercent' ? (
            <>
              <input type="number" min="0.1" max="100" step="0.1" aria-label="Move size in percent" value={percent} onChange={(event) => setPercent(event.target.value)} />
              <select value={windowMs} onChange={(event) => setWindowMs(Number(event.target.value))} aria-label="Within">
                {MOVE_WINDOWS_MS.map((ms) => <option value={ms} key={ms}>in {ms >= 3_600_000 ? `${ms / 3_600_000}h` : `${ms / 60_000}m`}</option>)}
              </select>
            </>
          ) : (
          <input
            ref={priceRef}
            type="number"
            min="0"
            step="any"
            required
            aria-label={market.kind === 'dominance' ? 'Target level' : `Target price (${market.quoteAsset})`}
            placeholder={lastPrice !== undefined ? String(lastPrice) : 'Price'}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
          )}
          {(FORM_KINDS[kind].condition === 'enterChannel' || FORM_KINDS[kind].condition === 'exitChannel') && (
            <input type="number" min="0" step="any" required aria-label="Other side of the channel" placeholder="Upper / lower" value={upper} onChange={(event) => setUpper(event.target.value)} />
          )}
          <button type="submit" title="Create alert"><BellIcon /> Add</button>
        </div>
        <button type="button" className="alert-more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
          {moreOpen ? 'Fewer options' : 'Repeat, expiry and message…'}
        </button>
        {moreOpen && (
          <div className="alert-more">
            <label>
              <span>Trigger</span>
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as 'once' | 'everyTime')}>
                <option value="once">Only once</option>
                <option value="everyTime">Every time (at most once a minute)</option>
              </select>
            </label>
            <label>
              <span>Expires</span>
              <select value={expiry} onChange={(event) => setExpiry(Number(event.target.value))}>
                <option value={0}>Never</option>
                <option value={86_400_000}>In 1 day</option>
                <option value={7 * 86_400_000}>In 1 week</option>
                <option value={30 * 86_400_000}>In 1 month</option>
              </select>
            </label>
            <label className="wide">
              <span>Message</span>
              <input value={message} maxLength={MAX_MESSAGE_LENGTH} placeholder="Shown in the notification (optional)" onChange={(event) => setMessage(event.target.value)} />
            </label>
          </div>
        )}
        <small className="alert-note">
          Tip: right-click the chart or use the + next to the price scale to place an alert, then drag its line to move it.
          {market.kind === 'dominance' && ' Index alerts only fire while TradeHorizon is open.'}
        </small>
      </form>

      <details className="alert-notifications" open={notificationsOpen} onToggle={(event) => setNotificationsOpen(event.currentTarget.open)}>
        <summary><span>Notifications · browser &amp; Telegram</span><small>{notificationSummary}</small><ChevronIcon /></summary>
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
                      <strong title={describeAlert(alert)}>
                        {(alert.condition ?? 'crossing') === 'crossing' && !alert.line
                          ? alert.targetPrice.toLocaleString('en-US', { maximumFractionDigits: alert.symbol === market.symbol ? precision : 8 })
                          : describeAlert(alert)}
                      </strong>
                      <span>
                        {triggered
                          ? `Triggered ${formatTime(alert.triggeredAtMs!)}${alert.triggeredPrice !== undefined ? ` at ${alert.triggeredPrice.toLocaleString('en-US', { maximumFractionDigits: 8 })}` : ''}`
                          : isExpired(alert, Date.now()) ? 'Expired' : alert.enabled ? 'Active' : 'Paused'}
                        {alert.frequency === 'everyTime' && <b> · every time{alert.triggerCount ? ` (${alert.triggerCount}×)` : ''}</b>}
                        {alert.expiresAtMs !== undefined && !triggered && !isExpired(alert, Date.now()) && <b> · until {formatTime(alert.expiresAtMs)}</b>}
                        {away && !alert.line && !alert.condition && <b> · {away}</b>}
                      </span>
                      {alert.message && <em className="alert-message">“{alert.message}”</em>}
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
