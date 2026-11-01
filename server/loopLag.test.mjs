import { describe, expect, it } from 'vitest'
import { createLoopLagMonitor } from './loopLag.mjs'

describe('event loop delay monitor', () => {
  it('records how late each tick ran and summarises the last window', () => {
    let clock = 0
    const monitor = createLoopLagMonitor({ intervalMs: 100, windowMs: 1000, now: () => clock })
    for (let index = 0; index < 9; index += 1) { clock += 102; monitor.tick() } // 2 ms late each time
    clock += 400; monitor.tick() // blocked for 300 ms
    expect(monitor.status()).toEqual({ p50: 2, p99: 2, max: 300 })
    for (let index = 0; index < 10; index += 1) { clock += 100; monitor.tick() } // the block leaves the window
    expect(monitor.status().max).toBe(0)
  })

  it('catches a real freeze', async () => {
    const monitor = createLoopLagMonitor({ intervalMs: 20 })
    monitor.start()
    await new Promise((resolve) => setTimeout(resolve, 60))
    const end = Date.now() + 200
    while (Date.now() < end) { /* busy */ }
    await new Promise((resolve) => setTimeout(resolve, 60))
    monitor.stop()
    expect(monitor.status().max).toBeGreaterThan(150)
  })
})
