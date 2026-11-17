import type { Dispatch, SetStateAction } from 'react'
import { DRAWING_TOOLS } from '../../chart/tools'
import type { Drawing } from '../../drawings'
import { ColorPicker } from '../ColorPicker'
import { CloseIcon, LongPositionIcon, ShortPositionIcon } from '../Icons'
import { colorInputValue, styleNumber } from './workspaceHelpers'

interface PositionSettingsDialogProps {
  /** A long or short position drawing. */
  selectedDrawing: Drawing
  /** Currency the account size is in (the market's quote asset). */
  quoteAsset: string
  updateSelectedStyle(changes: Record<string, string | number | boolean>): void
  setPositionSettingsOpen: Dispatch<SetStateAction<boolean>>
}

/** Settings window of a long or short position: risk inputs (account size, risk, DCA size) and colors. */
export function PositionSettingsDialog({
  selectedDrawing,
  quoteAsset,
  updateSelectedStyle,
  setPositionSettingsOpen,
}: PositionSettingsDialogProps) {
  return (
    <div className="position-settings-backdrop" role="presentation" onMouseDown={() => setPositionSettingsOpen(false)}>
      <section
        className="position-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            {selectedDrawing.type === 'shortPosition' ? <ShortPositionIcon /> : <LongPositionIcon />}
            <div>
              <small>Drawing properties</small>
              <h2 id="position-settings-title">{DRAWING_TOOLS[selectedDrawing.type].label}</h2>
            </div>
          </div>
          <button type="button" aria-label="Close settings" onClick={() => setPositionSettingsOpen(false)}>
            <CloseIcon />
          </button>
        </header>

        <div className="position-settings-section">
          <h3>Risk inputs</h3>
          <div className="position-settings-grid">
            <label>
              <span>
                Account size <small>{quoteAsset}</small>
              </span>
              <input
                type="number"
                min="0"
                step="100"
                value={styleNumber(selectedDrawing.style.accountSize, 10000)}
                onChange={(event) => updateSelectedStyle({ accountSize: Math.max(0, Number(event.target.value)) })}
              />
            </label>
            <label>
              <span>
                Risk per trade <small>%</small>
              </span>
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.1"
                value={styleNumber(selectedDrawing.style.riskPercent, 1)}
                onChange={(event) => updateSelectedStyle({ riskPercent: Math.max(0.01, Math.min(100, Number(event.target.value))) })}
              />
            </label>
          </div>
          {selectedDrawing.anchors.length > 3 && (
            <div className="position-settings-grid">
              <label>
                <span>
                  DCA size <small>× entry order</small>
                </span>
                <input
                  type="number"
                  min="0.1"
                  max="20"
                  step="0.1"
                  value={styleNumber(selectedDrawing.style.dcaSize, 1)}
                  onChange={(event) => updateSelectedStyle({ dcaSize: Math.max(0.1, Math.min(20, Number(event.target.value) || 1)) })}
                />
              </label>
            </div>
          )}
          <p>Position quantity is calculated automatically from account size, risk percentage, entry, and stop distance.</p>
        </div>

        <div className="position-settings-section">
          <h3>Style</h3>
          <div className="position-settings-grid colors-grid">
            <label>
              <span>Target color</span>
              <ColorPicker
                label="Target color"
                value={colorInputValue(selectedDrawing.style.targetColor, '#16a085')}
                onChange={(color) => updateSelectedStyle({ targetColor: color })}
              />
            </label>
            <label>
              <span>Stop color</span>
              <ColorPicker
                label="Stop color"
                value={colorInputValue(selectedDrawing.style.stopColor, '#f0445e')}
                onChange={(color) => updateSelectedStyle({ stopColor: color })}
              />
            </label>
            <label>
              <span>Line color</span>
              <ColorPicker
                label="Line color"
                value={colorInputValue(selectedDrawing.style.lineColor, '#c7d0db')}
                onChange={(color) => updateSelectedStyle({ lineColor: color })}
              />
            </label>
            <label>
              <span>Text color</span>
              <ColorPicker
                label="Text color"
                value={colorInputValue(selectedDrawing.style.textColor, '#ffffff')}
                onChange={(color) => updateSelectedStyle({ textColor: color })}
              />
            </label>
            <label>
              <span>Line thickness</span>
              <select
                value={styleNumber(selectedDrawing.style.lineWidth, 1)}
                onChange={(event) => updateSelectedStyle({ lineWidth: Number(event.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((width) => (
                  <option value={width} key={width}>
                    {width}px
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                Fill opacity <small>{styleNumber(selectedDrawing.style.fillOpacity, 22)}%</small>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={styleNumber(selectedDrawing.style.fillOpacity, 22)}
                onChange={(event) => updateSelectedStyle({ fillOpacity: Number(event.target.value) })}
              />
            </label>
          </div>
        </div>

        <footer>
          <button type="button" onClick={() => setPositionSettingsOpen(false)}>
            Done
          </button>
        </footer>
      </section>
    </div>
  )
}
