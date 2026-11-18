import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'
import { CHART_TYPES, CHART_TYPE_LABELS, type ChartType } from '../../chart/chartTypes'
import { MAX_COMPARE } from '../../chart/compare'
import type { IndicatorSettings } from '../../chart/indicators'
import { DISPLAY_INTERVALS } from '../../chart/intervals'
import type { KLineChartController } from '../../chart/KLineChartController'
import { displaySymbol, type CryptoMarket } from '../../chart/markets'
import type { ChartRuntimeState, ReplayState } from '../../chart/types'
import type { DrawingType } from '../../drawings'
import { MARKET_INTERVALS, MARKET_INTERVAL_SPECS, type MarketInterval } from '../../market'
import { ChartTypeIcon } from '../ChartTypeIcon'
import { BellIcon, CameraIcon, LayersIcon, PlusIcon, ReplayIcon, SplitIcon, TargetIcon } from '../Icons'
import { SYNC_KEYS, withSplitSync, type PaneSpec, type SplitCount } from '../panes'
import { defaultSplitName, type ChartTab, type SavedLayout, type UserWorkspace } from '../workspace'
import type { SymbolSearchMode } from './useWorkspaceHotkeys'
import type { ToolbarMenus } from './useToolbarMenus'
import { connectionCopy, countActiveIndicators, DEFAULT_LAYOUT_NAME } from './workspaceHelpers'
import { isNative } from '../../platform/native'

interface MarketToolbarProps {
  workspace: UserWorkspace
  setWorkspace: Dispatch<SetStateAction<UserWorkspace>>
  menus: ToolbarMenus
  market: CryptoMarket
  interval: MarketInterval
  /** Timeframe buttons in the toolbar: the standard ones, then the user's own. */
  toolbarIntervals: readonly MarketInterval[]
  changeInterval(next: MarketInterval): void
  chartType: ChartType
  indicators: IndicatorSettings
  activeTab: ChartTab
  panes: readonly PaneSpec[]
  paneTotal: number
  setPaneCount(count: 1 | SplitCount): void
  saveSplitAsLayout(name: string): void
  setSymbolSearch: Dispatch<SetStateAction<SymbolSearchMode | null>>
  setIndicatorsOpen: Dispatch<SetStateAction<boolean>>
  alertsOpen: boolean
  setAlertsOpen: Dispatch<SetStateAction<boolean>>
  controller: KLineChartController | null
  runtime: ChartRuntimeState
  replay: ReplayState | null
  replayActive: boolean
  setActiveTool: Dispatch<SetStateAction<'cursor' | DrawingType>>
  currentLayout: SavedLayout | undefined
  savedLayouts: readonly SavedLayout[]
  layoutNotice: string
  layoutDraftName: string
  setLayoutDraftName: Dispatch<SetStateAction<string>>
  saveCurrentLayout(name?: string, forceNew?: boolean): void
  setSaveAsOpen: Dispatch<SetStateAction<boolean>>
  setSuperchartOpen: Dispatch<SetStateAction<boolean>>
  takeSnapshot(mode: 'download' | 'copy'): void
}

/**
 * Toolbar above the chart: symbol and compare, timeframes, chart type, split layout, indicators, alerts, replay,
 * go-live, connection state, the layout menu and the snapshot menu.
 */
export function MarketToolbar({
  workspace,
  setWorkspace,
  menus,
  market,
  interval,
  toolbarIntervals,
  changeInterval,
  chartType,
  indicators,
  activeTab,
  panes,
  paneTotal,
  setPaneCount,
  saveSplitAsLayout,
  setSymbolSearch,
  setIndicatorsOpen,
  alertsOpen,
  setAlertsOpen,
  controller,
  runtime,
  replay,
  replayActive,
  setActiveTool,
  currentLayout,
  savedLayouts,
  layoutNotice,
  layoutDraftName,
  setLayoutDraftName,
  saveCurrentLayout,
  setSaveAsOpen,
  setSuperchartOpen,
  takeSnapshot,
}: MarketToolbarProps) {
  const {
    layoutMenuOpen,
    setLayoutMenuOpen,
    timeframeMenuOpen,
    setTimeframeMenuOpen,
    splitMenuOpen,
    setSplitMenuOpen,
    splitSaveName,
    setSplitSaveName,
    chartTypeMenuOpen,
    setChartTypeMenuOpen,
    snapshotMenuOpen,
    setSnapshotMenuOpen,
    layoutMenuRef,
    timeframeMenuRef,
    snapshotMenuRef,
    chartTypeMenuRef,
    indicatorMenuRef,
    splitMenuRef,
  } = menus
  const [customIntervalAmount, setCustomIntervalAmount] = useState('12')
  const [customIntervalUnit, setCustomIntervalUnit] = useState<'m' | 'h' | 'd' | 'w' | 'M'>('h')
  const [customIntervalError, setCustomIntervalError] = useState('')

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
        customIntervals: current.customIntervals.includes(next) ? current.customIntervals : [...current.customIntervals, next],
      }))
    }
    changeInterval(next)
    setTimeframeMenuOpen(false)
  }, [changeInterval, customIntervalAmount, customIntervalUnit, setTimeframeMenuOpen, setWorkspace])

  const quote = runtime.quote
  const activeIndicatorCount = countActiveIndicators(workspace.volumeVisible, indicators)
  const connectionLabel = connectionCopy(runtime)

  return (
    <div className="market-toolbar">
      <button
        type="button"
        className="symbol-button"
        title="Symbol search"
        aria-haspopup="dialog"
        onClick={() => setSymbolSearch('change')}
      >
        <span className="asset-badge">{market.mark}</span>
        <strong>{displaySymbol(market.symbol)}</strong>
        {market.kind !== 'dominance' && market.exchange !== 'binance' && market.exchange !== 'binance-futures' && (
          <small className="symbol-button-venue">{market.venue.replace(' Futures', '')}</small>
        )}
      </button>
      <button
        type="button"
        className="compare-button"
        title={indicators.compare.length >= MAX_COMPARE ? `Up to ${MAX_COMPARE} symbols can be compared` : 'Compare or add symbol'}
        aria-label="Compare symbol"
        disabled={indicators.compare.length >= MAX_COMPARE || market.kind === 'dominance'}
        onClick={() => setSymbolSearch('compare')}
      >
        <PlusIcon />
      </button>

      <span className="toolbar-divider" />

      <div className="timeframe-group" aria-label="Chart timeframe">
        {toolbarIntervals.map((value) => (
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
          {toolbarIntervals.includes(interval) ? (
            'More'
          ) : (
            <span className="current-timeframe">{MARKET_INTERVAL_SPECS[interval].label}</span>
          )}
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
                  onClick={() => {
                    changeInterval(value)
                    setTimeframeMenuOpen(false)
                  }}
                >
                  {MARKET_INTERVAL_SPECS[value].label}
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                addCustomInterval()
              }}
            >
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

      <div className="toolbar-popover-control" ref={chartTypeMenuRef}>
        <button
          type="button"
          className="indicators-button chart-type-button"
          aria-label={`Chart type: ${CHART_TYPE_LABELS[chartType]}`}
          title={CHART_TYPE_LABELS[chartType]}
          aria-expanded={chartTypeMenuOpen}
          onClick={() => setChartTypeMenuOpen((open) => !open)}
        >
          <ChartTypeIcon type={chartType} />
        </button>
        {chartTypeMenuOpen && (
          <div className="top-menu layout-menu chart-type-menu" role="menu">
            {CHART_TYPES.map((type) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={type === chartType}
                className={type === chartType ? 'active' : ''}
                key={type}
                onClick={() => {
                  setChartTypeMenuOpen(false)
                  setWorkspace((current) => {
                    const { chartType: _previous, ...rest } = current
                    return type === 'candles' ? rest : { ...rest, chartType: type }
                  })
                }}
              >
                <span className="chart-type-option">
                  <ChartTypeIcon type={type} />
                  {CHART_TYPE_LABELS[type]}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar-popover-control" ref={splitMenuRef}>
        <button
          type="button"
          className={paneTotal > 1 ? 'indicators-button active' : 'indicators-button'}
          aria-label="Chart layout"
          aria-haspopup="menu"
          aria-expanded={splitMenuOpen}
          title="Chart layout: show 2, 3 or 4 charts in this tab"
          onClick={() => setSplitMenuOpen((open) => !open)}
        >
          <SplitIcon count={paneTotal} />
        </button>
        {splitMenuOpen && (
          <div className="top-menu split-menu" role="menu" aria-label="Chart layout">
            <strong>Charts in this tab</strong>
            <div className="split-menu-grid">
              {([1, 2, 3, 4] as const).map((count) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={paneTotal === count}
                  className={paneTotal === count ? 'active' : ''}
                  key={count}
                  onClick={() => setPaneCount(count)}
                >
                  <SplitIcon count={count} />
                  <span>{count === 1 ? 'Single' : `${count} charts`}</span>
                </button>
              ))}
            </div>
            {paneTotal > 1 && (
              <small>Click a chart to make it active. The toolbar, drawing tools and panels act on the active chart.</small>
            )}
            {paneTotal > 1 && (
              <div className="split-sync" role="group" aria-label="Sync charts">
                <b>Sync in this tab</b>
                {SYNC_KEYS.map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={activeTab.split?.sync?.[key] === true}
                      onChange={(event) =>
                        setWorkspace((current) => ({
                          ...current,
                          tabs: current.tabs.map((tab) =>
                            tab.id === current.activeTabId ? withSplitSync(tab, key, event.target.checked) : tab,
                          ),
                        }))
                      }
                    />
                    <span>
                      {key === 'symbol'
                        ? 'Symbol'
                        : key === 'interval'
                          ? 'Timeframe'
                          : key === 'crosshair'
                            ? 'Crosshair'
                            : 'Time (scroll and zoom)'}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {paneTotal > 1 && (
              <form
                className="split-save"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveSplitAsLayout(splitSaveName)
                }}
              >
                <input
                  value={splitSaveName}
                  maxLength={48}
                  placeholder={defaultSplitName(panes)}
                  aria-label="Name for the saved split"
                  onChange={(event) => setSplitSaveName(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
                <button type="submit" title="Save this split view to your layouts so you can open it again later">
                  Save split
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <span className="toolbar-divider" />

      <div className="toolbar-popover-control" ref={indicatorMenuRef}>
        <button
          type="button"
          className={activeIndicatorCount > 0 ? 'indicators-button active' : 'indicators-button'}
          aria-haspopup="dialog"
          onClick={() => setIndicatorsOpen(true)}
        >
          <LayersIcon /> Indicators
        </button>
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
        title={replayActive ? 'Replaying history; live updates are paused' : (runtime.error ?? connectionLabel)}
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
          <small
            title={
              currentLayout
                ? 'Changes to this layout are saved automatically'
                : 'Your open tabs are kept, but they are not part of a saved layout yet'
            }
          >
            {layoutNotice || (currentLayout ? 'Autosaved' : 'Not saved as layout')}
          </small>
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
            <button
              type="button"
              onClick={() => {
                saveCurrentLayout(layoutDraftName)
                setLayoutMenuOpen(false)
              }}
            >
              Save layout
            </button>
            <button
              type="button"
              onClick={() => {
                setSaveAsOpen(true)
                setLayoutMenuOpen(false)
              }}
            >
              Save as…
            </button>
            <button
              type="button"
              onClick={() => {
                setSuperchartOpen(true)
                setLayoutMenuOpen(false)
              }}
            >
              Manage layouts <span>{savedLayouts.length}</span>
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-popover-control" ref={snapshotMenuRef}>
        <button
          type="button"
          className="indicators-button snapshot-button"
          aria-label="Take a snapshot"
          title="Take a snapshot"
          aria-haspopup="menu"
          aria-expanded={snapshotMenuOpen}
          onClick={() => setSnapshotMenuOpen((open) => !open)}
          disabled={!controller || !quote}
        >
          <CameraIcon />
        </button>
        {snapshotMenuOpen && (
          <div className="top-menu layout-menu snapshot-menu" role="menu">
            {isNative ? (
              // The Android app shares the image (save to the phone, send to an app); a WebView cannot copy images.
              <button type="button" role="menuitem" onClick={() => takeSnapshot('download')}>
                Share image…
              </button>
            ) : (
              <>
                <button type="button" role="menuitem" onClick={() => takeSnapshot('download')}>
                  Download image <span>Ctrl+Alt+S</span>
                </button>
                <button type="button" role="menuitem" onClick={() => takeSnapshot('copy')}>
                  Copy image <span>Ctrl+Shift+S</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
