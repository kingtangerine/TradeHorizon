import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { CryptoChartSurface } from '../chart/CryptoChartSurface'
import { DISPLAY_INTERVALS } from '../chart/intervals'
import type { KLineChartController } from '../chart/KLineChartController'
import { CRYPTO_MARKETS, DEFAULT_CRYPTO_MARKET } from '../chart/markets'
import type { ChartRuntimeState } from '../chart/types'
import {
  DrawingStore,
  createLocalStorageDrawingRepository,
  deleteDrawing,
  updateDrawing,
} from '../drawings'
import type { MarketInterval } from '../market'
import { alertReached, loadAlerts, saveAlerts, type AlertDirection, type PriceAlert } from './alerts'
import { logIn, logOut, restoreSession, signUp, type AppUser } from './auth'
import { loadWorkspace, saveWorkspace, type ChartTab } from './workspace'
import {
  CursorIcon,
  CloseIcon,
  BellIcon,
  EyeIcon,
  EyeOffIcon,
  HorizontalLineIcon,
  HorizonLogo,
  LayersIcon,
  LockIcon,
  LongPositionIcon,
  PlusIcon,
  PriceRangeIcon,
  RedoIcon,
  RectangleIcon,
  RefreshIcon,
  SettingsIcon,
  TargetIcon,
  TrashIcon,
  TrendLineIcon,
  UndoIcon,
  UnlockIcon,
  UserIcon,
} from './Icons'

const INITIAL_INTERVAL: MarketInterval = '15m'

function formatPrice(value?: number, precision = 2): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value)
}

function formatCompact(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
}

function connectionCopy(state: ChartRuntimeState): string {
  switch (state.connection) {
    case 'live':
      return 'Live'
    case 'reconnecting':
      return 'Reconnecting'
    case 'connecting':
      return 'Connecting'
    case 'loading':
      return 'Loading history'
    case 'error':
      return 'Data unavailable'
  }
}

function styleNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function colorInputValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  if (/^#[0-9a-f]{6}$/i.test(value)) return value

  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  if (!rgba) return fallback
  return `#${rgba.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0')).join('')}`
}

interface WorkspaceAppProps {
  user: AppUser
  onLogout(): void
}

function WorkspaceApp({ user, onLogout }: WorkspaceAppProps) {
  const [workspace, setWorkspace] = useState(() => loadWorkspace(user.id))
  const initialTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0]
  const initialMarket = CRYPTO_MARKETS.find((item) => item.symbol === initialTab.symbol) ?? DEFAULT_CRYPTO_MARKET
  const [drawingStore] = useState(
    () =>
      new DrawingStore({
        repository: createLocalStorageDrawingRepository({
          key: `trade-horizon:user:${user.id}:drawings:v1`,
        }),
        historyLimit: 100,
      }),
  )
  const drawingSnapshot = useSyncExternalStore(
    drawingStore.subscribe,
    drawingStore.getSnapshot,
    drawingStore.getSnapshot,
  )
  const [interval, setInterval] = useState<MarketInterval>(initialTab.interval)
  const [market, setMarket] = useState(initialMarket)
  const [controller, setController] = useState<KLineChartController | null>(null)
  const [activeTool, setActiveTool] = useState<
    'cursor' | 'trendLine' | 'horizontalLine' | 'rectangle' | 'longPosition' | 'priceRange'
  >('cursor')
  const [selectedDrawingId, setSelectedDrawingId] = useState<string>()
  const [objectTreeOpen, setObjectTreeOpen] = useState(true)
  const [positionSettingsOpen, setPositionSettingsOpen] = useState(false)
  const [superchartOpen, setSuperchartOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => loadAlerts(user.id))
  const [alertDirection, setAlertDirection] = useState<AlertDirection>('above')
  const [alertPrice, setAlertPrice] = useState('')
  const previousPriceRef = useRef<number | undefined>(undefined)
  const [runtime, setRuntime] = useState<ChartRuntimeState>({
    interval: INITIAL_INTERVAL,
    connection: 'loading',
    quote: null,
    error: null,
    followingLive: true,
  })

  const handleControllerChange = useCallback(
    (next: KLineChartController | null) => setController(next),
    [],
  )
  const handleToolSettled = useCallback(() => setActiveTool('cursor'), [])
  const handleSelectionChange = useCallback((id?: string) => {
    setSelectedDrawingId(id)
    setPositionSettingsOpen(false)
  }, [])

  const chooseCursor = useCallback(() => {
    controller?.cancelActiveTool()
    controller?.clearDrawingSelection()
    setActiveTool('cursor')
  }, [controller])

  const chooseTrendLine = useCallback(() => {
    if (controller?.startTrendLine()) setActiveTool('trendLine')
  }, [controller])

  const chooseHorizontalLine = useCallback(() => {
    if (controller?.startHorizontalLine()) setActiveTool('horizontalLine')
  }, [controller])

  const chooseRectangle = useCallback(() => {
    if (controller?.startRectangle()) setActiveTool('rectangle')
  }, [controller])

  const chooseLongPosition = useCallback(() => {
    if (controller?.startLongPosition()) setActiveTool('longPosition')
  }, [controller])

  const choosePriceRange = useCallback(() => {
    if (controller?.startPriceRange()) setActiveTool('priceRange')
  }, [controller])

  const updateActiveTab = useCallback((changes: Partial<Pick<ChartTab, 'symbol' | 'interval'>>) => {
    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => tab.id === current.activeTabId ? { ...tab, ...changes } : tab),
    }))
  }, [])

  const changeMarket = useCallback((nextMarket: typeof market) => {
    setMarket(nextMarket)
    updateActiveTab({ symbol: nextMarket.symbol })
  }, [updateActiveTab])

  const changeInterval = useCallback((nextInterval: MarketInterval) => {
    setInterval(nextInterval)
    updateActiveTab({ interval: nextInterval })
  }, [updateActiveTab])

  const activateTab = useCallback((tab: ChartTab) => {
    const nextMarket = CRYPTO_MARKETS.find((item) => item.symbol === tab.symbol) ?? DEFAULT_CRYPTO_MARKET
    setWorkspace((current) => ({ ...current, activeTabId: tab.id }))
    setMarket(nextMarket)
    setInterval(tab.interval)
    setSuperchartOpen(false)
  }, [])

  const createChartTab = useCallback((symbol: string) => {
    const tab: ChartTab = {
      id: crypto.randomUUID(),
      symbol,
      interval: INITIAL_INTERVAL,
      createdAtMs: Date.now(),
    }
    setWorkspace((current) => ({ tabs: [...current.tabs, tab], activeTabId: tab.id }))
    const nextMarket = CRYPTO_MARKETS.find((item) => item.symbol === symbol) ?? DEFAULT_CRYPTO_MARKET
    setMarket(nextMarket)
    setInterval(tab.interval)
    setSuperchartOpen(false)
  }, [])

  const closeChartTab = useCallback((id: string) => {
    setWorkspace((current) => {
      if (current.tabs.length === 1) return current
      const index = current.tabs.findIndex((tab) => tab.id === id)
      const tabs = current.tabs.filter((tab) => tab.id !== id)
      if (current.activeTabId !== id) return { ...current, tabs }
      const next = tabs[Math.max(0, index - 1)] ?? tabs[0]
      const nextMarket = CRYPTO_MARKETS.find((item) => item.symbol === next.symbol) ?? DEFAULT_CRYPTO_MARKET
      setMarket(nextMarket)
      setInterval(next.interval)
      return { tabs, activeTabId: next.id }
    })
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return

      if (event.key === 'Escape') chooseCursor()
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedDrawingId) {
        event.preventDefault()
        controller?.deleteSelected()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.shiftKey ? drawingStore.redo() : drawingStore.undo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        drawingStore.redo()
      }
    }

    globalThis.addEventListener('keydown', handleKeyDown)
    return () => globalThis.removeEventListener('keydown', handleKeyDown)
  }, [chooseCursor, controller, drawingStore, selectedDrawingId])

  useEffect(() => {
    setSelectedDrawingId(undefined)
    setPositionSettingsOpen(false)
    previousPriceRef.current = undefined
  }, [market])

  useEffect(() => saveWorkspace(user.id, workspace), [user.id, workspace])
  useEffect(() => saveAlerts(user.id, alerts), [alerts, user.id])

  useEffect(() => {
    const price = runtime.quote?.close
    if (price === undefined) return
    const previous = previousPriceRef.current
    previousPriceRef.current = price
    if (previous === undefined) return

    const triggered = alerts.filter((alert) => (
      alert.enabled && !alert.triggeredAtMs && alert.symbol === market.symbol &&
      !alertReached(alert, previous) && alertReached(alert, price)
    ))
    if (triggered.length === 0) return

    const now = Date.now()
    setAlerts((current) => current.map((alert) => (
      triggered.some((item) => item.id === alert.id) ? { ...alert, triggeredAtMs: now, enabled: false } : alert
    )))

    try {
      const AudioContextClass = globalThis.AudioContext
      const audio = new AudioContextClass()
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.18, audio.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6)
      oscillator.connect(gain).connect(audio.destination)
      oscillator.start()
      oscillator.stop(audio.currentTime + 0.6)
    } catch {
      // Audio may be blocked until the user interacts with the page.
    }

    for (const alert of triggered) {
      if ('Notification' in globalThis && Notification.permission === 'granted') {
        new Notification(`${alert.symbol} price alert`, {
          body: `Price reached ${price.toLocaleString()} (target ${alert.targetPrice.toLocaleString()}).`,
        })
      }
    }
  }, [alerts, market.symbol, runtime.quote?.close])

  const quote = runtime.quote
  const isPositive = (quote?.changePercent ?? 0) >= 0
  const blockingLoad = !quote && runtime.connection !== 'error'
  const connectionLabel = connectionCopy(runtime)
  const marketDrawings = drawingSnapshot.drawings.filter((drawing) => drawing.marketId === market.marketId)
  const selectedDrawing = drawingSnapshot.drawings.find((drawing) => drawing.id === selectedDrawingId)

  const updateSelectedStyle = (changes: Record<string, string | number>) => {
    if (!selectedDrawing) return
    drawingStore.execute(updateDrawing(selectedDrawing.id, {
      style: { ...selectedDrawing.style, ...changes },
    }))
  }

  return (
    <div className="terminal-shell">
      <header className="topbar">
        <div className="brand" aria-label="TradeHorizon">
          <HorizonLogo />
          <span className="brand-name">TradeHorizon</span>
          <span className="preview-pill">ALPHA</span>
        </div>

        <div className="market-heading">
          <span className="asset-badge">{market.mark}</span>
          <div className="market-title-group">
            <div className="market-title-row">
              <label className="market-selector">
                <span className="sr-only">Select crypto market</span>
                <select
                  value={market.symbol}
                  onChange={(event) => {
                    const next = CRYPTO_MARKETS.find((item) => item.symbol === event.target.value)
                    if (next) changeMarket(next)
                  }}
                >
                  {CRYPTO_MARKETS.map((item) => (
                    <option value={item.symbol} key={item.symbol}>
                      {item.baseAsset} / {item.quoteAsset} · {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="market-kind">Spot</span>
            </div>
            <span>Binance</span>
          </div>
        </div>

        <div className="quote-heading" aria-live="polite">
          <strong>{formatPrice(quote?.close, market.pricePrecision)}</strong>
          <span className={isPositive ? 'price-up' : 'price-down'}>
            {quote ? `${isPositive ? '+' : ''}${quote.changePercent.toFixed(2)}%` : '—'}
          </span>
          <small>{interval} candle</small>
        </div>

        <div className={`connection-chip connection-${runtime.connection}`} title={runtime.error ?? connectionLabel}>
          <span className="connection-dot" />
          <span>{connectionLabel}</span>
        </div>
      </header>

      <nav className="chart-tabs" aria-label="Open charts">
        <div className="chart-tabs-scroll">
          {workspace.tabs.map((tab) => {
            const tabMarket = CRYPTO_MARKETS.find((item) => item.symbol === tab.symbol) ?? DEFAULT_CRYPTO_MARKET
            const active = tab.id === workspace.activeTabId
            return (
              <div className={active ? 'chart-tab active' : 'chart-tab'} key={tab.id}>
                <button type="button" className="chart-tab-main" onClick={() => activateTab(tab)}>
                  <span className="chart-tab-mark">{tabMarket.mark}</span>
                  <span>{tabMarket.baseAsset} / USDT</span>
                  <small>{tab.interval}</small>
                </button>
                <button
                  type="button"
                  className="chart-tab-close"
                  aria-label={`Close ${tabMarket.baseAsset} chart`}
                  onClick={() => closeChartTab(tab.id)}
                  disabled={workspace.tabs.length === 1}
                >
                  <CloseIcon />
                </button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className="new-chart-tab"
          aria-label="Open new Superchart"
          title="New Superchart"
          onClick={() => setSuperchartOpen(true)}
        >
          <PlusIcon />
        </button>
      </nav>

      <div className="market-toolbar">
        <div className="timeframe-group" aria-label="Chart timeframe">
          {DISPLAY_INTERVALS.map((value) => (
            <button
              className={interval === value ? 'timeframe-button active' : 'timeframe-button'}
              type="button"
              key={value}
              aria-pressed={interval === value}
              onClick={() => changeInterval(value)}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="ohlc-strip" aria-label="Current candle values">
          <span><b>O</b>{formatPrice(quote?.open, market.pricePrecision)}</span>
          <span><b>H</b>{formatPrice(quote?.high, market.pricePrecision)}</span>
          <span><b>L</b>{formatPrice(quote?.low, market.pricePrecision)}</span>
          <span><b>C</b>{formatPrice(quote?.close, market.pricePrecision)}</span>
          <span className="volume-value"><b>Vol</b>{formatCompact(quote?.volume)}</span>
        </div>

        <button
          type="button"
          className={runtime.followingLive ? 'live-button active' : 'live-button'}
          onClick={() => controller?.goToLive()}
          disabled={!controller}
        >
          <TargetIcon />
          Go live
        </button>
      </div>

      <main className={objectTreeOpen ? 'workspace object-tree-visible' : 'workspace'}>
        <aside className="tool-rail" aria-label="Drawing tools">
          <button
            type="button"
            className={activeTool === 'cursor' ? 'tool-button active' : 'tool-button'}
            aria-label="Pointer tool"
            title="Pointer (Esc)"
            onClick={chooseCursor}
          >
            <CursorIcon />
          </button>
          <button
            type="button"
            className={activeTool === 'trendLine' ? 'tool-button active' : 'tool-button'}
            aria-label="Draw trend line"
            title="Trend line"
            onClick={chooseTrendLine}
            disabled={!controller || runtime.connection === 'error'}
          >
            <TrendLineIcon />
          </button>
          <button
            type="button"
            className={activeTool === 'horizontalLine' ? 'tool-button active' : 'tool-button'}
            aria-label="Draw horizontal line"
            title="Horizontal line"
            onClick={chooseHorizontalLine}
            disabled={!controller || runtime.connection === 'error'}
          >
            <HorizontalLineIcon />
          </button>
          <button
            type="button"
            className={activeTool === 'rectangle' ? 'tool-button active' : 'tool-button'}
            aria-label="Draw rectangle"
            title="Rectangle"
            onClick={chooseRectangle}
            disabled={!controller || runtime.connection === 'error'}
          >
            <RectangleIcon />
          </button>
          <button
            type="button"
            className={activeTool === 'priceRange' ? 'tool-button active' : 'tool-button'}
            aria-label="Draw price range"
            title="Price range"
            onClick={choosePriceRange}
            disabled={!controller || runtime.connection === 'error'}
          >
            <PriceRangeIcon />
          </button>
          <button
            type="button"
            className={activeTool === 'longPosition' ? 'tool-button active' : 'tool-button'}
            aria-label="Draw long position"
            title="Long position"
            onClick={chooseLongPosition}
            disabled={!controller || runtime.connection === 'error'}
          >
            <LongPositionIcon />
          </button>

          <span className="tool-divider" />

          <button
            type="button"
            className="tool-button"
            aria-label="Undo drawing change"
            title="Undo (Ctrl+Z)"
            onClick={() => drawingStore.undo()}
            disabled={!drawingSnapshot.canUndo}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="tool-button"
            aria-label="Redo drawing change"
            title="Redo (Ctrl+Y)"
            onClick={() => drawingStore.redo()}
            disabled={!drawingSnapshot.canRedo}
          >
            <RedoIcon />
          </button>
          <button
            type="button"
            className="tool-button danger"
            aria-label="Delete selected drawing"
            title="Delete selected drawing"
            onClick={() => controller?.deleteSelected()}
            disabled={!selectedDrawingId}
          >
            <TrashIcon />
          </button>
        </aside>

        <section className="chart-workspace" aria-label="Market chart workspace">
          <div className="chart-watermark" aria-hidden="true">
            <strong>{market.symbol}</strong>
            <span>{interval} · Binance Spot</span>
          </div>

          <CryptoChartSurface
            interval={interval}
            market={market}
            drawingStore={drawingStore}
            onRuntimeState={setRuntime}
            onControllerChange={handleControllerChange}
            onToolSettled={handleToolSettled}
            onSelectionChange={handleSelectionChange}
          />

          {activeTool === 'trendLine' && (
            <div className="drawing-hint" role="status">
              <TrendLineIcon />
              Select two points on the chart
              <kbd>Esc</kbd>
            </div>
          )}

          {activeTool === 'horizontalLine' && (
            <div className="drawing-hint" role="status">
              <HorizontalLineIcon />
              Click anywhere on chart to place horizontal line
              <kbd>Esc</kbd>
            </div>
          )}

          {activeTool === 'rectangle' && (
            <div className="drawing-hint" role="status">
              <RectangleIcon />
              Select two opposite corners
              <kbd>Esc</kbd>
            </div>
          )}

          {activeTool === 'priceRange' && (
            <div className="drawing-hint" role="status">
              <PriceRangeIcon />
              Select start and end points to measure
              <kbd>Esc</kbd>
            </div>
          )}

          {activeTool === 'longPosition' && (
            <div className="drawing-hint" role="status">
              <LongPositionIcon />
              Select entry, target, then stop
              <kbd>Esc</kbd>
            </div>
          )}

          {blockingLoad && (
            <div className="chart-state" role="status">
              <span className="loader-ring" />
              <strong>Loading BTC candles</strong>
              <span>Connecting to the Binance market feed…</span>
            </div>
          )}

          {!quote && runtime.connection === 'error' && (
            <div className="chart-state error-state" role="alert">
              <span className="error-symbol">!</span>
              <strong>Market feed unavailable</strong>
              <span>{runtime.error ?? 'Check your connection and try again.'}</span>
              <button type="button" onClick={() => controller?.retry()}>
                <RefreshIcon />
                Retry
              </button>
            </div>
          )}

          {selectedDrawing && (
            <div className="floating-object-toolbar" role="toolbar" aria-label="Selected object properties">
              <span className="toolbar-grip" aria-hidden="true" />
              <div
                className="toolbar-object-type"
                title={
                  selectedDrawing.type === 'rectangle'
                    ? 'Rectangle'
                    : selectedDrawing.type === 'horizontalLine'
                      ? 'Horizontal line'
                      : selectedDrawing.type === 'priceRange'
                        ? 'Price range'
                        : selectedDrawing.type === 'longPosition'
                          ? 'Long position'
                          : 'Trend line'
                }
              >
                {selectedDrawing.type === 'rectangle'
                  ? <RectangleIcon />
                  : selectedDrawing.type === 'horizontalLine'
                    ? <HorizontalLineIcon />
                    : selectedDrawing.type === 'priceRange'
                      ? <PriceRangeIcon />
                      : selectedDrawing.type === 'longPosition'
                        ? <LongPositionIcon />
                        : <TrendLineIcon />}
              </div>
              <span className="toolbar-separator" />

              {selectedDrawing.type === 'longPosition' ? (
                <>
                  <label className="toolbar-color-control" title="Target color">
                    <input
                      type="color"
                      aria-label="Target color"
                      value={colorInputValue(selectedDrawing.style.targetColor, '#16a085')}
                      onChange={(event) => updateSelectedStyle({ targetColor: event.target.value })}
                    />
                  </label>
                  <label className="toolbar-color-control" title="Stop color">
                    <input
                      type="color"
                      aria-label="Stop color"
                      value={colorInputValue(selectedDrawing.style.stopColor, '#f0445e')}
                      onChange={(event) => updateSelectedStyle({ stopColor: event.target.value })}
                    />
                  </label>
                  <select
                    className="toolbar-select thickness-select"
                    aria-label="Line thickness"
                    title="Line thickness"
                    value={styleNumber(selectedDrawing.style.lineWidth, 1)}
                    onChange={(event) => updateSelectedStyle({ lineWidth: Number(event.target.value) })}
                  >
                    {[1, 2, 3, 4, 5].map((width) => <option value={width} key={width}>{width}px</option>)}
                  </select>
                  <button
                    type="button"
                    className={positionSettingsOpen ? 'toolbar-action active' : 'toolbar-action'}
                    aria-label="Long position settings"
                    title="Long position settings"
                    onClick={() => setPositionSettingsOpen((open) => !open)}
                  >
                    <SettingsIcon />
                  </button>
                </>
              ) : (
                <>
                  <label className="toolbar-color-control" title="Line color">
                    <input
                      type="color"
                      aria-label="Line color"
                      value={colorInputValue(selectedDrawing.style.color, selectedDrawing.type === 'rectangle' ? '#3aa9ff' : '#f4b860')}
                      onChange={(event) => updateSelectedStyle({ color: event.target.value })}
                    />
                  </label>
                  <select
                    className="toolbar-select thickness-select"
                    aria-label="Line thickness"
                    title="Line thickness"
                    value={styleNumber(selectedDrawing.style.lineWidth, 2)}
                    onChange={(event) => updateSelectedStyle({ lineWidth: Number(event.target.value) })}
                  >
                    {[1, 2, 3, 4, 5].map((width) => <option value={width} key={width}>{width}px</option>)}
                  </select>
                  <select
                    className="toolbar-select style-select"
                    aria-label="Line style"
                    title="Line style"
                    value={selectedDrawing.style.lineStyle === 'dashed' ? 'dashed' : 'solid'}
                    onChange={(event) => updateSelectedStyle({ lineStyle: event.target.value })}
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                  </select>
                  {selectedDrawing.type === 'rectangle' && (
                    <>
                      <span className="toolbar-separator" />
                      <label className="toolbar-color-control fill-control" title="Fill color">
                        <input
                          type="color"
                          aria-label="Rectangle fill color"
                          value={colorInputValue(selectedDrawing.style.fillColor, '#3aa9ff')}
                          onChange={(event) => updateSelectedStyle({ fillColor: event.target.value })}
                        />
                      </label>
                      <label className="toolbar-opacity" title="Fill opacity">
                        <span>{styleNumber(selectedDrawing.style.fillOpacity, 14)}%</span>
                        <input
                          type="range"
                          aria-label="Rectangle fill opacity"
                          min="0"
                          max="100"
                          step="1"
                          value={styleNumber(selectedDrawing.style.fillOpacity, 14)}
                          onChange={(event) => updateSelectedStyle({ fillOpacity: Number(event.target.value) })}
                        />
                      </label>
                    </>
                  )}
                </>
              )}

              <span className="toolbar-separator" />
              <button
                type="button"
                className={selectedDrawing.hidden ? 'toolbar-action active' : 'toolbar-action'}
                aria-label={selectedDrawing.hidden ? 'Show object' : 'Hide object'}
                title={selectedDrawing.hidden ? 'Show object' : 'Hide object'}
                onClick={() => drawingStore.execute(updateDrawing(selectedDrawing.id, {
                  hidden: !selectedDrawing.hidden,
                }))}
              >
                {selectedDrawing.hidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              <button
                type="button"
                className={selectedDrawing.locked ? 'toolbar-action active' : 'toolbar-action'}
                aria-label={selectedDrawing.locked ? 'Unlock object' : 'Lock object'}
                title={selectedDrawing.locked ? 'Unlock object' : 'Lock object'}
                onClick={() => drawingStore.execute(updateDrawing(selectedDrawing.id, {
                  locked: !selectedDrawing.locked,
                }))}
              >
                {selectedDrawing.locked ? <LockIcon /> : <UnlockIcon />}
              </button>
              <button
                type="button"
                className="toolbar-action delete"
                aria-label="Delete object"
                title="Delete object"
                onClick={() => drawingStore.execute(deleteDrawing(selectedDrawing.id))}
              >
                <TrashIcon />
              </button>
              <button
                type="button"
                className="toolbar-action"
                aria-label="Close object toolbar"
                title="Close"
                onClick={() => controller?.clearDrawingSelection()}
              >
                <CloseIcon />
              </button>
            </div>
          )}

          {selectedDrawing?.type === 'longPosition' && positionSettingsOpen && (
            <div className="position-settings-backdrop" role="presentation" onMouseDown={() => setPositionSettingsOpen(false)}>
              <section
                className="position-settings-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="position-settings-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <LongPositionIcon />
                    <div>
                      <small>Drawing properties</small>
                      <h2 id="position-settings-title">Long position</h2>
                    </div>
                  </div>
                  <button type="button" aria-label="Close settings" onClick={() => setPositionSettingsOpen(false)}>
                    <CloseIcon />
                  </button>
                </header>

                <div className="position-settings-section">
                  <h3>Risk inputs</h3>
                  <div className="position-settings-grid">
                    <label>
                      <span>Account size <small>USDT</small></span>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={styleNumber(selectedDrawing.style.accountSize, 10000)}
                        onChange={(event) => updateSelectedStyle({ accountSize: Math.max(0, Number(event.target.value)) })}
                      />
                    </label>
                    <label>
                      <span>Risk per trade <small>%</small></span>
                      <input
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.1"
                        value={styleNumber(selectedDrawing.style.riskPercent, 1)}
                        onChange={(event) => updateSelectedStyle({ riskPercent: Math.max(0.01, Math.min(100, Number(event.target.value))) })}
                      />
                    </label>
                  </div>
                  <p>Position quantity is calculated automatically from account size, risk percentage, entry, and stop distance.</p>
                </div>

                <div className="position-settings-section">
                  <h3>Style</h3>
                  <div className="position-settings-grid colors-grid">
                    <label>
                      <span>Target color</span>
                      <input
                        type="color"
                        value={colorInputValue(selectedDrawing.style.targetColor, '#16a085')}
                        onChange={(event) => updateSelectedStyle({ targetColor: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Stop color</span>
                      <input
                        type="color"
                        value={colorInputValue(selectedDrawing.style.stopColor, '#f0445e')}
                        onChange={(event) => updateSelectedStyle({ stopColor: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Line color</span>
                      <input
                        type="color"
                        value={colorInputValue(selectedDrawing.style.lineColor, '#c7d0db')}
                        onChange={(event) => updateSelectedStyle({ lineColor: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Text color</span>
                      <input
                        type="color"
                        value={colorInputValue(selectedDrawing.style.textColor, '#ffffff')}
                        onChange={(event) => updateSelectedStyle({ textColor: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Line thickness</span>
                      <select
                        value={styleNumber(selectedDrawing.style.lineWidth, 1)}
                        onChange={(event) => updateSelectedStyle({ lineWidth: Number(event.target.value) })}
                      >
                        {[1, 2, 3, 4, 5].map((width) => <option value={width} key={width}>{width}px</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Fill opacity <small>{styleNumber(selectedDrawing.style.fillOpacity, 22)}%</small></span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={styleNumber(selectedDrawing.style.fillOpacity, 22)}
                        onChange={(event) => updateSelectedStyle({ fillOpacity: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                </div>

                <footer>
                  <button type="button" onClick={() => setPositionSettingsOpen(false)}>Done</button>
                </footer>
              </section>
            </div>
          )}
        </section>

        {objectTreeOpen && (
          <aside className="object-tree" aria-label="Object tree">
            <header className="object-tree-header">
              <div>
                <LayersIcon />
                <strong>Object tree</strong>
                <span>{marketDrawings.length}</span>
              </div>
              <button
                type="button"
                className="object-icon-button"
                aria-label="Close object tree"
                title="Close object tree"
                onClick={() => setObjectTreeOpen(false)}
              >
                <CloseIcon />
              </button>
            </header>

            <div className="object-market-row">
              <span className="object-market-symbol">{market.mark}</span>
              <div>
                <strong>{market.symbol}</strong>
                <span>Binance Spot · {interval}</span>
              </div>
            </div>

            <div className="object-list">
              {[...marketDrawings].reverse().map((drawing, reverseIndex) => {
                const originalIndex = marketDrawings.length - reverseIndex
                const label = drawing.type === 'rectangle'
                  ? 'Rectangle'
                  : drawing.type === 'horizontalLine'
                    ? 'Horizontal line'
                    : drawing.type === 'priceRange'
                      ? 'Price range'
                      : drawing.type === 'longPosition'
                        ? 'Long position'
                        : 'Trend line'
                const Icon = drawing.type === 'rectangle'
                  ? RectangleIcon
                  : drawing.type === 'horizontalLine'
                    ? HorizontalLineIcon
                    : drawing.type === 'priceRange'
                      ? PriceRangeIcon
                      : drawing.type === 'longPosition'
                        ? LongPositionIcon
                        : TrendLineIcon
                const selected = drawing.id === selectedDrawingId

                return (
                  <div
                    className={selected ? 'object-row selected' : 'object-row'}
                    key={drawing.id}
                    onClick={() => controller?.focusDrawing(drawing.id)}
                  >
                    <Icon />
                    <button
                      type="button"
                      className="object-name"
                      title={`Focus ${label.toLowerCase()}`}
                      onClick={() => controller?.focusDrawing(drawing.id)}
                    >
                      <span>{label}</span>
                      <small>#{originalIndex}</small>
                    </button>
                    <button
                      type="button"
                      className="object-icon-button"
                      aria-label={`${drawing.hidden ? 'Show' : 'Hide'} ${label.toLowerCase()}`}
                      title={drawing.hidden ? 'Show object' : 'Hide object'}
                      onClick={(event) => {
                        event.stopPropagation()
                        drawingStore.execute(updateDrawing(drawing.id, { hidden: !drawing.hidden }))
                      }}
                    >
                      {drawing.hidden ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                    <button
                      type="button"
                      className="object-icon-button delete"
                      aria-label={`Delete ${label.toLowerCase()}`}
                      title="Delete object"
                      onClick={(event) => {
                        event.stopPropagation()
                        drawingStore.execute(deleteDrawing(drawing.id))
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )
              })}

              {marketDrawings.length === 0 && (
                <div className="object-tree-empty">
                  <LayersIcon />
                  <strong>No drawing objects</strong>
                  <span>Add a trend line or rectangle to see it here.</span>
                </div>
              )}
            </div>

          </aside>
        )}

        <aside className="panel-rail" aria-label="Panels">
          <button
            type="button"
            className={objectTreeOpen ? 'tool-button active' : 'tool-button'}
            aria-label="Toggle object tree"
            aria-pressed={objectTreeOpen}
            title="Object tree"
            onClick={() => setObjectTreeOpen((open) => !open)}
          >
            <LayersIcon />
          </button>
          <button
            type="button"
            className={alertsOpen ? 'tool-button active panel-button-badge' : 'tool-button panel-button-badge'}
            aria-label="Price alerts"
            aria-pressed={alertsOpen}
            title="Price alerts"
            onClick={() => setAlertsOpen((open) => !open)}
          >
            <BellIcon />
            {alerts.filter((alert) => alert.enabled).length > 0 && (
              <span>{alerts.filter((alert) => alert.enabled).length}</span>
            )}
          </button>
        </aside>
      </main>

      {alertsOpen && (
        <aside className="alerts-panel" aria-label="Price alerts">
          <header>
            <div><BellIcon /><strong>Price alerts</strong></div>
            <button type="button" onClick={() => setAlertsOpen(false)} aria-label="Close alerts"><CloseIcon /></button>
          </header>
          <form
            className="alert-create-form"
            onSubmit={(event) => {
              event.preventDefault()
              const targetPrice = Number(alertPrice)
              if (!Number.isFinite(targetPrice) || targetPrice <= 0) return
              const alert: PriceAlert = {
                id: crypto.randomUUID(),
                symbol: market.symbol,
                targetPrice,
                direction: alertDirection,
                enabled: true,
                createdAtMs: Date.now(),
              }
              setAlerts((current) => [alert, ...current])
              setAlertPrice('')
              if ('Notification' in globalThis && Notification.permission === 'default') {
                void Notification.requestPermission()
              }
            }}
          >
            <strong>Create alert for {market.baseAsset}</strong>
            <label>
              <span>Trigger</span>
              <select value={alertDirection} onChange={(event) => setAlertDirection(event.target.value as AlertDirection)}>
                <option value="above">Price crosses above</option>
                <option value="below">Price crosses below</option>
              </select>
            </label>
            <label>
              <span>Target price (USDT)</span>
              <input
                type="number"
                min="0"
                step="any"
                required
                placeholder={quote ? String(quote.close) : 'Target price'}
                value={alertPrice}
                onChange={(event) => setAlertPrice(event.target.value)}
              />
            </label>
            <button type="submit"><BellIcon /> Create alert</button>
          </form>
          <div className="alerts-list">
            {alerts.map((alert) => (
              <div className={alert.triggeredAtMs ? 'alert-row triggered' : 'alert-row'} key={alert.id}>
                <div>
                  <strong>{alert.symbol.replace('USDT', '')} {alert.direction === 'above' ? '≥' : '≤'} {alert.targetPrice.toLocaleString()}</strong>
                  <span>{alert.triggeredAtMs ? 'Triggered' : alert.enabled ? 'Active' : 'Paused'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAlerts((current) => current.map((item) => {
                    if (item.id !== alert.id) return item
                    if (item.enabled) return { ...item, enabled: false }
                    const { triggeredAtMs: _, ...reset } = item
                    return { ...reset, enabled: true }
                  }))}
                >
                  {alert.enabled ? 'Pause' : 'Enable'}
                </button>
                <button type="button" className="delete" onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}>
                  <TrashIcon />
                </button>
              </div>
            ))}
            {alerts.length === 0 && <div className="alerts-empty">No price alerts yet.</div>}
          </div>
        </aside>
      )}

      {superchartOpen && (
        <div className="superchart-backdrop" role="presentation" onMouseDown={() => setSuperchartOpen(false)}>
          <section className="superchart-launcher" role="dialog" aria-modal="true" aria-labelledby="superchart-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <HorizonLogo />
                <div><small>TradeHorizon</small><h2 id="superchart-title">Open Superchart</h2></div>
              </div>
              <button type="button" onClick={() => setSuperchartOpen(false)} aria-label="Close Superchart launcher"><CloseIcon /></button>
            </header>
            <div className="saved-charts-section">
              <h3>Saved tabs</h3>
              <div className="saved-chart-list">
                {workspace.tabs.map((tab) => {
                  const tabMarket = CRYPTO_MARKETS.find((item) => item.symbol === tab.symbol) ?? DEFAULT_CRYPTO_MARKET
                  return (
                    <button type="button" key={tab.id} onClick={() => activateTab(tab)}>
                      <span className="saved-chart-mark">{tabMarket.mark}</span>
                      <span><strong>{tabMarket.baseAsset} / USDT</strong><small>Binance Spot · {tab.interval}</small></span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="new-market-section">
              <h3>Start a new chart</h3>
              <div className="market-card-grid">
                {CRYPTO_MARKETS.map((item) => (
                  <button type="button" key={item.symbol} onClick={() => createChartTab(item.symbol)}>
                    <span>{item.mark}</span>
                    <strong>{item.baseAsset} / USDT</strong>
                    <small>{item.name} · Binance Spot</small>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      <footer className="statusbar">
        <span>BINANCE SPOT</span>
        <span>UTC</span>
        <span className="status-separator" />
        <span>{marketDrawings.length} saved drawing{marketDrawings.length === 1 ? '' : 's'} for {market.baseAsset}</span>
        <span className="status-spacer" />
        <span className="status-note">Market data · Public feed</span>
        <button type="button" className="user-menu-button" onClick={onLogout} title="Log out">
          <UserIcon /> {user.displayName} · Log out
        </button>
        {runtime.error && quote && (
          <button type="button" className="status-retry" onClick={() => controller?.retry()}>
            <RefreshIcon /> Refresh feed
          </button>
        )}
      </footer>
    </div>
  )
}

function AuthScreen({ onAuthenticated }: { onAuthenticated(user: AppUser): void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const user = mode === 'signup'
        ? await signUp(displayName, email, password)
        : await logIn(email, password)
      onAuthenticated(user)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand"><HorizonLogo /><div><strong>TradeHorizon</strong><span>Crypto Supercharts</span></div></div>
        <div className="auth-copy">
          <span className="preview-pill">LOCAL ALPHA</span>
          <h1>{mode === 'login' ? 'Welcome back' : 'Create your trading workspace'}</h1>
          <p>Your chart tabs, drawings, Long Positions, and price alerts are saved to your profile on this device.</p>
        </div>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(undefined) }}>Log in</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(undefined) }}>Sign up</button>
        </div>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <label><span>Display name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required /></label>
          )}
          <label><span>Email address</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label><span>Password</span><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button type="submit" className="auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
        <small className="auth-disclaimer">Local testing mode. Production authentication will require a secure server and database.</small>
      </section>
    </main>
  )
}

export function App() {
  const [user, setUser] = useState<AppUser | null>(() => restoreSession())
  if (!user) return <AuthScreen onAuthenticated={setUser} />
  return (
    <WorkspaceApp
      key={user.id}
      user={user}
      onLogout={() => {
        logOut()
        setUser(null)
      }}
    />
  )
}
