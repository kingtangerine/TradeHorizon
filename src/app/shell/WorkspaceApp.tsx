import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChartType } from '../../chart/chartTypes'
import { DEFAULT_INDICATORS } from '../../chart/indicators'
import { DISPLAY_INTERVALS } from '../../chart/intervals'
import type { DrawingModes, KLineChartController, ScaleMode } from '../../chart/KLineChartController'
import { allMarkets, getMarket, refreshMarketCatalog } from '../../chart/markets'
import { TOOL_GROUPS } from '../../chart/tools'
import type { ChartRuntimeState } from '../../chart/types'
import { DrawingStore, createLocalStorageDrawingRepository, type DrawingType } from '../../drawings'
import type { MarketInterval } from '../../market'
import { AdminPage } from '../AdminPage'
import { isTriggered } from '../alerts'
import { AlertsPanel } from '../AlertsPanel'
import type { AppUser } from '../auth'
import { ChartPane } from '../ChartPane'
import { ChartSettingsDialog } from '../ChartSettingsDialog'
import type { DrawingSettingsTab } from '../DrawingSettingsDialog'
import { loadGroups } from '../groups'
import { parseIntervalInput } from '../hotkeys'
import { loadLayoutFolders } from '../layoutFolders'
import { activePaneIndex, panesOf } from '../panes'
import { loadPreferences } from '../preferences'
import { Superchart } from '../Superchart'
import { SymbolSearch } from '../SymbolSearch'
import { defaultTemplateStyle, loadTemplates } from '../templates'
import { applyTheme, loadUserTheme, saveUserTheme, type Theme } from '../theme'
import { resolveTimeZone } from '../timeZones'
import { Watchlist } from '../Watchlist'
import { addSymbol, loadWatchlists } from '../watchlists'
import { adoptActiveLayout, loadSavedLayouts, loadWorkspace, type SavedLayout } from '../workspace'
import { AlertNotifications } from './AlertNotifications'
import { ChartTabsBar } from './ChartTabsBar'
import { DrawingDialogs } from './DrawingDialogs'
import { drawingEdits } from './drawingEdits'
import { DrawingHint, MultiSelectionToolbar, SelectedDrawingToolbar } from './DrawingToolbars'
import { IndicatorDialogs } from './IndicatorDialogs'
import { MarketToolbar } from './MarketToolbar'
import { ObjectTreePanel } from './ObjectTreePanel'
import { PanelRail } from './PanelRail'
import { PositionSettingsDialog } from './PositionSettingsDialog'
import { ReplayControls } from './ReplayControls'
import { SaveLayoutAsDialog } from './SaveLayoutAsDialog'
import { StatusBar } from './StatusBar'
import { ToolRail } from './ToolRail'
import { useAlertChannels } from './useAlertChannels'
import { useAlertList, useAlertWatcher } from './useAlerts'
import { useChartSnapshot } from './useChartSnapshot'
import { useIndicatorActions } from './useIndicatorActions'
import { useLayoutActions } from './useLayoutActions'
import { useTabActions } from './useTabActions'
import { useTabDrag } from './useTabDrag'
import { useCloseMenusOnOutsideClick, useToolbarMenus } from './useToolbarMenus'
import { useUserDataPersistence } from './useUserDataPersistence'
import { useWorkspaceHotkeys, type SymbolSearchMode } from './useWorkspaceHotkeys'
import { INITIAL_INTERVAL, isPositionTool } from './workspaceHelpers'

interface WorkspaceAppProps {
  user: AppUser
  onLogout(): void
  /** Reloads the account from the server (after a password change). */
  onUserRefresh(): void
}

/** The signed-in app: chart tabs, toolbar, chart panes with drawing tools, side panels, dialogs and status bar. */
export function WorkspaceApp({ user, onLogout, onUserRefresh }: WorkspaceAppProps) {
  const [workspace, setWorkspace] = useState(() => adoptActiveLayout(loadWorkspace(user.id)))
  const [drawingStore] = useState(
    () =>
      new DrawingStore({
        repository: createLocalStorageDrawingRepository({
          key: `trade-horizon:user:${user.id}:drawings:v1`,
        }),
        historyLimit: 100,
      }),
  )
  const drawingSnapshot = useSyncExternalStore(drawingStore.subscribe, drawingStore.getSnapshot, drawingStore.getSnapshot)
  const [controller, setController] = useState<KLineChartController | null>(null)
  const [activeTool, setActiveTool] = useState<'cursor' | DrawingType>('cursor')
  const [selectedDrawingId, setSelectedDrawingId] = useState<string>()
  // Drawing editing: settings window (double-click), right-click menu, Ctrl/Shift+click multi-selection.
  const [drawingSettings, setDrawingSettings] = useState<{ id: string; tab: DrawingSettingsTab }>()
  const [drawingMenu, setDrawingMenu] = useState<{ id: string; left: number; top: number }>()
  const [multiSelection, setMultiSelection] = useState<readonly string[]>([])
  const [objectTreeOpen, setObjectTreeOpen] = useState(false)
  const [groupState, setGroupState] = useState(() => loadGroups(user.id))
  const [preferences, setPreferences] = useState(() => loadPreferences(user.id))
  const chartTimeZone = useMemo(() => resolveTimeZone(preferences.timeZone), [preferences.timeZone])
  const [layoutFolders, setLayoutFolders] = useState(() => loadLayoutFolders(user.id))
  const [theme, setTheme] = useState<Theme>(() => loadUserTheme(user.id))
  const [groupSelectMode, setGroupSelectMode] = useState(false)
  const [templateState, setTemplateState] = useState(() => loadTemplates(user.id))
  const [watchlistState, setWatchlistState] = useState(() => loadWatchlists(user.id))
  const [watchlistOpen, setWatchlistOpen] = useState(false)
  const [positionSettingsOpen, setPositionSettingsOpen] = useState(false)
  const [superchartOpen, setSuperchartOpen] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState<SymbolSearchMode | null>(null)
  const [markets, setMarkets] = useState(() => allMarkets())
  const [alertsOpen, setAlertsOpen] = useState(false)
  // Typing on the chart (TradingView): letters open symbol search with them, digits open the timeframe box.
  const [searchSeed, setSearchSeed] = useState<string>()
  const [intervalInput, setIntervalInput] = useState<string | null>(null)
  const [intervalError, setIntervalError] = useState('')
  /** Alt+A: the alert form opens at the current price (the key remounts the panel with it). */
  const [alertSeed, setAlertSeed] = useState<{ price: string; key: number }>()
  const menus = useToolbarMenus()
  const { profileOpen, setProfileOpen, setLayoutMenuOpen, setSplitMenuOpen, setSplitSaveName, setSnapshotMenuOpen } = menus
  const [profileFocus, setProfileFocus] = useState<'chart' | 'password'>()
  const [adminOpen, setAdminOpen] = useState(false)
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false)
  const openChartSettings = useCallback(() => setChartSettingsOpen(true), [])
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>(() => loadSavedLayouts(user.id))
  const indicators = workspace.indicators ?? DEFAULT_INDICATORS
  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0]
  const currentLayout = savedLayouts.find((layout) => layout.id === activeTab.layoutId)
  // A tab shows one chart or a split of 2 to 4. The active pane's symbol and timeframe drive the toolbar, tools and panels.
  const activePaneIdx = activePaneIndex(activeTab)
  const panes = useMemo(() => panesOf(activeTab), [activeTab])
  // getMarket() reads the shared market catalog, which `markets` mirrors: look the panes up again when the catalog loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `markets` is that catalog-changed signal
  const paneMarkets = useMemo(() => panes.map((pane) => getMarket(pane.symbol)), [panes, markets])
  const paneTotal = panes.length
  const market = paneMarkets[activePaneIdx]
  const interval = panes[activePaneIdx].interval
  const chartType: ChartType = workspace.chartType ?? 'candles'
  const drawingModes = useMemo<DrawingModes>(
    () => ({
      stayInDrawingMode: workspace.stayInDrawingMode === true,
      lockAll: workspace.lockAllDrawings === true,
      hideAll: workspace.hideAllDrawings === true,
    }),
    [workspace.stayInDrawingMode, workspace.lockAllDrawings, workspace.hideAllDrawings],
  )
  /** Timeframe buttons in the toolbar: the standard ones, then the user's own. */
  const toolbarIntervals = useMemo<readonly MarketInterval[]>(
    () => [
      ...DISPLAY_INTERVALS,
      ...workspace.customIntervals.filter((value) => !(DISPLAY_INTERVALS as readonly MarketInterval[]).includes(value)),
    ],
    [workspace.customIntervals],
  )
  const { alerts, setAlerts, addAlertAtPrice, createAlert, moveAlertTo, deleteAlert, toggleAlert } = useAlertList(user.id, setToast)
  const previousPriceRef = useRef<number | undefined>(undefined)
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

  const handleControllerChange = useCallback((next: KLineChartController | null) => setController(next), [])
  const handleToolSettled = useCallback(() => setActiveTool('cursor'), [])

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

  /** Tool rail: the last tool used in each group is the one its button shows. */
  const [groupTools, setGroupTools] = useState<Record<string, DrawingType>>({})
  const chooseTool = useCallback(
    (type: DrawingType) => {
      if (!controller?.startTool(type)) return
      setActiveTool(type)
      const group = TOOL_GROUPS.find((item) => item.tools.includes(type))
      if (group) setGroupTools((current) => (current[group.id] === type ? current : { ...current, [group.id]: type }))
    },
    [controller],
  )

  const indicatorActions = useIndicatorActions(user.id, setWorkspace, setPreferences)
  const {
    toggleVwap,
    toggleMovingAverage,
    studySettingsId,
    setStudySettingsId,
    addCompare,
    removeCompare,
    indicatorsOpen,
    setIndicatorsOpen,
    scripts,
    setScripts,
    scriptEditor,
    setScriptSettingsId,
    changeScriptInstance,
    removeScriptInstance,
    changeStudy,
    removeStudy,
  } = indicatorActions

  const { changeMarket, changeInterval, activateTab, createChartTab, closeChartTab, handleActivatePane, setPaneCount } = useTabActions({
    setWorkspace,
    setSuperchartOpen,
    setSplitMenuOpen,
    controller,
    setActiveTool,
    setSelectedDrawingId,
  })

  const tabDrag = useTabDrag(setWorkspace)

  const showToast = useCallback((message: string) => {
    setToast(message)
    globalThis.setTimeout(() => setToast((current) => (current === message ? '' : current)), 3600)
  }, [])

  useEffect(() => {
    if (!controller) return
    setMultiSelection([])
    return controller.subscribeDrawingEvents((event) => {
      if (event.kind === 'selection') setMultiSelection(event.ids)
      else if (event.kind === 'contextMenu') setDrawingMenu({ id: event.id, left: event.clientX, top: event.clientY })
      else {
        const drawing = drawingStore.getSnapshot().drawings.find((item) => item.id === event.id)
        if (drawing && isPositionTool(drawing.type)) setPositionSettingsOpen(true)
        else if (drawing) setDrawingSettings({ id: event.id, tab: 'style' })
      }
    })
  }, [controller, drawingStore])

  const takeSnapshot = useChartSnapshot({ controller, market, interval, chartTimeZone, theme, showToast, setSnapshotMenuOpen })

  useWorkspaceHotkeys({
    controller,
    drawingStore,
    pricePrecision: market.pricePrecision,
    intervalInput,
    setIntervalInput,
    setIntervalError,
    changeInterval,
    takeSnapshot,
    setAlertSeed,
    setAlertsOpen,
    setSearchSeed,
    symbolSearch,
    setSymbolSearch,
    indicatorsOpen,
    scriptEditor,
    profileOpen,
    adminOpen,
    superchartOpen,
    chartSettingsOpen,
    studySettingsId,
    drawingSettings,
    chooseCursor,
    chooseTool,
    replayActive,
    replayPlaying,
    selectedDrawingId,
  })

  // The Alt+A price is for that one opening; the bell button opens an empty form.
  useEffect(() => {
    if (!alertsOpen) setAlertSeed(undefined)
  }, [alertsOpen])

  useEffect(() => {
    setSelectedDrawingId(undefined)
    setPositionSettingsOpen(false)
    previousPriceRef.current = undefined
  }, [market])

  useEffect(() => {
    const controller = new AbortController()
    refreshMarketCatalog(undefined, controller.signal)
      .then((changed) => {
        if (changed) setMarkets(allMarkets())
      })
      .catch(() => {
        // Offline or blocked: the curated and cached markets stay available.
      })
    return () => controller.abort()
  }, [])

  const {
    layoutDraftName,
    setLayoutDraftName,
    layoutNotice,
    openLayoutsTogether,
    saveSplitAsLayout,
    saveCurrentLayout,
    openSavedLayout,
    openSavedLayoutInBackground,
    createNewLayout,
    toggleLayoutFavorite,
    renameLayout,
    duplicateSavedLayout,
    deleteSavedLayout,
  } = useLayoutActions({
    workspace,
    setWorkspace,
    savedLayouts,
    setSavedLayouts,
    activeTab,
    currentLayout,
    activateTab,
    showToast,
    setSuperchartOpen,
    setLayoutMenuOpen,
    setSplitMenuOpen,
    setSplitSaveName,
  })

  useUserDataPersistence({
    userId: user.id,
    drawingStore,
    workspace,
    setWorkspace,
    savedLayouts,
    setSavedLayouts,
    alerts,
    setAlerts,
    scripts,
    setScripts,
    groupState,
    setGroupState,
    preferences,
    setPreferences,
    layoutFolders,
    setLayoutFolders,
    templateState,
    setTemplateState,
    watchlistState,
    setWatchlistState,
    setTheme,
  })
  useEffect(() => {
    const style = defaultTemplateStyle(templateState)
    controller?.setToolDefaultStyle('rectangle', style ? { ...style } : undefined)
  }, [controller, templateState])
  useEffect(() => {
    applyTheme(theme)
    saveUserTheme(user.id, theme)
  }, [theme, user.id])

  useCloseMenusOnOutsideClick(menus)

  useAlertWatcher({ alerts, setAlerts, symbol: market.symbol, quoteClose: runtime.quote?.close, replay: runtime.replay, previousPriceRef })

  const alertChannels = useAlertChannels(alertsOpen)
  const { pushStatus, telegram } = alertChannels

  const quote = runtime.quote
  const marketDrawings = drawingSnapshot.drawings.filter((drawing) => drawing.marketId === market.marketId)
  const selectedDrawing = drawingSnapshot.drawings.find((drawing) => drawing.id === selectedDrawingId)
  const { toggleDca, setGroupFlag, updateSelectedStyle } = drawingEdits(
    drawingStore,
    drawingSnapshot.drawings,
    selectedDrawing,
    multiSelection,
  )
  const toggleVolume = () => setWorkspace((current) => ({ ...current, volumeVisible: !current.volumeVisible }))
  const changeScaleMode = (mode: ScaleMode) =>
    setWorkspace((current) => {
      const { scaleMode: _previous, ...rest } = current
      return mode === 'normal' ? rest : { ...rest, scaleMode: mode }
    })

  return (
    <div className="terminal-shell">
      {user.mustChangePassword && (
        <div className="temp-password-banner" role="alert">
          <span>You signed in with a temporary password. Choose your own now so only you know it.</span>
          <button
            type="button"
            onClick={() => {
              setProfileFocus('password')
              setProfileOpen(true)
            }}
          >
            Choose a new password
          </button>
        </div>
      )}
      <ChartTabsBar
        user={user}
        workspace={workspace}
        superchartOpen={superchartOpen}
        setSuperchartOpen={setSuperchartOpen}
        tabDrag={tabDrag}
        activateTab={activateTab}
        closeChartTab={closeChartTab}
        profileMenuRef={menus.profileMenuRef}
        profileOpen={profileOpen}
        setProfileOpen={setProfileOpen}
        profileFocus={profileFocus}
        setProfileFocus={setProfileFocus}
        setAdminOpen={setAdminOpen}
        theme={theme}
        setTheme={setTheme}
        layoutCount={savedLayouts.length}
        preferences={preferences}
        setPreferences={setPreferences}
        onLogout={onLogout}
        onUserRefresh={onUserRefresh}
      />

      <MarketToolbar
        workspace={workspace}
        setWorkspace={setWorkspace}
        menus={menus}
        market={market}
        interval={interval}
        toolbarIntervals={toolbarIntervals}
        changeInterval={changeInterval}
        chartType={chartType}
        indicators={indicators}
        activeTab={activeTab}
        panes={panes}
        paneTotal={paneTotal}
        setPaneCount={setPaneCount}
        saveSplitAsLayout={saveSplitAsLayout}
        setSymbolSearch={setSymbolSearch}
        setIndicatorsOpen={setIndicatorsOpen}
        alertsOpen={alertsOpen}
        setAlertsOpen={setAlertsOpen}
        controller={controller}
        runtime={runtime}
        replay={replay}
        replayActive={replayActive}
        setActiveTool={setActiveTool}
        currentLayout={currentLayout}
        savedLayouts={savedLayouts}
        layoutNotice={layoutNotice}
        layoutDraftName={layoutDraftName}
        setLayoutDraftName={setLayoutDraftName}
        saveCurrentLayout={saveCurrentLayout}
        setSaveAsOpen={setSaveAsOpen}
        setSuperchartOpen={setSuperchartOpen}
        takeSnapshot={takeSnapshot}
      />

      <main className={objectTreeOpen ? 'workspace object-tree-visible' : 'workspace'}>
        <ToolRail
          activeTool={activeTool}
          groupTools={groupTools}
          chooseCursor={chooseCursor}
          chooseTool={chooseTool}
          controller={controller}
          connection={runtime.connection}
          workspace={workspace}
          setWorkspace={setWorkspace}
          drawingStore={drawingStore}
          drawingSnapshot={drawingSnapshot}
          selectedDrawingId={selectedDrawingId}
        />

        <section className={replayActive ? 'chart-workspace replay-active' : 'chart-workspace'} aria-label="Market chart workspace">
          <div className={`split-grid count-${paneTotal}`} data-count={paneTotal}>
            {panes.map((pane, index) => (
              <ChartPane
                key={`${activeTab.id}:${index}`}
                index={index}
                active={index === activePaneIdx}
                framed={paneTotal > 1}
                market={paneMarkets[index]}
                interval={pane.interval}
                drawingStore={drawingStore}
                volumeVisible={workspace.volumeVisible}
                indicators={indicators}
                magnet={!!workspace.magnet}
                chartType={chartType}
                theme={theme}
                countdown={preferences.candleCountdown}
                timeZone={chartTimeZone}
                highLowLabels={preferences.highLowLabels}
                scaleMode={workspace.scaleMode ?? 'normal'}
                appearance={preferences.appearance}
                drawingModes={drawingModes}
                syncGroup={paneTotal > 1 ? activeTab.id : undefined}
                syncCrosshair={activeTab.split?.sync?.crosshair === true}
                syncTime={activeTab.split?.sync?.time === true}
                alerts={alerts}
                alertLinesVisible={preferences.alertLines}
                onMoveAlert={moveAlertTo}
                onDeleteAlert={deleteAlert}
                onActivate={handleActivatePane}
                onActiveRuntime={setRuntime}
                onActiveController={handleControllerChange}
                onToolSettled={handleToolSettled}
                onSelectionChange={handleSelectionChange}
                onAddAlert={addAlertAtPrice}
                onToggleVolume={toggleVolume}
                onToggleMovingAverage={toggleMovingAverage}
                onToggleVwap={toggleVwap}
                onStudyChange={changeStudy}
                onStudyRemove={removeStudy}
                onStudySettings={setStudySettingsId}
                onCompareRemove={removeCompare}
                onScriptChange={changeScriptInstance}
                onScriptRemove={removeScriptInstance}
                onScriptSettings={setScriptSettingsId}
                onOpenSettings={openChartSettings}
              />
            ))}
          </div>

          <ReplayControls replay={replay} replayActive={replayActive} controller={controller} />

          {activeTool !== 'cursor' && <DrawingHint tool={activeTool} />}

          {multiSelection.length > 1 && (
            <MultiSelectionToolbar multiSelection={multiSelection} controller={controller} setGroupFlag={setGroupFlag} />
          )}

          {selectedDrawing && multiSelection.length < 2 && (
            <SelectedDrawingToolbar
              selectedDrawing={selectedDrawing}
              controller={controller}
              drawingStore={drawingStore}
              positionSettingsOpen={positionSettingsOpen}
              setPositionSettingsOpen={setPositionSettingsOpen}
              openSettings={() => setDrawingSettings({ id: selectedDrawing.id, tab: 'style' })}
              toggleDca={toggleDca}
              updateSelectedStyle={updateSelectedStyle}
              templateState={templateState}
              setTemplateState={setTemplateState}
            />
          )}

          {selectedDrawing && isPositionTool(selectedDrawing.type) && positionSettingsOpen && (
            <PositionSettingsDialog
              selectedDrawing={selectedDrawing}
              quoteAsset={market.quoteAsset}
              updateSelectedStyle={updateSelectedStyle}
              setPositionSettingsOpen={setPositionSettingsOpen}
            />
          )}
        </section>

        {objectTreeOpen && (
          <ObjectTreePanel
            marketDrawings={marketDrawings}
            market={market}
            interval={interval}
            selectedDrawingId={selectedDrawingId}
            groupState={groupState}
            setGroupState={setGroupState}
            groupSelectMode={groupSelectMode}
            setGroupSelectMode={setGroupSelectMode}
            setObjectTreeOpen={setObjectTreeOpen}
            controller={controller}
            drawingStore={drawingStore}
          />
        )}

        <PanelRail
          watchlistOpen={watchlistOpen}
          setWatchlistOpen={setWatchlistOpen}
          objectTreeOpen={objectTreeOpen}
          setObjectTreeOpen={setObjectTreeOpen}
          alertsOpen={alertsOpen}
          setAlertsOpen={setAlertsOpen}
          alerts={alerts}
        />
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
        <AlertsPanel
          key={alertSeed?.key ?? 0}
          initialPrice={alertSeed?.price}
          alerts={alerts}
          market={market}
          lastPrice={quote?.close}
          linesVisible={preferences.alertLines}
          onToggleLines={() => setPreferences((current) => ({ ...current, alertLines: !current.alertLines }))}
          onCreate={(options) => createAlert(options, market.symbol)}
          onToggle={toggleAlert}
          onDelete={deleteAlert}
          onClearTriggered={() => setAlerts((current) => current.filter((alert) => !isTriggered(alert)))}
          onOpenSymbol={(symbol) => {
            const next = findWatchMarket(symbol)
            if (next) changeMarket(next)
          }}
          onClose={() => setAlertsOpen(false)}
          notificationSummary={`Browser ${pushStatus === 'on' ? 'on' : 'off'}${telegram?.configured ? ` · Telegram ${telegram.linked ? 'on' : 'off'}` : ''}`}
          notifications={<AlertNotifications channels={alertChannels} />}
        />
      )}

      {adminOpen && user.isAdmin && <AdminPage myUserId={user.id} onClose={() => setAdminOpen(false)} />}

      {symbolSearch && (
        <SymbolSearch
          markets={markets}
          current={market}
          initialQuery={searchSeed}
          onSelect={(next) => {
            if (symbolSearch === 'new') createChartTab(next.symbol)
            else if (symbolSearch === 'watchlist') setWatchlistState((current) => addSymbol(current, next.symbol))
            else if (symbolSearch === 'compare') addCompare(next.symbol)
            else changeMarket(next)
            setSymbolSearch(null)
            setSearchSeed(undefined)
          }}
          onClose={() => {
            setSymbolSearch(null)
            setSearchSeed(undefined)
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {intervalInput !== null && (
        <div className="interval-prompt" role="dialog" aria-label="Change interval">
          <small>Change interval</small>
          <strong>{intervalInput}</strong>
          <span className={intervalError ? 'interval-prompt-error' : ''}>
            {intervalError ||
              (parseIntervalInput(intervalInput)
                ? `Enter: ${parseIntervalInput(intervalInput)}`
                : 'm minutes · h hours · D day · W week · M month')}
          </span>
        </div>
      )}

      {saveAsOpen && (
        <SaveLayoutAsDialog
          layoutDraftName={layoutDraftName}
          setLayoutDraftName={setLayoutDraftName}
          saveCurrentLayout={saveCurrentLayout}
          setSaveAsOpen={setSaveAsOpen}
        />
      )}

      {superchartOpen && (
        <Superchart
          layouts={savedLayouts}
          folders={layoutFolders}
          onFoldersChange={setLayoutFolders}
          activeLayoutId={activeTab.layoutId}
          onOpen={openSavedLayout}
          onOpenInBackground={openSavedLayoutInBackground}
          onOpenTogether={openLayoutsTogether}
          onCreate={createNewLayout}
          onNewChart={() => setSymbolSearch('new')}
          onToggleFavorite={toggleLayoutFavorite}
          onRename={renameLayout}
          onDuplicate={duplicateSavedLayout}
          onDelete={deleteSavedLayout}
        />
      )}

      <IndicatorDialogs
        actions={indicatorActions}
        indicators={indicators}
        volumeVisible={workspace.volumeVisible}
        market={market}
        runtime={runtime}
        favorites={preferences.favoriteIndicators}
        toggleVolume={toggleVolume}
      />

      <DrawingDialogs
        drawings={drawingSnapshot.drawings}
        multiSelection={multiSelection}
        drawingSettings={drawingSettings}
        setDrawingSettings={setDrawingSettings}
        drawingMenu={drawingMenu}
        setDrawingMenu={setDrawingMenu}
        setPositionSettingsOpen={setPositionSettingsOpen}
        chartTimeZone={chartTimeZone}
        market={market}
        quoteClose={runtime.quote?.close}
        createAlert={createAlert}
        showToast={showToast}
        controller={controller}
        drawingStore={drawingStore}
      />

      {chartSettingsOpen && (
        <ChartSettingsDialog
          preferences={preferences}
          onPreferences={setPreferences}
          scaleMode={workspace.scaleMode ?? 'normal'}
          onScaleMode={changeScaleMode}
          onClose={() => setChartSettingsOpen(false)}
        />
      )}

      <StatusBar
        controller={controller}
        market={market}
        interval={interval}
        changeInterval={changeInterval}
        chartTimeZone={chartTimeZone}
        scaleMode={workspace.scaleMode ?? 'normal'}
        changeScaleMode={changeScaleMode}
        preferences={preferences}
        setPreferences={setPreferences}
        drawingCount={marketDrawings.length}
        runtime={runtime}
        setProfileOpen={setProfileOpen}
      />
    </div>
  )
}
