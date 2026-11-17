import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSendQueue } from './sendQueue.ts'

const quiet = { log() {}, warn() {} }
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('send queue', () => {
  it('keeps the global pace and the gap per key', async () => {
    const queue = createSendQueue({ name: 'test', perSecond: 2, perKeyGapMs: 1000, log: quiet })
    const startedAt: Array<[string, number]> = []
    const run = (label: string) => async () => {
      startedAt.push([label, Date.now()])
    }
    const t0 = Date.now()
    for (const label of ['a1', 'a2', 'b1', 'c1', 'd1']) void queue.enqueue(label[0], run(label))
    await settle(0)
    expect(startedAt.map(([label]) => label)).toEqual(['a1', 'b1']) // a2 waits for its key, 2 per second
    await settle(1000)
    expect(startedAt.map(([label]) => label)).toEqual(['a1', 'b1', 'a2', 'c1'])
    await settle(1000)
    expect(startedAt.map(([label]) => label)).toEqual(['a1', 'b1', 'a2', 'c1', 'd1'])
    expect(Number(startedAt.find(([label]) => label === 'a2')?.[1]) - t0).toBeGreaterThanOrEqual(1000)
    expect(queue.status()).toMatchObject({ pending: 0, sent: 5 })
  })

  it('waits as long as the service asks after "too many requests", for every message, then delivers', async () => {
    const queue = createSendQueue({ name: 'test', perSecond: 100, log: quiet })
    let calls = 0
    const limited = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('Too Many Requests'), { retryAfterMs: 5000 })
    })
    const other = vi.fn(async () => {})
    const first = queue.enqueue('chat-1', limited)
    await settle(0)
    const second = queue.enqueue('chat-2', other)
    await settle(100)
    expect(other).not.toHaveBeenCalled() // the whole queue is paused
    expect(queue.status().pausedForSec).toBeGreaterThan(0)
    await settle(5000)
    expect(await first).toEqual({ ok: true, attempts: 2 })
    expect(await second).toMatchObject({ ok: true })
    expect(queue.status()).toMatchObject({ sent: 2, retried: 1, failed: 0 })
  })

  it('retries passing errors with growing pauses, gives up after the last attempt, and never retries permanent errors', async () => {
    const queue = createSendQueue({ name: 'test', maxAttempts: 3, log: quiet })
    const flaky = vi.fn(async () => {
      throw new Error('network down')
    })
    const blocked = vi.fn(async () => {
      throw Object.assign(new Error('bot was blocked'), { permanent: true })
    })
    const flakyResult = queue.enqueue('a', flaky)
    const blockedResult = queue.enqueue('b', blocked)
    await settle(0)
    expect(await blockedResult).toMatchObject({ ok: false, attempts: 1, error: 'bot was blocked' })
    await settle(2000) // first retry after 2 s
    expect(flaky).toHaveBeenCalledTimes(2)
    await settle(4000) // second retry after 4 s
    expect(await flakyResult).toMatchObject({ ok: false, attempts: 3 })
    expect(queue.status()).toMatchObject({ failed: 2, retried: 2, pending: 0 })
  })

  it('refuses new messages beyond its size limit instead of using unbounded memory', async () => {
    const queue = createSendQueue({ name: 'test', perSecond: 1, maxPending: 2, log: quiet })
    void queue.enqueue('a', async () => {})
    void queue.enqueue('b', async () => {})
    expect(await queue.enqueue('c', async () => {})).toMatchObject({ ok: false, error: 'queue full' })
    expect(queue.status().dropped).toBe(1)
  })
})
