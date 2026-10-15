import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BellIcon, SettingsIcon, TargetIcon } from './Icons'

export interface ChartContextMenuProps {
  /** Where the right-click happened, relative to the chart pane. */
  readonly left: number
  readonly top: number
  /** Price under the pointer, or null when the click was not on the price chart (e.g. the volume pane). */
  readonly price: number | null
  readonly pricePrecision: number
  readonly quoteAsset: string
  /** Already following the live price: "Go live" has nothing to do. */
  readonly live: boolean
  onGoLive(): void
  onAddAlert(price: number): void
  onOpenSettings(): void
  onClose(): void
}

/** TradingView-style menu on right-click in the chart: go live, alert at the clicked price, settings. */
export function ChartContextMenu({ left, top, price, pricePrecision, quoteAsset, live, onGoLive, onAddAlert, onOpenSettings, onClose }: ChartContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left, top })

  // Keep the menu inside the chart: open it to the left / upwards when there is no room.
  useLayoutEffect(() => {
    const menu = menuRef.current
    const parent = menu?.offsetParent as HTMLElement | null
    if (!menu || !parent) return
    setPosition({
      left: Math.max(4, Math.min(left, parent.clientWidth - menu.offsetWidth - 4)),
      top: Math.max(4, top + menu.offsetHeight > parent.clientHeight - 4 ? top - menu.offsetHeight : top),
    })
  }, [left, top])

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (event: Event) => { if (!(event.target instanceof Node && menuRef.current?.contains(event.target))) onClose() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('wheel', outside, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('wheel', outside, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const run = (action: () => void) => () => { onClose(); action() }
  const priceText = price === null
    ? null
    : price.toLocaleString('en-US', { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision })

  return (
    <div
      ref={menuRef}
      className="chart-context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" disabled={live} onClick={run(onGoLive)} title={live ? 'Already showing the latest candles' : undefined}>
        <TargetIcon /> Go live
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={price === null}
        onClick={run(() => { if (price !== null) onAddAlert(price) })}
        title={price === null ? 'Right-click on the price chart to set an alert at that price' : undefined}
      >
        <BellIcon /> {priceText ? <>Add alert at <b>{priceText}</b> <small>{quoteAsset}</small></> : 'Add alert'}
      </button>
      <span className="chart-context-separator" role="separator" />
      <button type="button" role="menuitem" onClick={run(onOpenSettings)}>
        <SettingsIcon /> Settings…
      </button>
    </div>
  )
}
