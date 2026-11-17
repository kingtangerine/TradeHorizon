import { VWAP_ANCHORS, type VwapAnchor } from './vwap'
import { normalizeStudies, type Study } from './studies'
import { normalizeCompare } from './compare'
import { MAX_SOURCE_LENGTH } from './script'

/** A user script on the chart: a copy of its source (so layouts carry it) and the inputs chosen for this chart. */
export interface ScriptInstance {
  readonly id: string
  /** The script in "My scripts" it came from (edits there update this copy). */
  readonly scriptId: string
  readonly name: string
  readonly source: string
  readonly inputs: readonly number[]
  readonly visible: boolean
}

/** Most user scripts one chart can show. */
export const MAX_SCRIPT_INSTANCES = 10

/** Cleans saved script instances: drops malformed or duplicate ones and keeps at most MAX_SCRIPT_INSTANCES. */
export function normalizeScriptInstances(value: unknown): ScriptInstance[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .filter((item): item is ScriptInstance => {
      const candidate = item as ScriptInstance | null
      if (
        !candidate ||
        typeof candidate.id !== 'string' ||
        seen.has(candidate.id) ||
        typeof candidate.source !== 'string' ||
        candidate.source.length > MAX_SOURCE_LENGTH
      )
        return false
      seen.add(candidate.id)
      return true
    })
    .slice(0, MAX_SCRIPT_INSTANCES)
    .map((item) => ({
      id: item.id,
      scriptId: typeof item.scriptId === 'string' ? item.scriptId : item.id,
      name: typeof item.name === 'string' ? item.name.slice(0, 60) : 'My script',
      source: item.source,
      inputs: Array.isArray(item.inputs)
        ? item.inputs.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).slice(0, 32)
        : [],
      visible: item.visible !== false,
    }))
}

/** Moving average type: simple or exponential. */
export type MovingAverageKind = 'sma' | 'ema'
/** VWAP line: anchored VWAP or the quarterly VWAP. */
export type VwapKind = 'vwap' | 'qvwap'
/** Dominance line: Bitcoin, Tether or altcoins. */
export type DominanceKey = 'btc' | 'usdt' | 'alt'

/** A moving average's on/off switch and its periods (in bars). */
export interface MovingAverageSettings {
  readonly visible: boolean
  readonly periods: readonly number[]
}

/** Every indicator setting of one chart, as saved with the layout. */
export interface IndicatorSettings {
  readonly sma: MovingAverageSettings
  readonly ema: MovingAverageSettings
  readonly dominance: Readonly<Record<DominanceKey, boolean>>
  /** Volume-weighted average price, restarting every day, week, month, quarter or year (UTC). */
  readonly vwap: { readonly visible: boolean; readonly anchor: VwapAnchor }
  /** Quarterly VWAP: the volume-weighted average price since the start of the quarter. */
  readonly qvwap: { readonly visible: boolean }
  /** Indicator library: RSI, MACD, Bollinger Bands … (studies.ts). */
  readonly studies: readonly Study[]
  /** Compare: other symbols drawn over the chart (compare.ts). */
  readonly compare: readonly string[]
  /** "My scripts" on the chart. */
  readonly scripts: readonly ScriptInstance[]
}

/** Most periods one moving-average type can have at once. */
export const MAX_MOVING_AVERAGE_PERIODS = 5
/** Longest moving-average period allowed, in bars. */
export const MAX_MOVING_AVERAGE_PERIOD = 500

/** Indicator settings of a new chart: everything off, SMA 20 and EMA 12 ready to switch on. */
export const DEFAULT_INDICATORS: IndicatorSettings = {
  sma: { visible: false, periods: [20] },
  ema: { visible: false, periods: [12] },
  dominance: { btc: false, usdt: false, alt: false },
  vwap: { visible: false, anchor: 'day' },
  qvwap: { visible: false },
  studies: [],
  compare: [],
  scripts: [],
}

/** Short labels for the moving-average types. */
export const MOVING_AVERAGE_LABELS: Readonly<Record<MovingAverageKind, string>> = {
  sma: 'SMA',
  ema: 'EMA',
}

/** Line colours per moving-average type, one per period slot. */
export const MOVING_AVERAGE_COLORS: Readonly<Record<MovingAverageKind, readonly string[]>> = {
  sma: ['#f7c948', '#26a69a', '#ab47bc', '#8d6e63', '#78909c'],
  ema: ['#2962ff', '#ff9800', '#e91e63', '#00bcd4', '#9ccc65'],
}

/** Line colours of the VWAP lines. */
export const VWAP_COLORS: Readonly<Record<VwapKind, string>> = { vwap: '#e040fb', qvwap: '#26c6da' }

/** Short labels of the dominance lines, also used as their indicator names. */
export const DOMINANCE_LABELS: Readonly<Record<DominanceKey, string>> = {
  btc: 'BTC.D',
  usdt: 'USDT.D',
  alt: 'ALT.D',
}

/** Full names of the dominance lines. */
export const DOMINANCE_DESCRIPTIONS: Readonly<Record<DominanceKey, string>> = {
  btc: 'Bitcoin dominance',
  usdt: 'Tether dominance',
  alt: 'Altcoin dominance',
}

/** Line colours of the dominance lines. */
export const DOMINANCE_COLORS: Readonly<Record<DominanceKey, string>> = {
  btc: '#f7931a',
  usdt: '#26a69a',
  alt: '#7e57c2',
}

/** A period from user input or saved settings: a whole number from 1 to MAX_MOVING_AVERAGE_PERIOD, else undefined. */
export function parsePeriod(value: unknown): number | undefined {
  const period = typeof value === 'string' ? Number(value) : value
  return typeof period === 'number' && Number.isInteger(period) && period >= 1 && period <= MAX_MOVING_AVERAGE_PERIOD ? period : undefined
}

/** Adds a period and switches the average on; unchanged when the period limit is reached. */
export function addMovingAveragePeriod(settings: MovingAverageSettings, period: number): MovingAverageSettings {
  if (settings.periods.includes(period)) return { ...settings, visible: true }
  if (settings.periods.length >= MAX_MOVING_AVERAGE_PERIODS) return settings
  return { visible: true, periods: [...settings.periods, period].sort((a, b) => a - b) }
}

/** Removes a period; the average switches off when none are left. */
export function removeMovingAveragePeriod(settings: MovingAverageSettings, period: number): MovingAverageSettings {
  const periods = settings.periods.filter((item) => item !== period)
  return { visible: periods.length > 0 && settings.visible, periods }
}

/** True when the average is switched on and has at least one period. */
export function movingAverageActive(settings: MovingAverageSettings): boolean {
  return settings.visible && settings.periods.length > 0
}

function normalizeMovingAverage(value: unknown, fallback: MovingAverageSettings): MovingAverageSettings {
  if (typeof value !== 'object' || value === null) return fallback
  const candidate = value as { visible?: unknown; periods?: unknown }
  const periods = Array.isArray(candidate.periods)
    ? [...new Set(candidate.periods.map(parsePeriod).filter((item): item is number => item !== undefined))]
        .sort((a, b) => a - b)
        .slice(0, MAX_MOVING_AVERAGE_PERIODS)
    : fallback.periods
  return { visible: candidate.visible === true && periods.length > 0, periods }
}

/** Validates saved indicator settings, falling back to the defaults for anything missing or malformed. */
export function normalizeIndicators(value: unknown): IndicatorSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_INDICATORS
  const candidate = value as {
    sma?: unknown
    ema?: unknown
    dominance?: unknown
    vwap?: { visible?: unknown; anchor?: unknown }
    qvwap?: { visible?: unknown }
    studies?: unknown
    compare?: unknown
    scripts?: unknown
  }
  const dominance = (typeof candidate.dominance === 'object' && candidate.dominance !== null ? candidate.dominance : {}) as Partial<
    Record<DominanceKey, unknown>
  >
  return {
    sma: normalizeMovingAverage(candidate.sma, DEFAULT_INDICATORS.sma),
    ema: normalizeMovingAverage(candidate.ema, DEFAULT_INDICATORS.ema),
    dominance: {
      btc: dominance.btc === true,
      usdt: dominance.usdt === true,
      alt: dominance.alt === true,
    },
    vwap: {
      visible: candidate.vwap?.visible === true,
      anchor: VWAP_ANCHORS.includes(candidate.vwap?.anchor as VwapAnchor) ? (candidate.vwap?.anchor as VwapAnchor) : 'day',
    },
    qvwap: { visible: candidate.qvwap?.visible === true },
    studies: normalizeStudies(candidate.studies),
    compare: normalizeCompare(candidate.compare),
    scripts: normalizeScriptInstances(candidate.scripts),
  }
}
