import { describe, expect, it } from 'vitest'
import { buildBackup, parseBackup, restoreBackup } from './dataTransfer'

function fakeStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries))
  return {
    get length() { return map.size },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    map,
  }
}

describe('data backup', () => {
  it('exports only the signed-in user\'s data, without the prefix', () => {
    const storage = fakeStorage({
      'trade-horizon:user:u1:layouts:v1': '[]',
      'trade-horizon:user:u1:drawings:v1': '{"a":1}',
      'trade-horizon:user:u2:layouts:v1': '[9]',
      'trade-horizon:session:v2': '{}',
    })
    const backup = buildBackup('u1', { email: 'a@b.c', displayName: 'A' }, storage, 5)
    expect(Object.keys(backup.items).sort()).toEqual(['drawings:v1', 'layouts:v1'])
    expect(backup.exportedAtMs).toBe(5)
  })

  it('round-trips through JSON into another account', () => {
    const source = fakeStorage({ 'trade-horizon:user:u1:layouts:v1': '[{"id":"x"}]' })
    const text = JSON.stringify(buildBackup('u1', { email: 'a@b.c', displayName: 'A' }, source))
    const target = fakeStorage({})
    expect(restoreBackup('u2', parseBackup(text), target)).toBe(1)
    expect(target.map.get('trade-horizon:user:u2:layouts:v1')).toBe('[{"id":"x"}]')
  })

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow('valid JSON')
    expect(() => parseBackup('{"format":"other","items":{}}')).toThrow('not a TradeHorizon backup')
    expect(() => parseBackup(JSON.stringify({ format: 'trade-horizon-backup', version: 99, items: { a: '1' } }))).toThrow('newer version')
  })

  it('skips unsafe keys and values that are not JSON', () => {
    const text = JSON.stringify({
      format: 'trade-horizon-backup',
      version: 1,
      items: { 'ok:v1': '{}', '../evil': '{}', 'bad:v1': 'not json', 'num:v1': 5 },
    })
    expect(Object.keys(parseBackup(text).items)).toEqual(['ok:v1'])
  })
})
