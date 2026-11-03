// Per-drawing options stored in the drawing's style (so they sync and undo like any style change):
// which timeframes it shows on (TradingView's Visibility tab) and the levels of a Fibonacci retracement.
import type { DrawingStyle } from '../drawings'
import type { MarketInterval } from '../market'
import { FIB_LEVELS } from './geometry'

export const INTERVAL_GROUPS = ['minutes', 'hours', 'days', 'weeks', 'months'] as const
export type IntervalGroup = (typeof INTERVAL_GROUPS)[number]

export const INTERVAL_GROUP_LABELS: Readonly<Record<IntervalGroup, string>> = {
  minutes: 'Minutes', hours: 'Hours', days: 'Days', weeks: 'Weeks', months: 'Months',
}

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

export function visibleOnInterval(style: DrawingStyle | undefined, interval: MarketInterval): boolean {
  return !hiddenGroups(style).includes(intervalGroup(interval))
}

export const MAX_FIB_LEVELS = 16

/** The retracement's levels: the stored ones, or TradingView's defaults. Sorted, unique, between -5 and 10. */
export function fibLevels(style: DrawingStyle | undefined): number[] {
  const value = style?.fibLevels
  if (!Array.isArray(value)) return [...FIB_LEVELS]
  const levels = [...new Set(value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item >= -5 && item <= 10))]
    .sort((a, b) => a - b)
    .slice(0, MAX_FIB_LEVELS)
  return levels.length > 0 ? levels : [...FIB_LEVELS]
}
