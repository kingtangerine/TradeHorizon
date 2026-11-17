import { type Dispatch, type SetStateAction, useEffect } from 'react'
import type { DrawingStore } from '../../drawings'
import { loadAlerts, saveAlerts, type PriceAlert } from '../alerts'
import { loadGroups, saveGroups, type GroupState } from '../groups'
import { loadLayoutFolders, pruneFolderAssignments, saveLayoutFolders } from '../layoutFolders'
import { loadPreferences, savePreferences, type Preferences } from '../preferences'
import { loadScripts, saveScripts, type UserScript } from '../scripts'
import { loadTemplates, saveTemplates } from '../templates'
import { loadUserTheme, type Theme } from '../theme'
import { subscribeRemoteData } from '../userSync'
import { loadWatchlists, saveWatchlists } from '../watchlists'
import {
  adoptActiveLayout,
  autosaveLayouts,
  loadSavedLayouts,
  loadWorkspace,
  saveSavedLayouts,
  saveWorkspace,
  type SavedLayout,
  type UserWorkspace,
} from '../workspace'

type LayoutFolders = ReturnType<typeof loadLayoutFolders>
type TemplateState = ReturnType<typeof loadTemplates>
type WatchlistState = ReturnType<typeof loadWatchlists>

interface UserDataOptions {
  userId: string
  drawingStore: DrawingStore
  workspace: UserWorkspace
  setWorkspace: Dispatch<SetStateAction<UserWorkspace>>
  savedLayouts: SavedLayout[]
  setSavedLayouts: Dispatch<SetStateAction<SavedLayout[]>>
  alerts: PriceAlert[]
  setAlerts: Dispatch<SetStateAction<PriceAlert[]>>
  scripts: UserScript[]
  setScripts: Dispatch<SetStateAction<UserScript[]>>
  groupState: GroupState
  setGroupState: Dispatch<SetStateAction<GroupState>>
  preferences: Preferences
  setPreferences: Dispatch<SetStateAction<Preferences>>
  layoutFolders: LayoutFolders
  setLayoutFolders: Dispatch<SetStateAction<LayoutFolders>>
  templateState: TemplateState
  setTemplateState: Dispatch<SetStateAction<TemplateState>>
  watchlistState: WatchlistState
  setWatchlistState: Dispatch<SetStateAction<WatchlistState>>
  setTheme: Dispatch<SetStateAction<Theme>>
}

/**
 * Keeps the user's data and storage in step: saves each part when it changes, autosaves open layouts, and shows
 * changes that arrive from the user's other devices (merged into storage by userSync) without a reload.
 */
export function useUserDataPersistence({
  userId,
  drawingStore,
  workspace,
  setWorkspace,
  savedLayouts,
  setSavedLayouts,
  alerts,
  setAlerts,
  scripts,
  setScripts,
  groupState,
  setGroupState,
  preferences,
  setPreferences,
  layoutFolders,
  setLayoutFolders,
  templateState,
  setTemplateState,
  watchlistState,
  setWatchlistState,
  setTheme,
}: UserDataOptions) {
  useEffect(() => saveWorkspace(userId, workspace), [userId, workspace])
  useEffect(() => saveSavedLayouts(userId, savedLayouts), [savedLayouts, userId])
  // Layouts save themselves as you work, like TradingView: shortly after the open tabs change, each open layout follows.
  useEffect(() => {
    const timer = globalThis.setTimeout(
      () => setSavedLayouts((current) => autosaveLayouts(current, workspace, Date.now()) as SavedLayout[]),
      1200,
    )
    return () => globalThis.clearTimeout(timer)
  }, [setSavedLayouts, workspace])
  useEffect(() => saveAlerts(userId, alerts), [alerts, userId])
  useEffect(() => saveScripts(userId, scripts), [scripts, userId])
  useEffect(() => saveGroups(userId, groupState), [groupState, userId])

  // Another device changed something (merged into storage by userSync): show it without a reload.
  useEffect(() => {
    const reloaders: Record<string, () => void> = {
      'workspace:v1': () => setWorkspace(adoptActiveLayout(loadWorkspace(userId))),
      'layouts:v1': () => setSavedLayouts(loadSavedLayouts(userId)),
      'drawings:v1': () => drawingStore.reloadFromRepository(),
      'alerts:v1': () => setAlerts(loadAlerts(userId)),
      'scripts:v1': () => setScripts(loadScripts(userId)),
      'groups:v1': () => setGroupState(loadGroups(userId)),
      'layout-folders:v1': () => setLayoutFolders(loadLayoutFolders(userId)),
      'rect-templates:v1': () => setTemplateState(loadTemplates(userId)),
      'watchlists:v1': () => setWatchlistState(loadWatchlists(userId)),
      'prefs:v1': () => setPreferences(loadPreferences(userId)),
      'theme:v1': () => setTheme(loadUserTheme(userId)),
    }
    return subscribeRemoteData((keys) => {
      for (const key of keys) reloaders[key]?.()
    })
  }, [
    drawingStore,
    setAlerts,
    setGroupState,
    setLayoutFolders,
    setPreferences,
    setSavedLayouts,
    setScripts,
    setTemplateState,
    setTheme,
    setWatchlistState,
    setWorkspace,
    userId,
  ])
  useEffect(() => savePreferences(userId, preferences), [preferences, userId])
  useEffect(() => saveLayoutFolders(userId, layoutFolders), [layoutFolders, userId])
  // A deleted layout leaves its folder.
  useEffect(() => {
    setLayoutFolders((current) =>
      pruneFolderAssignments(
        current,
        savedLayouts.map((layout) => layout.id),
      ),
    )
  }, [savedLayouts, setLayoutFolders])
  useEffect(() => saveTemplates(userId, templateState), [templateState, userId])
  useEffect(() => saveWatchlists(userId, watchlistState), [watchlistState, userId])
}
