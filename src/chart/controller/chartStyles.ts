import type { Options } from 'klinecharts'
import type { ChartType } from '../types'
import type { ChartAppearanceStyle } from './types'

/** Options the chart is created with: TradingView-like dark colours, axis gaps and zoom limits. */
export function chartInitOptions(): Options {
  return {
    locale: 'en-US',
    timezone: 'UTC',
    zoomAnchor: 'cursor',
    hotkey: { enabled: true },
    layout: {
      barSpaceLimit: { min: 0.4, max: 60 },
      pane: { minHeight: 120 },
      yAxis: {
        position: 'right',
        inside: false,
        scrollZoomEnabled: true,
        gap: { top: 0.16, bottom: 0.12 },
      },
    },
    styles: {
      grid: {
        horizontal: { color: '#1f2330', style: 'dashed', dashedValue: [3, 3] },
        vertical: { color: '#1f2330', style: 'dashed', dashedValue: [3, 3] },
      },
      candle: {
        bar: {
          upColor: '#089981',
          downColor: '#f23645',
          noChangeColor: '#787b86',
          upBorderColor: '#089981',
          downBorderColor: '#f23645',
          noChangeBorderColor: '#787b86',
          upWickColor: '#089981',
          downWickColor: '#f23645',
          noChangeWickColor: '#787b86',
        },
        tooltip: { showRule: 'none' },
        priceMark: {
          high: { show: false },
          low: { show: false },
          last: {
            line: { show: true, style: 'dashed', size: 1, dashedValue: [4, 4] },
          },
        },
      },
      xAxis: {
        axisLine: { color: '#2a2e39' },
        tickLine: { color: '#2a2e39' },
        tickText: { color: '#787b86', size: 12, family: 'Inter, system-ui, sans-serif' },
      },
      yAxis: {
        axisLine: { color: '#2a2e39' },
        tickLine: { color: '#2a2e39' },
        tickText: { color: '#b2b5be', size: 12, family: 'Inter, system-ui, sans-serif' },
      },
      indicator: {
        tooltip: {
          title: { family: 'Inter, system-ui, sans-serif', size: 12, color: '#b2b5be' },
          legend: { family: 'Inter, system-ui, sans-serif', size: 12 },
        },
      },
      crosshair: {
        horizontal: {
          line: { color: '#9598a1', style: 'dashed', size: 1, dashedValue: [4, 4] },
        },
        vertical: {
          line: { color: '#9598a1', style: 'dashed', size: 1, dashedValue: [4, 4] },
        },
      },
      overlay: {
        line: { color: '#f4b860', size: 2 },
        point: {
          color: '#f4b860',
          borderColor: '#080b10',
          activeColor: '#fff1cf',
          activeBorderColor: '#f4b860',
        },
      },
    },
  }
}

/** Candle styles for a chart type; Heikin Ashi and baseline hide the library's own series (they are drawn by us). */
export function chartTypeStyles(type: ChartType) {
  const drawnByUs = type === 'heikinAshi' || type === 'baseline'
  const candleType = type === 'bars' ? 'ohlc' : type === 'hollow' ? 'candle_up_stroke' : type === 'candles' ? 'candle_solid' : 'area'
  const area =
    type === 'area'
      ? {
          lineColor: '#2962ff',
          lineSize: 2,
          backgroundColor: [
            { offset: 0, color: 'rgba(41, 98, 255, 0.02)' },
            { offset: 1, color: 'rgba(41, 98, 255, 0.32)' },
          ],
        }
      : drawnByUs
        ? { lineColor: 'transparent', lineSize: 0, backgroundColor: 'transparent' }
        : { lineColor: '#2962ff', lineSize: 2, backgroundColor: 'transparent' }
  return {
    candle: { type: candleType, area: { ...area, value: 'close', smooth: false, point: { show: false } } },
  }
}

/** Chart styles for the settings window's candle colours, wicks, grid and last-price line (the background goes on the host). */
export function appearanceStyles(appearance: ChartAppearanceStyle) {
  const { upColor, downColor } = appearance
  const wick = (color: string) => (appearance.wicks ? color : 'transparent')
  return {
    candle: {
      bar: {
        upColor,
        downColor,
        upBorderColor: upColor,
        downBorderColor: downColor,
        upWickColor: wick(upColor),
        downWickColor: wick(downColor),
      },
      priceMark: { last: { upColor, downColor, line: { show: appearance.lastPriceLine } } },
    },
    grid: {
      horizontal: { show: appearance.grid === 'both' || appearance.grid === 'horizontal' },
      vertical: { show: appearance.grid === 'both' || appearance.grid === 'vertical' },
    },
  }
}

/** Grid, axis, crosshair and legend colours of the chart canvas for the app theme. */
export function themeStyles(theme: 'dark' | 'light') {
  const light = theme === 'light'
  const grid = light ? '#e6e9ef' : '#1f2330'
  const axis = light ? '#d3d8e0' : '#2a2e39'
  const crosshair = light ? '#6b7280' : '#9598a1'
  return {
    grid: {
      horizontal: { color: grid },
      vertical: { color: grid },
    },
    xAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: light ? '#4b5563' : '#787b86' } },
    yAxis: { axisLine: { color: axis }, tickLine: { color: axis }, tickText: { color: light ? '#374151' : '#b2b5be' } },
    indicator: { tooltip: { title: { color: light ? '#374151' : '#b2b5be' } } },
    crosshair: {
      horizontal: { line: { color: crosshair } },
      vertical: { line: { color: crosshair } },
    },
  }
}
