import { describe, expect, it } from 'vitest'
import { DEFAULT_REPLAY_SPEED_MS, REPLAY_SPEEDS, replayStartCursor, replayTransitionCursor } from './replay'

describe('replayStartCursor', () => {
  const times = [100, 200, 300, 400]

  it('keeps every bar up to and including the chosen one', () => {
    expect(replayStartCursor(times, 200)).toBe(2)
    expect(replayStartCursor(times, 250)).toBe(2)
    expect(replayStartCursor(times, 100)).toBe(1)
  })

  it('refuses a start with nothing left to replay or nothing to show', () => {
    expect(replayStartCursor(times, 400)).toBeNull()
    expect(replayStartCursor(times, 9999)).toBeNull()
    expect(replayStartCursor(times, 50)).toBeNull()
    expect(replayStartCursor([], 100)).toBeNull()
  })
})

describe('replayTransitionCursor', () => {
  const times = [100, 200, 300, 400]

  it('keeps every bar up to and including the target timestamp', () => {
    expect(replayTransitionCursor(times, 200)).toBe(2)
    expect(replayTransitionCursor(times, 250)).toBe(2)
    expect(replayTransitionCursor(times, 100)).toBe(1)
  })

  it('shows all bars if target timestamp is at or past the latest bar', () => {
    expect(replayTransitionCursor(times, 400)).toBe(4)
    expect(replayTransitionCursor(times, 9999)).toBe(4)
  })

  it('shows at least 1 bar if target timestamp is before the first bar', () => {
    expect(replayTransitionCursor(times, 50)).toBe(1)
  })

  it('returns 0 for empty bars array', () => {
    expect(replayTransitionCursor([], 100)).toBe(0)
  })
})

describe('replay speeds', () => {
  it('offers the default speed and lists faster speeds as shorter delays', () => {
    expect(REPLAY_SPEEDS.some((speed) => speed.ms === DEFAULT_REPLAY_SPEED_MS)).toBe(true)
    const delays = REPLAY_SPEEDS.map((speed) => speed.ms)
    expect([...delays].sort((a, b) => b - a)).toEqual(delays)
  })
})

