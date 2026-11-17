import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { EXAMPLE_SCRIPT, MAX_SOURCE_LENGTH, SCRIPT_HELP } from '../chart/script'
import { compiledScript } from '../chart/scriptIndicator'
import type { ScriptInstance } from '../chart/indicators'
import { CloseIcon } from './Icons'
import type { UserScript } from './scripts'

// The script editor (TradingView's Pine Editor, as a window): name, code, the first mistake with its line,
// and a short reference. "Save and add to chart" puts it on the chart at once.

interface ScriptEditorDialogProps {
  script?: UserScript
  onSave(script: UserScript, addToChart: boolean): void
  onClose(): void
}

export function ScriptEditorDialog({ script, onSave, onClose }: ScriptEditorDialogProps) {
  const [name, setName] = useState(script?.name ?? '')
  const [source, setSource] = useState(script?.source ?? EXAMPLE_SCRIPT)
  const [checked, setChecked] = useState(source)

  // Check the code a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setChecked(source), 400)
    return () => clearTimeout(timer)
  }, [source])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', escape)
    return () => globalThis.removeEventListener('keydown', escape)
  }, [onClose])

  const result = useMemo(() => compiledScript(checked), [checked])
  const error = result instanceof Error ? result.message : undefined
  const save = (addToChart: boolean) => {
    const compiled = compiledScript(source)
    if (compiled instanceof Error) {
      setChecked(source)
      return
    }
    onSave(
      { id: script?.id ?? crypto.randomUUID(), name: name.trim() || compiled.title || 'My script', source, updatedAtMs: Date.now() },
      addToChart,
    )
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="script-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Script editor"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <input
            className="script-name"
            value={name}
            maxLength={60}
            placeholder={result instanceof Error ? 'Script name' : result.title}
            aria-label="Script name"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="button" className="object-icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="script-editor-body">
          <textarea
            className="script-code"
            spellCheck={false}
            value={source}
            maxLength={MAX_SOURCE_LENGTH}
            aria-label="Script code"
            onChange={(event) => setSource(event.target.value)}
            onKeyDown={(event) => {
              // Tab indents instead of leaving the box.
              if (event.key !== 'Tab') return
              event.preventDefault()
              const target = event.currentTarget
              const start = target.selectionStart
              const next = `${source.slice(0, start)}  ${source.slice(target.selectionEnd)}`
              setSource(next)
              requestAnimationFrame(() => {
                target.selectionStart = target.selectionEnd = start + 2
              })
            }}
          />
          <aside className="script-help">
            <strong>Reference</strong>
            <ul>
              {SCRIPT_HELP.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button type="button" className="small-button" onClick={() => setSource(EXAMPLE_SCRIPT)}>
              Load the example
            </button>
          </aside>
        </div>
        <footer>
          <span className={error ? 'script-status error' : 'script-status'} role="status">
            {error ??
              (result instanceof Error
                ? ''
                : `OK · ${result.overlay ? 'drawn on the candles' : 'in its own pane'}${result.inputs.length ? ` · inputs: ${result.inputs.map((input) => input.title).join(', ')}` : ''}`)}
          </span>
          <span className="chart-settings-inline">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" disabled={!!error} onClick={() => save(false)}>
              Save
            </button>
            <button type="button" className="primary" disabled={!!error} onClick={() => save(true)}>
              Save and add to chart
            </button>
          </span>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

interface ScriptSettingsDialogProps {
  instance: ScriptInstance
  onChange(instance: ScriptInstance): void
  onEdit(): void
  onRemove(): void
  onClose(): void
}

/** Settings of one script on the chart: its inputs (only for this chart) and visibility. */
export function ScriptSettingsDialog({ instance, onChange, onEdit, onRemove, onClose }: ScriptSettingsDialogProps) {
  const compiled = compiledScript(instance.source)
  const inputs = compiled instanceof Error ? [] : compiled.inputs
  const [drafts, setDrafts] = useState(() => inputs.map((input, index) => String(instance.inputs[index] ?? input.defaultValue)))

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', escape)
    return () => globalThis.removeEventListener('keydown', escape)
  }, [onClose])

  const commit = (index: number, text: string) => {
    const value = Number(text)
    if (!Number.isFinite(value)) return
    const next = inputs.map((input, position) => (position === index ? value : (instance.inputs[position] ?? input.defaultValue)))
    onChange({ ...instance, inputs: next })
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="chart-settings-dialog study-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${instance.name} settings`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>{instance.name}</strong>
          <button type="button" className="object-icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="chart-settings-panel">
          {compiled instanceof Error && <p className="chart-settings-note error">{compiled.message}</p>}
          <h4>Inputs</h4>
          {inputs.length === 0 && <p className="chart-settings-note">This script has no inputs. Add some with input(14, "Length").</p>}
          {inputs.map((input, index) => (
            <label className="chart-settings-row" key={`${input.title}-${index}`}>
              <span>{input.title}</span>
              <input
                type="number"
                step="any"
                className="study-input"
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
          <label className="chart-settings-row">
            <span>Visible</span>
            <input
              type="checkbox"
              checked={instance.visible}
              onChange={(event) => onChange({ ...instance, visible: event.target.checked })}
            />
          </label>
        </div>
        <footer>
          <span className="chart-settings-inline">
            <button type="button" onClick={onEdit}>
              Edit script
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
