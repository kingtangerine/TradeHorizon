import type { ChartRuntimeState } from '../types'

/** Price scale of the candle pane: regular, logarithmic, or percent from the first visible candle. */
export type ScaleMode = 'normal' | 'log' | 'percent'

/** What the chart settings window controls (kept free of app imports; preferences.ts has the stored form). */
export interface ChartAppearanceStyle {
  readonly upColor: string
  readonly downColor: string
  readonly wicks: boolean
  readonly background: string | null
  readonly grid: 'both' | 'vertical' | 'horizontal' | 'none'
  readonly lastPriceLine: boolean
}

/** The candle under the crosshair, for the legend (TradingView shows the hovered candle's values). */
export interface HoverState {
  readonly index: number
  readonly bar: {
    readonly timestamp: number
    readonly open: number
    readonly high: number
    readonly low: number
    readonly close: number
    readonly volume?: number
  }
  readonly previousClose?: number
  /** The newest candle: the legend shows live values instead. */
  readonly latest: boolean
}

/** Indicator values for one candle, in the order the legend lists them. */
export interface IndicatorValues {
  readonly sma: ReadonlyArray<number | undefined>
  readonly ema: ReadonlyArray<number | undefined>
  readonly vwap?: number
  readonly qvwap?: number
}

/** What the chart controller tells the app about (runtime state, tools, selection, price view, alert lines). */
export interface KLineChartControllerCallbacks {
  onRuntimeState(state: ChartRuntimeState): void
  onToolSettled(): void
  onSelectionChange(selectedId?: string): void
  /** The price scale was moved or zoomed by the user (true) or is back on automatic fit (false). */
  onPriceViewChange?(manual: boolean): void
  /** An alert line was dragged to a new price. */
  onAlertMove?(id: string, price: number): void
  /** The ✕ on an alert line was clicked. */
  onAlertDelete?(id: string): void
}

/** Drawing gestures the app answers with its own UI (settings window, context menu, multi-selection toolbar). */
export type DrawingEvent =
  | { readonly kind: 'doubleClick'; readonly id: string }
  | { readonly kind: 'contextMenu'; readonly id: string; readonly clientX: number; readonly clientY: number }
  | { readonly kind: 'selection'; readonly ids: readonly string[] }

/** Tool-rail toggles that apply to every drawing. */
export interface DrawingModes {
  /** Keep the tool armed after a drawing is placed. */
  readonly stayInDrawingMode: boolean
  readonly lockAll: boolean
  readonly hideAll: boolean
}

/** A price alert shown as a line on this chart. */
export interface AlertLine {
  readonly id: string
  readonly price: number
  readonly paused: boolean
}

/** Where the chart should land once the candles of a new timeframe (or a far-back date) have loaded. */
export interface PendingViewport {
  followingLive: boolean
  centerTimeMs?: number
  barSpace: number
}

/** Merges a patch into the chart's runtime state and tells the app (shared by the controller's collaborators). */
export type PatchRuntime = (patch: Partial<ChartRuntimeState>) => void
