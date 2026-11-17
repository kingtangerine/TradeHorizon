import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { STUDIES, clampParam, newStudy, type Study } from '../chart/studies'
import { ColorPicker } from './ColorPicker'
import { CloseIcon } from './Icons'

// Settings of one library study (gear button in the legend): inputs and line colours, like TradingView's
// Inputs and Style tabs on one page. Changes apply as they are made.

interface StudySettingsDialogProps {
  study: Study
  onChange(study: Study): void
  onRemove(): void
  onClose(): void
}

/** Settings window for one study's inputs and line colours; changes apply at once, and it can remove the study. */
export function StudySettingsDialog({ study, onChange, onRemove, onClose }: StudySettingsDialogProps) {
  const definition = STUDIES[study.type]
  // Typed text is kept while editing so "1" on the way to "14" is not clamped straight away.
  const [drafts, setDrafts] = useState(() => study.params.map(String))

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', escape)
    return () => globalThis.removeEventListener('keydown', escape)
  }, [onClose])

  const commit = (index: number, text: string) => {
    const value = clampParam(definition.params[index], Number(text))
    setDrafts((current) => current.map((item, position) => (position === index ? String(value) : item)))
    if (value !== study.params[index])
      onChange({ ...study, params: study.params.map((item, position) => (position === index ? value : item)) })
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="chart-settings-dialog study-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${definition.name} settings`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>{definition.name}</strong>
          <button type="button" className="object-icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="chart-settings-panel">
          <p className="chart-settings-note">{definition.description}</p>
          <h4>Inputs</h4>
          {definition.params.map((param, index) => (
            <label className="chart-settings-row" key={param.label}>
              <span>{param.label}</span>
              <input
                type="number"
                className="study-input"
                min={param.min}
                max={param.max}
                step={param.step ?? 1}
                value={drafts[index]}
                onChange={(event) =>
                  setDrafts((current) => current.map((item, position) => (position === index ? event.target.value : item)))
                }
                onBlur={(event) => commit(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit(index, (event.target as HTMLInputElement).value)
                }}
              />
            </label>
          ))}
          <h4>Style</h4>
          {definition.lines.map((line, index) => (
            <div className="chart-settings-row" key={line.key}>
              <span>{line.label}</span>
              <ColorPicker
                label={`${line.label} colour`}
                value={study.colors[index]}
                onChange={(color) =>
                  onChange({ ...study, colors: study.colors.map((item, position) => (position === index ? color : item)) })
                }
              />
            </div>
          ))}
          <label className="chart-settings-row">
            <span>Visible</span>
            <input type="checkbox" checked={study.visible} onChange={(event) => onChange({ ...study, visible: event.target.checked })} />
          </label>
        </div>
        <footer>
          <span className="chart-settings-inline">
            <button
              type="button"
              onClick={() => {
                const fresh = { ...newStudy(study.type, study.id), visible: study.visible }
                setDrafts(fresh.params.map(String))
                onChange(fresh)
              }}
            >
              Defaults
            </button>
            <button type="button" onClick={onRemove}>
              Remove
            </button>
          </span>
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
