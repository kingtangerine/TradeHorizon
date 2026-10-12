import { VWAP_ANCHORS, type VwapAnchor } from './vwap'

export type MovingAverageKind = 'sma' | 'ema'
export type VwapKind = 'vwap' | 'qvwap'
export type DominanceKey = 'btc' | 'usdt' | 'alt'

export interface MovingAverageSettings {
  readonly visible: boolean
  readonly periods: readonly number[]
}

export interface IndicatorSettings {
  readonly sma: MovingAverageSettings
  readonly ema: MovingAverageSettings
  readonly dominance: Readonly<Record<DominanceKey, boolean>>
  /** Volume-weighted average price, restarting every day, week, month, quarter or year (UTC). */
  readonly vwap: { readonly visible: boolean; readonly anchor: VwapAnchor }
  /** Quarterly VWAP: the volume-weighted average price since the start of the quarter. */
  readonly qvwap: { readonly visible: boolean }
}

export const MAX_MOVING_AVERAGE_PERIODS = 5
export const MAX_MOVING_AVERAGE_PERIOD = 500

export const DEFAULT_INDICATORS: IndicatorSettings = {
  sma: { visible: false, periods: [20] },
  ema: { visible: false, periods: [20] },
  dominance: { btc: false, usdt: false, alt: false },
  vwap: { visible: false, anchor: 'day' },
  qvwap: { visible: false },
}

export const MOVING_AVERAGE_LABELS: Readonly<Record<MovingAverageKind, string>> = {
  sma: 'SMA',
  ema: 'EMA',
}

export const MOVING_AVERAGE_COLORS: Readonly<Record<MovingAverageKind, readonly string[]>> = {
  sma: ['#f7c948', '#26a69a', '#ab47bc', '#8d6e63', '#78909c'],
  ema: ['#2962ff', '#ff9800', '#e91e63', '#00bcd4', '#9ccc65'],
}

export const VWAP_COLORS: Readonly<Record<VwapKind, string>> = { vwap: '#e040fb', qvwap: '#26c6da' }

export const DOMINANCE_LABELS: Readonly<Record<DominanceKey, string>> = {
  btc: 'BTC.D',
  usdt: 'USDT.D',
  alt: 'ALT.D',
}

export const DOMINANCE_DESCRIPTIONS: Readonly<Record<DominanceKey, string>> = {
  btc: 'Bitcoin dominance',
  usdt: 'Tether dominance',
  alt: 'Altcoin dominance',
}

export const DOMINANCE_COLORS: Readonly<Record<DominanceKey, string>> = {
  btc: '#f7931a',
  usdt: '#26a69a',
  alt: '#7e57c2',
}

export function parsePeriod(value: unknown): number | undefined {
  const period = typeof value === 'string' ? Number(value) : value
  return typeof period === 'number' && Number.isInteger(period) && period >= 1 && period <= MAX_MOVING_AVERAGE_PERIOD
    ? period
    : undefined
}

export function addMovingAveragePeriod(settings: MovingAverageSettings, period: number): MovingAverageSettings {
  if (settings.periods.includes(period)) return { ...settings, visible: true }
  if (settings.periods.length >= MAX_MOVING_AVERAGE_PERIODS) return settings
  return { visible: true, periods: [...settings.periods, period].sort((a, b) => a - b) }
}

export function removeMovingAveragePeriod(settings: MovingAverageSettings, period: number): MovingAverageSettings {
  const periods = settings.periods.filter((item) => item !== period)
  return { visible: periods.length > 0 && settings.visible, periods }
}

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

export function normalizeIndicators(value: unknown): IndicatorSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_INDICATORS
  const candidate = value as { sma?: unknown; ema?: unknown; dominance?: unknown; vwap?: { visible?: unknown; anchor?: unknown }; qvwap?: { visible?: unknown } }
  const dominance = (typeof candidate.dominance === 'object' && candidate.dominance !== null
    ? candidate.dominance
    : {}) as Partial<Record<DominanceKey, unknown>>
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
  }
}
