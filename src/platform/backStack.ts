// What Android's Back button (or gesture) should close. Everything that opens over the chart (a window, a panel, a
// menu, an armed drawing tool) registers how to close itself while it is open; Back closes the one opened last.
// With nothing registered, Back leaves the app (see backButton.ts).
import { useEffect, useRef } from 'react'

type BackHandler = () => void

const handlers: BackHandler[] = []

/** Registers a close action on top of the stack. Returns the function that removes it again. */
export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler)
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}

/** Runs the most recently registered close action. Returns false when nothing was open. */
export function handleBack(): boolean {
  const handler = handlers.at(-1)
  if (!handler) return false
  handler()
  return true
}

/** How many things Back could close right now. */
export function backStackDepth(): number {
  return handlers.length
}

/**
 * While `active` is true, Back calls `onBack` (when this is the most recently opened thing). Pass whether the window,
 * panel or menu is open, and the function that closes it.
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
  // The latest closure is used without re-registering, so the position in the stack stays where it was opened.
  const latest = useRef(onBack)
  latest.current = onBack
  useEffect(() => {
    if (!active) return
    return pushBackHandler(() => latest.current())
  }, [active])
}
