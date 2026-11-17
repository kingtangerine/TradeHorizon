// Alert conditions, shared by the server (server/alerts.ts) and the app (src/app/alerts.ts), so both decide the
// same way when an alert fires. Older alerts have no `condition`: they are "crossing" in their `direction`.
//
// Conditions (TradingView's names):
//   crossing      price reaches the target from the other side (direction above = crossing up, below = down)
//   greater       price is above the target (fires at once if it already is)
//   less          price is below the target
//   enterChannel  price is between targetPrice and upperPrice
//   exitChannel   price is outside targetPrice..upperPrice
//   movePercent   price moved `percent` % within `windowMs` (direction above = up, below = down)
// A `line` ({ t1, p1, t2, p2 }) makes the target follow a trend line (extended past its ends) instead of a level.
// `frequency` 'everyTime' re-arms the alert once the condition is false again, at most once a minute.

export type AlertCondition = 'crossing' | 'greater' | 'less' | 'enterChannel' | 'exitChannel' | 'movePercent'

export interface AlertLineAnchors { readonly t1: number, readonly p1: number, readonly t2: number, readonly p2: number }

/** The fields of a stored alert that decide when it fires and how it is described. */
export interface AlertRuleFields {
  readonly id: string
  readonly symbol: string
  readonly targetPrice: number
  readonly direction: 'above' | 'below'
  readonly condition?: AlertCondition
  readonly upperPrice?: number
  readonly percent?: number
  readonly windowMs?: number
  readonly line?: AlertLineAnchors
  readonly frequency?: 'once' | 'everyTime'
  readonly expiresAtMs?: number
  readonly message?: string
  readonly lastTriggeredAtMs?: number
}

/** What the evaluator remembers about an alert between prices (see evaluateAlert). */
export interface AlertState { readonly met: boolean, readonly armed: boolean }

/** One evaluateAlert step: whether the alert fires now and the state to keep. */
export interface AlertEvaluation { readonly fire: boolean, readonly state: AlertState }

export const ALERT_CONDITIONS: readonly AlertCondition[] = ['crossing', 'greater', 'less', 'enterChannel', 'exitChannel', 'movePercent']
export const EVERY_TIME_COOLDOWN_MS = 60_000
export const MOVE_WINDOWS_MS: readonly number[] = [5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 3_600_000, 24 * 3_600_000]
export const MAX_MESSAGE_LENGTH = 200

/** Number.isFinite as a type guard (it is true only for finite numbers). */
const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value)
const isCondition = (value: unknown): value is AlertCondition => (ALERT_CONDITIONS as readonly unknown[]).includes(value)

export function conditionOf(alert: { readonly condition?: unknown } | null | undefined): AlertCondition {
  return isCondition(alert?.condition) ? alert.condition : 'crossing'
}

/** The target price now: a level, or the trend line's price at this moment. */
export function targetAt(alert: AlertRuleFields, nowMs: number): number {
  const line = alert?.line
  if (line && Number.isFinite(line.t1) && Number.isFinite(line.t2) && line.t1 !== line.t2 && Number.isFinite(line.p1) && Number.isFinite(line.p2)) {
    return line.p1 + ((line.p2 - line.p1) * (nowMs - line.t1)) / (line.t2 - line.t1)
  }
  return alert.targetPrice
}

/** Whether the condition holds at `price`. `referencePrice` is the price `windowMs` ago (movePercent only). */
export function conditionMet(alert: AlertRuleFields, price: number, nowMs: number, referencePrice?: number): boolean {
  const target = targetAt(alert, nowMs)
  switch (conditionOf(alert)) {
    case 'greater': return price > target
    case 'less': return price < target
    case 'enterChannel':
    case 'exitChannel': {
      const upper = isFiniteNumber(alert.upperPrice) ? alert.upperPrice : target
      const inside = price >= Math.min(target, upper) && price <= Math.max(target, upper)
      return conditionOf(alert) === 'enterChannel' ? inside : !inside
    }
    case 'movePercent': {
      if (!isFiniteNumber(referencePrice) || referencePrice <= 0 || !isFiniteNumber(alert.percent)) return false
      const change = ((price - referencePrice) / referencePrice) * 100
      return alert.direction === 'below' ? change <= -Math.abs(alert.percent) : change >= Math.abs(alert.percent)
    }
    default:
      return alert.direction === 'above' ? price >= target : price <= target
  }
}

/** Crossings fire on the move from not met to met; the other conditions fire whenever they hold (and are armed). */
export function firesOnTransition(alert: AlertRuleFields): boolean {
  return conditionOf(alert) === 'crossing'
}

export function isExpired(alert: Partial<AlertRuleFields> | undefined, nowMs: number): boolean {
  return isFiniteNumber(alert?.expiresAtMs) && nowMs > alert.expiresAtMs
}

/**
 * Decides one check. `state` is what the evaluator remembers about the alert: { met, armed } from the previous
 * price (undefined before the first one). Returns whether it fires now and the state to keep.
 */
export function evaluateAlert(alert: AlertRuleFields, price: number, nowMs: number, state: AlertState | undefined, referencePrice?: number): AlertEvaluation {
  const met = conditionMet(alert, price, nowMs, referencePrice)
  if (isExpired(alert, nowMs)) return { fire: false, state: { met, armed: false } }
  const everyTime = alert.frequency === 'everyTime'
  const cooling = everyTime && isFiniteNumber(alert.lastTriggeredAtMs) && nowMs - alert.lastTriggeredAtMs < EVERY_TIME_COOLDOWN_MS
  let armed: boolean
  if (firesOnTransition(alert)) {
    // Needs a previous price on the other side.
    armed = state !== undefined && state.met === false
  } else {
    armed = state === undefined ? true : state.armed || state.met === false
  }
  const fire = met && armed && !cooling
  return { fire, state: { met, armed: fire ? false : armed && !met ? true : armed } }
}

function plain(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(10))) : String(value)
}

/** "Crossing up 65000", "Entering 60000 – 62000", "Moving up 3% in 1h", plus "(trend line)". */
export function describeAlert(alert: AlertRuleFields): string {
  const condition = conditionOf(alert)
  const windowMs = alert.windowMs ?? 0
  const window = windowMs >= 3_600_000 ? `${windowMs / 3_600_000}h` : `${Math.round(windowMs / 60_000)}m`
  let text: string
  switch (condition) {
    case 'greater': text = `Greater than ${plain(alert.targetPrice)}`; break
    case 'less': text = `Less than ${plain(alert.targetPrice)}`; break
    case 'enterChannel': text = `Entering ${plain(Math.min(alert.targetPrice, alert.upperPrice ?? NaN))} – ${plain(Math.max(alert.targetPrice, alert.upperPrice ?? NaN))}`; break
    case 'exitChannel': text = `Exiting ${plain(Math.min(alert.targetPrice, alert.upperPrice ?? NaN))} – ${plain(Math.max(alert.targetPrice, alert.upperPrice ?? NaN))}`; break
    case 'movePercent': text = `Moving ${alert.direction === 'below' ? 'down' : 'up'} ${plain(Math.abs(alert.percent ?? NaN))}% in ${window}`; break
    default: text = `Crossing ${alert.direction === 'below' ? 'down' : 'up'} ${alert.line ? 'trend line' : plain(alert.targetPrice)}`
  }
  return alert.line && condition !== 'crossing' ? `${text} (trend line)` : text
}

/** Notification text: the user's own message when there is one. */
export function alertMessage(alert: AlertRuleFields, price: number): string {
  const custom = typeof alert.message === 'string' ? alert.message.trim().slice(0, MAX_MESSAGE_LENGTH) : ''
  return custom || `${describeAlert(alert)}: price ${plain(price)}.`
}

/** Shape checks for stored alerts (both sides ignore anything malformed). */
export function isValidAlert(value: unknown): value is AlertRuleFields {
  // Read as a bag of unknown fields; every one that matters is checked below.
  const alert = value as { readonly [field: string]: unknown } | null | undefined
  if (!alert || typeof alert.id !== 'string' || typeof alert.symbol !== 'string' || !Number.isFinite(alert.targetPrice)) return false
  if (alert.direction !== 'above' && alert.direction !== 'below') return false
  const condition = conditionOf(alert)
  if ((condition === 'enterChannel' || condition === 'exitChannel') && !isFiniteNumber(alert.upperPrice)) return false
  if (condition === 'movePercent' && (!isFiniteNumber(alert.percent) || !(Number(alert.windowMs) > 0))) return false
  return true
}
