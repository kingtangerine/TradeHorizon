import type { Dispatch, SetStateAction } from 'react'
import type { PriceAlert } from '../alerts'
import { BellIcon, LayersIcon, StarIcon } from '../Icons'

interface PanelRailProps {
  watchlistOpen: boolean
  setWatchlistOpen: Dispatch<SetStateAction<boolean>>
  objectTreeOpen: boolean
  setObjectTreeOpen: Dispatch<SetStateAction<boolean>>
  alertsOpen: boolean
  setAlertsOpen: Dispatch<SetStateAction<boolean>>
  alerts: readonly PriceAlert[]
}

/** Right rail: buttons that open the watchlist, the object tree and the price alerts (with the active alert count). */
export function PanelRail({
  watchlistOpen,
  setWatchlistOpen,
  objectTreeOpen,
  setObjectTreeOpen,
  alertsOpen,
  setAlertsOpen,
  alerts,
}: PanelRailProps) {
  return (
    <aside className="panel-rail" aria-label="Panels">
      <button
        type="button"
        className={watchlistOpen ? 'tool-button active' : 'tool-button'}
        aria-label="Watchlist"
        aria-pressed={watchlistOpen}
        title="Watchlist"
        onClick={() => {
          setWatchlistOpen((open) => !open)
          setAlertsOpen(false)
        }}
      >
        <StarIcon />
      </button>
      <button
        type="button"
        className={objectTreeOpen ? 'tool-button active' : 'tool-button'}
        aria-label="Toggle object tree"
        aria-pressed={objectTreeOpen}
        title="Object tree"
        onClick={() => setObjectTreeOpen((open) => !open)}
      >
        <LayersIcon />
      </button>
      <button
        type="button"
        className={alertsOpen ? 'tool-button active panel-button-badge' : 'tool-button panel-button-badge'}
        aria-label="Price alerts"
        aria-pressed={alertsOpen}
        title="Price alerts"
        onClick={() => {
          setAlertsOpen((open) => !open)
          setWatchlistOpen(false)
        }}
      >
        <BellIcon />
        {alerts.filter((alert) => alert.enabled).length > 0 && <span>{alerts.filter((alert) => alert.enabled).length}</span>}
      </button>
    </aside>
  )
}
