import { describe, expect, it } from 'vitest'
import { compareVersions, summarizeCopy } from './syncCheck'
import { describeHttpProblem } from './userSync'

describe('sync check helpers', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.14.0', '0.9.0')).toBe(1)
    expect(compareVersions('0.14.0', '0.14.0')).toBe(0)
    expect(compareVersions('0.13.2', '0.14.0')).toBe(-1)
  })

  it('summarises each kind of saved item', () => {
    const layouts = JSON.stringify([{ id: 'a', name: 'Swing' }, { id: 'b', name: 'Scalp' }])
    expect(summarizeCopy('layouts:v1', layouts)).toMatchObject({ text: '2 layouts', names: ['Swing', 'Scalp'], ids: ['a', 'b'] })
    expect(summarizeCopy('drawings:v1', JSON.stringify({ version: 1, drawings: [{ id: 'd' }] })).text).toBe('1 drawing')
    expect(summarizeCopy('workspace:v1', JSON.stringify({ tabs: [{ symbol: 'BTCUSDT', interval: '15m' }] }))).toMatchObject({ text: '1 tab', names: ['BTCUSDT 15m'] })
    expect(summarizeCopy('watchlists:v1', JSON.stringify({ lists: [{ id: 'w', name: 'Main', items: [{}, {}] }] })).text).toBe('1 list, 2 symbols')
    expect(summarizeCopy('theme:v1', 'dark').text).toBe('dark')
  })

  it('explains known deployment problems', () => {
    expect(describeHttpProblem(404)).toContain('restart the Node process')
    expect(describeHttpProblem(413)).toContain('client_max_body_size')
    expect(describeHttpProblem(502)).toContain('Node process is running')
  })
})
