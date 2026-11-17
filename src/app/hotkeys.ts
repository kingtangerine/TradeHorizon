// TradingView's typing shortcuts: start typing a ticker anywhere on the chart to search for it, or a number to change
// the timeframe ("15" then Enter = 15 minutes, "60" or "1h" = 1 hour, "4h", "1d"/"D", "1w"/"W", "1M" = 1 month).
import { MARKET_INTERVALS, type MarketInterval } from '../market'

/** The timeframe typed, or undefined when it is not one the exchange offers. Lower-case m is minutes, upper-case M months. */
export function parseIntervalInput(text: string): MarketInterval | undefined {
  const match = /^(\d*)\s*([mhdwHDWM]?)$/.exec(text.trim())
  if (!match || (match[1] === '' && match[2] === '')) return undefined
  const count = match[1] === '' ? 1 : Number(match[1])
  if (!Number.isSafeInteger(count) || count <= 0) return undefined
  const unit = match[2]
  let candidate: string
  if (unit === '' || unit === 'm') {
    // Plain numbers are minutes; whole hours and days become those units, like TradingView's 60 -> 1h.
    if (count % 1440 === 0) candidate = `${count / 1440}d`
    else if (count % 60 === 0) candidate = `${count / 60}h`
    else candidate = `${count}m`
  } else if (unit === 'h' || unit === 'H') candidate = count % 24 === 0 ? `${count / 24}d` : `${count}h`
  else if (unit === 'd' || unit === 'D') candidate = count % 7 === 0 ? `${count / 7}w` : `${count}d`
  else if (unit === 'w' || unit === 'W') candidate = `${count}w`
  else candidate = `${count}M`
  return (MARKET_INTERVALS as readonly string[]).includes(candidate) ? (candidate as MarketInterval) : undefined
}

/** Characters that may follow the first digit in the timeframe box. */
export const INTERVAL_INPUT_CHARS = /^[0-9mhdwHDWM]$/

/** A plain key press meant for the chart (no modifier, not typed into a field). */
export function isChartTypingKey(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  target: EventTarget | null,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return false
  if (
    typeof HTMLElement !== 'undefined' &&
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
    return false
  return true
}

/** Alt shortcuts that are not drawing tools: Alt+R resets the chart view, Alt+A adds an alert (as in TradingView). */
export const RESERVED_ALT_KEYS: readonly string[] = ['R', 'A']
