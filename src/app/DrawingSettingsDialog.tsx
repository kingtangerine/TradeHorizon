import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { INTERVAL_GROUPS, INTERVAL_GROUP_LABELS, MAX_FIB_LEVELS, fibLevels, hiddenGroups } from '../chart/drawingVisibility'
import { zonedInputToTime } from '../chart/dateRanges'
import { localTime } from '../chart/timeAxis'
import { DRAWING_TOOLS } from '../chart/tools'
import { isDecimalPrice, type Anchor, type Drawing, type DrawingUpdate } from '../drawings'
import { ColorPicker } from './ColorPicker'
import { CloseIcon } from './Icons'

// TradingView's drawing settings window (double-click a drawing, or Settings… in its menu): Style, Coordinates and
// Visibility. Every change is a normal drawing update, so it syncs and can be undone.

export type DrawingSettingsTab = 'style' | 'coordinates' | 'visibility'

interface DrawingSettingsDialogProps {
  drawing: Drawing
  timeZone: string
  pricePrecision: number
  initialTab?: DrawingSettingsTab
  onUpdate(changes: DrawingUpdate): void
  onClose(): void
}

const ANCHOR_NAMES: Partial<Record<Drawing['type'], readonly string[]>> = {
  trendLine: ['Start', 'End'],
  ray: ['Start', 'Through'],
  rectangle: ['Corner 1', 'Corner 2'],
  parallelChannel: ['Start', 'End', 'Width'],
  pitchfork: ['Pivot', 'High', 'Low'],
  fibExtension: ['Swing start', 'Swing end', 'Projected from'],
  ellipse: ['Corner 1', 'Corner 2'],
  dateRange: ['Start', 'End'],
  datePriceRange: ['Start', 'End'],
  arrow: ['Tail', 'Head'],
  extendedLine: ['Point 1', 'Point 2'],
  priceRange: ['Start', 'End'],
  fibRetracement: ['Level 1', 'Level 0'],
  longPosition: ['Entry', 'Target', 'Stop', 'DCA'],
  shortPosition: ['Entry', 'Target', 'Stop', 'DCA'],
}

function timeInput(ms: number, timeZone: string): string {
  const t = localTime(ms, timeZone)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${t.year}-${two(t.month + 1)}-${two(t.day)}T${two(t.hour)}:${two(t.minute)}`
}

/** Tools with a fill colour and opacity. */
const FILLED = new Set<Drawing['type']>(['rectangle', 'fibRetracement', 'ellipse', 'parallelChannel', 'pitchfork', 'dateRange'])

const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

export function DrawingSettingsDialog({ drawing, timeZone, pricePrecision, initialTab = 'style', onUpdate, onClose }: DrawingSettingsDialogProps) {
  const [tab, setTab] = useState<DrawingSettingsTab>(initialTab)
  const tool = DRAWING_TOOLS[drawing.type]
  const style = drawing.style
  const setStyle = (changes: Record<string, string | number | boolean | readonly string[] | readonly number[] | null>) => onUpdate({ style: { ...style, ...changes } })
  const position = drawing.type === 'longPosition' || drawing.type === 'shortPosition'

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    globalThis.addEventListener('keydown', escape)
    return () => globalThis.removeEventListener('keydown', escape)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="chart-settings-dialog drawing-settings-dialog" role="dialog" aria-modal="true" aria-label={`${tool.label} settings`} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <strong>{tool.label}</strong>
          <button type="button" className="object-icon-button" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="chart-settings-body">
          <nav aria-label="Settings sections">
            {(['style', 'coordinates', 'visibility'] as const).map((item) => (
              <button type="button" key={item} className={tab === item ? 'active' : ''} aria-current={tab === item} onClick={() => setTab(item)}>
                {item === 'style' ? 'Style' : item === 'coordinates' ? 'Coordinates' : 'Visibility'}
              </button>
            ))}
          </nav>
          <div className="chart-settings-panel">
            {tab === 'style' && <StyleTab drawing={drawing} position={position} setStyle={setStyle} />}
            {tab === 'coordinates' && drawing.type === 'brush' && <p className="chart-settings-note">A brush stroke has too many points to type in; drag it on the chart to move it.</p>}
            {tab === 'coordinates' && drawing.type !== 'brush' && <CoordinatesTab drawing={drawing} timeZone={timeZone} pricePrecision={pricePrecision} onAnchors={(anchors) => onUpdate({ anchors })} />}
            {tab === 'visibility' && (
              <>
                <h4>Show on timeframes</h4>
                {INTERVAL_GROUPS.map((group) => {
                  const hidden = hiddenGroups(style)
                  return (
                    <label className="chart-settings-row" key={group}>
                      <span>{INTERVAL_GROUP_LABELS[group]}</span>
                      <input
                        type="checkbox"
                        checked={!hidden.includes(group)}
                        onChange={(event) => setStyle({ hiddenOn: event.target.checked ? hidden.filter((item) => item !== group) : [...hidden, group] })}
                      />
                    </label>
                  )
                })}
                <p className="chart-settings-note">For example, keep weekly levels off the 1-minute chart.</p>
              </>
            )}
          </div>
        </div>
        <footer>
          <span />
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

function StyleTab({ drawing, position, setStyle }: {
  drawing: Drawing
  position: boolean
  setStyle(changes: Record<string, string | number | boolean | readonly string[] | readonly number[] | null>): void
}) {
  const style = drawing.style
  const type = drawing.type
  const [levelDraft, setLevelDraft] = useState('')
  const levels = fibLevels(style)
  return (
    <>
      {position ? (
        <>
          <div className="chart-settings-row"><span>Target colour</span><ColorPicker label="Target colour" value={text(style.targetColor, '#16a085')} onChange={(targetColor) => setStyle({ targetColor })} /></div>
          <div className="chart-settings-row"><span>Stop colour</span><ColorPicker label="Stop colour" value={text(style.stopColor, '#f0445e')} onChange={(stopColor) => setStyle({ stopColor })} /></div>
          <p className="chart-settings-note">Risk, quantity and DCA are in the position&apos;s own settings (gear button on its toolbar).</p>
        </>
      ) : (
        <>
          {type !== 'fibRetracement' && type !== 'priceRange' && (
            <div className="chart-settings-row">
              <span>{type === 'text' ? 'Text colour' : 'Line colour'}</span>
              <ColorPicker
                label="Line colour"
                value={text(style.color, '#2962ff')}
                none={type === 'rectangle' && style.noBorder === true}
                onNone={type === 'rectangle' ? () => setStyle({ noBorder: true }) : undefined}
                onChange={(color) => setStyle({ color, noBorder: false })}
              />
            </div>
          )}
          {type !== 'text' && (
            <>
              <label className="chart-settings-row">
                <span>Line width</span>
                <select value={num(style.lineWidth, 2)} onChange={(event) => setStyle({ lineWidth: Number(event.target.value) })}>
                  {[1, 2, 3, 4, 5].map((width) => <option value={width} key={width}>{width}px</option>)}
                </select>
              </label>
              <label className="chart-settings-row">
                <span>Line style</span>
                <select value={style.lineStyle === 'dashed' ? 'dashed' : 'solid'} onChange={(event) => setStyle({ lineStyle: event.target.value })}>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                </select>
              </label>
            </>
          )}
          {FILLED.has(type) && (
            <>
              {type !== 'fibRetracement' && <div className="chart-settings-row"><span>Fill colour</span><ColorPicker label="Fill colour" value={text(style.fillColor, '#3aa9ff')} onChange={(fillColor) => setStyle({ fillColor })} /></div>}
              <label className="chart-settings-row">
                <span>Fill opacity</span>
                <span className="chart-settings-inline">
                  <input type="range" min="0" max="60" value={num(style.fillOpacity, type === 'rectangle' ? 14 : 8)} onChange={(event) => setStyle({ fillOpacity: Number(event.target.value) })} />
                  <small>{num(style.fillOpacity, type === 'rectangle' ? 14 : 8)}%</small>
                </span>
              </label>
            </>
          )}
          {type === 'priceLabel' && (
            <label className="chart-settings-row">
              <span>Label</span>
              <input className="study-input wide" value={text(style.text, 'Text') === 'Text' ? '' : text(style.text, '')} placeholder="The price (default)" maxLength={80} onChange={(event) => setStyle({ text: event.target.value || 'Text' })} />
            </label>
          )}
          {type === 'text' && (
            <>
              <label className="chart-settings-row">
                <span>Text</span>
                <input className="study-input wide" value={text(style.text, 'Text')} maxLength={200} onChange={(event) => setStyle({ text: event.target.value })} />
              </label>
              <label className="chart-settings-row">
                <span>Font size</span>
                <select value={num(style.fontSize, 14)} onChange={(event) => setStyle({ fontSize: Number(event.target.value) })}>
                  {[10, 12, 14, 16, 20, 24, 32, 48].map((size) => <option value={size} key={size}>{size}px</option>)}
                </select>
              </label>
            </>
          )}
          {type === 'fibRetracement' && (
            <>
              <h4>Levels</h4>
              <div className="fib-levels">
                {levels.map((level) => (
                  <span className="fib-level" key={level}>
                    {level}
                    <button type="button" aria-label={`Remove level ${level}`} disabled={levels.length <= 1} onClick={() => setStyle({ fibLevels: levels.filter((item) => item !== level) })}>×</button>
                  </span>
                ))}
              </div>
              <form
                className="chart-settings-row"
                onSubmit={(event) => {
                  event.preventDefault()
                  const value = Number(levelDraft)
                  if (!Number.isFinite(value) || value < -5 || value > 10 || levels.length >= MAX_FIB_LEVELS) return
                  setStyle({ fibLevels: [...levels, value] })
                  setLevelDraft('')
                }}
              >
                <span>Add level</span>
                <span className="chart-settings-inline">
                  <input className="study-input" type="number" step="0.001" placeholder="e.g. 2.618" value={levelDraft} onChange={(event) => setLevelDraft(event.target.value)} />
                  <button type="submit" className="small-button">Add</button>
                  <button type="button" className="small-button" onClick={() => setStyle({ fibLevels: null })}>Defaults</button>
                </span>
              </form>
            </>
          )}
        </>
      )}
    </>
  )
}

function CoordinatesTab({ drawing, timeZone, pricePrecision, onAnchors }: {
  drawing: Drawing
  timeZone: string
  pricePrecision: number
  onAnchors(anchors: readonly Anchor[]): void
}) {
  const names = ANCHOR_NAMES[drawing.type] ?? []
  const [drafts, setDrafts] = useState(() => drawing.anchors.map((anchor) => ({ price: anchor.price, time: timeInput(anchor.timeMs, timeZone) })))
  const [error, setError] = useState('')

  const commit = (index: number, draft: { price: string, time: string }) => {
    const price = draft.price.trim()
    const timeMs = zonedInputToTime(draft.time, timeZone)
    if (!isDecimalPrice(price) || Number(price) <= 0) { setError('Prices are plain positive numbers, like 67250.5'); return }
    if (timeMs === undefined) { setError('Enter a date and time'); return }
    setError('')
    const current = drawing.anchors[index]
    if (current.price === price && current.timeMs === timeMs) return
    // An anchor typed in by hand is no longer snapped to a candle.
    onAnchors(drawing.anchors.map((anchor, position) => (position === index ? { timeMs, price } : anchor)))
  }

  return (
    <>
      {drawing.anchors.map((anchor, index) => (
        <div className="coordinate-row" key={index}>
          <h4>{names[index] ?? `Point ${index + 1}`}</h4>
          <label className="chart-settings-row">
            <span>Price</span>
            <input
              className="study-input wide"
              inputMode="decimal"
              value={drafts[index].price}
              placeholder={Number(anchor.price).toFixed(pricePrecision)}
              onChange={(event) => setDrafts((current) => current.map((item, position) => (position === index ? { ...item, price: event.target.value } : item)))}
              onBlur={() => commit(index, drafts[index])}
              onKeyDown={(event) => { if (event.key === 'Enter') commit(index, drafts[index]) }}
            />
          </label>
          {drawing.type !== 'horizontalLine' && (
            <label className="chart-settings-row">
              <span>Time</span>
              <input
                type="datetime-local"
                className="study-input wide"
                value={drafts[index].time}
                onChange={(event) => {
                  const next = { ...drafts[index], time: event.target.value }
                  setDrafts((current) => current.map((item, position) => (position === index ? next : item)))
                  commit(index, next)
                }}
              />
            </label>
          )}
        </div>
      ))}
      {error && <p className="chart-settings-note error">{error}</p>}
    </>
  )
}
