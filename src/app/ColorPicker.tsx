import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// TradingView-style palette: a grey row, then ten hues from light to dark.
const GREYS = ['#ffffff', '#dbdbdb', '#b2b5be', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#1e222d', '#000000']
const HUES: ReadonlyArray<readonly string[]> = [
  ['#fccbcd', '#faa1a4', '#f77c80', '#f7525f', '#f23645', '#cc2f3c', '#b22833', '#801922', '#5c0f15'],
  ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#f57c00', '#e65100', '#bf360c', '#7f2500'],
  ['#fff9c4', '#fff59d', '#ffee58', '#ffeb3b', '#fdd835', '#f9a825', '#f57f17', '#e65100', '#a33c00'],
  ['#c8e6c9', '#a5d6a7', '#81c784', '#4caf50', '#089981', '#00897b', '#00695c', '#004d40', '#00251a'],
  ['#b2dfdb', '#80cbc4', '#4db6ac', '#26a69a', '#00bcd4', '#0097a7', '#00838f', '#006064', '#003c40'],
  ['#bbd9fb', '#90bff9', '#5b9cf6', '#42a5f5', '#2962ff', '#1e53e5', '#1848cc', '#143a9e', '#0c2461'],
  ['#d1c4e9', '#b39ddb', '#9575cd', '#7e57c2', '#673ab7', '#5e35b1', '#4527a0', '#311b92', '#1a0f5c'],
  ['#e1bee7', '#ce93d8', '#ba68c8', '#ab47bc', '#9c27b0', '#8e24aa', '#6a1b9a', '#4a148c', '#2e0c57'],
  ['#f8bbd0', '#f48fb1', '#f06292', '#ec407a', '#e91e63', '#d81b60', '#ad1457', '#880e4f', '#560a32'],
  ['#d7ccc8', '#bcaaa4', '#a1887f', '#8d6e63', '#795548', '#6d4c41', '#5d4037', '#4e342e', '#3e2723'],
]

interface ColorPickerProps {
  value: string
  label: string
  onChange(color: string): void
}

export function ColorPicker({ value, label, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
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
      // Fixed positioning keeps the popover clear of clipped toolbars; keep it inside the viewport.
      setPosition({
        top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 300)),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 236)),
      })
    }
    setOpen((current) => !current)
  }

  const pick = (color: string) => {
    onChange(color)
    setOpen(false)
  }
  const swatch = (color: string) => (
    <button
      type="button"
      key={color}
      className={color.toLowerCase() === value.toLowerCase() ? 'color-swatch selected' : 'color-swatch'}
      style={{ background: color }}
      title={color}
      aria-label={color}
      onClick={() => pick(color)}
    />
  )

  return (
    <span className="color-picker">
      <button
        type="button"
        ref={buttonRef}
        className="color-picker-button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span style={{ background: value }} />
      </button>
      {open && createPortal(
        <div ref={popoverRef} className="color-popover" role="dialog" aria-label={label} style={position}>
          <div className="color-row">{GREYS.map(swatch)}</div>
          <div className="color-grid">
            {Array.from({ length: 9 }, (_, shade) => (
              <div className="color-row" key={shade}>{HUES.map((hue) => swatch(hue[shade]))}</div>
            ))}
          </div>
          <label className="color-custom">
            <span>Custom…</span>
            <input type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label} (custom)`} />
          </label>
        </div>,
        document.body,
      )}
    </span>
  )
}
