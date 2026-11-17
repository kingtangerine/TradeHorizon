import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'
import { evaluateAlert, type AlertState } from '../../../server/alertRules.ts'
import { displaySymbol } from '../../chart/markets'
import type { ReplayState } from '../../chart/types'
import { loadAlerts, moveAlert, type AlertOptions, type PriceAlert } from '../alerts'
import { fetchAlertEvents } from '../backgroundAlerts'
import { isNewAlertEvent, toggleAlertEnabled, withServerAlertEvents, withTriggeredAlerts } from './workspaceHelpers'

/** Sound plus a system notification for alerts that just fired while the app is open. */
function announceAlerts(items: ReadonlyArray<{ symbol: string; targetPrice: number; price?: number }>): void {
  try {
    const AudioContextClass = globalThis.AudioContext
    const audio = new AudioContextClass()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.18, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + 0.6)
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
  for (const item of items) {
    if ('Notification' in globalThis && Notification.permission === 'granted') {
      new Notification(`${displaySymbol(item.symbol)} price alert`, {
        body: `Price reached ${(item.price ?? item.targetPrice).toLocaleString()} (target ${item.targetPrice.toLocaleString()}).`,
      })
    }
  }
}

/** The user's price alerts and the actions that add, move, delete and switch them. */
export function useAlertList(userId: string, setToast: Dispatch<SetStateAction<string>>) {
  const [alerts, setAlerts] = useState<PriceAlert[]>(() => loadAlerts(userId))

  const addAlertAtPrice = useCallback(
    (targetPrice: number, symbol: string, last: number | undefined) => {
      setAlerts((current) => [
        {
          id: crypto.randomUUID(),
          symbol,
          targetPrice,
          direction: last !== undefined && targetPrice < last ? 'below' : 'above',
          enabled: true,
          createdAtMs: Date.now(),
        },
        ...current,
      ])
      const message = `Alert set at ${targetPrice.toLocaleString('en-US', { maximumFractionDigits: 8 })}. Drag its line to move it, ✕ to delete.`
      setToast(message)
      globalThis.setTimeout(() => setToast((currentToast) => (currentToast === message ? '' : currentToast)), 3600)
      if ('Notification' in globalThis && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
    },
    [setToast],
  )

  const createAlert = useCallback((options: AlertOptions, symbol: string) => {
    setAlerts((current) => [{ id: crypto.randomUUID(), symbol, ...options, enabled: true, createdAtMs: Date.now() }, ...current])
    if ('Notification' in globalThis && Notification.permission === 'default') void Notification.requestPermission()
  }, [])

  /** Dragging an alert line moves the alert (and re-arms it on the side of the price it now sits). */
  const moveAlertTo = useCallback((id: string, targetPrice: number, lastPrice: number | undefined) => {
    if (id.endsWith(':upper')) {
      const base = id.slice(0, -':upper'.length)
      setAlerts((current) => current.map((alert) => (alert.id === base ? { ...alert, upperPrice: targetPrice } : alert)))
      return
    }
    setAlerts((current) => current.map((alert) => (alert.id === id ? moveAlert(alert, targetPrice, lastPrice) : alert)))
  }, [])

  const deleteAlert = useCallback((id: string) => {
    const base = id.endsWith(':upper') ? id.slice(0, -':upper'.length) : id
    setAlerts((current) => current.filter((alert) => alert.id !== base))
  }, [])

  const toggleAlert = useCallback((id: string) => {
    setAlerts((current) =>
      current.map((alert) => {
        if (alert.id !== id) return alert
        return toggleAlertEnabled(alert)
      }),
    )
  }, [])

  return { alerts, setAlerts, addAlertAtPrice, createAlert, moveAlertTo, deleteAlert, toggleAlert }
}

interface AlertWatcherOptions {
  alerts: PriceAlert[]
  setAlerts: Dispatch<SetStateAction<PriceAlert[]>>
  /** Symbol of the active chart: only its alerts are checked against the live price. */
  symbol: string
  /** Latest price of the active chart. */
  quoteClose: number | undefined
  replay: ReplayState | null | undefined
  previousPriceRef: MutableRefObject<number | undefined>
}

/**
 * Fires alerts while the app is open: checks the active chart's live price against its alerts (same rules as the
 * server), and picks up alerts the server triggered.
 */
export function useAlertWatcher({ alerts, setAlerts, symbol, quoteClose, replay, previousPriceRef }: AlertWatcherOptions) {
  /** Per-alert memory between price updates (was the condition met, is it armed), as on the server. */
  const alertStatesRef = useRef(new Map<string, AlertState>())

  useEffect(() => {
    const price = quoteClose
    if (replay) {
      previousPriceRef.current = undefined
      return
    }
    if (price === undefined) return
    previousPriceRef.current = price

    // Same rules as the server (alertRules.ts). "Moving N%" needs a price history, so only the server checks it.
    const now = Date.now()
    const triggered = alerts.filter((alert) => {
      if (!alert.enabled || alert.triggeredAtMs || alert.symbol !== symbol || alert.condition === 'movePercent') return false
      const step = evaluateAlert(alert, price, now, alertStatesRef.current.get(alert.id))
      alertStatesRef.current.set(alert.id, step.state)
      return step.fire
    })
    if (triggered.length === 0) return

    setAlerts((current) => withTriggeredAlerts(current, triggered, now, price))

    announceAlerts(triggered.map((alert) => ({ symbol: alert.symbol, targetPrice: alert.targetPrice, price })))
  }, [alerts, symbol, quoteClose, replay, previousPriceRef, setAlerts])

  // The server also watches prices (even with the app closed). While the app is visible, pick up what it triggered.
  const alertsRef = useRef(alerts)
  alertsRef.current = alerts
  useEffect(() => {
    let live = true
    let since = 0
    let hiddenAtMs: number | undefined
    const poll = async () => {
      if (document.visibilityState !== 'visible') return
      const events = await fetchAlertEvents(since)
      if (!live || events.length === 0) return
      since = Math.max(since, ...events.map((event) => event.triggeredAtMs))
      const fresh = events.filter((event) => alertsRef.current.some((alert) => alert.id === event.id && isNewAlertEvent(alert, event)))
      if (fresh.length === 0) return
      setAlerts((current) => withServerAlertEvents(current, fresh))
      // Alerts that fired while this tab was hidden were already announced by the push notification.
      const announce = fresh.filter((event) => hiddenAtMs === undefined || event.triggeredAtMs >= hiddenAtMs)
      if (announce.length > 0)
        announceAlerts(announce.map((event) => ({ symbol: event.symbol, targetPrice: event.targetPrice, price: event.triggeredPrice })))
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAtMs = Date.now()
      else {
        void poll()
        hiddenAtMs = undefined
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = globalThis.setInterval(() => void poll(), 15_000)
    void poll()
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisibility)
      globalThis.clearInterval(timer)
    }
  }, [setAlerts])
}
