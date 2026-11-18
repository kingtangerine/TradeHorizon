import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BellIcon, CopyIcon, EyeOffIcon, LockIcon, SettingsIcon, TrashIcon, UnlockIcon } from './Icons'

// Right-click menu on a drawing (TradingView): settings, clone, lock, hide, timeframe visibility, delete.

interface DrawingContextMenuProps {
  left: number
  top: number
  locked: boolean
  /** More than one drawing is selected: the actions apply to all of them. */
  count: number
  onSettings(): void
  onVisibility(): void
  onClone(): void
  /** Trend lines and rays: an alert that fires when the price crosses the line. */
  onAddAlert?(): void
  onLock(): void
  onHide(): void
  onDelete(): void
  onClose(): void
}

/** The right-click menu of a drawing (or several selected drawings); closes on an outside click. */
export function DrawingContextMenu({
  left,
  top,
  locked,
  count,
  onSettings,
  onVisibility,
  onClone,
  onAddAlert,
  onLock,
  onHide,
  onDelete,
  onClose,
}: DrawingContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: Event) => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target))) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape)
    globalThis.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', escape)
      globalThis.removeEventListener('blur', onClose)
    }
  }, [onClose])
  const run = (action: () => void) => () => {
    action()
    onClose()
  }
  const single = count <= 1
  // The menu opens at the pointer, then moves in if it would stick out of the screen. Its size is measured rather
  // than assumed: the rows are taller on a phone.
  const [style, setStyle] = useState({ left, top })
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const margin = 8
    const { width, height } = menu.getBoundingClientRect()
    setStyle({
      left: Math.max(margin, Math.min(left, globalThis.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(top, globalThis.innerHeight - height - margin)),
    })
  }, [left, top, count])
  return createPortal(
    <div
      ref={ref}
      className="chart-context-menu drawing-context-menu"
      role="menu"
      style={style}
      onContextMenu={(event) => event.preventDefault()}
    >
      {!single && <div className="context-menu-title">{count} drawings selected</div>}
      {single && (
        <button type="button" role="menuitem" onClick={run(onSettings)}>
          <SettingsIcon /> Settings…
        </button>
      )}
      {single && (
        <button type="button" role="menuitem" onClick={run(onVisibility)}>
          <EyeOffIcon /> Visibility on timeframes…
        </button>
      )}
      {onAddAlert && (
        <button type="button" role="menuitem" onClick={run(onAddAlert)}>
          <BellIcon /> Add alert on this line
        </button>
      )}
      <button type="button" role="menuitem" onClick={run(onClone)}>
        <CopyIcon /> Clone <kbd>Ctrl+D</kbd>
      </button>
      <button type="button" role="menuitem" onClick={run(onLock)}>
        {locked ? <UnlockIcon /> : <LockIcon />} {locked ? 'Unlock' : 'Lock'}
      </button>
      <button type="button" role="menuitem" onClick={run(onHide)}>
        <EyeOffIcon /> Hide
      </button>
      <button type="button" role="menuitem" className="danger" onClick={run(onDelete)}>
        <TrashIcon /> {single ? 'Remove' : `Remove ${count} drawings`} <kbd>Del</kbd>
      </button>
    </div>,
    document.body,
  )
}
