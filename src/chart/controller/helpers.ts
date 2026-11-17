import type { KLineData } from 'klinecharts'
import type { Anchor } from '../../drawings'
import { MARKET_INTERVAL_SPECS, type MarketInterval } from '../../market'
import type { ChartQuote } from '../types'

/** Candles fetched per history request. */
export const HISTORY_PAGE_SIZE = 1000
/** Extra history pages fetched so a timeframe switch can keep the part of the chart you were looking at. */
export const MAX_VIEWPORT_BACKFILL_PAGES = 10
/** Candles fetched beyond the moment a timeframe switch (or go-to-date) has to show. */
export const VIEWPORT_BACKFILL_MARGIN_BARS = 200
/** How close (in pixels) a point must be to a candle's open, high, low or close for the magnet to snap to it. */
export const MAGNET_TOLERANCE_PX = 12
/** One day in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000
// The HTML legend lists moving averages, so the library's own overlapping label is blanked.
/** Tooltip data source of indicators whose legend the app draws itself in HTML. */
export const HIDDEN_INDICATOR_TOOLTIP = { name: '', calcParamsText: '', features: [], legends: [] }

/** Length of one candle of `interval` (a month counts as 30 days). */
export function intervalDurationMs(interval: MarketInterval): number {
  return MARKET_INTERVAL_SPECS[interval].durationMs ?? 30 * DAY_MS
}

/** The colour behind the chart (its canvases are transparent), for pictures of it. */
export function chartBackground(element: HTMLElement): string {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor
    if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) return color
  }
  return '#131722'
}

/** A chart bar as a (not final) quote for the header, timed now. */
export function barToQuote(bar: KLineData): ChartQuote {
  return {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 0,
    changePercent: bar.open === 0 ? 0 : ((bar.close - bar.open) / bar.open) * 100,
    isFinal: false,
    updatedAtMs: Date.now(),
  }
}

/** True when two anchor lists have the same times and prices in the same order. */
export function anchorsEqual(a: readonly Anchor[], b: readonly Anchor[]): boolean {
  return a.length === b.length && a.every((anchor, index) => anchor.timeMs === b[index].timeMs && anchor.price === b[index].price)
}

/** True for the error an aborted fetch throws. */
export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError')
}

/** A new unique id for a drawing. */
export function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `trend-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** A message for the user from anything thrown while loading market data. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Market data is temporarily unavailable.'
}

/** A `#rrggbb` or `rgb()/rgba()` colour with the opacity set to `opacityPercent` (0-100); other colours are returned as is. */
export function colorWithOpacity(color: string, opacityPercent: number): string {
  const opacity = Math.max(0, Math.min(100, opacityPercent)) / 100
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const value = hex[1]
    return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${opacity})`
  }

  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color)
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${opacity})` : color
}
