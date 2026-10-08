import { getSupportedOverlays, registerOverlay } from 'klinecharts'
import { FIB_LEVELS, clampPositionLevels, fibLevelPrice, type PositionDirection } from './geometry'
import {
  FIB_RETRACEMENT_OVERLAY_NAME,
  HORIZONTAL_LINE_OVERLAY_NAME,
  LONG_POSITION_OVERLAY_NAME,
  PRICE_RANGE_OVERLAY_NAME,
  RECTANGLE_OVERLAY_NAME,
  SHORT_POSITION_OVERLAY_NAME,
  TEXT_OVERLAY_NAME,
  VERTICAL_LINE_OVERLAY_NAME,
} from './overlayNames'
import { calculateLongPositionMetrics } from './position'

export * from './overlayNames'


const FIB_COLORS = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#787b86', '#2962ff']

function numericStyle(styles: unknown, key: string, fallback: number): number {
  if (!styles || typeof styles !== 'object') return fallback
  const value = (styles as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringStyle(styles: unknown, key: string, fallback: string): string {
  if (!styles || typeof styles !== 'object') return fallback
  const value = (styles as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : fallback
}

function rgba(hex: string, opacityPercent: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return hex
  const value = match[1]
  return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${Math.max(0, Math.min(100, opacityPercent)) / 100})`
}

function formatPositionNumber(value: number, digits = 2): string {
  return Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: digits })
    : '—'
}

export function registerTradeHorizonOverlays(): void {
  const supported = new Set(getSupportedOverlays())

  if (!supported.has(RECTANGLE_OVERLAY_NAME)) {
    registerOverlay({
      name: RECTANGLE_OVERLAY_NAME,
      totalStep: 3,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: true,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ coordinates, overlay }) => {
        if (coordinates.length < 2) return []

        let minX = coordinates[0].x
        let maxX = coordinates[0].x
        let minY = coordinates[0].y
        let maxY = coordinates[0].y

        for (let i = 1; i < coordinates.length; i++) {
          const { x, y } = coordinates[i]
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }

        const figures: Array<Record<string, unknown>> = [{
          type: 'rect',
          attrs: {
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY),
          },
        }]
        // Optional horizontal line through the middle of the box.
        if (numericStyle(overlay.styles, 'showMidline', 0) === 1) {
          const middle = (minY + maxY) / 2
          figures.push({ type: 'line', attrs: { coordinates: [{ x: minX, y: middle }, { x: maxX, y: middle }] }, ignoreEvent: true })
        }
        return figures as never
      },
      performEventPressedMove: ({ points, performPointIndex, performPoint }) => {
        if (points.length < 8) return

        const p0 = points[0]
        const p1 = points[1]
        const p2 = points[2]
        const p3 = points[3]
        const p4 = points[4]
        const p5 = points[5]
        const p6 = points[6]
        const p7 = points[7]

        let tL = p0?.timestamp ?? p6?.timestamp ?? p7?.timestamp
        let tR = p2?.timestamp ?? p3?.timestamp ?? p4?.timestamp
        let pT = p0?.value ?? p1?.value ?? p2?.value
        let pB = p4?.value ?? p5?.value ?? p6?.value

        let dL = p0?.dataIndex ?? p6?.dataIndex ?? p7?.dataIndex
        let dR = p2?.dataIndex ?? p3?.dataIndex ?? p4?.dataIndex

        switch (performPointIndex) {
          case 0: // Top-Left
            tL = performPoint.timestamp ?? tL
            dL = performPoint.dataIndex ?? dL
            pT = performPoint.value ?? pT
            break
          case 1: // Top-Center
            pT = performPoint.value ?? pT
            break
          case 2: // Top-Right
            tR = performPoint.timestamp ?? tR
            dR = performPoint.dataIndex ?? dR
            pT = performPoint.value ?? pT
            break
          case 3: // Right-Center
            tR = performPoint.timestamp ?? tR
            dR = performPoint.dataIndex ?? dR
            break
          case 4: // Bottom-Right
            tR = performPoint.timestamp ?? tR
            dR = performPoint.dataIndex ?? dR
            pB = performPoint.value ?? pB
            break
          case 5: // Bottom-Center
            pB = performPoint.value ?? pB
            break
          case 6: // Bottom-Left
            tL = performPoint.timestamp ?? tL
            dL = performPoint.dataIndex ?? dL
            pB = performPoint.value ?? pB
            break
          case 7: // Left-Center
            tL = performPoint.timestamp ?? tL
            dL = performPoint.dataIndex ?? dL
            break
        }

        const tM = tL !== undefined && tR !== undefined ? Math.round((tL + tR) / 2) : undefined
        const dM = dL !== undefined && dR !== undefined ? Math.round((dL + dR) / 2) : undefined
        const pM = pT !== undefined && pB !== undefined ? (pT + pB) / 2 : undefined

        points[0] = { timestamp: tL, dataIndex: dL, value: pT }
        points[1] = { timestamp: tM, dataIndex: dM, value: pT }
        points[2] = { timestamp: tR, dataIndex: dR, value: pT }
        points[3] = { timestamp: tR, dataIndex: dR, value: pM }
        points[4] = { timestamp: tR, dataIndex: dR, value: pB }
        points[5] = { timestamp: tM, dataIndex: dM, value: pB }
        points[6] = { timestamp: tL, dataIndex: dL, value: pB }
        points[7] = { timestamp: tL, dataIndex: dL, value: pM }
      },
    })
  }

  const positions: Array<[string, PositionDirection]> = [
    [LONG_POSITION_OVERLAY_NAME, 'long'],
    [SHORT_POSITION_OVERLAY_NAME, 'short'],
  ]
  for (const [positionName, direction] of positions) if (!supported.has(positionName)) registerOverlay({
    name: positionName,
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length !== 3 || overlay.points.length !== 3) return []

      const [entryCoordinate, targetCoordinate, stopCoordinate] = coordinates
      const entry = overlay.points[0].value
      const target = overlay.points[1].value
      const stop = overlay.points[2].value
      if (entry === undefined || target === undefined || stop === undefined) return []

      const left = Math.min(entryCoordinate.x, targetCoordinate.x, stopCoordinate.x)
      const right = Math.max(entryCoordinate.x, targetCoordinate.x, stopCoordinate.x)
      const width = Math.max(1, right - left)
      const targetColor = stringStyle(overlay.styles, 'targetColor', '#16a085')
      const stopColor = stringStyle(overlay.styles, 'stopColor', '#f0445e')
      const textColor = stringStyle(overlay.styles, 'textColor', '#ffffff')
      const lineColor = stringStyle(overlay.styles, 'positionLineColor', '#c7d0db')
      const fillOpacity = numericStyle(overlay.styles, 'positionFillOpacity', 22)
      const lineWidth = numericStyle(overlay.styles, 'positionLineWidth', 1)
      const accountSize = numericStyle(overlay.styles, 'accountSize', 10_000)
      const riskPercent = numericStyle(overlay.styles, 'riskPercent', 1)
      const showValues = numericStyle(overlay.styles, 'showValues', 1) !== 0
      const metrics = calculateLongPositionMetrics(entry, target, stop, accountSize, riskPercent)
      const lineStyles = { color: lineColor, size: lineWidth, style: 'solid' }
      const textStyles = {
        color: textColor,
        size: 11,
        family: 'Inter, system-ui, sans-serif',
        weight: 600,
        style: 'fill',
        borderStyle: 'solid',
        borderDashedValue: [2, 2],
        paddingLeft: 5,
        paddingRight: 5,
        paddingTop: 3,
        paddingBottom: 3,
      }

      const labels = !showValues ? [] : [
        {
          type: 'text',
          attrs: { x: left + 5, y: targetCoordinate.y, text: `Target: ${formatPositionNumber(target)} (${formatPositionNumber(metrics.targetPercent)}%)  P&L: ${formatPositionNumber(metrics.rewardAmount)}  Qty: ${formatPositionNumber(metrics.quantity, 6)}`, align: 'left', baseline: direction === 'long' ? 'bottom' : 'top' },
          styles: { ...textStyles, backgroundColor: targetColor },
          ignoreEvent: true,
        },
        {
          type: 'text',
          attrs: { x: left + 5, y: entryCoordinate.y, text: `Entry: ${formatPositionNumber(entry)}  Risk/Reward: ${formatPositionNumber(metrics.riskReward)}`, align: 'left', baseline: 'bottom' },
          styles: { ...textStyles, backgroundColor: '#3a4655' },
          ignoreEvent: true,
        },
        {
          type: 'text',
          attrs: { x: left + 5, y: stopCoordinate.y, text: `Stop: ${formatPositionNumber(stop)} (${formatPositionNumber(metrics.stopPercent)}%)  Risk: ${formatPositionNumber(metrics.riskAmount)}`, align: 'left', baseline: direction === 'long' ? 'top' : 'bottom' },
          styles: { ...textStyles, backgroundColor: stopColor },
          ignoreEvent: true,
        },
      ]

      return [
        {
          type: 'rect',
          attrs: {
            x: left,
            y: Math.min(entryCoordinate.y, targetCoordinate.y),
            width,
            height: Math.abs(targetCoordinate.y - entryCoordinate.y),
          },
          styles: { style: 'stroke_fill', color: rgba(targetColor, fillOpacity), borderColor: targetColor, borderSize: lineWidth, borderStyle: 'solid', borderDashedValue: [4, 4], borderRadius: 0 },
        },
        {
          type: 'rect',
          attrs: {
            x: left,
            y: Math.min(entryCoordinate.y, stopCoordinate.y),
            width,
            height: Math.abs(stopCoordinate.y - entryCoordinate.y),
          },
          styles: { style: 'stroke_fill', color: rgba(stopColor, fillOpacity), borderColor: stopColor, borderSize: lineWidth, borderStyle: 'solid', borderDashedValue: [4, 4], borderRadius: 0 },
        },
        { type: 'line', attrs: { coordinates: [{ x: left, y: targetCoordinate.y }, { x: right, y: targetCoordinate.y }] }, styles: lineStyles },
        { type: 'line', attrs: { coordinates: [{ x: left, y: entryCoordinate.y }, { x: right, y: entryCoordinate.y }] }, styles: lineStyles },
        { type: 'line', attrs: { coordinates: [{ x: left, y: stopCoordinate.y }, { x: right, y: stopCoordinate.y }] }, styles: lineStyles },
        ...labels,
      ]
    },
    performEventPressedMove: ({ points, performPointIndex }) => {
      if (points.length < 3) return
      const entry = points[0].value
      const target = points[1].value
      const stop = points[2].value
      if (entry === undefined || target === undefined || stop === undefined) return

      if (performPointIndex === 0) {
        points[0].value = Math.min(Math.max(target, stop), Math.max(Math.min(target, stop), entry))
        return
      }
      const clamped = clampPositionLevels(direction, entry, target, stop)
      points[1].value = clamped.target
      points[2].value = clamped.stop
    },
  })

  if (!supported.has(TEXT_OVERLAY_NAME)) {
    registerOverlay({
      name: TEXT_OVERLAY_NAME,
      totalStep: 2,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates, overlay }) => {
        if (coordinates.length < 1) return []
        const fontSize = numericStyle(overlay.styles, 'fontSize', 14)
        const lines = (stringStyle(overlay.styles, 'textValue', 'Text') || ' ').split(String.fromCharCode(10))
        return lines.map((line, index) => ({
          type: 'text',
          attrs: { x: coordinates[0].x, y: coordinates[0].y + index * fontSize * 1.35, text: line || ' ', align: 'left', baseline: 'middle' },
          styles: {
            style: 'fill',
            color: stringStyle(overlay.styles, 'textColor', '#2962ff'),
            size: fontSize,
            family: 'Inter, system-ui, sans-serif',
            weight: numericStyle(overlay.styles, 'bold', 0) === 1 ? 700 : 400,
            backgroundColor: 'transparent',
            borderSize: 0,
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 2,
            paddingBottom: 2,
          },
        }))
      },
      performEventPressedMove: ({ points, performPoint }) => {
        if (points.length < 1) return
        points[0].timestamp = performPoint.timestamp
        points[0].dataIndex = performPoint.dataIndex
        points[0].value = performPoint.value
      },
    })
  }

  if (!supported.has(HORIZONTAL_LINE_OVERLAY_NAME)) {
    registerOverlay({
      name: HORIZONTAL_LINE_OVERLAY_NAME,
      totalStep: 2,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ coordinates, bounding }) => {
        if (coordinates.length < 1) return []
        return [
          {
            type: 'line',
            attrs: {
              coordinates: [
                { x: 0, y: coordinates[0].y },
                { x: bounding.width, y: coordinates[0].y },
              ],
            },
          },
        ]
      },
      performEventPressedMove: ({ points, performPoint }) => {
        if (points.length < 1) return
        points[0].value = performPoint.value
      },
    })
  }

  if (!supported.has(PRICE_RANGE_OVERLAY_NAME)) {
    registerOverlay({
      name: PRICE_RANGE_OVERLAY_NAME,
      totalStep: 3,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: true,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ coordinates, overlay }) => {
        if (coordinates.length < 2 || overlay.points.length < 2) return []

        const [c1, c2] = coordinates
        const p1 = overlay.points[0].value
        const p2 = overlay.points[1].value
        if (p1 === undefined || p2 === undefined) return []

        const left = Math.min(c1.x, c2.x)
        const right = Math.max(c1.x, c2.x)
        const top = Math.min(c1.y, c2.y)
        const bottom = Math.max(c1.y, c2.y)
        const width = Math.max(1, right - left)
        const height = Math.max(1, bottom - top)

        const priceDiff = p2 - p1
        const percentChange = p1 !== 0 ? (priceDiff / p1) * 100 : 0
        const isPositive = priceDiff >= 0

        const upColor = stringStyle(overlay.styles, 'upColor', '#10b981')
        const downColor = stringStyle(overlay.styles, 'downColor', '#ef4444')
        const color = isPositive ? upColor : downColor
        const fillOpacity = numericStyle(overlay.styles, 'fillOpacity', 18)
        const lineWidth = numericStyle(overlay.styles, 'lineWidth', 1.5)
        const lineStyle = stringStyle(overlay.styles, 'lineStyle', 'solid')

        const sign = priceDiff >= 0 ? '+' : ''
        const labelText = `${sign}${formatPositionNumber(priceDiff)} (${sign}${formatPositionNumber(percentChange)}%)`

        const centerX = (left + right) / 2
        const centerY = (top + bottom) / 2

        return [
          {
            type: 'rect',
            attrs: { x: left, y: top, width, height },
            styles: {
              style: 'stroke_fill',
              color: rgba(color, fillOpacity),
              borderColor: color,
              borderSize: lineWidth,
              borderStyle: lineStyle,
              borderDashedValue: [4, 4],
              borderRadius: 2,
            },
          },
          {
            type: 'line',
            attrs: {
              coordinates: [
                { x: left, y: c1.y },
                { x: right, y: c1.y },
              ],
            },
            styles: { color, size: lineWidth, style: 'solid' },
          },
          {
            type: 'line',
            attrs: {
              coordinates: [
                { x: left, y: c2.y },
                { x: right, y: c2.y },
              ],
            },
            styles: { color, size: lineWidth, style: 'solid' },
          },
          {
            type: 'line',
            attrs: {
              coordinates: [
                { x: centerX, y: c1.y },
                { x: centerX, y: c2.y },
              ],
            },
            styles: { color, size: lineWidth, style: 'dashed', dashedValue: [3, 3] },
          },
          {
            type: 'text',
            attrs: {
              x: centerX,
              y: centerY,
              text: labelText,
              align: 'center',
              baseline: 'middle',
            },
            styles: {
              color: '#ffffff',
              size: 11,
              family: 'Inter, system-ui, sans-serif',
              weight: 600,
              style: 'fill',
              backgroundColor: color,
              borderStyle: 'solid',
              paddingLeft: 7,
              paddingRight: 7,
              paddingTop: 4,
              paddingBottom: 4,
              borderRadius: 3,
            },
            ignoreEvent: true,
          },
        ]
      },
    })
  }

  if (!supported.has(VERTICAL_LINE_OVERLAY_NAME)) {
    registerOverlay({
      name: VERTICAL_LINE_OVERLAY_NAME,
      totalStep: 2,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: true,
      needDefaultYAxisFigure: false,
      createPointFigures: ({ coordinates, bounding }) => {
        if (coordinates.length < 1) return []
        return [
          {
            type: 'line',
            attrs: {
              coordinates: [
                { x: coordinates[0].x, y: 0 },
                { x: coordinates[0].x, y: bounding.height },
              ],
            },
          },
        ]
      },
    })
  }

  if (!supported.has(FIB_RETRACEMENT_OVERLAY_NAME)) {
    registerOverlay({
      name: FIB_RETRACEMENT_OVERLAY_NAME,
      totalStep: 3,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: true,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ coordinates, overlay, chart, yAxis }) => {
        if (coordinates.length < 2 || overlay.points.length < 2) return []
        const first = overlay.points[0].value
        const second = overlay.points[1].value
        if (first === undefined || second === undefined || !yAxis) return []

        const [c1, c2] = coordinates
        const left = Math.min(c1.x, c2.x)
        const right = Math.max(Math.max(c1.x, c2.x), left + 120)
        const precision = chart.getSymbol()?.pricePrecision ?? 2
        const fillOpacity = numericStyle(overlay.styles, 'fillOpacity', 8)
        const lineWidth = numericStyle(overlay.styles, 'lineWidth', 1)
        const lineStyle = stringStyle(overlay.styles, 'lineStyle', 'solid')
        const levels = FIB_LEVELS.map((level, index) => {
          const price = fibLevelPrice(first, second, level)
          return { level, price, y: yAxis.convertToPixel(price), color: FIB_COLORS[index % FIB_COLORS.length] }
        })

        const bands = levels.slice(1).map((current, index) => {
          const previous = levels[index]
          return {
            type: 'rect',
            attrs: {
              x: left,
              y: Math.min(previous.y, current.y),
              width: right - left,
              height: Math.abs(current.y - previous.y),
            },
            styles: { style: 'fill', color: rgba(current.color, fillOpacity), borderSize: 0 },
            ignoreEvent: true,
          }
        })
        const lines = levels.map((item) => ({
          type: 'line',
          attrs: { coordinates: [{ x: left, y: item.y }, { x: right, y: item.y }] },
          styles: { color: item.color, size: lineWidth, style: lineStyle, dashedValue: [4, 4] },
        }))
        const labels = levels.map((item) => ({
          type: 'text',
          attrs: {
            x: left + 4,
            y: item.y - 2,
            text: `${item.level} (${formatPositionNumber(item.price, precision)})`,
            align: 'left',
            baseline: 'bottom',
          },
          styles: {
            color: item.color,
            size: 11,
            family: 'Inter, system-ui, sans-serif',
            weight: 600,
            style: 'fill',
            backgroundColor: 'transparent',
            paddingLeft: 0,
            paddingRight: 0,
            paddingTop: 0,
            paddingBottom: 0,
          },
          ignoreEvent: true,
        }))

        return [
          ...bands,
          ...lines,
          {
            type: 'line',
            attrs: { coordinates: [c1, c2] },
            styles: { color: '#787b86', size: 1, style: 'dashed', dashedValue: [3, 3] },
          },
          ...labels,
        ]
      },
    })
  }
}
