// Chart image for the camera button (TradingView's "Download image" / "Copy image"). The chart canvas does not contain
// the legend (it is HTML), so the image gets its own header: symbol, timeframe, venue, the candle's prices and a time stamp.
import { localTime } from '../chart/timeAxis'
import { formatPrice } from './format'
import { candleChange, type LegendCandle } from './LegendValues'

/** One piece of the snapshot header's value line, drawn in the given tone. */
export interface SnapshotPart {
  readonly text: string
  /** 'label' for O/H/L/C, 'up'/'down' for coloured values. */
  readonly tone: 'label' | 'up' | 'down'
}

/** The chart canvas rendered as an image, plus the size and background needed to compose the snapshot. */
export interface ChartPicture {
  /** PNG data URL from the chart (already at the screen's pixel ratio). */
  readonly url: string
  /** Size in CSS pixels. */
  readonly width: number
  readonly height: number
  readonly background: string
}

/** Everything needed to draw a chart snapshot: the chart picture and the header text. */
export interface SnapshotInput {
  readonly chart: ChartPicture
  /** "BTC / USDT · 1h · Binance" */
  readonly title: string
  readonly values: readonly SnapshotPart[]
  /** Right side of the header: app name and time. */
  readonly stamp: string
  readonly dark: boolean
}

const HEADER_HEIGHT = 56
const UP = '#089981'
const DOWN = '#f23645'

/** O/H/L/C and change, coloured like the legend (values follow the candle's direction, the change its sign). */
export function snapshotValues(candle: LegendCandle, precision: number): SnapshotPart[] {
  const tone = candle.close >= candle.open ? 'up' : 'down'
  const change = candleChange(candle)
  const sign = change.value >= 0 ? '+' : '−'
  return [
    { text: 'O', tone: 'label' },
    { text: formatPrice(candle.open, precision), tone },
    { text: 'H', tone: 'label' },
    { text: formatPrice(candle.high, precision), tone },
    { text: 'L', tone: 'label' },
    { text: formatPrice(candle.low, precision), tone },
    { text: 'C', tone: 'label' },
    { text: formatPrice(candle.close, precision), tone },
    {
      text: `${sign}${formatPrice(Math.abs(change.value), precision)} (${sign}${Math.abs(change.percent).toFixed(2)}%)`,
      tone: change.value >= 0 ? 'up' : 'down',
    },
  ]
}

/** "BTCUSDT_1h_2026-11-02_13-45.png", in the chart's time zone. */
export function snapshotFileName(symbol: string, interval: string, timestampMs: number, timeZone: string): string {
  const time = localTime(timestampMs, timeZone)
  const two = (value: number) => String(value).padStart(2, '0')
  const safe = (text: string) => text.replace(/[^A-Za-z0-9.-]+/g, '-')
  return `${safe(symbol)}_${safe(interval)}_${time.year}-${two(time.month + 1)}-${two(time.day)}_${two(time.hour)}-${two(time.minute)}.png`
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The chart picture could not be read'))
    image.src = url
  })
}

/** The finished PNG: header on top, the chart below. */
export async function composeSnapshot(input: SnapshotInput): Promise<Blob> {
  const { chart } = input
  const image = await loadImage(chart.url)
  const ratio = chart.width > 0 ? image.naturalWidth / chart.width : 1
  const width = chart.width
  const height = chart.height + HEADER_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Images are not supported in this browser')
  context.scale(ratio, ratio)

  const text = input.dark ? '#d1d4dc' : '#131722'
  const muted = input.dark ? '#787b86' : '#6a6d78'
  const line = input.dark ? '#2a2e39' : '#e0e3eb'
  const font = (weight: number, size: number) =>
    `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif`

  context.fillStyle = chart.background
  context.fillRect(0, 0, width, height)
  context.textBaseline = 'middle'

  context.font = font(400, 12)
  context.textAlign = 'right'
  context.fillStyle = muted
  context.fillText(input.stamp, width - 14, 18)
  const stampWidth = context.measureText(input.stamp).width

  context.textAlign = 'left'
  context.font = font(600, 15)
  context.fillStyle = text
  context.fillText(input.title, 14, 18, Math.max(80, width - stampWidth - 44))

  context.font = font(400, 13)
  let x = 14
  for (const part of input.values) {
    context.fillStyle = part.tone === 'label' ? muted : part.tone === 'up' ? UP : DOWN
    context.fillText(part.text, x, 40)
    x += context.measureText(part.text).width + (part.tone === 'label' ? 4 : 10)
  }

  context.fillStyle = line
  context.fillRect(0, HEADER_HEIGHT - 1, width, 1)
  context.drawImage(image, 0, HEADER_HEIGHT, width, chart.height)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be created'))), 'image/png')
  })
}

/** Saves a blob to the user's downloads under the given file name via a temporary link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Copies the image. The blob is passed as a promise so Safari still sees the click that asked for it. */
export async function copyImage(blob: Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('This browser cannot copy images')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
