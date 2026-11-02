// Time display like TradingView: everything in the user's time zone, time-axis labels on round times
// (06:00, 12:00…) with the day number at midnight, the month name on the 1st and the year in January,
// and a crosshair date such as "Mon 02 Nov '26  13:45".

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()
const offsets = new Map<string, number>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** Minutes the zone is ahead of UTC at that moment (DST included). Cached per hour: offsets only change on the hour. */
export function zoneOffsetMinutes(timestamp: number, timeZone: string): number {
  if (timeZone === 'UTC') return 0
  const hourStart = Math.floor(timestamp / HOUR_MS) * HOUR_MS
  const key = `${timeZone}|${hourStart}`
  const cached = offsets.get(key)
  if (cached !== undefined) return cached
  const parts = formatterFor(timeZone).formatToParts(hourStart)
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(field('year'), field('month') - 1, field('day'), field('hour') % 24, field('minute'))
  const offset = Math.round((asUtc - hourStart) / 60_000)
  if (offsets.size > 20_000) offsets.clear()
  offsets.set(key, offset)
  return offset
}

export interface LocalTime {
  readonly year: number
  /** 0 = January */
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  /** 0 = Sunday */
  readonly weekday: number
  /** Minutes since local midnight. */
  readonly minuteOfDay: number
}

export function localTime(timestamp: number, timeZone: string): LocalTime {
  const shifted = new Date(timestamp + zoneOffsetMinutes(timestamp, timeZone) * 60_000)
  const hour = shifted.getUTCHours()
  const minute = shifted.getUTCMinutes()
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour,
    minute,
    weekday: shifted.getUTCDay(),
    minuteOfDay: hour * 60 + minute,
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** "Mon 02 Nov '26  13:45", or without the time for daily and longer candles. */
export function formatCrosshairTime(timestamp: number, timeZone: string, intervalMs: number): string {
  const t = localTime(timestamp, timeZone)
  const date = `${WEEKDAYS[t.weekday]} ${pad(t.day)} ${MONTHS[t.month]} '${String(t.year).slice(-2)}`
  return intervalMs >= DAY_MS ? date : `${date}  ${pad(t.hour)}:${pad(t.minute)}`
}

/** Spacing candidates, smallest first: minutes within a day, then days, months and years. */
type Step = { readonly unit: 'minute' | 'day' | 'month' | 'year', readonly size: number, readonly approxMs: number }
const STEPS: readonly Step[] = [
  ...[1, 2, 3, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720].map((size) => ({ unit: 'minute' as const, size, approxMs: size * 60_000 })),
  ...[1, 2, 3, 5, 7, 10, 15].map((size) => ({ unit: 'day' as const, size, approxMs: size * DAY_MS })),
  ...[1, 2, 3, 6].map((size) => ({ unit: 'month' as const, size, approxMs: size * 30.44 * DAY_MS })),
  ...[1, 2, 5, 10].map((size) => ({ unit: 'year' as const, size, approxMs: size * 365.25 * DAY_MS })),
]

export interface TimeTick {
  readonly index: number
  readonly timestamp: number
  readonly text: string
  /** 4 year, 3 month, 2 day, 1 time of day: when labels crowd, the higher level wins. */
  readonly level: number
}

export interface TickOptions {
  /** Pixels per bar. */
  readonly barSpacePx: number
  /** Length of one candle. */
  readonly intervalMs: number
  readonly timeZone: string
  /** Least distance between two labels. */
  readonly minSpacingPx?: number
}

/**
 * Labels for the time axis. `bars` are consecutive candles in index order; include the one just left of the visible
 * range so that a boundary at the left edge is still recognised.
 */
export function buildTimeTicks(bars: ReadonlyArray<{ readonly index: number, readonly timestamp: number }>, options: TickOptions): TimeTick[] {
  const minSpacing = options.minSpacingPx ?? 72
  if (bars.length < 2 || options.barSpacePx <= 0) return []
  const step = STEPS.find((candidate) => candidate.approxMs >= options.intervalMs && (candidate.approxMs / options.intervalMs) * options.barSpacePx >= minSpacing)
    ?? STEPS[STEPS.length - 1]

  const candidates: TimeTick[] = []
  let previous = localTime(bars[0].timestamp, options.timeZone)
  for (let position = 1; position < bars.length; position += 1) {
    const bar = bars[position]
    const current = localTime(bar.timestamp, options.timeZone)
    let level = 0
    let text = ''
    if (current.year !== previous.year) {
      if (step.unit !== 'year' || current.year % step.size === 0) { level = 4; text = String(current.year) }
    } else if (current.month !== previous.month) {
      if (step.unit !== 'year' && (step.unit !== 'month' || current.month % step.size === 0)) { level = 3; text = MONTHS[current.month] }
    } else if (current.day !== previous.day) {
      if (step.unit === 'minute' || (step.unit === 'day' && (current.day - 1) % step.size === 0 && current.day + step.size / 2 <= 31)) {
        level = 2
        text = String(current.day)
      }
    } else if (step.unit === 'minute' && Math.floor(current.minuteOfDay / step.size) !== Math.floor(previous.minuteOfDay / step.size)) {
      level = 1
      text = `${pad(current.hour)}:${pad(current.minute)}`
    }
    if (level > 0) candidates.push({ index: bar.index, timestamp: bar.timestamp, text, level })
    previous = current
  }

  // Keep labels apart; where two crowd each other, keep the more important one.
  const kept: TimeTick[] = []
  for (const tick of candidates) {
    const last = kept[kept.length - 1]
    if (last && (tick.index - last.index) * options.barSpacePx < minSpacing) {
      if (tick.level > last.level) kept[kept.length - 1] = tick
      continue
    }
    kept.push(tick)
  }
  return kept
}
