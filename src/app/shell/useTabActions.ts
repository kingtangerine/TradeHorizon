import { type Dispatch, type SetStateAction, useCallback } from 'react'
import type { KLineChartController } from '../../chart/KLineChartController'
import type { CryptoMarket } from '../../chart/markets'
import type { DrawingType } from '../../drawings'
import type { MarketInterval } from '../../market'
import { activePaneIndex, withActivePane, withPaneCount, withSyncedPaneChange, type PaneSpec, type SplitCount } from '../panes'
import type { ChartTab, UserWorkspace } from '../workspace'
import { closeTab, INITIAL_INTERVAL } from './workspaceHelpers'

interface TabActionsOptions {
  setWorkspace: Dispatch<SetStateAction<UserWorkspace>>
  setSuperchartOpen: Dispatch<SetStateAction<boolean>>
  setSplitMenuOpen: Dispatch<SetStateAction<boolean>>
  controller: KLineChartController | null
  setActiveTool: Dispatch<SetStateAction<'cursor' | DrawingType>>
  setSelectedDrawingId: Dispatch<SetStateAction<string | undefined>>
}

/** Opening, switching and closing chart tabs, and changing the symbol, timeframe and split of the active one. */
export function useTabActions({
  setWorkspace,
  setSuperchartOpen,
  setSplitMenuOpen,
  controller,
  setActiveTool,
  setSelectedDrawingId,
}: TabActionsOptions) {
  /** Changes the symbol or timeframe of the active chart (the main chart of the tab, or one of its split panes). */
  const updateActivePane = useCallback(
    (changes: Partial<PaneSpec>) => {
      setWorkspace((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => (tab.id === current.activeTabId ? withSyncedPaneChange(tab, activePaneIndex(tab), changes) : tab)),
      }))
    },
    [setWorkspace],
  )

  const changeMarket = useCallback(
    (nextMarket: CryptoMarket) => {
      updateActivePane({ symbol: nextMarket.symbol })
    },
    [updateActivePane],
  )

  const changeInterval = useCallback(
    (nextInterval: MarketInterval) => {
      updateActivePane({ interval: nextInterval })
    },
    [updateActivePane],
  )

  const activateTab = useCallback(
    (tab: ChartTab) => {
      setWorkspace((current) => ({ ...current, activeTabId: tab.id }))
      setSuperchartOpen(false)
    },
    [setSuperchartOpen, setWorkspace],
  )

  const createChartTab = useCallback(
    (symbol: string) => {
      const tab: ChartTab = {
        id: crypto.randomUUID(),
        symbol,
        interval: INITIAL_INTERVAL,
        createdAtMs: Date.now(),
      }
      setWorkspace((current) => ({ ...current, tabs: [...current.tabs, tab], activeTabId: tab.id }))
      setSuperchartOpen(false)
    },
    [setSuperchartOpen, setWorkspace],
  )

  const closeChartTab = useCallback(
    (id: string) => {
      setWorkspace((current) => closeTab(current, id))
    },
    [setWorkspace],
  )

  /** Clicking another chart in a split view makes it the one the toolbar and tools act on. */
  const handleActivatePane = useCallback(
    (index: number) => {
      controller?.cancelActiveTool()
      controller?.clearDrawingSelection()
      setActiveTool('cursor')
      setSelectedDrawingId(undefined)
      setWorkspace((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => (tab.id === current.activeTabId ? withActivePane(tab, index) : tab)),
      }))
    },
    [controller, setActiveTool, setSelectedDrawingId, setWorkspace],
  )

  const setPaneCount = useCallback(
    (count: 1 | SplitCount) => {
      setWorkspace((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => (tab.id === current.activeTabId ? withPaneCount(tab, count) : tab)),
      }))
      setSplitMenuOpen(false)
    },
    [setSplitMenuOpen, setWorkspace],
  )

  return { updateActivePane, changeMarket, changeInterval, activateTab, createChartTab, closeChartTab, handleActivatePane, setPaneCount }
}
