// The indicator library ("studies", TradingView's word): definitions, stored settings and the maths, all pure so it
// can be tested without the chart. studyIndicators.ts registers them with klinecharts.

/** The studies in the indicator library, in menu order. */
export const STUDY_TYPES = ['rsi', 'macd', 'bb', 'stochRsi', 'atr', 'ichimoku', 'supertrend', 'volumeProfile'] as const
/** One of the studies in STUDY_TYPES. */
export type StudyType = (typeof STUDY_TYPES)[number]

/** An adjustable study setting, with its default and allowed range. */
export interface StudyParam {
  readonly label: string
  readonly default: number
  readonly min: number
  readonly max: number
  /** Whole numbers unless a step is given. */
  readonly step?: number
}

/** One output line of a study and its default colour. */
export interface StudyLine {
  readonly key: string
  readonly label: string
  readonly color: string
}

/** How a study is described, set up and drawn. */
export interface StudyDefinition {
  readonly type: StudyType
  readonly name: string
  readonly short: string
  readonly description: string
  /** On the candles, or in its own pane below. */
  readonly pane: 'price' | 'separate'
  readonly params: readonly StudyParam[]
  readonly lines: readonly StudyLine[]
  /** Horizontal guide levels in the study's pane (RSI 70/30 …). */
  readonly levels?: readonly number[]
}

/** Every study's name, pane, settings, lines and guide levels. */
export const STUDIES: Readonly<Record<StudyType, StudyDefinition>> = {
  rsi: {
    type: 'rsi',
    name: 'Relative Strength Index',
    short: 'RSI',
    pane: 'separate',
    description: 'Momentum from 0 to 100; above 70 is often called overbought, below 30 oversold.',
    params: [{ label: 'Length', default: 14, min: 2, max: 200 }],
    lines: [{ key: 'rsi', label: 'RSI', color: '#7e57c2' }],
    levels: [70, 50, 30],
  },
  macd: {
    type: 'macd',
    name: 'MACD',
    short: 'MACD',
    pane: 'separate',
    description: 'Difference of a fast and a slow EMA, its signal line and the histogram between them.',
    params: [
      { label: 'Fast length', default: 12, min: 1, max: 200 },
      { label: 'Slow length', default: 26, min: 2, max: 400 },
      { label: 'Signal length', default: 9, min: 1, max: 100 },
    ],
    lines: [
      { key: 'macd', label: 'MACD', color: '#2962ff' },
      { key: 'signal', label: 'Signal', color: '#ff6d00' },
      { key: 'histogram', label: 'Histogram', color: '#26a69a' },
    ],
    levels: [0],
  },
  bb: {
    type: 'bb',
    name: 'Bollinger Bands',
    short: 'BB',
    pane: 'price',
    description: 'A moving average with bands a number of standard deviations above and below it.',
    params: [
      { label: 'Length', default: 20, min: 2, max: 400 },
      { label: 'Standard deviations', default: 2, min: 0.1, max: 10, step: 0.1 },
    ],
    lines: [
      { key: 'basis', label: 'Basis', color: '#ff6d00' },
      { key: 'upper', label: 'Upper', color: '#2962ff' },
      { key: 'lower', label: 'Lower', color: '#2962ff' },
    ],
  },
  stochRsi: {
    type: 'stochRsi',
    name: 'Stochastic RSI',
    short: 'Stoch RSI',
    pane: 'separate',
    description: 'The stochastic oscillator applied to RSI: where RSI sits in its recent range, smoothed.',
    params: [
      { label: 'K smoothing', default: 3, min: 1, max: 50 },
      { label: 'D smoothing', default: 3, min: 1, max: 50 },
      { label: 'RSI length', default: 14, min: 2, max: 200 },
      { label: 'Stochastic length', default: 14, min: 2, max: 200 },
    ],
    lines: [
      { key: 'k', label: 'K', color: '#2962ff' },
      { key: 'd', label: 'D', color: '#ff6d00' },
    ],
    levels: [80, 50, 20],
  },
  atr: {
    type: 'atr',
    name: 'Average True Range',
    short: 'ATR',
    pane: 'separate',
    description: 'Average size of a candle including gaps: how much the price usually moves per candle.',
    params: [{ label: 'Length', default: 14, min: 1, max: 200 }],
    lines: [{ key: 'atr', label: 'ATR', color: '#b71c1c' }],
  },
  ichimoku: {
    type: 'ichimoku',
    name: 'Ichimoku Cloud',
    short: 'Ichimoku',
    pane: 'price',
    description: 'Conversion and base lines, a lagging span and a cloud between two leading spans.',
    params: [
      { label: 'Conversion line length', default: 9, min: 1, max: 200 },
      { label: 'Base line length', default: 26, min: 1, max: 200 },
      { label: 'Leading span B length', default: 52, min: 1, max: 400 },
      { label: 'Displacement', default: 26, min: 1, max: 200 },
    ],
    lines: [
      { key: 'conversion', label: 'Conversion', color: '#2962ff' },
      { key: 'base', label: 'Base', color: '#b71c1c' },
      { key: 'lagging', label: 'Lagging span', color: '#43a047' },
      { key: 'spanA', label: 'Leading span A', color: '#a5d6a7' },
      { key: 'spanB', label: 'Leading span B', color: '#ef9a9a' },
    ],
  },
  supertrend: {
    type: 'supertrend',
    name: 'Supertrend',
    short: 'Supertrend',
    pane: 'price',
    description: 'A trailing line from ATR: below the price in an uptrend, above it in a downtrend.',
    params: [
      { label: 'ATR length', default: 10, min: 1, max: 200 },
      { label: 'Factor', default: 3, min: 0.1, max: 20, step: 0.1 },
    ],
    lines: [
      { key: 'up', label: 'Up trend', color: '#089981' },
      { key: 'down', label: 'Down trend', color: '#f23645' },
    ],
  },
  volumeProfile: {
    type: 'volumeProfile',
    name: 'Volume Profile (visible range)',
    short: 'VPVR',
    pane: 'price',
    description: 'How much was traded at each price on the candles on screen; the widest row is the point of control.',
    params: [
      { label: 'Rows', default: 24, min: 6, max: 120 },
      { label: 'Width (% of chart)', default: 30, min: 5, max: 80 },
    ],
    lines: [
      { key: 'up', label: 'Up volume', color: '#089981' },
      { key: 'down', label: 'Down volume', color: '#f23645' },
      { key: 'poc', label: 'Point of control', color: '#ffd600' },
    ],
  },
}

/** A study on the chart, as stored in the workspace. */
export interface Study {
  readonly id: string
  readonly type: StudyType
  readonly params: readonly number[]
  readonly colors: readonly string[]
  readonly visible: boolean
}

/** Most studies one chart can show. */
export const MAX_STUDIES = 10

/** True when the value is a known study type. */
export function isStudyType(value: unknown): value is StudyType {
  return typeof value === 'string' && (STUDY_TYPES as readonly string[]).includes(value)
}

/** A new visible study with default settings and colours. */
export function newStudy(type: StudyType, id: string): Study {
  const definition = STUDIES[type]
  return {
    id,
    type,
    params: definition.params.map((param) => param.default),
    colors: definition.lines.map((line) => line.color),
    visible: true,
  }
}

/** A param clamped to its limits (and to whole numbers unless it has a step). */
export function clampParam(param: StudyParam, value: number): number {
  if (!Number.isFinite(value)) return param.default
  const stepped = param.step ? Math.round(value / param.step) * param.step : Math.round(value)
  return Math.min(param.max, Math.max(param.min, Number(stepped.toFixed(4))))
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** Cleans saved studies: drops unknown or duplicate ones, clamps settings, fixes colours, keeps at most MAX_STUDIES. */
export function normalizeStudies(value: unknown): Study[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: Study[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    if (!isStudyType(item.type) || typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 64 || seen.has(item.id)) continue
    const definition = STUDIES[item.type]
    const params = definition.params.map((param, index) =>
      clampParam(
        param,
        Array.isArray(item.params) && typeof item.params[index] === 'number' ? (item.params[index] as number) : param.default,
      ),
    )
    const colors = definition.lines.map((line, index) =>
      Array.isArray(item.colors) && typeof item.colors[index] === 'string' && HEX.test(item.colors[index] as string)
        ? (item.colors[index] as string)
        : line.color,
    )
    seen.add(item.id)
    result.push({ id: item.id, type: item.type, params, colors, visible: item.visible !== false })
    if (result.length >= MAX_STUDIES) break
  }
  return result
}

/** "RSI 14", "BB 20 2" */
export function studyLabel(study: Pick<Study, 'type' | 'params'>): string {
  return `${STUDIES[study.type].short} ${study.params.join(' ')}`
}

// ---------------------------------------------------------------------------------------------------------------
// Maths. Every function returns one entry per input bar; undefined until there is enough history.

/** One candle as the study maths needs it. */
export interface Bar {
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume?: number
}

type Series = Array<number | undefined>

/** Wilder's moving average (RMA), as TradingView uses for RSI and ATR. */
function rma(values: Readonly<Series>, length: number): Series {
  const out: Series = new Array(values.length).fill(undefined)
  let sum = 0
  let count = 0
  let previous: number | undefined
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === undefined) continue
    if (previous === undefined) {
      sum += value
      count += 1
      if (count === length) {
        previous = sum / length
        out[index] = previous
      }
    } else {
      previous = (previous * (length - 1) + value) / length
      out[index] = previous
    }
  }
  return out
}

/** Exponential moving average seeded with the SMA of the first `length` values; undefined until then. Gaps are skipped. */
export function ema(values: Readonly<Series>, length: number): Series {
  const out: Series = new Array(values.length).fill(undefined)
  const alpha = 2 / (length + 1)
  let sum = 0
  let count = 0
  let previous: number | undefined
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === undefined) continue
    if (previous === undefined) {
      sum += value
      count += 1
      if (count === length) {
        previous = sum / length
        out[index] = previous
      }
    } else {
      previous = alpha * value + (1 - alpha) * previous
      out[index] = previous
    }
  }
  return out
}

/** Simple moving average over `length` values; undefined until enough history, restarting after a gap. */
export function sma(values: Readonly<Series>, length: number): Series {
  const out: Series = new Array(values.length).fill(undefined)
  let sum = 0
  const window: number[] = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === undefined) {
      window.length = 0
      sum = 0
      continue
    }
    window.push(value)
    sum += value
    if (window.length > length) sum -= window.shift()!
    if (window.length === length) out[index] = sum / length
  }
  return out
}

/** RSI (0–100) with Wilder smoothing, as TradingView computes it; undefined until enough history. */
export function rsi(closes: readonly number[], length: number): Series {
  const gains: Series = [undefined]
  const losses: Series = [undefined]
  for (let index = 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1]
    gains.push(Math.max(change, 0))
    losses.push(Math.max(-change, 0))
  }
  const up = rma(gains, length)
  const down = rma(losses, length)
  return closes.map((_, index) => {
    const u = up[index]
    const d = down[index]
    if (u === undefined || d === undefined) return undefined
    if (d === 0) return u === 0 ? 50 : 100
    return 100 - 100 / (1 + u / d)
  })
}

/** MACD line (fast EMA minus slow EMA), its signal EMA and the histogram; fields undefined until enough history. */
export function macd(
  closes: readonly number[],
  fast: number,
  slow: number,
  signalLength: number,
): Array<{ macd?: number; signal?: number; histogram?: number }> {
  const fastLine = ema(closes, fast)
  const slowLine = ema(closes, slow)
  const line: Series = closes.map((_, index) =>
    fastLine[index] !== undefined && slowLine[index] !== undefined ? fastLine[index]! - slowLine[index]! : undefined,
  )
  const signal = ema(line, signalLength)
  return line.map((value, index) => ({
    macd: value,
    signal: signal[index],
    histogram: value !== undefined && signal[index] !== undefined ? value - signal[index]! : undefined,
  }))
}

/** Bollinger Bands: SMA basis and upper/lower bands `deviations` standard deviations away; empty until enough history. */
export function bollinger(
  closes: readonly number[],
  length: number,
  deviations: number,
): Array<{ basis?: number; upper?: number; lower?: number }> {
  const basis = sma(closes, length)
  return closes.map((_, index) => {
    const middle = basis[index]
    if (middle === undefined) return {}
    let sum = 0
    for (let offset = index - length + 1; offset <= index; offset += 1) sum += (closes[offset] - middle) ** 2
    const spread = Math.sqrt(sum / length) * deviations
    return { basis: middle, upper: middle + spread, lower: middle - spread }
  })
}

/** Stochastic RSI: %K (smoothed stochastic of RSI) and %D (SMA of %K), 0–100; undefined until enough history. */
export function stochRsi(
  closes: readonly number[],
  kSmoothing: number,
  dSmoothing: number,
  rsiLength: number,
  stochLength: number,
): Array<{ k?: number; d?: number }> {
  const values = rsi(closes, rsiLength)
  const raw: Series = values.map((value, index) => {
    if (value === undefined || index < stochLength - 1) return undefined
    let low = Infinity
    let high = -Infinity
    for (let offset = index - stochLength + 1; offset <= index; offset += 1) {
      const item = values[offset]
      if (item === undefined) return undefined
      low = Math.min(low, item)
      high = Math.max(high, item)
    }
    return high === low ? 0 : ((value - low) / (high - low)) * 100
  })
  const k = sma(raw, kSmoothing)
  const d = sma(k, dSmoothing)
  const bound = (value: number | undefined) => (value === undefined ? undefined : Math.min(100, Math.max(0, value)))
  return closes.map((_, index) => ({ k: bound(k[index]), d: bound(d[index]) }))
}

function trueRanges(bars: readonly Bar[]): number[] {
  return bars.map((bar, index) =>
    index === 0
      ? bar.high - bar.low
      : Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index - 1].close), Math.abs(bar.low - bars[index - 1].close)),
  )
}

/** Average True Range with Wilder smoothing, in price units; undefined until enough history. */
export function atr(bars: readonly Bar[], length: number): Series {
  return rma(trueRanges(bars), length)
}

/** Midpoint of the highest high and lowest low over `length` bars ending at each bar. */
function donchianMid(bars: readonly Bar[], length: number): Series {
  return bars.map((_, index) => {
    if (index < length - 1) return undefined
    let high = -Infinity
    let low = Infinity
    for (let offset = index - length + 1; offset <= index; offset += 1) {
      high = Math.max(high, bars[offset].high)
      low = Math.min(low, bars[offset].low)
    }
    return (high + low) / 2
  })
}

/**
 * Ichimoku. The leading spans are drawn `displacement` bars ahead and the lagging span the same distance back;
 * here they are shifted onto existing bars (span values at bar i were computed at bar i - displacement).
 */
export function ichimoku(
  bars: readonly Bar[],
  conversionLength: number,
  baseLength: number,
  spanBLength: number,
  displacement: number,
): Array<{ conversion?: number; base?: number; lagging?: number; spanA?: number; spanB?: number }> {
  const conversion = donchianMid(bars, conversionLength)
  const base = donchianMid(bars, baseLength)
  const spanBRaw = donchianMid(bars, spanBLength)
  const shift = displacement - 1
  return bars.map((_, index) => {
    const from = index - shift
    const spanA =
      from >= 0 && conversion[from] !== undefined && base[from] !== undefined ? (conversion[from]! + base[from]!) / 2 : undefined
    const spanB = from >= 0 ? spanBRaw[from] : undefined
    const lagging = index + shift < bars.length ? bars[index + shift].close : undefined
    return { conversion: conversion[index], base: base[index], lagging, spanA, spanB }
  })
}

/** Supertrend: `up` holds the line while the trend is up (below price), `down` while it is down. */
export function supertrend(bars: readonly Bar[], atrLength: number, factor: number): Array<{ up?: number; down?: number }> {
  const range = atr(bars, atrLength)
  const result: Array<{ up?: number; down?: number }> = []
  let finalUpper = 0
  let finalLower = 0
  let trend: 1 | -1 = 1
  let started = false
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index]
    const value = range[index]
    if (value === undefined) {
      result.push({})
      continue
    }
    const middle = (bar.high + bar.low) / 2
    const basicUpper = middle + factor * value
    const basicLower = middle - factor * value
    const previousClose = index > 0 ? bars[index - 1].close : bar.close
    if (!started) {
      finalUpper = basicUpper
      finalLower = basicLower
      trend = bar.close >= middle ? 1 : -1
      started = true
    } else {
      finalUpper = basicUpper < finalUpper || previousClose > finalUpper ? basicUpper : finalUpper
      finalLower = basicLower > finalLower || previousClose < finalLower ? basicLower : finalLower
      if (trend === -1 && bar.close > finalUpper) trend = 1
      else if (trend === 1 && bar.close < finalLower) trend = -1
    }
    result.push(trend === 1 ? { up: finalLower } : { down: finalUpper })
  }
  return result
}

/** One price row of a volume profile: its price range and the up/down volume traded in it. */
export interface ProfileRow {
  readonly low: number
  readonly high: number
  readonly up: number
  readonly down: number
}

/** Volume per price row over some candles; each candle's volume is spread evenly over the rows its range covers. */
export function volumeProfile(bars: readonly Bar[], rows: number): { rows: ProfileRow[]; pocIndex: number } | undefined {
  if (bars.length === 0 || rows < 1) return undefined
  let low = Infinity
  let high = -Infinity
  for (const bar of bars) {
    low = Math.min(low, bar.low)
    high = Math.max(high, bar.high)
  }
  if (!(high > low)) return undefined
  const size = (high - low) / rows
  const profile = Array.from({ length: rows }, (_, index) => ({ low: low + index * size, high: low + (index + 1) * size, up: 0, down: 0 }))
  for (const bar of bars) {
    const volume = bar.volume ?? 0
    if (volume <= 0) continue
    const first = Math.min(rows - 1, Math.floor((bar.low - low) / size))
    const last = Math.min(rows - 1, Math.floor((bar.high - low) / size))
    const share = volume / (last - first + 1)
    for (let row = first; row <= last; row += 1) {
      if (bar.close >= bar.open) profile[row].up += share
      else profile[row].down += share
    }
  }
  let pocIndex = 0
  profile.forEach((row, index) => {
    if (row.up + row.down > profile[pocIndex].up + profile[pocIndex].down) pocIndex = index
  })
  return { rows: profile, pocIndex }
}
