// klinecharts side of "My scripts" (script.ts): one indicator template for every user script. The script, its
// inputs and its plot styles travel in `extendData`; plots become the figures p0..p7, horizontal lines are drawn.
import { getSupportedIndicators, registerIndicator, type KLineData } from 'klinecharts'
import { MAX_PLOTS, compileScript, runScript, type CompiledScript } from './script'

export const SCRIPT_INDICATOR_NAME = 'tradeHorizonScript'

export interface ScriptPlotStyle {
  readonly title: string
  readonly color: string
  readonly width: number
}

export interface ScriptExtend {
  readonly source: string
  readonly inputs: readonly number[]
  readonly plots: readonly ScriptPlotStyle[]
  readonly hlines: ReadonlyArray<{ value: number; color: string }>
}

const cache = new Map<string, CompiledScript | Error>()

/** Compiled once per source text; a script with a mistake gives the error instead. */
export function compiledScript(source: string): CompiledScript | Error {
  let entry = cache.get(source)
  if (!entry) {
    try {
      entry = compileScript(source)
    } catch (error) {
      entry = error instanceof Error ? error : new Error(String(error))
    }
    if (cache.size > 50) cache.clear()
    cache.set(source, entry)
  }
  return entry
}

type Row = Record<string, number | undefined>

export function registerScriptIndicator(): void {
  if (getSupportedIndicators().includes(SCRIPT_INDICATOR_NAME)) return
  registerIndicator<Row>({
    name: SCRIPT_INDICATOR_NAME,
    shortName: 'Script',
    figures: Array.from({ length: MAX_PLOTS }, (_, index) => ({ key: `p${index}`, type: 'line' })),
    calc: (data: KLineData[], indicator) => {
      const extend = indicator.extendData as ScriptExtend | undefined
      const script = extend ? compiledScript(extend.source) : undefined
      if (!extend || !script || script instanceof Error) return data.map(() => ({}))
      try {
        const result = runScript(script, data, extend.inputs)
        return data.map((_, index) => {
          const row: Row = {}
          result.plots.forEach((plot, plotIndex) => {
            const value = plot.values[index]
            row[`p${plotIndex}`] = Number.isFinite(value) ? value : undefined
          })
          return row
        })
      } catch {
        return data.map(() => ({}))
      }
    },
    draw: ({ ctx, bounding, indicator, yAxis }) => {
      const extend = indicator.extendData as ScriptExtend | undefined
      ctx.save()
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      for (const line of extend?.hlines ?? []) {
        const y = Math.round(yAxis.convertToPixel(line.value)) + 0.5
        ctx.strokeStyle = line.color
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(bounding.width, y)
        ctx.stroke()
      }
      ctx.restore()
      return false
    },
  })
}
