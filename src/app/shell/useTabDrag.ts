import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'
import { moveTab, type UserWorkspace } from '../workspace'

/** Reordering the open chart tabs by dragging (mouse, touch press-and-hold) or with Alt+Shift+arrows. */
export function useTabDrag(setWorkspace: Dispatch<SetStateAction<UserWorkspace>>) {
  // --- Reordering the open tabs by dragging ---------------------------------------------------
  // Mouse: drag a tab. Touch: press and hold briefly, then drag (a quick swipe still scrolls the tab strip).
  // Keyboard: Alt+Shift+Left or Right on a focused tab.
  const tabStripRef = useRef<HTMLDivElement>(null)
  const tabElements = useRef(new Map<string, HTMLDivElement>())
  const tabDrag = useRef<{
    id: string
    pointerId: number
    startX: number
    grab: number
    active: boolean
    touch: boolean
    timer?: ReturnType<typeof globalThis.setTimeout>
  } | null>(null)
  const justDraggedTab = useRef(false)
  const [draggingTabId, setDraggingTabId] = useState<string>()

  const placeDraggedTab = useCallback(
    (clientX: number) => {
      const drag = tabDrag.current
      const strip = tabStripRef.current
      const element = drag && tabElements.current.get(drag.id)
      if (!drag || !strip || !element) return
      const bounds = strip.getBoundingClientRect()
      // Keep the dragged tab under the pointer, and scroll the strip when the pointer reaches its edge.
      if (clientX < bounds.left + 36) strip.scrollLeft -= 14
      else if (clientX > bounds.right - 36) strip.scrollLeft += 14
      const pointerInStrip = clientX - bounds.left + strip.scrollLeft
      element.style.transform = `translateX(${pointerInStrip - drag.grab - element.offsetLeft}px)`
      // Its new position is the number of other tabs whose centre is left of the pointer.
      let toIndex = 0
      for (const [id, other] of tabElements.current) {
        if (id !== drag.id && other.offsetLeft + other.offsetWidth / 2 < pointerInStrip) toIndex += 1
      }
      setWorkspace((current) => {
        if (current.tabs.findIndex((tab) => tab.id === drag.id) === toIndex) return current
        return { ...current, tabs: moveTab(current.tabs, drag.id, toIndex) }
      })
    },
    [setWorkspace],
  )

  const endTabDrag = useCallback(() => {
    const drag = tabDrag.current
    if (!drag) return
    globalThis.clearTimeout(drag.timer)
    if (drag.active) {
      const element = tabElements.current.get(drag.id)
      if (element) element.style.transform = ''
      justDraggedTab.current = true
      globalThis.setTimeout(() => {
        justDraggedTab.current = false
      }, 80)
    }
    tabDrag.current = null
    setDraggingTabId(undefined)
  }, [])

  useEffect(() => {
    const preventScroll = (event: TouchEvent) => {
      if (tabDrag.current?.active) event.preventDefault()
    }
    const onMove = (event: PointerEvent) => {
      const drag = tabDrag.current
      if (!drag || event.pointerId !== drag.pointerId) return
      if (!drag.active) {
        const moved = Math.abs(event.clientX - drag.startX)
        if (drag.touch) {
          if (moved > 8) {
            globalThis.clearTimeout(drag.timer)
            tabDrag.current = null
          }
          return
        }
        if (moved < 5) return
        drag.active = true
        setDraggingTabId(drag.id)
      }
      placeDraggedTab(event.clientX)
    }
    const onUp = (event: PointerEvent) => {
      if (tabDrag.current?.pointerId === event.pointerId) endTabDrag()
    }
    globalThis.addEventListener('pointermove', onMove)
    globalThis.addEventListener('pointerup', onUp)
    globalThis.addEventListener('pointercancel', onUp)
    document.addEventListener('touchmove', preventScroll, { passive: false })
    return () => {
      globalThis.removeEventListener('pointermove', onMove)
      globalThis.removeEventListener('pointerup', onUp)
      globalThis.removeEventListener('pointercancel', onUp)
      document.removeEventListener('touchmove', preventScroll)
    }
  }, [placeDraggedTab, endTabDrag])

  const startTabDrag = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (event.button !== 0 || (event.target as Element).closest('.chart-tab-close')) return
    const element = tabElements.current.get(id)
    if (!element) return
    const touch = event.pointerType === 'touch'
    const drag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      grab: event.clientX - element.getBoundingClientRect().left,
      active: false,
      touch,
    } as NonNullable<typeof tabDrag.current>
    tabDrag.current = drag
    if (touch) {
      drag.timer = globalThis.setTimeout(() => {
        if (tabDrag.current !== drag) return
        drag.active = true
        setDraggingTabId(id)
        placeDraggedTab(drag.startX)
      }, 350)
    }
  }

  const moveTabByKey = (event: React.KeyboardEvent, id: string) => {
    if (!event.altKey || !event.shiftKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    setWorkspace((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id)
      return { ...current, tabs: moveTab(current.tabs, id, index + (event.key === 'ArrowLeft' ? -1 : 1)) }
    })
  }

  return { tabStripRef, tabElements, justDraggedTab, draggingTabId, startTabDrag, moveTabByKey }
}

/** What useTabDrag gives the tab strip. */
export type TabDrag = ReturnType<typeof useTabDrag>
