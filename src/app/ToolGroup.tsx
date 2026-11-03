import { useEffect, useRef, useState, type ComponentType } from 'react'
import { DRAWING_TOOLS } from '../chart/tools'
import type { DrawingType } from '../drawings'

// One tool-rail button for a group of drawing tools (TradingView's fly-outs): it shows the group's last used tool;
// the small arrow in its corner lists the others.

interface ToolGroupProps {
  label: string
  tools: readonly DrawingType[]
  shown: DrawingType
  activeTool: DrawingType | 'cursor'
  icons: Readonly<Record<DrawingType, ComponentType>>
  disabled: boolean
  onChoose(type: DrawingType): void
  onCursor(): void
}

export function ToolGroup({ label, tools, shown, activeTool, icons, disabled, onChoose, onCursor }: ToolGroupProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const Icon = icons[shown]
  const active = activeTool === shown
  const tool = DRAWING_TOOLS[shown]

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => { if (!(event.target instanceof Node && ref.current?.contains(event.target))) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', escape) }
  }, [open])

  return (
    <div className="tool-group" ref={ref}>
      <button
        type="button"
        className={active ? 'tool-button active' : 'tool-button'}
        aria-label={`Draw ${tool.label.toLowerCase()}`}
        aria-pressed={active}
        title={`${tool.label} (Alt+${tool.shortcut})`}
        onClick={() => (active ? onCursor() : onChoose(shown))}
        disabled={disabled}
      >
        <Icon />
      </button>
      {tools.length > 1 && (
        <button
          type="button"
          className="tool-group-more"
          aria-label={`More ${label.toLowerCase()}`}
          aria-expanded={open}
          title={label}
          onClick={() => setOpen((current) => !current)}
          disabled={disabled}
        >
          <svg viewBox="0 0 6 6" aria-hidden="true"><path d="M1 1 5 3 1 5Z" fill="currentColor" /></svg>
        </button>
      )}
      {open && (
        <div className="tool-flyout" role="menu" aria-label={label}>
          <strong>{label}</strong>
          {tools.map((type) => {
            const ItemIcon = icons[type]
            return (
              <button
                type="button"
                role="menuitem"
                key={type}
                className={activeTool === type ? 'active' : ''}
                onClick={() => { setOpen(false); onChoose(type) }}
              >
                <ItemIcon />
                <span>{DRAWING_TOOLS[type].label}</span>
                <kbd>Alt+{DRAWING_TOOLS[type].shortcut}</kbd>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
