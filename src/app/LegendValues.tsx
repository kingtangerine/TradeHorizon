import { useCallback, useSyncExternalStore } from 'react'
import type { HoverState, KLineChartController } from '../chart/KLineChartController'
import type { ChartQuote } from '../chart/types'
import { formatCompact, formatPrice } from './format'

// Legend values that follow the crosshair like TradingView's: the hovered candle's open/high/low/close, change and
// volume, and the indicator values at that candle; the live values when the pointer is not on the chart (or is on
// the newest candle). Each piece subscribes to the hover itself, so moving the mouse re-renders only these values.

/** The hovered candle, or null when the pointer is off the chart or on the newest candle. */
export function useHoveredCandle(controller: KLineChartController | null): HoverState | null {
  const subscribe = useCallback((listener: () => void) => controller?.subscribeHover(listener) ?? (() => {}), [controller])
  const snapshot = useCallback(() => controller?.getHover() ?? null, [controller])
  const hover = useSyncExternalStore(subscribe, snapshot, snapshot)
  return hover && !hover.latest ? hover : null
}

export interface LegendCandle {
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume?: number
  /** Close of the candle before, for the change (TradingView compares with the previous close). */
  readonly previousClose?: number
}

/** The candle the legend should show: the hovered one, otherwise the live one. */
export function legendCandle(hover: HoverState | null, quote: ChartQuote | null, livePreviousClose: number | undefined): LegendCandle | null {
  if (hover) return { ...hover.bar, previousClose: hover.previousClose }
  if (!quote) return null
  return { open: quote.open, high: quote.high, low: quote.low, close: quote.close, volume: quote.volume, previousClose: livePreviousClose }
}

/** Change and change % against the previous close (or the open when there is no previous candle). */
export function candleChange(candle: LegendCandle): { value: number, percent: number } {
  const reference = candle.previousClose ?? candle.open
  const value = candle.close - reference
  return { value, percent: reference === 0 ? 0 : (value / reference) * 100 }
}

export function LegendOhlc({ controller, quote, precision }: { controller: KLineChartController | null, quote: ChartQuote | null, precision: number }) {
  const hover = useHoveredCandle(controller)
  const candle = legendCandle(hover, quote, controller?.latestPreviousClose())
  const up = candle ? candle.close >= candle.open : true
  const change = candle ? candleChange(candle) : undefined
  const tone = up ? 'price-up' : 'price-down'
  const sign = (value: number) => (value >= 0 ? '+' : '−')
  return (
    <div className="chart-ohlc-row">
      <span><b>O</b><i className={tone}>{formatPrice(candle?.open, precision)}</i></span>
      <span><b>H</b><i className={tone}>{formatPrice(candle?.high, precision)}</i></span>
      <span><b>L</b><i className={tone}>{formatPrice(candle?.low, precision)}</i></span>
      <span><b>C</b><i className={tone}>{formatPrice(candle?.close, precision)}</i></span>
      <span className={change && change.value < 0 ? 'price-down' : 'price-up'}>
        {change ? `${sign(change.value)}${formatPrice(Math.abs(change.value), precision)} (${sign(change.value)}${Math.abs(change.percent).toFixed(2)}%)` : '—'}
      </span>
    </div>
  )
}

export function LegendVolume({ controller, quote }: { controller: KLineChartController | null, quote: ChartQuote | null }) {
  const hover = useHoveredCandle(controller)
  return <b>{formatCompact(hover ? hover.bar.volume : quote?.volume)}</b>
}

/** Values of one indicator line per period/series, at the hovered candle or the newest one. */
export function LegendIndicatorValues({ controller, pick, colors, precision }: {
  controller: KLineChartController | null
  /** Reads this indicator's values out of the controller's values for one candle. */
  pick: (values: ReturnType<KLineChartController['indicatorValuesAt']>) => ReadonlyArray<number | undefined>
  colors: readonly string[]
  precision: number
  /** Changes on every price update, so live values re-render while nothing is hovered. */
  quote: ChartQuote | null
}) {
  const hover = useHoveredCandle(controller)
  const values = controller ? pick(controller.indicatorValuesAt(hover?.index)) : []
  return (
    <>
      {values.map((value, position) => (
        <b key={position} style={{ color: colors[position % colors.length] }}>{formatPrice(value, precision)}</b>
      ))}
    </>
  )
}

/** Values of a library study at the hovered candle or the newest one. */
export function LegendStudyValues({ controller, studyId, colors, precision }: {
  controller: KLineChartController | null
  studyId: string
  colors: readonly string[]
  precision: number
  /** Changes on every price update, so live values re-render while nothing is hovered. */
  quote: ChartQuote | null
}) {
  const hover = useHoveredCandle(controller)
  const values = controller ? controller.studyValuesAt(studyId, hover?.index) : []
  return (
    <>
      {values.map((value, position) => (value === undefined ? null : (
        <b key={position} style={{ color: colors[position % colors.length] }}>{formatPrice(value, precision)}</b>
      )))}
    </>
  )
}
