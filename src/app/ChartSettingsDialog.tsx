import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ScaleMode } from '../chart/KLineChartController'
import { ColorPicker } from './ColorPicker'
import { CloseIcon } from './Icons'
import { DEFAULT_APPEARANCE, type ChartAppearance, type GridLines, type Preferences } from './preferences'
import { AUTO_TIME_ZONE, TIME_ZONES, browserTimeZone, timeZoneLabel } from './timeZones'

// TradingView's chart settings window (right-click → Settings): Symbol, Canvas and Scales tabs. Every change applies
// at once; the values are per-user preferences, synced with the account.

type Tab = 'symbol' | 'canvas' | 'scales'

interface ChartSettingsDialogProps {
  preferences: Preferences
  onPreferences(update: (current: Preferences) => Preferences): void
  scaleMode: ScaleMode
  onScaleMode(mode: ScaleMode): void
  onClose(): void
}

const GRID_LABELS: Record<GridLines, string> = { both: 'Vertical and horizontal', vertical: 'Vertical only', horizontal: 'Horizontal only', none: 'None' }

export function ChartSettingsDialog({ preferences, onPreferences, scaleMode, onScaleMode, onClose }: ChartSettingsDialogProps) {
  const [tab, setTab] = useState<Tab>('symbol')
  const appearance = preferences.appearance
  const setAppearance = (patch: Partial<ChartAppearance>) => onPreferences((current) => ({ ...current, appearance: { ...current.appearance, ...patch } }))
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => onPreferences((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    globalThis.addEventListener('keydown', escape)
    return () => globalThis.removeEventListener('keydown', escape)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="chart-settings-dialog" role="dialog" aria-modal="true" aria-label="Chart settings" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <strong>Settings</strong>
          <button type="button" className="object-icon-button" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="chart-settings-body">
          <nav aria-label="Settings sections">
            {(['symbol', 'canvas', 'scales'] as const).map((item) => (
              <button type="button" key={item} className={tab === item ? 'active' : ''} aria-current={tab === item} onClick={() => setTab(item)}>
                {item === 'symbol' ? 'Symbol' : item === 'canvas' ? 'Canvas' : 'Scales and time'}
              </button>
            ))}
          </nav>
          <div className="chart-settings-panel">
            {tab === 'symbol' && (
              <>
                <h4>Candles</h4>
                <div className="chart-settings-row">
                  <span>Up colour</span>
                  <ColorPicker label="Up candle colour" value={appearance.upColor} onChange={(upColor) => setAppearance({ upColor })} />
                </div>
                <div className="chart-settings-row">
                  <span>Down colour</span>
                  <ColorPicker label="Down candle colour" value={appearance.downColor} onChange={(downColor) => setAppearance({ downColor })} />
                </div>
                <label className="chart-settings-row">
                  <span>Wicks</span>
                  <input type="checkbox" checked={appearance.wicks} onChange={(event) => setAppearance({ wicks: event.target.checked })} />
                </label>
                <p className="chart-settings-note">Volume bars and Heikin Ashi candles use the same colours.</p>
              </>
            )}
            {tab === 'canvas' && (
              <>
                <h4>Chart background</h4>
                <div className="chart-settings-row">
                  <span>Background</span>
                  <span className="chart-settings-inline">
                    <select value={appearance.background ? 'custom' : 'theme'} onChange={(event) => setAppearance({ background: event.target.value === 'custom' ? (appearance.background ?? '#131722') : null })}>
                      <option value="theme">Theme default</option>
                      <option value="custom">Solid colour</option>
                    </select>
                    {appearance.background && <ColorPicker label="Background colour" value={appearance.background} onChange={(background) => setAppearance({ background })} />}
                  </span>
                </div>
                <div className="chart-settings-row">
                  <span>Grid lines</span>
                  <select value={appearance.grid} onChange={(event) => setAppearance({ grid: event.target.value as GridLines })}>
                    {(Object.keys(GRID_LABELS) as GridLines[]).map((value) => <option value={value} key={value}>{GRID_LABELS[value]}</option>)}
                  </select>
                </div>
              </>
            )}
            {tab === 'scales' && (
              <>
                <h4>Price scale</h4>
                <div className="chart-settings-row">
                  <span>Scale</span>
                  <select value={scaleMode} onChange={(event) => onScaleMode(event.target.value as ScaleMode)}>
                    <option value="normal">Regular</option>
                    <option value="log">Logarithmic</option>
                    <option value="percent">Percent</option>
                  </select>
                </div>
                <label className="chart-settings-row">
                  <span>Last price line</span>
                  <input type="checkbox" checked={appearance.lastPriceLine} onChange={(event) => setAppearance({ lastPriceLine: event.target.checked })} />
                </label>
                <label className="chart-settings-row">
                  <span>Candle countdown</span>
                  <input type="checkbox" checked={preferences.candleCountdown} onChange={(event) => set('candleCountdown', event.target.checked)} />
                </label>
                <label className="chart-settings-row">
                  <span>High and low price labels</span>
                  <input type="checkbox" checked={preferences.highLowLabels} onChange={(event) => set('highLowLabels', event.target.checked)} />
                </label>
                <label className="chart-settings-row">
                  <span>Alert lines</span>
                  <input type="checkbox" checked={preferences.alertLines} onChange={(event) => set('alertLines', event.target.checked)} />
                </label>
                <h4>Time scale</h4>
                <div className="chart-settings-row">
                  <span>Time zone</span>
                  <select value={preferences.timeZone} onChange={(event) => set('timeZone', event.target.value)}>
                    <option value={AUTO_TIME_ZONE}>Your computer · {timeZoneLabel(browserTimeZone())}</option>
                    {TIME_ZONES.map(({ zone }) => <option value={zone} key={zone}>{timeZoneLabel(zone)}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>
        <footer>
          <button type="button" onClick={() => onPreferences((current) => ({ ...current, appearance: DEFAULT_APPEARANCE }))}>Reset colours and canvas</button>
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
