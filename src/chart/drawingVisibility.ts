// Per-drawing options stored in the drawing's style (so they sync and undo like any style change):
// which timeframes it shows on (TradingView's Visibility tab) and the levels of a Fibonacci retracement.
import type { DrawingStyle } from '../drawings'
import type { MarketInterval } from '../market'
import { FIB_LEVELS } from './geometry'

/** Timeframe groups a drawing can be hidden on, as in TradingView's Visibility tab. */
export const INTERVAL_GROUPS = ['minutes', 'hours', 'days', 'weeks', 'months'] as const
/** One of the timeframe groups in INTERVAL_GROUPS. */
export type IntervalGroup = (typeof INTERVAL_GROUPS)[number]

/** Labels for the timeframe groups. */
export const INTERVAL_GROUP_LABELS: Readonly<Record<IntervalGroup, string>> = {
  minutes: 'Minutes',
  hours: 'Hours',
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
}

/** The timeframe group an interval belongs to ("4h" is hours, "1M" months). */
export function intervalGroup(interval: MarketInterval): IntervalGroup {
  if (interval.endsWith('M')) return 'months'
  if (interval.endsWith('w')) return 'weeks'
  if (interval.endsWith('d')) return 'days'
  if (interval.endsWith('h')) return 'hours'
  return 'minutes'
}

/** Groups the drawing is hidden on (stored as `hiddenOn`; missing = shown everywhere). */
export function hiddenGroups(style: DrawingStyle | undefined): IntervalGroup[] {
  const value = style?.hiddenOn
  if (!Array.isArray(value)) return []
  return INTERVAL_GROUPS.filter((group) => value.includes(group))
}

/** False when the drawing is hidden on the interval's timeframe group. */
export function visibleOnInterval(style: DrawingStyle | undefined, interval: MarketInterval): boolean {
  return !hiddenGroups(style).includes(intervalGroup(interval))
}

/** Most custom levels a Fibonacci retracement keeps. */
export const MAX_FIB_LEVELS = 16

/** The retracement's levels: the stored ones, or TradingView's defaults. Sorted, unique, between -5 and 10. */
export function fibLevels(style: DrawingStyle | undefined): number[] {
  const value = style?.fibLevels
  if (!Array.isArray(value)) return [...FIB_LEVELS]
  const levels = [
    ...new Set(value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item >= -5 && item <= 10)),
  ]
    .sort((a, b) => a - b)
    .slice(0, MAX_FIB_LEVELS)
  return levels.length > 0 ? levels : [...FIB_LEVELS]
}

// --- Fibonacci retracement settings (TradingView's Style tab) ----------------------------------------------------

/** One level row of a Fibonacci retracement: level `v`, hex colour `c`, and whether it is shown. */
export interface FibLevelRow {
  /** The level (0.618 …). */
  readonly v: number
  readonly c: string
  readonly on: boolean
}

/** A Fibonacci retracement's style settings, read from its drawing style by fibSettings. */
export interface FibSettings {
  readonly rows: readonly FibLevelRow[]
  /** The dashed line between the two points. */
  readonly trend: boolean
  readonly extendLeft: boolean
  readonly extendRight: boolean
  readonly background: boolean
  /** Swap which point is 0 and which is 1. */
  readonly reverse: boolean
  readonly prices: boolean
  readonly levels: boolean
  /** Labels as 61.8% instead of 0.618. */
  readonly percent: boolean
  readonly labelSide: 'left' | 'right'
  /** One colour for every level instead of each level's own. */
  readonly oneColor: string | null
}

/** TradingView's level list: the first eleven are shown by default. */
export const TV_FIB_ROWS: readonly FibLevelRow[] = [
  { v: 0, c: '#787b86', on: true },
  { v: 0.236, c: '#f23645', on: true },
  { v: 0.382, c: '#ff9800', on: true },
  { v: 0.5, c: '#4caf50', on: true },
  { v: 0.618, c: '#089981', on: true },
  { v: 0.786, c: '#00bcd4', on: true },
  { v: 1, c: '#787b86', on: true },
  { v: 1.618, c: '#2962ff', on: true },
  { v: 2.618, c: '#f23645', on: true },
  { v: 3.618, c: '#9c27b0', on: true },
  { v: 4.236, c: '#e91e63', on: true },
  { v: 1.272, c: '#ff9800', on: false },
  { v: 1.414, c: '#f23645', on: false },
  { v: 2, c: '#089981', on: false },
  { v: 2.272, c: '#ff9800', on: false },
  { v: 2.414, c: '#4caf50', on: false },
  { v: 3, c: '#00bcd4', on: false },
  { v: 3.272, c: '#787b86', on: false },
  { v: 3.414, c: '#2962ff', on: false },
  { v: 4, c: '#f23645', on: false },
  { v: 4.272, c: '#9c27b0', on: false },
  { v: 4.414, c: '#e91e63', on: false },
  { v: 4.618, c: '#ff9800', on: false },
  { v: 4.764, c: '#089981', on: false },
]

/** Most level rows a Fibonacci retracement keeps. */
export const MAX_FIB_ROWS = 30
const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** The retracement's settings, from its style. Drawings made before these settings keep their levels (all shown). */
export function fibSettings(style: DrawingStyle | undefined): FibSettings {
  const flag = (key: string, fallback: boolean) => (typeof style?.[key] === 'boolean' ? (style[key] as boolean) : fallback)
  let rows: FibLevelRow[]
  const stored = style?.fibRows
  if (Array.isArray(stored)) {
    rows = stored
      .flatMap((item) => {
        const row = item as { v?: unknown; c?: unknown; on?: unknown } | null
        if (!row || typeof row.v !== 'number' || !Number.isFinite(row.v) || row.v < -5 || row.v > 10) return []
        return [{ v: row.v, c: typeof row.c === 'string' && HEX_COLOR.test(row.c) ? row.c : '#787b86', on: row.on !== false }]
      })
      .slice(0, MAX_FIB_ROWS)
  } else if (Array.isArray(style?.fibLevels)) {
    rows = fibLevels(style).map((v) => ({ v, c: TV_FIB_ROWS.find((row) => row.v === v)?.c ?? '#787b86', on: true }))
  } else {
    // Older drawings without settings show the levels they always showed.
    rows = [...FIB_LEVELS].map((v) => ({ ...(TV_FIB_ROWS.find((row) => row.v === v) ?? { v, c: '#787b86', on: true }), on: true }))
  }
  const oneColor = typeof style?.fibOneColor === 'string' && HEX_COLOR.test(style.fibOneColor) ? style.fibOneColor : null
  return {
    rows,
    trend: flag('fibTrend', true),
    extendLeft: flag('fibExtendLeft', false),
    extendRight: flag('fibExtendRight', false),
    background: flag('fibBackground', true),
    reverse: flag('fibReverse', false),
    prices: flag('fibPrices', true),
    levels: flag('fibLevelsText', true),
    percent: flag('fibPercent', false),
    labelSide: style?.fibLabelSide === 'right' ? 'right' : 'left',
    oneColor,
  }
}

/** "0.618" or "61.8%", for the labels and the settings. */
export function fibLevelText(level: number, percent: boolean): string {
  return percent ? `${Number((level * 100).toFixed(2))}%` : String(Number(level.toFixed(4)))
}
