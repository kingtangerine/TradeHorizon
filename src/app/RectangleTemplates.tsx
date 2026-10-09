import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, StarIcon, TemplateIcon } from './Icons'
import {
  deleteTemplate,
  saveTemplate,
  toggleDefaultTemplate,
  type RectangleStyle,
  type TemplateState,
} from './templates'

interface RectangleTemplatesProps {
  state: TemplateState
  /** Look of the selected rectangle, saved when the user presses Save. */
  current: RectangleStyle
  onApply(style: RectangleStyle): void
  onChange(next: TemplateState): void
}

function rgba(hex: string, opacityPercent: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacityPercent / 100})`
}

export function RectangleTemplates({ state, current, onApply, onChange }: RectangleTemplatesProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event.target instanceof Node && (popoverRef.current?.contains(event.target) || buttonRef.current?.contains(event.target))) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect && !open) {
      setPosition({
        top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 380)),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
      })
    }
    setOpen((value) => !value)
  }

  const save = () => {
    onChange(saveTemplate(state, name, current))
    setName('')
  }

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className={open ? 'toolbar-action active' : 'toolbar-action'}
        aria-label="Rectangle templates"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Templates: save and reuse a rectangle's colors"
        onClick={toggle}
      >
        <TemplateIcon />
      </button>
      {open && createPortal(
        <div ref={popoverRef} className="template-popover" role="dialog" aria-label="Rectangle templates" style={position}>
          <strong>Rectangle templates</strong>
          {state.templates.length === 0 && <p className="template-empty">No templates yet. Style a rectangle, then save its look below.</p>}
          <div className="template-list">
            {state.templates.map((template) => (
              <div className="template-row" key={template.id}>
                <button
                  type="button"
                  className="template-apply"
                  title="Apply to this rectangle"
                  onClick={() => { onApply(template.style); setOpen(false) }}
                >
                  <span
                    className="template-swatch"
                    style={{ background: rgba(template.style.fillColor, template.style.fillOpacity), borderColor: template.style.color, borderStyle: template.style.lineStyle }}
                  />
                  <span className="template-name">{template.name}</span>
                  <small>{template.style.fillOpacity}% fill · {template.style.lineWidth}px</small>
                </button>
                <button
                  type="button"
                  className={state.defaultId === template.id ? 'object-icon-button active' : 'object-icon-button'}
                  aria-label={state.defaultId === template.id ? `Stop using ${template.name} for new rectangles` : `Use ${template.name} for new rectangles`}
                  aria-pressed={state.defaultId === template.id}
                  title={state.defaultId === template.id ? 'Default for new rectangles (click to clear)' : 'Use for new rectangles'}
                  onClick={() => onChange(toggleDefaultTemplate(state, template.id))}
                >
                  <StarIcon filled={state.defaultId === template.id} />
                </button>
                <button
                  type="button"
                  className="object-icon-button delete"
                  aria-label={`Delete template ${template.name}`}
                  title="Delete template"
                  onClick={() => onChange(deleteTemplate(state, template.id))}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
          <div className="template-save">
            <input
              value={name}
              maxLength={40}
              placeholder="Template name"
              aria-label="Template name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') save() }}
            />
            <button type="button" onClick={save}>Save current</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
