import { useEffect, useRef, useState } from 'react'
import { AUTO_TIME_ZONE, TIME_ZONES, browserTimeZone, resolveTimeZone, timeZoneLabel } from './timeZones'

/** Status-bar time zone button with TradingView's list (bottom right in TradingView). */
export function TimeZoneMenu({ value, onChange }: { value: string, onChange(zone: string): void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const current = resolveTimeZone(value)

  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => { if (!(event.target instanceof Node && rootRef.current?.contains(event.target))) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape)
    listRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: 'center' })
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const choose = (zone: string) => { onChange(zone); setOpen(false) }
  const option = (zone: string, label: string, checked: boolean) => (
    <button type="button" role="menuitemradio" aria-checked={checked} key={zone} className={checked ? 'selected' : ''} onClick={() => choose(zone)}>
      {label}
    </button>
  )

  return (
    <span className="time-zone-menu" ref={rootRef}>
      <button
        type="button"
        className="status-time-zone"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Chart time zone"
        onClick={() => setOpen((state) => !state)}
      >
        {timeZoneLabel(current)}
      </button>
      {open && (
        <div className="time-zone-list" role="menu" ref={listRef}>
          {option(AUTO_TIME_ZONE, `Your computer · ${timeZoneLabel(browserTimeZone())}`, value === AUTO_TIME_ZONE)}
          <span className="time-zone-separator" role="separator" />
          {TIME_ZONES.map(({ zone }) => option(zone, timeZoneLabel(zone), value === zone))}
        </div>
      )}
    </span>
  )
}
