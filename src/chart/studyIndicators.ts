// klinecharts registrations for the indicator library (maths in studies.ts). Line colours arrive per study in
// `styles.lines`; fills, levels and the volume profile are drawn in `draw`, which returns false when the library should
// still draw the lines on top.
import { getSupportedIndicators, registerIndicator, type IndicatorFigure, type IndicatorTemplate, type KLineData } from 'klinecharts'
import { STUDIES, atr, bollinger, ichimoku, macd, rsi, stochRsi, supertrend, volumeProfile, type StudyType } from './studies'

export const studyIndicatorName = (type: StudyType) => `tradeHorizonStudy:${type}`

type Row = Record<string, number | undefined>

interface StudyExtend { colors: readonly string[] }

function colorsOf(indicator: { extendData?: unknown }, type: StudyType): readonly string[] {
  const extend = indicator.extendData as StudyExtend | undefined
  return extend?.colors ?? STUDIES[type].lines.map((line) => line.color)
}

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

function lineFigures(type: StudyType, keys?: readonly string[]): IndicatorFigure<Row>[] {
  return STUDIES[type].lines
    .filter((line) => !keys || keys.includes(line.key))
    .map((line) => ({ key: line.key, title: `${line.label}: `, type: 'line' }))
}

/** Dashed guide levels (RSI 70/50/30 …) across the study's pane. */
function drawLevels(ctx: CanvasRenderingContext2D, levels: readonly number[], width: number, toY: (value: number) => number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(120, 123, 134, 0.55)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  for (const level of levels) {
    const y = Math.round(toY(level)) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}

/** Fill between two series of a study's result over the visible bars. */
function fillBetween(
  ctx: CanvasRenderingContext2D,
  rows: readonly Row[],
  from: number,
  to: number,
  upperKey: string,
  lowerKey: string,
  toX: (index: number) => number,
  toY: (value: number) => number,
  color: (row: Row) => string,
): void {
  for (let index = Math.max(from, 1); index < to; index += 1) {
    const previous = rows[index - 1]
    const current = rows[index]
    const values = [previous?.[upperKey], previous?.[lowerKey], current?.[upperKey], current?.[lowerKey]]
    if (values.some((value) => value === undefined)) continue
    const [pu, pl, cu, cl] = values as number[]
    ctx.fillStyle = color(current)
    ctx.beginPath()
    ctx.moveTo(toX(index - 1), toY(pu))
    ctx.lineTo(toX(index), toY(cu))
    ctx.lineTo(toX(index), toY(cl))
    ctx.lineTo(toX(index - 1), toY(pl))
    ctx.closePath()
    ctx.fill()
  }
}

function visible(chart: { getVisibleRange(): { from: number, to: number } }, length: number): [number, number] {
  const range = chart.getVisibleRange()
  return [Math.max(0, Math.floor(range.from)), Math.min(length, Math.ceil(range.to) + 1)]
}

function templates(): IndicatorTemplate<Row>[] {
  return [
    {
      name: studyIndicatorName('rsi'),
      shortName: 'RSI',
      calcParams: [14],
      minValue: 0,
      maxValue: 100,
      precision: 2,
      figures: lineFigures('rsi'),
      calc: (data: KLineData[], indicator) => rsi(data.map((bar) => bar.close), indicator.calcParams[0] as number).map((value) => ({ rsi: value })),
      draw: ({ ctx, bounding, yAxis }) => { drawLevels(ctx, STUDIES.rsi.levels!, bounding.width, (value) => yAxis.convertToPixel(value)); return false },
    },
    {
      name: studyIndicatorName('macd'),
      shortName: 'MACD',
      calcParams: [12, 26, 9],
      precision: 4,
      figures: [
        ...lineFigures('macd', ['macd', 'signal']),
        {
          key: 'histogram',
          title: 'Histogram: ',
          type: 'bar',
          baseValue: 0,
          styles: ({ data, indicator }) => {
            const colors = colorsOf(indicator, 'macd')
            const value = data.current?.histogram ?? 0
            const previous = data.prev?.histogram ?? 0
            const base = value >= 0 ? colors[2] : '#f23645'
            return { color: withAlpha(base, Math.abs(value) >= Math.abs(previous) ? 0.9 : 0.45) }
          },
        },
      ],
      calc: (data: KLineData[], indicator) => {
        const [fast, slow, signal] = indicator.calcParams as number[]
        return macd(data.map((bar) => bar.close), fast, slow, signal)
      },
      draw: ({ ctx, bounding, yAxis }) => { drawLevels(ctx, [0], bounding.width, (value) => yAxis.convertToPixel(value)); return false },
    },
    {
      name: studyIndicatorName('bb'),
      shortName: 'BB',
      calcParams: [20, 2],
      figures: lineFigures('bb'),
      calc: (data: KLineData[], indicator) => {
        const [length, deviations] = indicator.calcParams as number[]
        return bollinger(data.map((bar) => bar.close), length, deviations)
      },
      draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
        const [from, to] = visible(chart, indicator.result.length)
        const color = withAlpha(colorsOf(indicator, 'bb')[1], 0.08)
        fillBetween(ctx, indicator.result, from, to, 'upper', 'lower', (i) => xAxis.convertToPixel(i), (v) => yAxis.convertToPixel(v), () => color)
        return false
      },
    },
    {
      name: studyIndicatorName('stochRsi'),
      shortName: 'Stoch RSI',
      calcParams: [3, 3, 14, 14],
      minValue: 0,
      maxValue: 100,
      precision: 2,
      figures: lineFigures('stochRsi'),
      calc: (data: KLineData[], indicator) => {
        const [k, d, rsiLength, stochLength] = indicator.calcParams as number[]
        return stochRsi(data.map((bar) => bar.close), k, d, rsiLength, stochLength)
      },
      draw: ({ ctx, bounding, yAxis }) => { drawLevels(ctx, STUDIES.stochRsi.levels!, bounding.width, (value) => yAxis.convertToPixel(value)); return false },
    },
    {
      name: studyIndicatorName('atr'),
      shortName: 'ATR',
      calcParams: [14],
      figures: lineFigures('atr'),
      calc: (data: KLineData[], indicator) => atr(data, indicator.calcParams[0] as number).map((value) => ({ atr: value })),
    },
    {
      name: studyIndicatorName('ichimoku'),
      shortName: 'Ichimoku',
      calcParams: [9, 26, 52, 26],
      figures: lineFigures('ichimoku'),
      calc: (data: KLineData[], indicator) => {
        const [conversion, base, spanB, displacement] = indicator.calcParams as number[]
        return ichimoku(data, conversion, base, spanB, displacement)
      },
      draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
        const [from, to] = visible(chart, indicator.result.length)
        const colors = colorsOf(indicator, 'ichimoku')
        const up = withAlpha(colors[3], 0.18)
        const down = withAlpha(colors[4], 0.18)
        fillBetween(ctx, indicator.result, from, to, 'spanA', 'spanB', (i) => xAxis.convertToPixel(i), (v) => yAxis.convertToPixel(v), (row) => ((row.spanA ?? 0) >= (row.spanB ?? 0) ? up : down))
        return false
      },
    },
    {
      name: studyIndicatorName('supertrend'),
      shortName: 'Supertrend',
      calcParams: [10, 3],
      figures: lineFigures('supertrend'),
      calc: (data: KLineData[], indicator) => {
        const [length, factor] = indicator.calcParams as number[]
        return supertrend(data, length, factor)
      },
    },
    {
      name: studyIndicatorName('volumeProfile'),
      shortName: 'VPVR',
      calcParams: [24, 30],
      figures: [],
      calc: (data: KLineData[]) => data.map(() => ({})),
      draw: ({ ctx, chart, indicator, bounding, yAxis }) => {
        const data = chart.getDataList()
        const [from, to] = visible(chart, data.length)
        const [rows, widthPercent] = indicator.calcParams as number[]
        const profile = volumeProfile(data.slice(from, to), rows)
        if (!profile) return true
        const colors = colorsOf(indicator, 'volumeProfile')
        const max = Math.max(...profile.rows.map((row) => row.up + row.down))
        if (!(max > 0)) return true
        const maxWidth = (bounding.width * widthPercent) / 100
        profile.rows.forEach((row, index) => {
          const top = yAxis.convertToPixel(row.high)
          const bottom = yAxis.convertToPixel(row.low)
          const height = Math.max(1, bottom - top - 1)
          const upWidth = (row.up / max) * maxWidth
          const downWidth = (row.down / max) * maxWidth
          const right = bounding.width
          ctx.fillStyle = withAlpha(colors[0], index === profile.pocIndex ? 0.55 : 0.32)
          ctx.fillRect(right - upWidth, top, upWidth, height)
          ctx.fillStyle = withAlpha(colors[1], index === profile.pocIndex ? 0.55 : 0.32)
          ctx.fillRect(right - upWidth - downWidth, top, downWidth, height)
        })
        const poc = profile.rows[profile.pocIndex]
        const pocY = Math.round(yAxis.convertToPixel((poc.low + poc.high) / 2)) + 0.5
        ctx.strokeStyle = colors[2]
        ctx.lineWidth = 1
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(0, pocY)
        ctx.lineTo(bounding.width, pocY)
        ctx.stroke()
        return true
      },
    },
  ]
}

export function registerStudyIndicators(): void {
  const supported = getSupportedIndicators()
  for (const template of templates()) {
    if (!supported.includes(template.name)) registerIndicator(template)
  }
}
