import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_INDICATORS } from '../../chart/indicators'
import {
  combinedPanes,
  createLayout,
  createSplitLayout,
  duplicateLayout,
  splitTabFromPanes,
  type ChartTab,
  type SavedLayout,
  type UserWorkspace,
} from '../workspace'
import { DEFAULT_LAYOUT_NAME } from './workspaceHelpers'

interface LayoutActionsOptions {
  workspace: UserWorkspace
  setWorkspace: Dispatch<SetStateAction<UserWorkspace>>
  savedLayouts: SavedLayout[]
  setSavedLayouts: Dispatch<SetStateAction<SavedLayout[]>>
  activeTab: ChartTab
  /** The saved layout the active tab belongs to, if any. */
  currentLayout: SavedLayout | undefined
  activateTab(tab: ChartTab): void
  showToast(message: string): void
  setSuperchartOpen: Dispatch<SetStateAction<boolean>>
  setLayoutMenuOpen: Dispatch<SetStateAction<boolean>>
  setSplitMenuOpen: Dispatch<SetStateAction<boolean>>
  setSplitSaveName: Dispatch<SetStateAction<string>>
}

/** Saved layouts: saving, opening (alone, in the background or several as one split), renaming, copying and deleting. */
export function useLayoutActions({
  workspace,
  setWorkspace,
  savedLayouts,
  setSavedLayouts,
  activeTab,
  currentLayout,
  activateTab,
  showToast,
  setSuperchartOpen,
  setLayoutMenuOpen,
  setSplitMenuOpen,
  setSplitSaveName,
}: LayoutActionsOptions) {
  const [layoutDraftName, setLayoutDraftName] = useState(workspace.layoutName)
  const [layoutNotice, setLayoutNotice] = useState('')

  /** Opens 2 to 4 saved layouts together: one tab, one chart per layout (the chart each was saved with). */
  const openLayoutsTogether = useCallback(
    (selected: SavedLayout[], options: { name: string; save: boolean }) => {
      if (selected.length < 2) return
      const now = Date.now()
      const tab = splitTabFromPanes(combinedPanes(selected), crypto.randomUUID(), now)
      const layout = options.save
        ? createSplitLayout(
            options.name,
            tab,
            { volumeVisible: workspace.volumeVisible, customIntervals: workspace.customIntervals, indicators: workspace.indicators },
            now,
          )
        : undefined
      const openedTab: ChartTab = layout ? { ...tab, layoutId: layout.id } : tab
      if (layout) setSavedLayouts((current) => [layout, ...current])
      setWorkspace((current) => ({ ...current, tabs: [...current.tabs, openedTab], activeTabId: openedTab.id }))
      setSuperchartOpen(false)
      showToast(layout ? `Opened and saved “${layout.name}” to your layouts` : `Opened ${selected.length} layouts in a split view`)
    },
    [setSavedLayouts, setSuperchartOpen, setWorkspace, showToast, workspace.volumeVisible, workspace.customIntervals, workspace.indicators],
  )

  /** Keeps the split on screen as a layout of its own, so it can be reopened later from the layouts page. */
  const saveSplitAsLayout = useCallback(
    (name: string) => {
      const layout = createSplitLayout(
        name,
        activeTab,
        { volumeVisible: workspace.volumeVisible, customIntervals: workspace.customIntervals, indicators: workspace.indicators },
        Date.now(),
      )
      setSavedLayouts((current) => [layout, ...current])
      setSplitMenuOpen(false)
      setSplitSaveName('')
      showToast(`Saved “${layout.name}” to your layouts`)
    },
    [
      activeTab,
      setSavedLayouts,
      setSplitMenuOpen,
      setSplitSaveName,
      showToast,
      workspace.volumeVisible,
      workspace.customIntervals,
      workspace.indicators,
    ],
  )

  const saveCurrentLayout = useCallback(
    (name = layoutDraftName, forceNew = false) => {
      const normalizedName = name.trim() || DEFAULT_LAYOUT_NAME
      const now = Date.now()
      const existing = !forceNew && currentLayout ? currentLayout : undefined
      const id = existing?.id ?? crypto.randomUUID()
      const groupTabs = workspace.tabs.filter((tab) => tab.layoutId === activeTab.layoutId)
      const nextLayout: SavedLayout = {
        id,
        name: normalizedName,
        tabs: groupTabs.map(({ layoutId: _layoutId, ...tab }) => tab),
        activeTabId: workspace.activeTabId,
        volumeVisible: workspace.volumeVisible,
        customIntervals: workspace.customIntervals,
        ...(workspace.indicators ? { indicators: workspace.indicators } : {}),
        createdAtMs: existing?.createdAtMs ?? now,
        updatedAtMs: now,
        ...(existing?.favorite ? { favorite: true } : {}),
      }
      setSavedLayouts((current) =>
        existing ? current.map((layout) => (layout.id === id ? nextLayout : layout)) : [nextLayout, ...current],
      )
      setWorkspace((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => (groupTabs.some((item) => item.id === tab.id) ? { ...tab, layoutId: id } : tab)),
        layoutName: normalizedName,
        activeLayoutId: id,
      }))
      setLayoutDraftName(normalizedName)
      setLayoutNotice('Saved')
      globalThis.setTimeout(() => setLayoutNotice(''), 1600)
    },
    [activeTab.layoutId, currentLayout, layoutDraftName, setSavedLayouts, setWorkspace, workspace],
  )

  const openSavedLayout = useCallback(
    (layout: SavedLayout) => {
      // A layout that is already open in the tab bar is switched to, not opened a second time.
      const alreadyOpen = workspace.tabs.filter((tab) => tab.layoutId === layout.id)
      if (alreadyOpen.length > 0) {
        const savedIndex = Math.max(
          0,
          layout.tabs.findIndex((tab) => tab.id === layout.activeTabId),
        )
        activateTab(alreadyOpen[Math.min(savedIndex, alreadyOpen.length - 1)])
        setLayoutDraftName(layout.name)
        setLayoutMenuOpen(false)
        return
      }
      const openedTabs: ChartTab[] = layout.tabs.map((tab) => ({ ...tab, id: crypto.randomUUID(), layoutId: layout.id }))
      const index = Math.max(
        0,
        layout.tabs.findIndex((tab) => tab.id === layout.activeTabId),
      )
      const focused = openedTabs[index]
      setWorkspace((current) => ({
        ...current,
        tabs: [...current.tabs, ...openedTabs],
        activeTabId: focused.id,
        volumeVisible: layout.volumeVisible,
        indicators: layout.indicators ?? DEFAULT_INDICATORS,
        customIntervals: [...new Set([...current.customIntervals, ...layout.customIntervals])],
      }))
      setLayoutDraftName(layout.name)
      setSuperchartOpen(false)
      setLayoutMenuOpen(false)
    },
    [workspace.tabs, activateTab, setLayoutMenuOpen, setSuperchartOpen, setWorkspace],
  )

  /** Middle-click on a layout card: add its tabs to the tab bar and stay where we are. */
  const openSavedLayoutInBackground = useCallback(
    (layout: SavedLayout, forceCopy = false) => {
      // Middle-click on a layout that is already open does nothing; the menu's "Open in new tab" always makes a copy.
      if (!forceCopy && workspace.tabs.some((tab) => tab.layoutId === layout.id)) return
      const openedTabs: ChartTab[] = layout.tabs.map((tab) => ({ ...tab, id: crypto.randomUUID(), layoutId: layout.id }))
      setWorkspace((current) => ({
        ...current,
        tabs: [...current.tabs, ...openedTabs],
        customIntervals: [...new Set([...current.customIntervals, ...layout.customIntervals])],
      }))
    },
    [setWorkspace, workspace.tabs],
  )

  const createNewLayout = useCallback(() => {
    const layout = createLayout(DEFAULT_LAYOUT_NAME, Date.now())
    setSavedLayouts((current) => [layout, ...current])
    openSavedLayout(layout)
  }, [openSavedLayout, setSavedLayouts])

  const toggleLayoutFavorite = useCallback(
    (id: string) => {
      setSavedLayouts((current) =>
        current.map((layout) => {
          if (layout.id !== id) return layout
          const { favorite, ...rest } = layout
          return favorite ? rest : { ...rest, favorite: true }
        }),
      )
    },
    [setSavedLayouts],
  )

  const renameLayout = useCallback(
    (id: string, name: string) => {
      const nextName = name.trim().slice(0, 48)
      if (!nextName) return
      setSavedLayouts((current) =>
        current.map((layout) => (layout.id === id ? { ...layout, name: nextName, updatedAtMs: Date.now() } : layout)),
      )
      if (currentLayout?.id === id) setLayoutDraftName(nextName)
    },
    [currentLayout?.id, setSavedLayouts],
  )

  const duplicateSavedLayout = useCallback(
    (id: string) => {
      const source = savedLayouts.find((layout) => layout.id === id)
      if (!source) return
      setSavedLayouts((current) => [duplicateLayout(source, Date.now()), ...current])
    },
    [savedLayouts, setSavedLayouts],
  )

  const deleteSavedLayout = useCallback(
    (id: string) => {
      setSavedLayouts((current) => current.filter((layout) => layout.id !== id))
      setWorkspace((current) => {
        const { activeLayoutId, ...rest } = current
        return {
          ...(activeLayoutId === id ? rest : current),
          tabs: current.tabs.map((tab) => (tab.layoutId === id ? { ...tab, layoutId: undefined } : tab)),
        }
      })
    },
    [setSavedLayouts, setWorkspace],
  )

  // Reset the name field only when another layout is opened, not on every rename (that would fight the user's typing).
  const layoutNameRef = useRef(currentLayout?.name ?? workspace.layoutName)
  layoutNameRef.current = currentLayout?.name ?? workspace.layoutName
  const currentLayoutId = currentLayout?.id
  useEffect(() => {
    setLayoutDraftName(layoutNameRef.current)
  }, [currentLayoutId])

  return {
    layoutDraftName,
    setLayoutDraftName,
    layoutNotice,
    openLayoutsTogether,
    saveSplitAsLayout,
    saveCurrentLayout,
    openSavedLayout,
    openSavedLayoutInBackground,
    createNewLayout,
    toggleLayoutFavorite,
    renameLayout,
    duplicateSavedLayout,
    deleteSavedLayout,
  }
}
