import { describe, expect, it } from 'vitest'
import { describeData, deviceFrom, ensureRevisions, fingerprint, itemsSince, latestRevision, storeValue, writeValue } from './userdata.mjs'
import { fingerprint as appFingerprint } from '../src/app/syncMerge.ts'

describe('user data revisions', () => {
  it('gives revisions to items stored before revisions existed', () => {
    const data = { 'layouts:v1': { value: '[]', updatedAtMs: 1 }, 'theme:v1': { value: 'dark', updatedAtMs: 2, rev: 4 } }
    expect(ensureRevisions(data)).toBe(true)
    expect(data['layouts:v1'].rev).toBe(5)
    expect(ensureRevisions(data)).toBe(false)
    expect(latestRevision(data)).toBe(5)
  })

  it('accepts a write based on the current revision and counts up per user', () => {
    const data = {}
    const first = writeValue(data, 'layouts:v1', '[1]', 0, 10)
    expect(first).toMatchObject({ status: 'ok', item: { value: '[1]', rev: 1, updatedAtMs: 10 } })
    expect(writeValue(data, 'theme:v1', 'dark', 0).item.rev).toBe(2)
    expect(writeValue(data, 'layouts:v1', '[1,2]', 1).item.rev).toBe(3)
  })

  it('refuses a write based on an older copy and returns the current one to merge with', () => {
    const data = {}
    writeValue(data, 'layouts:v1', 'desktop-20', 0)
    writeValue(data, 'layouts:v1', 'desktop-21', 1)
    const stale = writeValue(data, 'layouts:v1', 'laptop-15', 1)
    expect(stale).toEqual({ status: 'conflict', item: data['layouts:v1'] })
    expect(data['layouts:v1'].value).toBe('desktop-21')
    // A device that never had the item cannot blindly replace it either.
    expect(writeValue(data, 'layouts:v1', 'fresh', 0).status).toBe('conflict')
  })

  it('refuses writes from tabs still running the old app (no base revision)', () => {
    const data = { 'layouts:v1': { value: 'x', updatedAtMs: 1, rev: 1 } }
    expect(writeValue(data, 'layouts:v1', 'old tab', undefined).status).toBe('outdated')
    expect(data['layouts:v1'].value).toBe('x')
  })

  it('does not make a new revision when the value is unchanged', () => {
    const data = {}
    writeValue(data, 'k', 'v', 0)
    expect(writeValue(data, 'k', 'v', 1).item.rev).toBe(1)
  })

  it('lists only items changed after a revision', () => {
    const data = {}
    writeValue(data, 'a', '1', 0)
    writeValue(data, 'b', '2', 0)
    storeValue(data, 'a', '3')
    expect(Object.keys(itemsSince(data, 0)).sort()).toEqual(['a', 'b'])
    expect(Object.keys(itemsSince(data, 2))).toEqual(['a'])
    expect(itemsSince(data, 3)).toEqual({})
  })
})

describe('sync check data', () => {
  it('records which device wrote an item and describes items without their values', () => {
    const data = {}
    writeValue(data, 'layouts:v1', '[1,2,3]', 0, 50, deviceFrom({ id: 'device-abc', name: 'Windows · Chrome' }))
    storeValue(data, 'alerts:v1', '[]', 60)
    expect(describeData(data)).toEqual({
      'layouts:v1': { rev: 1, updatedAtMs: 50, size: 7, hash: fingerprint('[1,2,3]'), by: 'device-abc', byName: 'Windows · Chrome' },
      'alerts:v1': { rev: 2, updatedAtMs: 60, size: 2, hash: fingerprint('[]'), by: 'server', byName: 'TradeHorizon server' },
    })
  })

  it('cleans up device details sent by the app', () => {
    expect(deviceFrom(undefined)).toEqual({ id: 'unknown', name: 'Unknown device' })
    expect(deviceFrom({ id: '../x', name: '  ' })).toEqual({ id: 'unknown', name: 'Unknown device' })
    expect(deviceFrom({ id: 'abcdef12', name: 'x'.repeat(100) }).name).toHaveLength(60)
  })

  it('fingerprints exactly like the app does', () => {
    for (const text of ['', 'dark', '[{"id":"a","name":"Ünïcode ✓"}]']) expect(fingerprint(text)).toBe(appFingerprint(text))
  })
})
