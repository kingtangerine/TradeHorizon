import { getSessionToken } from './auth'
import { apiUrl } from '../platform/api'

// Alerts that reach you with TradeHorizon closed: the server watches prices and sends a web-push
// notification through the browser's push service. This module turns that on and off for this device.

/** Background alerts on this device: not possible, denied by the browser, not subscribed, or active. */
export type PushStatus = 'unsupported' | 'blocked' | 'off' | 'on'

/** An alert trigger recorded by the server. */
export interface AlertEvent {
  readonly id: string
  readonly symbol: string
  readonly targetPrice: number
  readonly direction: 'above' | 'below'
  readonly triggeredAtMs: number
  readonly triggeredPrice?: number
  /** An "every time" alert: it stays active; this event is one of its triggers. */
  readonly everyTime?: boolean
}

/** Whether this browser has service workers, push and notifications. */
export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function authHeaders(): Record<string, string> {
  const token = getSessionToken()
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

function applicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64Url.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js')
}

/** Current background-alert state of this device, without prompting the user. */
export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  try {
    const existing = await (await registration()).pushManager.getSubscription()
    return existing && Notification.permission === 'granted' ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/**
 * Asks for notification permission and subscribes this device to server push.
 * Returns the resulting status; throws with a user-facing message when the server cannot provide a key or rejects the device.
 */
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'

  let keyResponse: Response
  try {
    keyResponse = await fetch(apiUrl('/api/push/key'))
  } catch {
    throw new Error('Could not reach the TradeHorizon server. Check your connection and try again.')
  }
  if (!keyResponse.ok) {
    // 404 means the running server predates background alerts: the new server files were not deployed or the Node process was not restarted.
    throw new Error(
      keyResponse.status === 404 || keyResponse.status === 405
        ? 'This server does not support background alerts yet. The server needs the latest TradeHorizon version, then a restart (administrator: see /healthz).'
        : `The server could not provide a notification key (error ${keyResponse.status}). Try again in a moment.`,
    )
  }
  const keyBody = (await keyResponse.json().catch(() => undefined)) as { publicKey?: string } | undefined
  if (!keyBody?.publicKey) {
    throw new Error(
      'The server answered with something that is not a notification key. If a proxy sits in front of the app, it must pass /api/ requests to the Node server.',
    )
  }
  const { publicKey } = keyBody
  await registration()
  const ready = await navigator.serviceWorker.ready
  const subscription =
    (await ready.pushManager.getSubscription()) ??
    (await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    }))
  const response = await fetch(apiUrl('/api/push/subscribe'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  })
  if (!response.ok) {
    // Best-effort cleanup; the error that matters is the server's answer, thrown below.
    await subscription.unsubscribe().catch(() => undefined)
    const { error } = (await response.json().catch(() => ({ error: undefined }))) as { error?: string }
    throw new Error(error ?? 'The server rejected this device for notifications.')
  }
  return 'on'
}

/** Unsubscribes this device from push (also when offline) and returns the resulting status. */
export async function disablePush(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  const subscription = await (await registration()).pushManager.getSubscription()
  if (subscription) {
    // Turning alerts off must work offline too: the server drops dead subscriptions on its own when a send fails.
    await fetch(apiUrl('/api/push/unsubscribe'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined)
    await subscription.unsubscribe().catch(() => undefined)
  }
  return Notification.permission === 'denied' ? 'blocked' : 'off'
}

/** Alerts the server has triggered since `sinceMs`. Returns an empty list when the server cannot be reached. */
export async function fetchAlertEvents(sinceMs: number): Promise<AlertEvent[]> {
  try {
    const response = await fetch(apiUrl(`/api/alerts/events?since=${sinceMs}`), { headers: authHeaders() })
    if (!response.ok) return []
    return ((await response.json()) as { events: AlertEvent[] }).events
  } catch {
    return []
  }
}
