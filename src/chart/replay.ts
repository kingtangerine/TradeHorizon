export const REPLAY_SPEEDS = [
  { ms: 1000, label: '1x' },
  { ms: 500, label: '2x' },
  { ms: 250, label: '4x' },
  { ms: 100, label: '10x' },
] as const

export const DEFAULT_REPLAY_SPEED_MS = 500

/**
 * How many bars stay visible when a replay starts at `timestamp`: everything up to and
 * including the chosen bar. Returns null when there is nothing left to replay after it,
 * or nothing to show before it.
 */
export function replayStartCursor(barTimes: readonly number[], timestamp: number): number | null {
  let cursor = barTimes.findIndex((time) => time > timestamp)
  if (cursor === -1) cursor = barTimes.length
  return cursor >= 1 && cursor < barTimes.length ? cursor : null
}

/**
 * Resolves the replay cursor when transitioning an existing replay to a new set of bars (e.g. timeframe change).
 * Returns how many bars should be shown so that every bar up to and including `targetTimestamp` remains visible.
 * Ensures at least 1 bar is visible if bars are present.
 */
export function replayTransitionCursor(barTimes: readonly number[], targetTimestamp: number): number {
  if (barTimes.length === 0) return 0
  let cursor = barTimes.findIndex((time) => time > targetTimestamp)
  if (cursor === -1) cursor = barTimes.length
  return Math.max(1, cursor)
}

