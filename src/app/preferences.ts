// Per-user chart preferences (synced with the account like the rest of the user's data).

export interface Preferences {
  /** Time left until the current candle closes, under the last price on the axis. */
  readonly candleCountdown: boolean
  /** Price alerts drawn as lines on the chart. */
  readonly alertLines: boolean
  /** "auto" (the computer's zone, the default) or an IANA zone such as "Asia/Dubai". */
  readonly timeZone: string
  /** Labels at the highest and lowest visible price (TradingView keeps them off by default). */
  readonly highLowLabels: boolean
  /** Colours and canvas of the chart (chart settings window). */
  readonly appearance: ChartAppearance
  /** Starred rows of the Indicators window ("study:rsi", "builtin:ema", "script:<id>" …). */
  readonly favoriteIndicators: readonly string[]
}

export type GridLines = 'both' | 'vertical' | 'horizontal' | 'none'

export interface ChartAppearance {
  readonly upColor: string
  readonly downColor: string
  readonly wicks: boolean
  /** null: the theme's background. */
  readonly background: string | null
  readonly grid: GridLines
  readonly lastPriceLine: boolean
}

export const DEFAULT_APPEARANCE: ChartAppearance = { upColor: '#089981', downColor: '#f23645', wicks: true, background: null, grid: 'both', lastPriceLine: true }

export const DEFAULT_PREFERENCES: Preferences = { candleCountdown: true, alertLines: true, timeZone: 'auto', highLowLabels: false, appearance: DEFAULT_APPEARANCE, favoriteIndicators: [] }

const COLOR = /^#[0-9a-fA-F]{6}$/

export function parseAppearance(value: unknown): ChartAppearance {
  if (typeof value !== 'object' || value === null) return DEFAULT_APPEARANCE
  const raw = value as Record<string, unknown>
  const color = (key: 'upColor' | 'downColor') => (typeof raw[key] === 'string' && COLOR.test(raw[key] as string) ? raw[key] as string : DEFAULT_APPEARANCE[key])
  return {
    upColor: color('upColor'),
    downColor: color('downColor'),
    wicks: typeof raw.wicks === 'boolean' ? raw.wicks : DEFAULT_APPEARANCE.wicks,
    background: typeof raw.background === 'string' && COLOR.test(raw.background) ? raw.background : null,
    grid: raw.grid === 'vertical' || raw.grid === 'horizontal' || raw.grid === 'none' ? raw.grid : 'both',
    lastPriceLine: typeof raw.lastPriceLine === 'boolean' ? raw.lastPriceLine : DEFAULT_APPEARANCE.lastPriceLine,
  }
}

export function preferencesKey(userId: string): string {
  return `trade-horizon:user:${userId}:prefs:v1`
}

export function parsePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES
  const raw = value as Record<string, unknown>
  return {
    candleCountdown: typeof raw.candleCountdown === 'boolean' ? raw.candleCountdown : DEFAULT_PREFERENCES.candleCountdown,
    alertLines: typeof raw.alertLines === 'boolean' ? raw.alertLines : DEFAULT_PREFERENCES.alertLines,
    timeZone: typeof raw.timeZone === 'string' && raw.timeZone.length <= 64 ? raw.timeZone : DEFAULT_PREFERENCES.timeZone,
    highLowLabels: typeof raw.highLowLabels === 'boolean' ? raw.highLowLabels : DEFAULT_PREFERENCES.highLowLabels,
    appearance: parseAppearance(raw.appearance),
    favoriteIndicators: Array.isArray(raw.favoriteIndicators) ? [...new Set(raw.favoriteIndicators.filter((item): item is string => typeof item === 'string' && item.length <= 80))].slice(0, 100) : [],
  }
}

export function loadPreferences(userId: string): Preferences {
  try {
    return parsePreferences(JSON.parse(localStorage.getItem(preferencesKey(userId)) ?? 'null'))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(userId: string, preferences: Preferences): void {
  try {
    localStorage.setItem(preferencesKey(userId), JSON.stringify(preferences))
  } catch {
    // Storage full or blocked: the choice is simply not remembered.
  }
}
