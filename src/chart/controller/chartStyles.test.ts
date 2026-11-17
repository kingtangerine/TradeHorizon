import { describe, expect, it } from 'vitest'
import { appearanceStyles, chartInitOptions, chartTypeStyles, themeStyles } from './chartStyles'

describe('chartTypeStyles', () => {
  it('maps each chart type to the library candle type', () => {
    expect(chartTypeStyles('bars').candle.type).toBe('ohlc')
    expect(chartTypeStyles('hollow').candle.type).toBe('candle_up_stroke')
    expect(chartTypeStyles('candles').candle.type).toBe('candle_solid')
    expect(chartTypeStyles('line').candle.type).toBe('area')
    expect(chartTypeStyles('heikinAshi').candle.type).toBe('area')
  })

  it('fills the area chart, draws a plain line, and hides the series we draw ourselves', () => {
    expect(chartTypeStyles('area').candle.area.backgroundColor).toHaveLength(2)
    expect(chartTypeStyles('line').candle.area).toMatchObject({ lineColor: '#2962ff', lineSize: 2, backgroundColor: 'transparent' })
    expect(chartTypeStyles('baseline').candle.area).toMatchObject({ lineColor: 'transparent', lineSize: 0, value: 'close' })
  })
})

describe('appearanceStyles', () => {
  const base = { upColor: '#0f0', downColor: '#f00', wicks: true, background: null, grid: 'both', lastPriceLine: true } as const

  it('colours bodies, borders and wicks, or hides the wicks', () => {
    expect(appearanceStyles(base).candle.bar).toMatchObject({ upWickColor: '#0f0', downBorderColor: '#f00' })
    expect(appearanceStyles({ ...base, wicks: false }).candle.bar).toMatchObject({
      upWickColor: 'transparent',
      downWickColor: 'transparent',
    })
  })

  it('shows the chosen grid lines and the last-price line', () => {
    const styles = appearanceStyles({ ...base, grid: 'vertical', lastPriceLine: false })
    expect(styles.grid).toEqual({ horizontal: { show: false }, vertical: { show: true } })
    expect(styles.candle.priceMark.last.line.show).toBe(false)
  })
})

describe('themeStyles and chartInitOptions', () => {
  it('uses light colours for the light theme and the initial dark colours otherwise', () => {
    expect(themeStyles('light').grid.horizontal.color).toBe('#e6e9ef')
    const dark = themeStyles('dark')
    const initial = chartInitOptions().styles as { grid: { horizontal: { color: string } }; yAxis: { tickText: { color: string } } }
    expect(dark.grid.horizontal.color).toBe(initial.grid.horizontal.color)
    expect(dark.yAxis.tickText.color).toBe(initial.yAxis.tickText.color)
  })
})
