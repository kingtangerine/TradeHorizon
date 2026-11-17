import type { Dispatch, RefObject, SetStateAction } from 'react'
import { getMarket } from '../../chart/markets'
import { versionDetails, versionLabel } from '../../version'
import type { AppUser } from '../auth'
import { CloseIcon, HorizonLogo, LayersIcon, PlusIcon, UserIcon } from '../Icons'
import type { Preferences } from '../preferences'
import { ProfileDialog } from '../ProfileDialog'
import type { Theme } from '../theme'
import type { ChartTab, UserWorkspace } from '../workspace'
import type { TabDrag } from './useTabDrag'

interface ChartTabsBarProps {
  user: AppUser
  workspace: UserWorkspace
  superchartOpen: boolean
  setSuperchartOpen: Dispatch<SetStateAction<boolean>>
  tabDrag: TabDrag
  activateTab(tab: ChartTab): void
  closeChartTab(id: string): void
  profileMenuRef: RefObject<HTMLDivElement | null>
  profileOpen: boolean
  setProfileOpen: Dispatch<SetStateAction<boolean>>
  profileFocus: 'chart' | 'password' | undefined
  setProfileFocus: Dispatch<SetStateAction<'chart' | 'password' | undefined>>
  setAdminOpen: Dispatch<SetStateAction<boolean>>
  theme: Theme
  setTheme: Dispatch<SetStateAction<Theme>>
  layoutCount: number
  preferences: Preferences
  setPreferences: Dispatch<SetStateAction<Preferences>>
  onLogout(): void
  onUserRefresh(): void
}

/** Top bar: the brand, the open chart tabs (drag to reorder), the new-tab button and the profile menu. */
export function ChartTabsBar({
  user,
  workspace,
  superchartOpen,
  setSuperchartOpen,
  tabDrag,
  activateTab,
  closeChartTab,
  profileMenuRef,
  profileOpen,
  setProfileOpen,
  profileFocus,
  setProfileFocus,
  setAdminOpen,
  theme,
  setTheme,
  layoutCount,
  preferences,
  setPreferences,
  onLogout,
  onUserRefresh,
}: ChartTabsBarProps) {
  const { tabStripRef, tabElements, justDraggedTab, draggingTabId, startTabDrag, moveTabByKey } = tabDrag
  return (
    <nav className="chart-tabs" aria-label="Open charts">
      <div className="brand tabs-brand" aria-label="TradeHorizon">
        <HorizonLogo />
        <span className="brand-name">TradeHorizon</span>
        <span className="preview-pill">ALPHA</span>
        <span className="brand-version" title={versionDetails()}>
          {versionLabel()}
        </span>
      </div>
      <div className="chart-tabs-scroll" ref={tabStripRef}>
        {workspace.tabs.map((tab) => {
          const tabMarket = getMarket(tab.symbol)
          const active = tab.id === workspace.activeTabId && !superchartOpen
          return (
            <div
              className={['chart-tab', active ? 'active' : '', draggingTabId === tab.id ? 'dragging' : ''].filter(Boolean).join(' ')}
              key={tab.id}
              ref={(element) => {
                if (element) tabElements.current.set(tab.id, element)
                else tabElements.current.delete(tab.id)
              }}
              onPointerDown={(event) => startTabDrag(event, tab.id)}
            >
              <button
                type="button"
                className="chart-tab-main"
                title="Drag to reorder (Alt+Shift+arrows with the keyboard)"
                onClick={() => {
                  if (!justDraggedTab.current) activateTab(tab)
                }}
                onKeyDown={(event) => moveTabByKey(event, tab.id)}
              >
                <span className="chart-tab-mark">{tabMarket.mark}</span>
                <span>{tabMarket.pair}</span>
                <small>{tab.interval}</small>
                {tab.split && (
                  <small className="chart-tab-split" title={`${tab.split.count} charts`}>
                    ▦{tab.split.count}
                  </small>
                )}
              </button>
              <button
                type="button"
                className="chart-tab-close"
                aria-label={`Close ${tabMarket.pair} chart`}
                onClick={() => closeChartTab(tab.id)}
                disabled={workspace.tabs.length === 1}
              >
                <CloseIcon />
              </button>
            </div>
          )
        })}
        {superchartOpen && (
          <div className="chart-tab active">
            <span className="chart-tab-main chart-tab-static">
              <LayersIcon />
              <span>New tab</span>
            </span>
            <button type="button" className="chart-tab-close" aria-label="Close new tab" onClick={() => setSuperchartOpen(false)}>
              <CloseIcon />
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="new-chart-tab"
        aria-label="Open new Superchart"
        title="New Superchart"
        onClick={() => setSuperchartOpen(true)}
      >
        <PlusIcon />
      </button>

      <div className="profile-control" ref={profileMenuRef}>
        <button
          type="button"
          className="profile-avatar"
          aria-label="Open user profile"
          aria-expanded={profileOpen}
          onClick={() => setProfileOpen((open) => !open)}
        >
          <UserIcon />
        </button>
        {profileOpen && (
          <ProfileDialog
            user={user}
            theme={theme}
            tabCount={workspace.tabs.length}
            layoutCount={layoutCount}
            onTheme={setTheme}
            candleCountdown={preferences.candleCountdown}
            onCandleCountdown={(candleCountdown) => setPreferences((current) => ({ ...current, candleCountdown }))}
            timeZone={preferences.timeZone}
            onTimeZone={(timeZone) => setPreferences((current) => ({ ...current, timeZone }))}
            highLowLabels={preferences.highLowLabels}
            onHighLowLabels={(highLowLabels) => setPreferences((current) => ({ ...current, highLowLabels }))}
            onLogout={onLogout}
            focusSection={profileFocus}
            onPasswordChanged={onUserRefresh}
            onOpenAdmin={
              user.isAdmin
                ? () => {
                    setProfileOpen(false)
                    setProfileFocus(undefined)
                    setAdminOpen(true)
                  }
                : undefined
            }
            onClose={() => {
              setProfileOpen(false)
              setProfileFocus(undefined)
            }}
          />
        )}
      </div>
    </nav>
  )
}
