import { describe, expect, it } from 'vitest'
import { AUTO_TIME_ZONE, TIME_ZONES, isValidTimeZone, offsetLabel, resolveTimeZone, timeZoneLabel } from './timeZones'

describe('time zones list', () => {
  it('only lists zones the browser knows', () => {
    for (const { zone } of TIME_ZONES) expect(isValidTimeZone(zone)).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
  })

  it('resolves "auto" and bad values to a real zone', () => {
    expect(resolveTimeZone('Asia/Dubai')).toBe('Asia/Dubai')
    expect(isValidTimeZone(resolveTimeZone(AUTO_TIME_ZONE))).toBe(true)
    expect(isValidTimeZone(resolveTimeZone('Mars/Olympus'))).toBe(true)
  })

  it('labels zones with their current offset', () => {
    const january = Date.UTC(2026, 0, 15)
    expect(offsetLabel('Asia/Dubai', january)).toBe('UTC+4')
    expect(offsetLabel('Asia/Kolkata', january)).toBe('UTC+5:30')
    expect(offsetLabel('America/New_York', january)).toBe('UTC−5')
    expect(timeZoneLabel('Asia/Dubai', january)).toBe('(UTC+4) Dubai')
    expect(timeZoneLabel('UTC', january)).toBe('UTC')
    expect(timeZoneLabel('Europe/Kyiv', january)).toBe('(UTC+2) Kyiv')
  })
})
