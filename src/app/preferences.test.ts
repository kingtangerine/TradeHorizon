import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, parsePreferences } from './preferences'

describe('parsePreferences', () => {
  it('defaults the countdown to on', () => {
    expect(DEFAULT_PREFERENCES.candleCountdown).toBe(true)
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences({})).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences({ candleCountdown: 'yes' })).toEqual(DEFAULT_PREFERENCES)
  })

  it('keeps a saved choice', () => {
    expect(parsePreferences({ candleCountdown: false }).candleCountdown).toBe(false)
  })
})

describe('time zone and price-label preferences', () => {
  it('defaults to the computer time zone and no high/low labels, and keeps a saved choice', () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({ timeZone: 'auto', highLowLabels: false })
    expect(parsePreferences({ timeZone: 'Asia/Dubai', highLowLabels: true })).toMatchObject({ timeZone: 'Asia/Dubai', highLowLabels: true })
    expect(parsePreferences({ timeZone: 42 }).timeZone).toBe('auto')
  })
})
