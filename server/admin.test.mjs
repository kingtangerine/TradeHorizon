import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adminEmails, countItems, describeUserItems, folderSize, summarizeUserData } from './admin.mjs'

const item = (value, extra = {}) => ({ value: JSON.stringify(value), updatedAtMs: 100, rev: 1, ...extra })

describe('admin helpers', () => {
  it('reads the admin list from TH_ADMIN_EMAILS', () => {
    expect([...adminEmails(' Me@Example.com, ops@x.io ,')]).toEqual(['me@example.com', 'ops@x.io'])
    expect(adminEmails(undefined).size).toBe(0)
  })

  it('counts what each stored item holds', () => {
    expect(countItems('layouts:v1', JSON.stringify([{}, {}]))).toEqual({ layouts: 2 })
    expect(countItems('drawings:v1', JSON.stringify({ version: 1, drawings: [{}] }))).toEqual({ drawings: 1 })
    expect(countItems('alerts:v1', JSON.stringify([{ enabled: true }, { enabled: false }, { enabled: true, triggeredAtMs: 1 }]))).toEqual({ alerts: 3, activeAlerts: 1 })
    expect(countItems('theme:v1', 'dark')).toEqual({})
    expect(countItems('layouts:v1', 'not json')).toEqual({ layouts: 0 })
  })

  it('summarises a user: size, counts, last sync and devices, without content', () => {
    const data = {
      'layouts:v1': item([{ id: 'a' }, { id: 'b' }], { by: 'pc', byName: 'PC', updatedAtMs: 300 }),
      'drawings:v1': item({ version: 1, drawings: [{ id: 'd' }] }, { by: 'laptop', byName: 'Laptop', updatedAtMs: 200 }),
      'alerts:v1': item([{ id: 'x', enabled: true }], { by: 'server', updatedAtMs: 400 }),
    }
    const summary = summarizeUserData(data)
    expect(summary).toMatchObject({ items: 3, lastSyncAtMs: 400, counts: { layouts: 2, drawings: 1, alerts: 1, activeAlerts: 1 } })
    expect(summary.devices).toEqual([{ name: 'PC', lastSaveAtMs: 300 }, { name: 'Laptop', lastSaveAtMs: 200 }])
    expect(summary.bytes).toBe(Object.values(data).reduce((sum, entry) => sum + entry.value.length, 0))
    const items = describeUserItems(data)
    expect(items[0]).toMatchObject({ key: 'drawings:v1', savedBy: 'Laptop' })
    expect(items.find((entry) => entry.key === 'alerts:v1').savedBy).toBe('TradeHorizon server')
    expect(JSON.stringify(items)).not.toContain('"id"')
  })

  it('measures a folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'th-size-'))
    try {
      writeFileSync(join(dir, 'a'), 'x'.repeat(10))
      mkdirSync(join(dir, 'sub'))
      writeFileSync(join(dir, 'sub', 'b'), 'x'.repeat(5))
      expect(folderSize(dir)).toBe(15)
      expect(folderSize(join(dir, 'missing'))).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
