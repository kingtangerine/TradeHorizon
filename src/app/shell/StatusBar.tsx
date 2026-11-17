import type { Dispatch, SetStateAction } from 'react'
import type { KLineChartController, ScaleMode } from '../../chart/KLineChartController'
import type { CryptoMarket } from '../../chart/markets'
import type { ChartRuntimeState } from '../../chart/types'
import type { MarketInterval } from '../../market'
import { BottomBar, ScaleToggles } from '../BottomBar'
import { RefreshIcon } from '../Icons'
import type { Preferences } from '../preferences'
import { syncStatusText, useSyncStatus } from '../SyncPanel'
import { TimeZoneMenu } from '../TimeZoneMenu'
import { marketKindLabel } from './workspaceHelpers'

interface StatusBarProps {
  controller: KLineChartController | null
  market: CryptoMarket
  interval: MarketInterval
  changeInterval(next: MarketInterval): void
  chartTimeZone: string
  scaleMode: ScaleMode
  changeScaleMode(mode: ScaleMode): void
  preferences: Preferences
  setPreferences: Dispatch<SetStateAction<Preferences>>
  /** Number of saved drawings on the active market. */
  drawingCount: number
  runtime: ChartRuntimeState
  setProfileOpen: Dispatch<SetStateAction<boolean>>
}

/** Bottom status bar: date ranges, venue, time zone, drawing count, sync state, feed retry and price-scale toggles. */
export function StatusBar({
  controller,
  market,
  interval,
  changeInterval,
  chartTimeZone,
  scaleMode,
  changeScaleMode,
  preferences,
  setPreferences,
  drawingCount,
  runtime,
  setProfileOpen,
}: StatusBarProps) {
  const syncStatus = useSyncStatus()
  const quote = runtime.quote
  return (
    <footer className="statusbar">
      <BottomBar
        controller={controller}
        interval={interval}
        timeZone={chartTimeZone}
        scaleMode={scaleMode}
        onScaleMode={changeScaleMode}
        onInterval={changeInterval}
      />
      <span className="status-separator" />
      <span className="status-venue">
        {market.venue.toUpperCase()} {marketKindLabel(market).toUpperCase()}
      </span>
      <TimeZoneMenu value={preferences.timeZone} onChange={(timeZone) => setPreferences((current) => ({ ...current, timeZone }))} />
      <span className="status-separator" />
      <span>
        {drawingCount} saved drawing{drawingCount === 1 ? '' : 's'} for {market.symbol}
      </span>
      <span className="status-spacer" />
      <button
        type="button"
        className={`status-sync sync-${syncStatus.state}`}
        title={syncStatus.error ?? 'Sync between your devices. Click for details and a sync check.'}
        onClick={() => setProfileOpen(true)}
      >
        <i aria-hidden="true" /> {syncStatusText(syncStatus)}
      </button>
      {runtime.error && quote && (
        <button type="button" className="status-retry" onClick={() => controller?.retry()}>
          <RefreshIcon /> Refresh feed
        </button>
      )}
      <ScaleToggles scaleMode={scaleMode} onScaleMode={changeScaleMode} />
    </footer>
  )
}
