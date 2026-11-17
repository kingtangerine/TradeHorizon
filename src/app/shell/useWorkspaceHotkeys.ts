import { type Dispatch, type SetStateAction, useEffect } from 'react'
import type { KLineChartController } from '../../chart/KLineChartController'
import { DRAWING_TOOLS, TOOL_ORDER } from '../../chart/tools'
import type { DrawingStore, DrawingType } from '../../drawings'
import type { MarketInterval } from '../../market'
import { INTERVAL_INPUT_CHARS, isChartTypingKey, parseIntervalInput } from '../hotkeys'
import type { DrawingSettingsTab } from '../DrawingSettingsDialog'
import type { UserScript } from '../scripts'

/** Which kind of symbol search is open: change the chart, open a new tab, add to the watchlist, or compare. */
export type SymbolSearchMode = 'change' | 'new' | 'watchlist' | 'compare'

interface WorkspaceHotkeysOptions {
  controller: KLineChartController | null
  drawingStore: DrawingStore
  pricePrecision: number
  /** The timeframe box typed on the chart (null while closed). */
  intervalInput: string | null
  setIntervalInput: Dispatch<SetStateAction<string | null>>
  setIntervalError: Dispatch<SetStateAction<string>>
  changeInterval(next: MarketInterval): void
  takeSnapshot(mode: 'download' | 'copy'): void
  setAlertSeed: Dispatch<SetStateAction<{ price: string; key: number } | undefined>>
  setAlertsOpen: Dispatch<SetStateAction<boolean>>
  setSearchSeed: Dispatch<SetStateAction<string | undefined>>
  symbolSearch: SymbolSearchMode | null
  setSymbolSearch: Dispatch<SetStateAction<SymbolSearchMode | null>>
  indicatorsOpen: boolean
  scriptEditor: { script?: UserScript } | undefined
  profileOpen: boolean
  adminOpen: boolean
  superchartOpen: boolean
  chartSettingsOpen: boolean
  studySettingsId: string | undefined
  drawingSettings: { id: string; tab: DrawingSettingsTab } | undefined
  chooseCursor(): void
  chooseTool(type: DrawingType): void
  replayActive: boolean
  replayPlaying: boolean
  selectedDrawingId: string | undefined
}

/**
 * Keyboard shortcuts of the chart workspace (TradingView style): typing a timeframe or a symbol on the chart,
 * snapshots, alerts, replay, drawing tools, clone, delete, undo and redo.
 */
export function useWorkspaceHotkeys({
  controller,
  drawingStore,
  pricePrecision,
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
}: WorkspaceHotkeysOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return

      // The timeframe box takes the keys while it is open.
      if (intervalInput !== null) {
        if (event.key === 'Escape') {
          setIntervalInput(null)
          event.preventDefault()
          return
        }
        if (event.key === 'Backspace') {
          event.preventDefault()
          setIntervalError('')
          setIntervalInput((value) => (value && value.length > 1 ? value.slice(0, -1) : null))
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const next = parseIntervalInput(intervalInput)
          if (next) {
            changeInterval(next)
            setIntervalInput(null)
          } else setIntervalError(`"${intervalInput}" is not a timeframe the exchange offers`)
          return
        }
        if (isChartTypingKey(event, target) && INTERVAL_INPUT_CHARS.test(event.key)) {
          event.preventDefault()
          setIntervalError('')
          setIntervalInput((value) => `${value ?? ''}${event.key}`.slice(0, 6))
          return
        }
        if (!event.ctrlKey && !event.metaKey && !event.altKey) return
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS' && (event.altKey || event.shiftKey)) {
        event.preventDefault()
        takeSnapshot(event.altKey ? 'download' : 'copy')
        return
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyR') {
        event.preventDefault()
        controller?.resetView()
        return
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyA') {
        event.preventDefault()
        const last = controller?.latestCandle()?.close
        setAlertSeed({ price: last !== undefined && Number.isFinite(last) ? last.toFixed(pricePrecision) : '', key: Date.now() })
        setAlertsOpen(true)
        return
      }
      const otherWindowOpen =
        symbolSearch !== null ||
        indicatorsOpen ||
        scriptEditor !== undefined ||
        profileOpen ||
        adminOpen ||
        superchartOpen ||
        chartSettingsOpen ||
        studySettingsId !== undefined ||
        drawingSettings !== undefined ||
        document.querySelector('[role="dialog"], [role="menu"]') !== null
      if (!otherWindowOpen && isChartTypingKey(event, target)) {
        if (/^[0-9]$/.test(event.key)) {
          event.preventDefault()
          setIntervalError('')
          setIntervalInput(event.key)
          return
        }
        if (/^[a-zA-Z]$/.test(event.key)) {
          event.preventDefault()
          setSearchSeed(event.key.toUpperCase())
          setSymbolSearch('change')
          return
        }
      }

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
        if (event.shiftKey) drawingStore.redo()
        else drawingStore.undo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        drawingStore.redo()
      }
    }

    globalThis.addEventListener('keydown', handleKeyDown)
    return () => globalThis.removeEventListener('keydown', handleKeyDown)
  }, [
    adminOpen,
    indicatorsOpen,
    scriptEditor,
    chartSettingsOpen,
    studySettingsId,
    drawingSettings,
    changeInterval,
    chooseCursor,
    chooseTool,
    controller,
    drawingStore,
    intervalInput,
    pricePrecision,
    profileOpen,
    replayActive,
    replayPlaying,
    selectedDrawingId,
    superchartOpen,
    symbolSearch,
    takeSnapshot,
    setAlertSeed,
    setAlertsOpen,
    setIntervalError,
    setIntervalInput,
    setSearchSeed,
    setSymbolSearch,
  ])

  // A click anywhere closes the timeframe box, as in TradingView.
  useEffect(() => {
    if (intervalInput === null) return
    const close = () => setIntervalInput(null)
    globalThis.addEventListener('pointerdown', close, true)
    return () => globalThis.removeEventListener('pointerdown', close, true)
  }, [intervalInput, setIntervalInput])
}
