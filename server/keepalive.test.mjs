import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createKeepAlive, originOf, recordStart, startsWithinDay } from './keepalive.mjs'

const quiet = { log() {}, warn() {} }

describe('keep-alive', () => {
  it('learns the public origin from a request, ignoring local addresses', () => {
    expect(originOf({ host: 'boring-nash.example.page', 'x-forwarded-proto': 'https' }, true)).toBe('https://boring-nash.example.page')
    expect(originOf({ host: 'example.com' }, true)).toBe('http://example.com')
    expect(originOf({ host: 'localhost:8787' }, true)).toBeUndefined()
    expect(originOf({ host: '127.0.0.1:3000' }, true)).toBeUndefined()
    expect(originOf({ host: 'bad host/../' }, true)).toBeUndefined()
  })

  it('pings /healthz on the learned address, and not before it knows one', async () => {
    const calls = []
    const keepAlive = createKeepAlive({ fetchImpl: async (url) => { calls.push(url); return { ok: true } }, log: quiet })
    await keepAlive.ping()
    expect(calls).toEqual([])
    keepAlive.observe({ headers: { host: 'example.com', 'x-forwarded-proto': 'https' } })
    keepAlive.observe({ headers: { host: 'other.com' } }) // the first address sticks
    await keepAlive.ping()
    expect(calls).toEqual(['https://example.com/healthz?keepalive=1'])
    expect(keepAlive.status()).toMatchObject({ origin: 'https://example.com', lastPingOk: true })
  })

  it('uses TH_PUBLIC_URL when given', async () => {
    const calls = []
    const keepAlive = createKeepAlive({ publicUrl: 'https://trade.example.com/', fetchImpl: async (url) => { calls.push(url); return { ok: true } }, log: quiet })
    await keepAlive.ping()
    expect(calls).toEqual(['https://trade.example.com/healthz?keepalive=1'])
  })

  it('records process starts and counts the last 24 hours', () => {
    const dir = mkdtempSync(join(tmpdir(), 'th-starts-'))
    try {
      const day = 24 * 60 * 60_000
      recordStart(dir, 1000)
      recordStart(dir, 1000 + day / 2)
      const starts = recordStart(dir, 1000 + day + 5)
      expect(starts).toHaveLength(3)
      expect(startsWithinDay(starts, 1000 + day + 5)).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
