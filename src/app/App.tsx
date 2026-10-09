import {
  type CSSProperties,
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
import { allMarkets, getMarket, refreshMarketCatalog } from '../chart/markets'
import type { ChartRuntimeState } from '../chart/types'
import {
  DrawingStore,
  createLocalStorageDrawingRepository,
  deleteDrawing,
  updateDrawing,
  type DrawingType,
} from '../drawings'
import { MARKET_INTERVALS, MARKET_INTERVAL_SPECS, type MarketInterval } from '../market'
import { alertReached, loadAlerts, saveAlerts, type AlertDirection, type PriceAlert } from './alerts'
import { ColorPicker } from './ColorPicker'
import { ObjectList } from './ObjectList'
import { Watchlist } from './Watchlist'
import { addSymbol, loadWatchlists, saveWatchlists } from './watchlists'
import { RectangleTemplates } from './RectangleTemplates'
import { defaultTemplateStyle, loadTemplates, rectangleStyleOf, saveTemplates } from './templates'
import { ProfileDialog } from './ProfileDialog'
import { applyTheme, loadUserTheme, saveUserTheme, type Theme } from './theme'
import { loadGroups, saveGroups } from './groups'
import { startUserSync, stopUserSync } from './userSync'
import { logIn, logOut, restoreSession, signUp, verifySession, type AppUser } from './auth'
import { Superchart } from './Superchart'
import {
  DEFAULT_INDICATORS,
  DOMINANCE_DESCRIPTIONS,
  DOMINANCE_LABELS,
  MAX_MOVING_AVERAGE_PERIODS,
  MAX_MOVING_AVERAGE_PERIOD,
  MOVING_AVERAGE_COLORS,
  MOVING_AVERAGE_LABELS,
  addMovingAveragePeriod,
  movingAverageActive,
  parsePeriod,
  removeMovingAveragePeriod,
  type DominanceKey,
  type IndicatorSettings,
  type MovingAverageKind,
} from '../chart/indicators'
import { REPLAY_SPEEDS } from '../chart/replay'
import { DRAWING_TOOLS, TOOL_ORDER } from '../chart/tools'
import { SymbolSearch } from './SymbolSearch'
import {
  adoptActiveLayout,
  createLayout,
  duplicateLayout,
  loadSavedLayouts,
  loadWorkspace,
  saveSavedLayouts,
  saveWorkspace,
  type ChartTab,
  type SavedLayout,
} from './workspace'
import {
  CopyIcon,
  CursorIcon,
  CloseIcon,
  FibIcon,
  MagnetIcon,
  RayIcon,
  ShortPositionIcon,
  VerticalLineIcon,
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
  CandlesIcon,
  LineChartIcon,
  PauseIcon,
  PlayIcon,
  ReplayIcon,
  StepForwardIcon,
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
  TextIcon,
  FolderIcon,
  StarIcon,
  MidlineIcon,
} from './Icons'

const INITIAL_INTERVAL: MarketInterval = '15m'

const TOOL_ICONS: Readonly<Record<DrawingType, typeof CursorIcon>> = {
  trendLine: TrendLineIcon,
  ray: RayIcon,
  horizontalLine: HorizontalLineIcon,
  verticalLine: VerticalLineIcon,
  rectangle: RectangleIcon,
  priceRange: PriceRangeIcon,
  fibRetracement: FibIcon,
  longPosition: LongPositionIcon,
  shortPosition: ShortPositionIcon,
  text: TextIcon,
}

function isPositionTool(type: DrawingType): boolean {
  return DRAWING_TOOLS[type].placement === 'position'
}
const DEFAULT_LAYOUT_NAME = 'Main layout'

function formatMemberSince(value: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(value)
}

function formatReplayTime(valueMs: number | null): string {
  if (valueMs === null) return '—'
  return `${new Date(valueMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

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

function marketKindLabel(market: { kind: 'spot' | 'futures' | 'dominance' }): string {
  return market.kind === 'spot' ? 'Spot' : market.kind === 'futures' ? 'Perpetual' : 'Index'
}

function colorInputValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  if (/^#[0-9a-f]{6}$/i.test(value)) return value

  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  if (!rgba) return fallback
  return `#${rgba.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0')).join('')}`
}

/** Text field that commits on Enter or blur, so typing does not create one undo step per key. */
function CommittedTextInput({ value, onCommit, label }: { value: string, onCommit(value: string): void, label: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => { if (draft !== value) onCommit(draft) }
  return (
    <input
      className="toolbar-text-input"
      aria-label={label}
      placeholder={label}
      value={draft}
      maxLength={200}
      autoFocus={value === 'Text'}
      onFocus={(event) => { if (value === 'Text') event.currentTarget.select() }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') { commit(); event.currentTarget.blur() }
        if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur() }
      }}
    />
  )
}

interface WorkspaceAppProps {
  user: AppUser
  onLogout(): void
}

function WorkspaceApp({ user, onLogout }: WorkspaceAppProps) {
  const [workspace, setWorkspace] = useState(() => adoptActiveLayout(loadWorkspace(user.id)))
  const initialTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0]
  const initialMarket = getMarket(initialTab.symbol)
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
  const [activeTool, setActiveTool] = useState<'cursor' | DrawingType>('cursor')
  const [selectedDrawingId, setSelectedDrawingId] = useState<string>()
  const [objectTreeOpen, setObjectTreeOpen] = useState(false)
  const [groupState, setGroupState] = useState(() => loadGroups(user.id))
  const [theme, setTheme] = useState<Theme>(() => loadUserTheme(user.id))
  const [groupSelectMode, setGroupSelectMode] = useState(false)
  const [templateState, setTemplateState] = useState(() => loadTemplates(user.id))
  const [watchlistState, setWatchlistState] = useState(() => loadWatchlists(user.id))
  const [watchlistOpen, setWatchlistOpen] = useState(false)
  const [positionSettingsOpen, setPositionSettingsOpen] = useState(false)
  const [superchartOpen, setSuperchartOpen] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState<'change' | 'new' | 'watchlist' | null>(null)
  const [markets, setMarkets] = useState(() => allMarkets())
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false)
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false)
  const [maDraft, setMaDraft] = useState<Record<MovingAverageKind, string>>({ sma: '', ema: '' })
  const [maError, setMaError] = useState<{ kind: MovingAverageKind; message: string } | null>(null)
  const [layoutDraftName, setLayoutDraftName] = useState(workspace.layoutName)
  const [customIntervalAmount, setCustomIntervalAmount] = useState('12')
  const [customIntervalUnit, setCustomIntervalUnit] = useState<'m' | 'h' | 'd' | 'w' | 'M'>('h')
  const [customIntervalError, setCustomIntervalError] = useState('')
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>(() => loadSavedLayouts(user.id))
  const indicators = workspace.indicators ?? DEFAULT_INDICATORS
  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0]
  const currentLayout = savedLayouts.find((layout) => layout.id === activeTab.layoutId)
  const [layoutNotice, setLayoutNotice] = useState('')
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => loadAlerts(user.id))
  const [alertDirection, setAlertDirection] = useState<AlertDirection>('above')
  const [alertPrice, setAlertPrice] = useState('')
  const previousPriceRef = useRef<number | undefined>(undefined)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const timeframeMenuRef = useRef<HTMLDivElement>(null)
  const indicatorMenuRef = useRef<HTMLDivElement>(null)
  const [runtime, setRuntime] = useState<ChartRuntimeState>({
    interval: INITIAL_INTERVAL,
    connection: 'loading',
    quote: null,
    error: null,
    followingLive: true,
  })

  const replay = runtime.replay ?? null
  const replayActive = replay?.status === 'active'
  const replayPlaying = !!replay?.playing

  const handleControllerChange = useCallback(
    (next: KLineChartController | null) => setController(next),
    [],
  )
  const handleToolSettled = useCallback(() => setActiveTool('cursor'), [])
  const addAlertAtPrice = useCallback((targetPrice: number) => {
    const last = runtime.quote?.close
    setAlerts((current) => [{
      id: crypto.randomUUID(),
      symbol: market.symbol,
      targetPrice,
      direction: last !== undefined && targetPrice < last ? 'below' : 'above',
      enabled: true,
      createdAtMs: Date.now(),
    }, ...current])
    setAlertsOpen(true)
    setWatchlistOpen(false)
    if ('Notification' in globalThis && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [market.symbol, runtime.quote?.close])

  const findWatchMarket = useCallback((symbol: string) => markets.find((item) => item.symbol === symbol), [markets])

  const handleSelectionChange = useCallback((id?: string) => {
    setSelectedDrawingId(id)
    setPositionSettingsOpen(false)
  }, [])

  const chooseCursor = useCallback(() => {
    controller?.cancelActiveTool()
    controller?.cancelReplaySelection()
    controller?.clearDrawingSelection()
    setActiveTool('cursor')
  }, [controller])

  const chooseTool = useCallback((type: DrawingType) => {
    if (controller?.startTool(type)) setActiveTool(type)
  }, [controller])

  const updateIndicators = useCallback((update: (current: IndicatorSettings) => IndicatorSettings) => {
    setWorkspace((current) => ({ ...current, indicators: update(current.indicators ?? DEFAULT_INDICATORS) }))
  }, [])

  const addMovingAverage = useCallback((kind: MovingAverageKind) => {
    const period = parsePeriod(maDraft[kind])
    const settings = indicators[kind]
    if (period === undefined) {
      setMaError({ kind, message: `Enter a whole number from 1 to ${MAX_MOVING_AVERAGE_PERIOD}.` })
      return
    }
    if (!settings.periods.includes(period) && settings.periods.length >= MAX_MOVING_AVERAGE_PERIODS) {
      setMaError({ kind, message: `You can plot up to ${MAX_MOVING_AVERAGE_PERIODS} lengths.` })
      return
    }
    setMaError(null)
    setMaDraft((current) => ({ ...current, [kind]: '' }))
    updateIndicators((current) => ({ ...current, [kind]: addMovingAveragePeriod(current[kind], period) }))
  }, [indicators, maDraft, updateIndicators])

  const toggleMovingAverage = useCallback((kind: MovingAverageKind) => {
    updateIndicators((current) => ({
      ...current,
      [kind]: { ...current[kind], visible: !current[kind].visible && current[kind].periods.length > 0 },
    }))
  }, [updateIndicators])

  const toggleDominance = useCallback((key: DominanceKey) => {
    updateIndicators((current) => ({ ...current, dominance: { ...current.dominance, [key]: !current.dominance[key] } }))
  }, [updateIndicators])

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
    const nextMarket = getMarket(tab.symbol)
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
    setWorkspace((current) => ({ ...current, tabs: [...current.tabs, tab], activeTabId: tab.id }))
    const nextMarket = getMarket(symbol)
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
      const nextMarket = getMarket(next.symbol)
      setMarket(nextMarket)
      setInterval(next.interval)
      return { ...current, tabs, activeTabId: next.id }
    })
  }, [])

  const saveCurrentLayout = useCallback((name = layoutDraftName, forceNew = false) => {
    const normalizedName = name.trim() || DEFAULT_LAYOUT_NAME
    const now = Date.now()
    const existing = !forceNew && currentLayout ? currentLayout : undefined
    const id = existing?.id ?? crypto.randomUUID()
    const groupTabs = workspace.tabs.filter((tab) => tab.layoutId === activeTab.layoutId)
    const nextLayout: SavedLayout = {
      id,
      name: normalizedName,
      tabs: groupTabs.map(({ layoutId: _layoutId, ...tab }) => tab),
      activeTabId: workspace.activeTabId,
      volumeVisible: workspace.volumeVisible,
      customIntervals: workspace.customIntervals,
      ...(workspace.indicators ? { indicators: workspace.indicators } : {}),
      createdAtMs: existing?.createdAtMs ?? now,
      updatedAtMs: now,
      ...(existing?.favorite ? { favorite: true } : {}),
    }
    setSavedLayouts((current) => existing
      ? current.map((layout) => layout.id === id ? nextLayout : layout)
      : [nextLayout, ...current])
    setWorkspace((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => groupTabs.some((item) => item.id === tab.id) ? { ...tab, layoutId: id } : tab),
      layoutName: normalizedName,
      activeLayoutId: id,
    }))
    setLayoutDraftName(normalizedName)
    setLayoutNotice('Saved')
    globalThis.setTimeout(() => setLayoutNotice(''), 1600)
  }, [activeTab.layoutId, currentLayout, layoutDraftName, workspace])

  const openSavedLayout = useCallback((layout: SavedLayout) => {
    const openedTabs: ChartTab[] = layout.tabs.map((tab) => ({ ...tab, id: crypto.randomUUID(), layoutId: layout.id }))
    const index = Math.max(0, layout.tabs.findIndex((tab) => tab.id === layout.activeTabId))
    const focused = openedTabs[index]
    setWorkspace((current) => ({
      ...current,
      tabs: [...current.tabs, ...openedTabs],
      activeTabId: focused.id,
      volumeVisible: layout.volumeVisible,
      indicators: layout.indicators ?? DEFAULT_INDICATORS,
      customIntervals: [...new Set([...current.customIntervals, ...layout.customIntervals])],
    }))
    setLayoutDraftName(layout.name)
    setMarket(getMarket(focused.symbol))
    setInterval(focused.interval)
    setSuperchartOpen(false)
    setLayoutMenuOpen(false)
  }, [])

  const createNewLayout = useCallback(() => {
    const layout = createLayout(DEFAULT_LAYOUT_NAME, Date.now())
    setSavedLayouts((current) => [layout, ...current])
    openSavedLayout(layout)
  }, [openSavedLayout])

  const toggleLayoutFavorite = useCallback((id: string) => {
    setSavedLayouts((current) => current.map((layout) => {
      if (layout.id !== id) return layout
      const { favorite, ...rest } = layout
      return favorite ? rest : { ...rest, favorite: true }
    }))
  }, [])

  const renameLayout = useCallback((id: string, name: string) => {
    const nextName = name.trim().slice(0, 48)
    if (!nextName) return
    setSavedLayouts((current) => current.map((layout) => (
      layout.id === id ? { ...layout, name: nextName, updatedAtMs: Date.now() } : layout
    )))
    if (currentLayout?.id === id) setLayoutDraftName(nextName)
  }, [currentLayout?.id])

  const duplicateSavedLayout = useCallback((id: string) => {
    const source = savedLayouts.find((layout) => layout.id === id)
    if (!source) return
    setSavedLayouts((current) => [duplicateLayout(source, Date.now()), ...current])
  }, [savedLayouts])

  const deleteSavedLayout = useCallback((id: string) => {
    setSavedLayouts((current) => current.filter((layout) => layout.id !== id))
    setWorkspace((current) => {
      const { activeLayoutId, ...rest } = current
      return {
        ...(activeLayoutId === id ? rest : current),
        tabs: current.tabs.map((tab) => (tab.layoutId === id ? { ...tab, layoutId: undefined } : tab)),
      }
    })
  }, [])

  const addCustomInterval = useCallback(() => {
    const candidate = `${Number(customIntervalAmount)}${customIntervalUnit}`
    const next = MARKET_INTERVALS.find((value) => value === candidate)
    if (!next) {
      setCustomIntervalError('This interval is not available from the Binance spot feed.')
      return
    }
    setCustomIntervalError('')
    if (!(DISPLAY_INTERVALS as readonly MarketInterval[]).includes(next)) {
      setWorkspace((current) => ({
        ...current,
        customIntervals: current.customIntervals.includes(next)
          ? current.customIntervals
          : [...current.customIntervals, next],
      }))
    }
    changeInterval(next)
    setTimeframeMenuOpen(false)
  }, [changeInterval, customIntervalAmount, customIntervalUnit])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return

      if (event.key === 'Escape') chooseCursor()
      if (event.shiftKey && replayActive && event.key === 'ArrowRight') {
        event.preventDefault()
        controller?.stepReplay()
      }
      if (event.shiftKey && replayActive && event.key === 'ArrowDown') {
        event.preventDefault()
        controller?.setReplayPlaying(!replayPlaying)
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const tool = TOOL_ORDER.find((type) => `Key${DRAWING_TOOLS[type].shortcut}` === event.code)
        if (tool) {
          event.preventDefault()
          chooseTool(tool)
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selectedDrawingId) {
        event.preventDefault()
        controller?.cloneDrawing(selectedDrawingId)
      }
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
  }, [chooseCursor, chooseTool, controller, drawingStore, replayActive, replayPlaying, selectedDrawingId])

  useEffect(() => {
    setSelectedDrawingId(undefined)
    setPositionSettingsOpen(false)
    previousPriceRef.current = undefined
  }, [market])

  useEffect(() => {
    const controller = new AbortController()
    refreshMarketCatalog(undefined, controller.signal)
      .then((changed) => { if (changed) setMarkets(allMarkets()) })
      .catch(() => {
        // Offline or blocked: the curated and cached markets stay available.
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    setLayoutDraftName(currentLayout?.name ?? workspace.layoutName)
  }, [currentLayout?.id])

  useEffect(() => saveWorkspace(user.id, workspace), [user.id, workspace])
  useEffect(() => saveSavedLayouts(user.id, savedLayouts), [savedLayouts, user.id])
  useEffect(() => saveAlerts(user.id, alerts), [alerts, user.id])
  useEffect(() => saveGroups(user.id, groupState), [groupState, user.id])
  useEffect(() => saveTemplates(user.id, templateState), [templateState, user.id])
  useEffect(() => saveWatchlists(user.id, watchlistState), [watchlistState, user.id])
  useEffect(() => {
    const style = defaultTemplateStyle(templateState)
    controller?.setToolDefaultStyle('rectangle', style ? { ...style } : undefined)
  }, [controller, templateState])
  useEffect(() => {
    applyTheme(theme)
    saveUserTheme(user.id, theme)
  }, [theme, user.id])

  useEffect(() => {
    const closeDetachedMenus = (event: MouseEvent) => {
      const target = event.target as Node
      if (!profileMenuRef.current?.contains(target)) setProfileOpen(false)
      if (!layoutMenuRef.current?.contains(target)) setLayoutMenuOpen(false)
      if (!timeframeMenuRef.current?.contains(target)) setTimeframeMenuOpen(false)
      if (!indicatorMenuRef.current?.contains(target)) setIndicatorMenuOpen(false)
    }
    globalThis.addEventListener('mousedown', closeDetachedMenus)
    return () => globalThis.removeEventListener('mousedown', closeDetachedMenus)
  }, [])

  useEffect(() => {
    const price = runtime.quote?.close
    if (runtime.replay) {
      previousPriceRef.current = undefined
      return
    }
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
  }, [alerts, market.symbol, runtime.quote?.close, runtime.replay])

  const quote = runtime.quote
  const activeIndicatorCount =
    (workspace.volumeVisible ? 1 : 0) +
    (movingAverageActive(indicators.sma) ? 1 : 0) +
    (movingAverageActive(indicators.ema) ? 1 : 0) +
    Object.values(indicators.dominance).filter(Boolean).length
  const isPositive = (quote?.changePercent ?? 0) >= 0
  const blockingLoad = !quote && runtime.connection !== 'error'
  const connectionLabel = connectionCopy(runtime)
  const marketDrawings = drawingSnapshot.drawings.filter((drawing) => drawing.marketId === market.marketId)
  const selectedDrawing = drawingSnapshot.drawings.find((drawing) => drawing.id === selectedDrawingId)
  const allDrawingsHidden = marketDrawings.length > 0 && marketDrawings.every((drawing) => drawing.hidden)

  const updateSelectedStyle = (changes: Record<string, string | number | boolean>) => {
    if (!selectedDrawing) return
    drawingStore.execute(updateDrawing(selectedDrawing.id, {
      style: { ...selectedDrawing.style, ...changes },
    }))
  }

  return (
    <div className="terminal-shell">
      <nav className="chart-tabs" aria-label="Open charts">
        <div className="brand tabs-brand" aria-label="TradeHorizon">
          <HorizonLogo />
          <span className="brand-name">TradeHorizon</span>
          <span className="preview-pill">ALPHA</span>
        </div>
        <div className="chart-tabs-scroll">
          {workspace.tabs.map((tab) => {
            const tabMarket = getMarket(tab.symbol)
            const active = tab.id === workspace.activeTabId && !superchartOpen
            return (
              <div className={active ? 'chart-tab active' : 'chart-tab'} key={tab.id}>
                <button type="button" className="chart-tab-main" onClick={() => activateTab(tab)}>
                  <span className="chart-tab-mark">{tabMarket.mark}</span>
                  <span>{tabMarket.pair}</span>
                  <small>{tab.interval}</small>
                </button>
                <button
                  type="button"
                  className="chart-tab-close"
                  aria-label={`Close ${tabMarket.pair} chart`}
                  onClick={() => closeChartTab(tab.id)}
                  disabled={workspace.tabs.length === 1}
                >
                  <CloseIcon />
                </button>
              </div>
            )
          })}
          {superchartOpen && (
            <div className="chart-tab active">
              <span className="chart-tab-main chart-tab-static">
                <LayersIcon />
                <span>New tab</span>
              </span>
              <button
                type="button"
                className="chart-tab-close"
                aria-label="Close new tab"
                onClick={() => setSuperchartOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
          )}
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

        <div className="profile-control" ref={profileMenuRef}>
          <button
            type="button"
            className="profile-avatar"
            aria-label="Open user profile"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen((open) => !open)}
          >
            <UserIcon />
          </button>
          {profileOpen && (
            <ProfileDialog
              user={user}
              theme={theme}
              tabCount={workspace.tabs.length}
              layoutCount={savedLayouts.length}
              onTheme={setTheme}
              onLogout={onLogout}
              onClose={() => setProfileOpen(false)}
            />
          )}
        </div>
      </nav>

      <div className="market-toolbar">
        <button
          type="button"
          className="symbol-button"
          title="Symbol search"
          aria-haspopup="dialog"
          onClick={() => setSymbolSearch('change')}
        >
          <span className="asset-badge">{market.mark}</span>
          <strong>{market.symbol}</strong>
        </button>

        <span className="toolbar-divider" />

        <div className="timeframe-group" aria-label="Chart timeframe">
          {[...DISPLAY_INTERVALS, ...workspace.customIntervals.filter((value) => !(DISPLAY_INTERVALS as readonly MarketInterval[]).includes(value))].map((value) => (
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

        <div className="toolbar-popover-control" ref={timeframeMenuRef}>
          <button
            type="button"
            className="more-timeframes-button"
            aria-label="More timeframes"
            aria-expanded={timeframeMenuOpen}
            onClick={() => setTimeframeMenuOpen((open) => !open)}
          >
            More
          </button>
          {timeframeMenuOpen && (
            <div className="top-menu timeframe-menu">
              <strong>All timeframes</strong>
              <div className="timeframe-menu-grid">
                {MARKET_INTERVALS.map((value) => (
                  <button
                    type="button"
                    className={interval === value ? 'active' : ''}
                    key={value}
                    onClick={() => { changeInterval(value); setTimeframeMenuOpen(false) }}
                  >
                    {MARKET_INTERVAL_SPECS[value].label}
                  </button>
                ))}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); addCustomInterval() }}>
                <span>Add a custom shortcut</span>
                <div>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={customIntervalAmount}
                    onChange={(event) => setCustomIntervalAmount(event.target.value)}
                    aria-label="Custom timeframe amount"
                  />
                  <select
                    value={customIntervalUnit}
                    onChange={(event) => setCustomIntervalUnit(event.target.value as typeof customIntervalUnit)}
                    aria-label="Custom timeframe unit"
                  >
                    <option value="m">Minutes</option>
                    <option value="h">Hours</option>
                    <option value="d">Days</option>
                    <option value="w">Weeks</option>
                    <option value="M">Months</option>
                  </select>
                  <button type="submit">Add</button>
                </div>
                {customIntervalError && <small>{customIntervalError}</small>}
              </form>
            </div>
          )}
        </div>

        <span className="toolbar-divider" />

        <div className="chart-type-toggle" role="group" aria-label="Chart type">
          <button
            type="button"
            className={workspace.chartType === 'line' ? '' : 'active'}
            aria-pressed={workspace.chartType !== 'line'}
            aria-label="Candlestick chart"
            title="Candles"
            onClick={() => setWorkspace((current) => {
              const { chartType: _chartType, ...rest } = current
              return rest
            })}
          >
            <CandlesIcon />
          </button>
          <button
            type="button"
            className={workspace.chartType === 'line' ? 'active' : ''}
            aria-pressed={workspace.chartType === 'line'}
            aria-label="Line chart"
            title="Line"
            onClick={() => setWorkspace((current) => ({ ...current, chartType: 'line' }))}
          >
            <LineChartIcon />
          </button>
        </div>

        <span className="toolbar-divider" />

        <div className="toolbar-popover-control" ref={indicatorMenuRef}>
          <button
            type="button"
            className={activeIndicatorCount > 0 ? 'indicators-button active' : 'indicators-button'}
            aria-expanded={indicatorMenuOpen}
            onClick={() => setIndicatorMenuOpen((open) => !open)}
          >
            <LayersIcon /> Indicators
          </button>
          {indicatorMenuOpen && (
            <div className="top-menu indicator-menu">
              <div className="indicator-menu-head">
                <strong>Indicators</strong>
                <small>{activeIndicatorCount} active</small>
              </div>
              <button
                type="button"
                className="indicator-row"
                onClick={() => setWorkspace((current) => ({ ...current, volumeVisible: !current.volumeVisible }))}
              >
                <span><b>Volume</b><small>Binance base-asset volume</small></span>
                {workspace.volumeVisible ? <EyeIcon /> : <EyeOffIcon />}
              </button>

              {(['sma', 'ema'] as const).map((kind) => {
                const settings = indicators[kind]
                return (
                  <div className="indicator-group" key={kind}>
                    <button type="button" className="indicator-row" onClick={() => toggleMovingAverage(kind)}>
                      <span>
                        <b>{kind === 'sma' ? 'Simple Moving Average' : 'Exponential Moving Average'}</b>
                        <small>{MOVING_AVERAGE_LABELS[kind]} of the close · up to {MAX_MOVING_AVERAGE_PERIODS} lengths</small>
                      </span>
                      {movingAverageActive(settings) ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                    <div className="indicator-periods">
                      {settings.periods.map((period, index) => (
                        <span
                          className="period-chip"
                          style={{ '--chip-color': MOVING_AVERAGE_COLORS[kind][index % MOVING_AVERAGE_COLORS[kind].length] } as CSSProperties}
                          key={period}
                        >
                          {period}
                          <button
                            type="button"
                            aria-label={`Remove ${MOVING_AVERAGE_LABELS[kind]} ${period}`}
                            onClick={() => updateIndicators((current) => ({ ...current, [kind]: removeMovingAveragePeriod(current[kind], period) }))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <form onSubmit={(event) => { event.preventDefault(); addMovingAverage(kind) }}>
                        <input
                          type="number"
                          min="1"
                          max={MAX_MOVING_AVERAGE_PERIOD}
                          placeholder="Length"
                          aria-label={`${MOVING_AVERAGE_LABELS[kind]} length`}
                          value={maDraft[kind]}
                          onChange={(event) => setMaDraft((current) => ({ ...current, [kind]: event.target.value }))}
                        />
                        <button type="submit">Add</button>
                      </form>
                    </div>
                    {maError?.kind === kind && <small className="indicator-error">{maError.message}</small>}
                  </div>
                )
              })}

              <div className="indicator-section-title">
                <b>Market dominance</b>
                <small>CoinGecko caps, Binance prices · estimated</small>
              </div>
              {(['btc', 'usdt', 'alt'] as const).map((key) => (
                <button type="button" className="indicator-row" key={key} onClick={() => toggleDominance(key)}>
                  <span>
                    <b>{DOMINANCE_DESCRIPTIONS[key]}</b>
                    <small>{DOMINANCE_LABELS[key]} · % of total crypto market cap</small>
                  </span>
                  {indicators.dominance[key] ? <EyeIcon /> : <EyeOffIcon />}
                </button>
              ))}
              {(indicators.dominance.btc || indicators.dominance.usdt || indicators.dominance.alt) && runtime.dominance === 'loading' && (
                <p className="indicator-note">Importing dominance data…</p>
              )}
              {(indicators.dominance.btc || indicators.dominance.usdt || indicators.dominance.alt) && runtime.dominance === 'error' && (
                <p className="indicator-note error">Could not import dominance data: {runtime.dominanceError}</p>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className={alertsOpen ? 'indicators-button active' : 'indicators-button'}
          aria-pressed={alertsOpen}
          onClick={() => setAlertsOpen((open) => !open)}
        >
          <BellIcon /> Alert
        </button>

        <button
          type="button"
          className={replay ? 'indicators-button active' : 'indicators-button'}
          aria-pressed={!!replay}
          title={replay ? 'Exit bar replay' : 'Bar replay: rewind the chart and play it forward'}
          onClick={() => {
            if (replay) {
              controller?.exitReplay()
            } else {
              controller?.cancelActiveTool()
              setActiveTool('cursor')
              controller?.startReplaySelection()
            }
          }}
          disabled={!controller || !quote}
        >
          <ReplayIcon /> Replay
        </button>

        <span className="toolbar-divider" />

        <button
          type="button"
          className={runtime.followingLive ? 'live-button active' : 'live-button'}
          onClick={() => controller?.goToLive()}
          disabled={!controller}
        >
          <TargetIcon />
          Go live
        </button>

        <span className="toolbar-spacer" />

        <div
          className={`connection-chip connection-${replayActive ? 'loading' : runtime.connection}`}
          title={replayActive ? 'Replaying history; live updates are paused' : runtime.error ?? connectionLabel}
        >
          <span className="connection-dot" />
          <span>{replayActive ? 'Replay' : connectionLabel}</span>
        </div>

        <div className="layout-control" ref={layoutMenuRef}>
          <button
            type="button"
            className="layout-name-button"
            aria-expanded={layoutMenuOpen}
            onClick={() => setLayoutMenuOpen((open) => !open)}
          >
            <LayersIcon />
            <span>{currentLayout?.name ?? workspace.layoutName}</span>
            <small>{layoutNotice || (currentLayout ? 'Saved layout' : 'Unsaved')}</small>
          </button>
          {layoutMenuOpen && (
            <div className="top-menu layout-menu" role="menu">
              <label>
                <span>Layout name</span>
                <input
                  value={layoutDraftName}
                  maxLength={48}
                  onChange={(event) => {
                    setLayoutDraftName(event.target.value)
                    setWorkspace((current) => ({ ...current, layoutName: event.target.value || DEFAULT_LAYOUT_NAME }))
                  }}
                />
              </label>
              <button type="button" onClick={() => { saveCurrentLayout(layoutDraftName); setLayoutMenuOpen(false) }}>Save layout</button>
              <button type="button" onClick={() => { setSaveAsOpen(true); setLayoutMenuOpen(false) }}>Save as…</button>
              <button type="button" onClick={() => { setSuperchartOpen(true); setLayoutMenuOpen(false) }}>
                Manage layouts <span>{savedLayouts.length}</span>
              </button>
            </div>
          )}
        </div>
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
          {TOOL_ORDER.map((type) => {
            const tool = DRAWING_TOOLS[type]
            const Icon = TOOL_ICONS[type]
            return (
              <button
                type="button"
                key={type}
                className={activeTool === type ? 'tool-button active' : 'tool-button'}
                aria-label={`Draw ${tool.label.toLowerCase()}`}
                aria-pressed={activeTool === type}
                title={`${tool.label} (Alt+${tool.shortcut})`}
                onClick={() => (activeTool === type ? chooseCursor() : chooseTool(type))}
                disabled={!controller || runtime.connection === 'error'}
              >
                <Icon />
              </button>
            )
          })}

          <span className="tool-divider" />

          <button
            type="button"
            className={workspace.magnet ? 'tool-button active' : 'tool-button'}
            aria-label="Magnet: snap to candle open, high, low, close"
            aria-pressed={!!workspace.magnet}
            title={workspace.magnet ? 'Magnet on: points snap to OHLC' : 'Magnet off: free placement'}
            onClick={() => setWorkspace((current) => {
              const { magnet, ...rest } = current
              return magnet ? rest : { ...rest, magnet: true }
            })}
          >
            <MagnetIcon />
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

        <section className={replayActive ? 'chart-workspace replay-active' : 'chart-workspace'} aria-label="Market chart workspace">
          <div className="chart-watermark" aria-hidden="true">
            <strong>{market.name}</strong>
            <span>· {interval} · {market.venue}</span>
            <i className={`legend-dot legend-dot-${runtime.connection}`} />
          </div>

          <div className="chart-legend" aria-label="Current market and indicators">
            <div className="chart-ohlc-row">
              <span><b>O</b>{formatPrice(quote?.open, market.pricePrecision)}</span>
              <span><b>H</b>{formatPrice(quote?.high, market.pricePrecision)}</span>
              <span><b>L</b>{formatPrice(quote?.low, market.pricePrecision)}</span>
              <span><b>C</b>{formatPrice(quote?.close, market.pricePrecision)}</span>
              <span className={isPositive ? 'price-up' : 'price-down'}>{quote ? `${isPositive ? '+' : ''}${quote.changePercent.toFixed(2)}%` : '—'}</span>
            </div>
            {market.kind !== 'dominance' && <button
              type="button"
              className={workspace.volumeVisible ? 'chart-indicator-row' : 'chart-indicator-row muted'}
              onClick={() => setWorkspace((current) => ({ ...current, volumeVisible: !current.volumeVisible }))}
              title={workspace.volumeVisible ? 'Hide Volume' : 'Show Volume'}
            >
              <span>Volume · {market.baseAsset}</span>
              <b>{formatCompact(quote?.volume)}</b>
              {workspace.volumeVisible ? <EyeIcon /> : <EyeOffIcon />}
            </button>}
            {(['sma', 'ema'] as const).filter((kind) => movingAverageActive(indicators[kind])).map((kind) => (
              <button
                type="button"
                key={kind}
                className="chart-indicator-row"
                onClick={() => toggleMovingAverage(kind)}
                title={`Hide ${MOVING_AVERAGE_LABELS[kind]}`}
              >
                <span>{MOVING_AVERAGE_LABELS[kind]}</span>
                {indicators[kind].periods.map((period, index) => (
                  <b key={period} style={{ color: MOVING_AVERAGE_COLORS[kind][index % MOVING_AVERAGE_COLORS[kind].length] }}>{period}</b>
                ))}
                <EyeIcon />
              </button>
            ))}
          </div>

          <CryptoChartSurface
            interval={interval}
            market={market}
            drawingStore={drawingStore}
            volumeVisible={workspace.volumeVisible}
            indicators={indicators}
            magnet={!!workspace.magnet}
            chartType={workspace.chartType ?? 'candles'}
            onRuntimeState={setRuntime}
            onControllerChange={handleControllerChange}
            onToolSettled={handleToolSettled}
            onSelectionChange={handleSelectionChange}
            onAddAlert={addAlertAtPrice}
            theme={theme}
          />

          {replay?.status === 'picking' && (
            <div className="drawing-hint" role="status">
              <ReplayIcon />
              Click the candle to start the replay from
              <kbd>Esc</kbd>
            </div>
          )}

          {replayActive && replay && (
            <div className="replay-bar" role="toolbar" aria-label="Bar replay">
              <button
                type="button"
                className="replay-primary"
                aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
                title={replay.playing ? 'Pause (Shift+↓)' : 'Play (Shift+↓)'}
                onClick={() => controller?.setReplayPlaying(!replay.playing)}
                disabled={replay.atEnd}
              >
                {replay.playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                type="button"
                aria-label="Forward one bar"
                title="Forward one bar (Shift+→)"
                onClick={() => controller?.stepReplay()}
                disabled={replay.atEnd}
              >
                <StepForwardIcon />
              </button>
              <select
                aria-label="Replay speed"
                title="Replay speed"
                value={replay.speedMs}
                onChange={(event) => controller?.setReplaySpeed(Number(event.target.value))}
              >
                {REPLAY_SPEEDS.map((speed) => <option value={speed.ms} key={speed.ms}>{speed.label}</option>)}
              </select>
              <span className="replay-time">{replay.atEnd ? 'Reached the latest bar' : formatReplayTime(replay.timeMs)}</span>
              <button type="button" title="Choose a different starting bar" onClick={() => controller?.startReplaySelection()}>
                <ReplayIcon /> Jump to…
              </button>
              <button type="button" className="replay-exit" title="Exit replay and return to live" onClick={() => controller?.exitReplay()}>
                <CloseIcon /> Exit
              </button>
            </div>
          )}

          {activeTool !== 'cursor' && (() => {
            const Icon = TOOL_ICONS[activeTool]
            return (
              <div className="drawing-hint" role="status">
                <Icon />
                {DRAWING_TOOLS[activeTool].hint}
                <kbd>Esc</kbd>
              </div>
            )
          })()}

          {blockingLoad && (
            <div className="chart-state" role="status">
              <span className="loader-ring" />
              <strong>Loading {market.symbol}</strong>
              <span>Connecting to the {market.venue} data feed…</span>
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
              <div className="toolbar-object-type" title={DRAWING_TOOLS[selectedDrawing.type].label}>
                {(() => {
                  const Icon = TOOL_ICONS[selectedDrawing.type]
                  return <Icon />
                })()}
              </div>
              <span className="toolbar-separator" />

              {isPositionTool(selectedDrawing.type) ? (
                <>
                  <label className="toolbar-color-control" title="Target color">
                    <ColorPicker label="Target color" value={colorInputValue(selectedDrawing.style.targetColor, '#16a085')} onChange={(color) => updateSelectedStyle({ targetColor: color })} />
                  </label>
                  <label className="toolbar-color-control" title="Stop color">
                    <ColorPicker label="Stop color" value={colorInputValue(selectedDrawing.style.stopColor, '#f0445e')} onChange={(color) => updateSelectedStyle({ stopColor: color })} />
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
                    aria-label="Position settings"
                    title="Position settings"
                    onClick={() => setPositionSettingsOpen((open) => !open)}
                  >
                    <SettingsIcon />
                  </button>
                </>
              ) : selectedDrawing.type === 'text' ? (
                <>
                  <CommittedTextInput
                    label="Text"
                    value={typeof selectedDrawing.style.text === 'string' ? selectedDrawing.style.text : 'Text'}
                    onCommit={(text) => updateSelectedStyle({ text })}
                  />
                  <ColorPicker label="Text color" value={colorInputValue(selectedDrawing.style.color, '#2962ff')} onChange={(color) => updateSelectedStyle({ color })} />
                  <select
                    className="toolbar-select thickness-select"
                    aria-label="Font size"
                    title="Font size"
                    value={styleNumber(selectedDrawing.style.fontSize, 14)}
                    onChange={(event) => updateSelectedStyle({ fontSize: Number(event.target.value) })}
                  >
                    {[10, 12, 14, 16, 20, 24, 32, 48].map((size) => <option value={size} key={size}>{size}px</option>)}
                  </select>
                  <button
                    type="button"
                    className={selectedDrawing.style.bold === true ? 'toolbar-action active' : 'toolbar-action'}
                    aria-label="Bold"
                    title="Bold"
                    aria-pressed={selectedDrawing.style.bold === true}
                    onClick={() => updateSelectedStyle({ bold: selectedDrawing.style.bold !== true })}
                  >
                    <b>B</b>
                  </button>
                </>
              ) : (
                <>
                  {selectedDrawing.type !== 'fibRetracement' && selectedDrawing.type !== 'priceRange' && (
                    <label className="toolbar-color-control" title="Line color">
                      <ColorPicker label="Line color" value={colorInputValue(selectedDrawing.style.color, selectedDrawing.type === 'rectangle' ? '#3aa9ff' : '#f4b860')} onChange={(color) => updateSelectedStyle({ color: color })} />
                    </label>
                  )}
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
                      <button
                        type="button"
                        className={selectedDrawing.style.midline === true ? 'toolbar-action active' : 'toolbar-action'}
                        aria-label="Middle line"
                        title="Draw a horizontal line through the middle"
                        aria-pressed={selectedDrawing.style.midline === true}
                        onClick={() => updateSelectedStyle({ midline: selectedDrawing.style.midline !== true })}
                      >
                        <MidlineIcon />
                      </button>
                      <RectangleTemplates
                        state={templateState}
                        current={rectangleStyleOf(selectedDrawing.style)}
                        onApply={(style) => updateSelectedStyle({ ...style })}
                        onChange={setTemplateState}
                      />
                      <label className="toolbar-color-control fill-control" title="Fill color">
                        <ColorPicker label="Rectangle fill color" value={colorInputValue(selectedDrawing.style.fillColor, '#3aa9ff')} onChange={(color) => updateSelectedStyle({ fillColor: color })} />
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
                className="toolbar-action"
                aria-label="Clone object"
                title="Clone (Ctrl+D)"
                onClick={() => controller?.cloneDrawing(selectedDrawing.id)}
              >
                <CopyIcon />
              </button>
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

          {selectedDrawing && isPositionTool(selectedDrawing.type) && positionSettingsOpen && (
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
                    {selectedDrawing.type === 'shortPosition' ? <ShortPositionIcon /> : <LongPositionIcon />}
                    <div>
                      <small>Drawing properties</small>
                      <h2 id="position-settings-title">{DRAWING_TOOLS[selectedDrawing.type].label}</h2>
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
                      <span>Account size <small>{market.quoteAsset}</small></span>
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
                      <ColorPicker label="Target color" value={colorInputValue(selectedDrawing.style.targetColor, '#16a085')} onChange={(color) => updateSelectedStyle({ targetColor: color })} />
                    </label>
                    <label>
                      <span>Stop color</span>
                      <ColorPicker label="Stop color" value={colorInputValue(selectedDrawing.style.stopColor, '#f0445e')} onChange={(color) => updateSelectedStyle({ stopColor: color })} />
                    </label>
                    <label>
                      <span>Line color</span>
                      <ColorPicker label="Line color" value={colorInputValue(selectedDrawing.style.lineColor, '#c7d0db')} onChange={(color) => updateSelectedStyle({ lineColor: color })} />
                    </label>
                    <label>
                      <span>Text color</span>
                      <ColorPicker label="Text color" value={colorInputValue(selectedDrawing.style.textColor, '#ffffff')} onChange={(color) => updateSelectedStyle({ textColor: color })} />
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
              {marketDrawings.length > 0 && (
                <button
                  type="button"
                  className={groupSelectMode ? 'object-icon-button active' : 'object-icon-button'}
                  aria-label="Group objects"
                  aria-pressed={groupSelectMode}
                  title="Group objects into folders"
                  onClick={() => setGroupSelectMode((on) => !on)}
                >
                  <FolderIcon />
                </button>
              )}
              {marketDrawings.length > 0 && (
                <button
                  type="button"
                  className="object-icon-button"
                  aria-label={allDrawingsHidden ? 'Show all drawings' : 'Hide all drawings'}
                  title={allDrawingsHidden ? 'Show all drawings' : 'Hide all drawings'}
                  onClick={() => {
                    for (const drawing of marketDrawings) {
                      if (!!drawing.hidden === allDrawingsHidden) {
                        drawingStore.execute(updateDrawing(drawing.id, { hidden: !allDrawingsHidden }))
                      }
                    }
                  }}
                >
                  {allDrawingsHidden ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              )}
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
                <span>{market.venue} {marketKindLabel(market)} · {interval}</span>
              </div>
            </div>

            <ObjectList
              drawings={marketDrawings}
              selectedId={selectedDrawingId}
              groupState={groupState}
              icons={TOOL_ICONS}
              selectMode={groupSelectMode}
              onSelectModeChange={setGroupSelectMode}
              onGroupState={setGroupState}
              onFocus={(id) => controller?.focusDrawing(id)}
              onSetHidden={(ids, hidden) => {
                for (const id of ids) {
                  const drawing = marketDrawings.find((item) => item.id === id)
                  if (drawing && !!drawing.hidden !== hidden) drawingStore.execute(updateDrawing(id, { hidden }))
                }
              }}
              onDelete={(id) => drawingStore.execute(deleteDrawing(id))}
            />
          </aside>
        )}

        <aside className="panel-rail" aria-label="Panels">
          <button
            type="button"
            className={watchlistOpen ? 'tool-button active' : 'tool-button'}
            aria-label="Watchlist"
            aria-pressed={watchlistOpen}
            title="Watchlist"
            onClick={() => { setWatchlistOpen((open) => !open); setAlertsOpen(false) }}
          >
            <StarIcon />
          </button>
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
            onClick={() => { setAlertsOpen((open) => !open); setWatchlistOpen(false) }}
          >
            <BellIcon />
            {alerts.filter((alert) => alert.enabled).length > 0 && (
              <span>{alerts.filter((alert) => alert.enabled).length}</span>
            )}
          </button>
        </aside>
      </main>

      {watchlistOpen && (
        <Watchlist
          state={watchlistState}
          findMarket={findWatchMarket}
          currentSymbol={market.symbol}
          onState={setWatchlistState}
          onOpen={changeMarket}
          onAdd={() => setSymbolSearch('watchlist')}
          onClose={() => setWatchlistOpen(false)}
        />
      )}

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
            <strong>Create alert for {market.symbol}</strong>
            <label>
              <span>Trigger</span>
              <select value={alertDirection} onChange={(event) => setAlertDirection(event.target.value as AlertDirection)}>
                <option value="above">Price crosses above</option>
                <option value="below">Price crosses below</option>
              </select>
            </label>
            <label>
              <span>Target {market.kind === 'dominance' ? (market.quoteAsset === '%' ? 'level (%)' : 'level (USD billions)') : `price (${market.quoteAsset})`}</span>
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

      {symbolSearch && (
        <SymbolSearch
          markets={markets}
          current={market}
          onSelect={(next) => {
            if (symbolSearch === 'new') createChartTab(next.symbol)
            else if (symbolSearch === 'watchlist') setWatchlistState((current) => addSymbol(current, next.symbol))
            else changeMarket(next)
            setSymbolSearch(null)
          }}
          onClose={() => setSymbolSearch(null)}
        />
      )}

      {saveAsOpen && (
        <div className="superchart-backdrop" role="presentation" onMouseDown={() => setSaveAsOpen(false)}>
          <form
            className="compact-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-layout-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              saveCurrentLayout(layoutDraftName, true)
              setSaveAsOpen(false)
            }}
          >
            <header>
              <div><LayersIcon /><h2 id="save-layout-title">Save layout as</h2></div>
              <button type="button" onClick={() => setSaveAsOpen(false)} aria-label="Close"><CloseIcon /></button>
            </header>
            <label>
              <span>Layout name</span>
              <input autoFocus required maxLength={48} value={layoutDraftName} onChange={(event) => setLayoutDraftName(event.target.value)} />
            </label>
            <footer><button type="button" onClick={() => setSaveAsOpen(false)}>Cancel</button><button type="submit">Save copy</button></footer>
          </form>
        </div>
      )}

      {superchartOpen && (
        <Superchart
          layouts={savedLayouts}
          activeLayoutId={activeTab.layoutId}
          onOpen={openSavedLayout}
          onCreate={createNewLayout}
          onNewChart={() => setSymbolSearch('new')}
          onToggleFavorite={toggleLayoutFavorite}
          onRename={renameLayout}
          onDuplicate={duplicateSavedLayout}
          onDelete={deleteSavedLayout}
        />
      )}

      <footer className="statusbar">
        <span>{market.venue.toUpperCase()} {marketKindLabel(market).toUpperCase()}</span>
        <span>UTC</span>
        <span className="status-separator" />
        <span>{marketDrawings.length} saved drawing{marketDrawings.length === 1 ? '' : 's'} for {market.symbol}</span>
        <span className="status-spacer" />
        <span className="status-note">Market data · Public feed</span>
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
          <span className="preview-pill">ALPHA</span>
          <h1>{mode === 'login' ? 'Welcome back' : 'Create your trading workspace'}</h1>
          <p>Your chart tabs, drawings, Long Positions, and price alerts are saved to your account and follow you to any device.</p>
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
        <small className="auth-disclaimer">Your account is stored on the TradeHorizon server, so you can sign in from any device.</small>
      </section>
    </main>
  )
}

export function App() {
  const [user, setUser] = useState<AppUser | null>(() => restoreSession())
  const [syncedUserId, setSyncedUserId] = useState<string>()
  useEffect(() => {
    if (!user) return
    let live = true
    void (async () => {
      if (!await verifySession()) {
        if (live) setUser(null)
        return
      }
      // Pull this user's layouts, drawings, alerts and workspace from the server before the workspace reads them.
      await startUserSync(user.id)
      if (live) setSyncedUserId(user.id)
    })()
    return () => { live = false }
  }, [user?.id])
  if (!user) return <AuthScreen onAuthenticated={setUser} />
  if (syncedUserId !== user.id) return <main className="auth-shell"><section className="auth-card"><div className="auth-copy"><h1>Loading your workspace…</h1></div></section></main>
  return (
    <WorkspaceApp
      key={user.id}
      user={user}
      onLogout={() => {
        stopUserSync()
        void logOut()
        setSyncedUserId(undefined)
        setUser(null)
      }}
    />
  )
}
