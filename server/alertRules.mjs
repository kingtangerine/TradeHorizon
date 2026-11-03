// Alert conditions, shared by the server (server/alerts.mjs) and the app (src/app/alerts.ts), so both decide the
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

export const ALERT_CONDITIONS = ['crossing', 'greater', 'less', 'enterChannel', 'exitChannel', 'movePercent']
export const EVERY_TIME_COOLDOWN_MS = 60_000
export const MOVE_WINDOWS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 3_600_000, 24 * 3_600_000]
export const MAX_MESSAGE_LENGTH = 200

export function conditionOf(alert) {
  return ALERT_CONDITIONS.includes(alert?.condition) ? alert.condition : 'crossing'
}

/** The target price now: a level, or the trend line's price at this moment. */
export function targetAt(alert, nowMs) {
  const line = alert?.line
  if (line && Number.isFinite(line.t1) && Number.isFinite(line.t2) && line.t1 !== line.t2 && Number.isFinite(line.p1) && Number.isFinite(line.p2)) {
    return line.p1 + ((line.p2 - line.p1) * (nowMs - line.t1)) / (line.t2 - line.t1)
  }
  return alert.targetPrice
}

/** Whether the condition holds at `price`. `referencePrice` is the price `windowMs` ago (movePercent only). */
export function conditionMet(alert, price, nowMs, referencePrice) {
  const target = targetAt(alert, nowMs)
  switch (conditionOf(alert)) {
    case 'greater': return price > target
    case 'less': return price < target
    case 'enterChannel':
    case 'exitChannel': {
      const upper = Number.isFinite(alert.upperPrice) ? alert.upperPrice : target
      const inside = price >= Math.min(target, upper) && price <= Math.max(target, upper)
      return conditionOf(alert) === 'enterChannel' ? inside : !inside
    }
    case 'movePercent': {
      if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(alert.percent)) return false
      const change = ((price - referencePrice) / referencePrice) * 100
      return alert.direction === 'below' ? change <= -Math.abs(alert.percent) : change >= Math.abs(alert.percent)
    }
    default:
      return alert.direction === 'above' ? price >= target : price <= target
  }
}

/** Crossings fire on the move from not met to met; the other conditions fire whenever they hold (and are armed). */
export function firesOnTransition(alert) {
  return conditionOf(alert) === 'crossing'
}

export function isExpired(alert, nowMs) {
  return Number.isFinite(alert?.expiresAtMs) && nowMs > alert.expiresAtMs
}

/**
 * Decides one check. `state` is what the evaluator remembers about the alert: { met, armed } from the previous
 * price (undefined before the first one). Returns whether it fires now and the state to keep.
 */
export function evaluateAlert(alert, price, nowMs, state, referencePrice) {
  const met = conditionMet(alert, price, nowMs, referencePrice)
  if (isExpired(alert, nowMs)) return { fire: false, state: { met, armed: false } }
  const everyTime = alert.frequency === 'everyTime'
  const cooling = everyTime && Number.isFinite(alert.lastTriggeredAtMs) && nowMs - alert.lastTriggeredAtMs < EVERY_TIME_COOLDOWN_MS
  let armed
  if (firesOnTransition(alert)) {
    // Needs a previous price on the other side.
    armed = state !== undefined && state.met === false
  } else {
    armed = state === undefined ? true : state.armed || state.met === false
  }
  const fire = met && armed && !cooling
  return { fire, state: { met, armed: fire ? false : armed && !met ? true : armed } }
}

function plain(value) {
  return Number.isFinite(value) ? String(Number(value.toPrecision(10))) : String(value)
}

/** "Crossing up 65000", "Entering 60000 – 62000", "Moving up 3% in 1h", plus "(trend line)". */
export function describeAlert(alert) {
  const condition = conditionOf(alert)
  const window = alert.windowMs >= 3_600_000 ? `${alert.windowMs / 3_600_000}h` : `${Math.round((alert.windowMs ?? 0) / 60_000)}m`
  let text
  switch (condition) {
    case 'greater': text = `Greater than ${plain(alert.targetPrice)}`; break
    case 'less': text = `Less than ${plain(alert.targetPrice)}`; break
    case 'enterChannel': text = `Entering ${plain(Math.min(alert.targetPrice, alert.upperPrice))} – ${plain(Math.max(alert.targetPrice, alert.upperPrice))}`; break
    case 'exitChannel': text = `Exiting ${plain(Math.min(alert.targetPrice, alert.upperPrice))} – ${plain(Math.max(alert.targetPrice, alert.upperPrice))}`; break
    case 'movePercent': text = `Moving ${alert.direction === 'below' ? 'down' : 'up'} ${plain(Math.abs(alert.percent))}% in ${window}`; break
    default: text = `Crossing ${alert.direction === 'below' ? 'down' : 'up'} ${alert.line ? 'trend line' : plain(alert.targetPrice)}`
  }
  return alert.line && condition !== 'crossing' ? `${text} (trend line)` : text
}

/** Notification text: the user's own message when there is one. */
export function alertMessage(alert, price) {
  const custom = typeof alert.message === 'string' ? alert.message.trim().slice(0, MAX_MESSAGE_LENGTH) : ''
  return custom || `${describeAlert(alert)}: price ${plain(price)}.`
}

/** Shape checks for stored alerts (both sides ignore anything malformed). */
export function isValidAlert(alert) {
  if (!alert || typeof alert.id !== 'string' || typeof alert.symbol !== 'string' || !Number.isFinite(alert.targetPrice)) return false
  if (alert.direction !== 'above' && alert.direction !== 'below') return false
  const condition = conditionOf(alert)
  if ((condition === 'enterChannel' || condition === 'exitChannel') && !Number.isFinite(alert.upperPrice)) return false
  if (condition === 'movePercent' && (!Number.isFinite(alert.percent) || !(alert.windowMs > 0))) return false
  return true
}
