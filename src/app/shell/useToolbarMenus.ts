import { useEffect, useRef, useState } from 'react'

/** Open state of the top bar's drop-down menus (profile, layout, timeframes, chart type, split, snapshot) and their elements. */
export function useToolbarMenus() {
  const [profileOpen, setProfileOpen] = useState(false)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false)
  const [splitMenuOpen, setSplitMenuOpen] = useState(false)
  const [splitSaveName, setSplitSaveName] = useState('')
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const timeframeMenuRef = useRef<HTMLDivElement>(null)
  const snapshotMenuRef = useRef<HTMLDivElement>(null)
  const chartTypeMenuRef = useRef<HTMLDivElement>(null)
  const [chartTypeMenuOpen, setChartTypeMenuOpen] = useState(false)
  const [snapshotMenuOpen, setSnapshotMenuOpen] = useState(false)
  const indicatorMenuRef = useRef<HTMLDivElement>(null)
  const splitMenuRef = useRef<HTMLDivElement>(null)

  return {
    profileOpen,
    setProfileOpen,
    layoutMenuOpen,
    setLayoutMenuOpen,
    timeframeMenuOpen,
    setTimeframeMenuOpen,
    splitMenuOpen,
    setSplitMenuOpen,
    splitSaveName,
    setSplitSaveName,
    chartTypeMenuOpen,
    setChartTypeMenuOpen,
    snapshotMenuOpen,
    setSnapshotMenuOpen,
    profileMenuRef,
    layoutMenuRef,
    timeframeMenuRef,
    snapshotMenuRef,
    chartTypeMenuRef,
    indicatorMenuRef,
    splitMenuRef,
  }
}

/** Menu state and refs from useToolbarMenus. */
export type ToolbarMenus = ReturnType<typeof useToolbarMenus>

/** A mouse press outside an open menu closes it. */
export function useCloseMenusOnOutsideClick(menus: ToolbarMenus) {
  const {
    profileMenuRef,
    layoutMenuRef,
    timeframeMenuRef,
    snapshotMenuRef,
    chartTypeMenuRef,
    splitMenuRef,
    setProfileOpen,
    setLayoutMenuOpen,
    setTimeframeMenuOpen,
    setSnapshotMenuOpen,
    setChartTypeMenuOpen,
    setSplitMenuOpen,
  } = menus
  useEffect(() => {
    const closeDetachedMenus = (event: MouseEvent) => {
      const target = event.target as Node
      if (!profileMenuRef.current?.contains(target)) setProfileOpen(false)
      if (!layoutMenuRef.current?.contains(target)) setLayoutMenuOpen(false)
      if (!timeframeMenuRef.current?.contains(target)) setTimeframeMenuOpen(false)
      if (!snapshotMenuRef.current?.contains(target)) setSnapshotMenuOpen(false)
      if (!chartTypeMenuRef.current?.contains(target)) setChartTypeMenuOpen(false)
      if (!splitMenuRef.current?.contains(target)) setSplitMenuOpen(false)
    }
    globalThis.addEventListener('mousedown', closeDetachedMenus)
    return () => globalThis.removeEventListener('mousedown', closeDetachedMenus)
  }, [
    chartTypeMenuRef,
    layoutMenuRef,
    profileMenuRef,
    setChartTypeMenuOpen,
    setLayoutMenuOpen,
    setProfileOpen,
    setSnapshotMenuOpen,
    setSplitMenuOpen,
    setTimeframeMenuOpen,
    snapshotMenuRef,
    splitMenuRef,
    timeframeMenuRef,
  ])
}
