import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { DRAWING_TOOLS } from '../chart/tools'
import type { DrawingType } from '../drawings'

// One tool-rail button for a group of drawing tools (TradingView's fly-outs): it shows the group's last used tool;
// the small arrow in its corner lists the others. The fly-out is portalled to <body> with fixed coordinates,
// because the rail scrolls (overflow: auto) and would otherwise clip it.

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
  const [position, setPosition] = useState<CSSProperties>()
  const ref = useRef<HTMLDivElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const Icon = icons[shown]
  const active = activeTool === shown
  const tool = DRAWING_TOOLS[shown]

  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (ref.current?.contains(target) || flyoutRef.current?.contains(target))
    const close = (event: Event) => { if (!inside(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const dismiss = () => setOpen(false)
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', dismiss)
    // The rail itself scrolls on short screens; the fly-out would no longer sit next to its button.
    const rail = ref.current?.closest('.tool-rail')
    rail?.addEventListener('scroll', dismiss)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', dismiss)
      rail?.removeEventListener('scroll', dismiss)
    }
  }, [open])

  // Place the fly-out to the right of the group, kept inside the window.
  useLayoutEffect(() => {
    if (!open || !ref.current || !flyoutRef.current) return
    const anchor = ref.current.getBoundingClientRect()
    const flyout = flyoutRef.current.getBoundingClientRect()
    const margin = 8
    const left = Math.min(anchor.right + 6, window.innerWidth - flyout.width - margin)
    const top = Math.max(margin, Math.min(anchor.top, window.innerHeight - flyout.height - margin))
    setPosition({ left: Math.max(margin, left), top })
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
      {open && createPortal(
        <div
          className="tool-flyout"
          role="menu"
          aria-label={label}
          ref={flyoutRef}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
        >
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
        </div>,
        document.body,
      )}
    </div>
  )
}
