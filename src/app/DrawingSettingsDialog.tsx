import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  INTERVAL_GROUPS,
  INTERVAL_GROUP_LABELS,
  MAX_FIB_ROWS,
  TV_FIB_ROWS,
  fibLevelText,
  fibSettings,
  hiddenGroups,
  type FibLevelRow,
} from '../chart/drawingVisibility'
import { zonedInputToTime } from '../chart/dateRanges'
import { localTime } from '../chart/timeAxis'
import { DRAWING_TOOLS } from '../chart/tools'
import { isDecimalPrice, type Anchor, type Drawing, type DrawingUpdate, type JsonValue } from '../drawings'
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
const FILLED = new Set<Drawing['type']>(['rectangle', 'ellipse', 'parallelChannel', 'pitchfork', 'dateRange'])

const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

export function DrawingSettingsDialog({
  drawing,
  timeZone,
  pricePrecision,
  initialTab = 'style',
  onUpdate,
  onClose,
}: DrawingSettingsDialogProps) {
  const [tab, setTab] = useState<DrawingSettingsTab>(initialTab)
  const tool = DRAWING_TOOLS[drawing.type]
  const style = drawing.style
  const setStyle = (changes: Record<string, JsonValue>) => onUpdate({ style: { ...style, ...changes } })
  const position = drawing.type === 'longPosition' || drawing.type === 'shortPosition'

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', escape)
    return () => globalThis.removeEventListener('keydown', escape)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="chart-settings-dialog drawing-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${tool.label} settings`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>{tool.label}</strong>
          <button type="button" className="object-icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="chart-settings-body">
          <nav aria-label="Settings sections">
            {(['style', 'coordinates', 'visibility'] as const).map((item) => (
              <button
                type="button"
                key={item}
                className={tab === item ? 'active' : ''}
                aria-current={tab === item}
                onClick={() => setTab(item)}
              >
                {item === 'style' ? 'Style' : item === 'coordinates' ? 'Coordinates' : 'Visibility'}
              </button>
            ))}
          </nav>
          <div className="chart-settings-panel">
            {tab === 'style' && <StyleTab drawing={drawing} position={position} setStyle={setStyle} />}
            {tab === 'coordinates' && drawing.type === 'brush' && (
              <p className="chart-settings-note">A brush stroke has too many points to type in; drag it on the chart to move it.</p>
            )}
            {tab === 'coordinates' && drawing.type !== 'brush' && (
              <CoordinatesTab
                drawing={drawing}
                timeZone={timeZone}
                pricePrecision={pricePrecision}
                onAnchors={(anchors) => onUpdate({ anchors })}
              />
            )}
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
                        onChange={(event) =>
                          setStyle({ hiddenOn: event.target.checked ? hidden.filter((item) => item !== group) : [...hidden, group] })
                        }
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
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

function StyleTab({
  drawing,
  position,
  setStyle,
}: {
  drawing: Drawing
  position: boolean
  setStyle(changes: Record<string, JsonValue>): void
}) {
  const style = drawing.style
  const type = drawing.type
  return (
    <>
      {position ? (
        <>
          <div className="chart-settings-row">
            <span>Target colour</span>
            <ColorPicker
              label="Target colour"
              value={text(style.targetColor, '#16a085')}
              onChange={(targetColor) => setStyle({ targetColor })}
            />
          </div>
          <div className="chart-settings-row">
            <span>Stop colour</span>
            <ColorPicker label="Stop colour" value={text(style.stopColor, '#f0445e')} onChange={(stopColor) => setStyle({ stopColor })} />
          </div>
          <p className="chart-settings-note">
            Risk, quantity and DCA are in the position&apos;s own settings (gear button on its toolbar).
          </p>
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
                  {[1, 2, 3, 4, 5].map((width) => (
                    <option value={width} key={width}>
                      {width}px
                    </option>
                  ))}
                </select>
              </label>
              <label className="chart-settings-row">
                <span>Line style</span>
                <select
                  value={style.lineStyle === 'dashed' ? 'dashed' : 'solid'}
                  onChange={(event) => setStyle({ lineStyle: event.target.value })}
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                </select>
              </label>
            </>
          )}
          {FILLED.has(type) && (
            <>
              {type !== 'fibRetracement' && (
                <div className="chart-settings-row">
                  <span>Fill colour</span>
                  <ColorPicker
                    label="Fill colour"
                    value={text(style.fillColor, '#3aa9ff')}
                    onChange={(fillColor) => setStyle({ fillColor })}
                  />
                </div>
              )}
              <label className="chart-settings-row">
                <span>Fill opacity</span>
                <span className="chart-settings-inline">
                  <input
                    type="range"
                    min="0"
                    max="60"
                    value={num(style.fillOpacity, type === 'rectangle' ? 14 : 8)}
                    onChange={(event) => setStyle({ fillOpacity: Number(event.target.value) })}
                  />
                  <small>{num(style.fillOpacity, type === 'rectangle' ? 14 : 8)}%</small>
                </span>
              </label>
            </>
          )}
          {type === 'priceLabel' && (
            <label className="chart-settings-row">
              <span>Label</span>
              <input
                className="study-input wide"
                value={text(style.text, 'Text') === 'Text' ? '' : text(style.text, '')}
                placeholder="The price (default)"
                maxLength={80}
                onChange={(event) => setStyle({ text: event.target.value || 'Text' })}
              />
            </label>
          )}
          {type === 'text' && (
            <>
              <label className="chart-settings-row">
                <span>Text</span>
                <input
                  className="study-input wide"
                  value={text(style.text, 'Text')}
                  maxLength={200}
                  onChange={(event) => setStyle({ text: event.target.value })}
                />
              </label>
              <label className="chart-settings-row">
                <span>Font size</span>
                <select value={num(style.fontSize, 14)} onChange={(event) => setStyle({ fontSize: Number(event.target.value) })}>
                  {[10, 12, 14, 16, 20, 24, 32, 48].map((size) => (
                    <option value={size} key={size}>
                      {size}px
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {type === 'fibRetracement' && <FibSection style={style} setStyle={setStyle} />}
        </>
      )}
    </>
  )
}

/** Fibonacci retracement, as TradingView's Style tab: the level table (on, value, colour) and the line and label options. */
function FibSection({ style, setStyle }: { style: Drawing['style']; setStyle(changes: Record<string, JsonValue>): void }) {
  const settings = fibSettings(style)
  const setRows = (rows: readonly FibLevelRow[]) => setStyle({ fibRows: rows.map((row) => ({ v: row.v, c: row.c, on: row.on })) })
  const updateRow = (index: number, patch: Partial<FibLevelRow>) =>
    setRows(settings.rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  const toggle = (key: string, label: string, value: boolean) => (
    <label className="chart-settings-row">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(event) => setStyle({ [key]: event.target.checked })} />
    </label>
  )
  return (
    <>
      {toggle('fibTrend', 'Trend line', settings.trend)}
      <h4>Levels</h4>
      <div className="fib-grid">
        {settings.rows.map((row, index) => (
          <div className={row.on ? 'fib-row' : 'fib-row off'} key={`${index}-${row.v}`}>
            <input
              type="checkbox"
              checked={row.on}
              aria-label={`Show level ${row.v}`}
              onChange={(event) => updateRow(index, { on: event.target.checked })}
            />
            <input
              type="number"
              step="0.001"
              className="fib-value"
              defaultValue={row.v}
              aria-label="Level"
              onBlur={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value) && value >= -5 && value <= 10 && value !== row.v) updateRow(index, { v: value })
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              }}
            />
            <ColorPicker
              label={`Colour of level ${row.v}`}
              value={settings.oneColor ?? row.c}
              onChange={(color) => updateRow(index, { c: color })}
            />
            <button
              type="button"
              className="fib-remove"
              aria-label={`Remove level ${row.v}`}
              disabled={settings.rows.length <= 1}
              onClick={() => setRows(settings.rows.filter((_, position) => position !== index))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="chart-settings-inline fib-actions">
        <button
          type="button"
          className="small-button"
          disabled={settings.rows.length >= MAX_FIB_ROWS}
          onClick={() =>
            setRows([...settings.rows, { v: Math.max(0, ...settings.rows.map((row) => row.v)) + 0.5, c: '#2962ff', on: true }])
          }
        >
          Add level
        </button>
        <button type="button" className="small-button" onClick={() => setRows(TV_FIB_ROWS)}>
          TradingView defaults
        </button>
      </div>
      <div className="chart-settings-row">
        <span>Use one colour</span>
        <span className="chart-settings-inline">
          <input
            type="checkbox"
            checked={settings.oneColor !== null}
            onChange={(event) => setStyle({ fibOneColor: event.target.checked ? '#2962ff' : null })}
          />
          {settings.oneColor && (
            <ColorPicker label="Colour of all levels" value={settings.oneColor} onChange={(color) => setStyle({ fibOneColor: color })} />
          )}
        </span>
      </div>
      <h4>Lines</h4>
      {toggle('fibExtendLeft', 'Extend lines left', settings.extendLeft)}
      {toggle('fibExtendRight', 'Extend lines right', settings.extendRight)}
      <div className="chart-settings-row">
        <span>Background</span>
        <span className="chart-settings-inline">
          <input type="checkbox" checked={settings.background} onChange={(event) => setStyle({ fibBackground: event.target.checked })} />
          <input
            type="range"
            min="0"
            max="60"
            disabled={!settings.background}
            value={typeof style.fillOpacity === 'number' ? style.fillOpacity : 8}
            aria-label="Background opacity"
            onChange={(event) => setStyle({ fillOpacity: Number(event.target.value) })}
          />
        </span>
      </div>
      {toggle('fibReverse', 'Reverse', settings.reverse)}
      <h4>Labels</h4>
      {toggle('fibPrices', 'Prices', settings.prices)}
      {toggle('fibLevelsText', 'Levels', settings.levels)}
      <label className="chart-settings-row">
        <span>Levels as</span>
        <select
          value={settings.percent ? 'percent' : 'values'}
          onChange={(event) => setStyle({ fibPercent: event.target.value === 'percent' })}
        >
          <option value="values">Values ({fibLevelText(0.618, false)})</option>
          <option value="percent">Percents ({fibLevelText(0.618, true)})</option>
        </select>
      </label>
      <label className="chart-settings-row">
        <span>Labels on the</span>
        <select value={settings.labelSide} onChange={(event) => setStyle({ fibLabelSide: event.target.value })}>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </label>
    </>
  )
}

function CoordinatesTab({
  drawing,
  timeZone,
  pricePrecision,
  onAnchors,
}: {
  drawing: Drawing
  timeZone: string
  pricePrecision: number
  onAnchors(anchors: readonly Anchor[]): void
}) {
  const names = ANCHOR_NAMES[drawing.type] ?? []
  const [drafts, setDrafts] = useState(() =>
    drawing.anchors.map((anchor) => ({ price: anchor.price, time: timeInput(anchor.timeMs, timeZone) })),
  )
  const [error, setError] = useState('')

  const commit = (index: number, draft: { price: string; time: string }) => {
    const price = draft.price.trim()
    const timeMs = zonedInputToTime(draft.time, timeZone)
    if (!isDecimalPrice(price) || Number(price) <= 0) {
      setError('Prices are plain positive numbers, like 67250.5')
      return
    }
    if (timeMs === undefined) {
      setError('Enter a date and time')
      return
    }
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
              onChange={(event) =>
                setDrafts((current) =>
                  current.map((item, position) => (position === index ? { ...item, price: event.target.value } : item)),
                )
              }
              onBlur={() => commit(index, drafts[index])}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit(index, drafts[index])
              }}
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
