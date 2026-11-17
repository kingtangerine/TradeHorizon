import { describe, expect, it } from 'vitest'
import { EXAMPLE_SCRIPT, ScriptError, compileScript, runScript } from './script'

const bars = Array.from({ length: 60 }, (_, index) => ({
  timestamp: index * 60_000,
  open: 100 + index,
  high: 102 + index,
  low: 98 + index,
  close: 101 + index,
  volume: 10,
}))

describe('user scripts', () => {
  it('reads title, pane and inputs, and runs the example', () => {
    const script = compileScript(EXAMPLE_SCRIPT)
    expect(script.title).toBe('EMA cross')
    expect(script.overlay).toBe(true)
    expect(script.inputs.map((input) => [input.title, input.defaultValue])).toEqual([
      ['Fast length', 12],
      ['Slow length', 26],
    ])
    const result = runScript(script, bars)
    expect(result.plots.map((plot) => plot.title)).toEqual(['Fast', 'Slow'])
    expect(result.plots[0].color).toBe('#2962ff')
    expect(Number.isNaN(result.plots[0].values[10])).toBe(true)
    expect(result.plots[0].values[11]).toBeCloseTo(101 + 5.5) // first EMA = SMA of closes 101..112
  })

  it('uses changed inputs instead of the defaults', () => {
    const script = compileScript('n = input(3, "N")\nplot(sma(close, n))')
    expect(runScript(script, bars, [5]).plots[0].values[4]).toBeCloseTo(103)
    expect(runScript(script, bars).plots[0].values[2]).toBeCloseTo(102)
  })

  it('handles operators, history, ternaries and signals', () => {
    const script = compileScript(
      'd = close - close[1]\nup = d > 0 and volume >= 10 ? 1 : -1\nplot(up)\nplot(crossover(close, 120))\nhline(0, "Zero")',
    )
    const result = runScript(script, bars)
    expect(Number.isNaN(result.plots[0].values[0])).toBe(false)
    expect(result.plots[0].values[5]).toBe(1)
    expect([...result.plots[1].values].indexOf(1)).toBe(20) // close goes from 120 to 121 at bar 20
    expect(result.hlines).toEqual([{ value: 0, title: 'Zero', color: '#787b86' }])
  })

  it('reports the line of a mistake', () => {
    expect(() => compileScript('a = ema(close, 10)\nplot(foo)')).toThrow(/Line 2: "foo" is not defined/)
    expect(() => compileScript('plot(ema(close 10))')).toThrow(ScriptError)
    expect(() => compileScript('x = notafunction(close)\nplot(x)')).toThrow(/unknown function notafunction/)
    expect(() => compileScript('close = 1')).toThrow(/built-in name/)
    expect(() => compileScript('plot(sma(close, 0))')).toThrow(/length/)
  })

  it('computes RSI and ATR like the library studies', () => {
    const script = compileScript('plot(rsi(close, 14))\nplot(atr(14))')
    const result = runScript(script, bars)
    expect(result.plots[0].values[59]).toBe(100) // rising every candle
    expect(result.plots[1].values[59]).toBeCloseTo(4) // high - low is 4 every candle
  })
})
