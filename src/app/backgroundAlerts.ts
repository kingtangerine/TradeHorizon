import { getSessionToken } from './auth'

// Alerts that reach you with TradeHorizon closed: the server watches prices and sends a web-push
// notification through the browser's push service. This module turns that on and off for this device.

export type PushStatus = 'unsupported' | 'blocked' | 'off' | 'on'

export interface AlertEvent {
  readonly id: string
  readonly symbol: string
  readonly targetPrice: number
  readonly direction: 'above' | 'below'
  readonly triggeredAtMs: number
  readonly triggeredPrice?: number
}

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

export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'

  const keyResponse = await fetch('/api/push/key')
  if (!keyResponse.ok) throw new Error('The server could not provide a notification key.')
  const { publicKey } = await keyResponse.json() as { publicKey: string }
  await registration()
  const ready = await navigator.serviceWorker.ready
  const subscription = (await ready.pushManager.getSubscription()) ?? await ready.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  })
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  })
  if (!response.ok) {
    await subscription.unsubscribe().catch(() => undefined)
    const { error } = await response.json().catch(() => ({ error: undefined })) as { error?: string }
    throw new Error(error ?? 'The server rejected this device for notifications.')
  }
  return 'on'
}

export async function disablePush(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  const subscription = await (await registration()).pushManager.getSubscription()
  if (subscription) {
    await fetch('/api/push/unsubscribe', {
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
    const response = await fetch(`/api/alerts/events?since=${sinceMs}`, { headers: authHeaders() })
    if (!response.ok) return []
    return ((await response.json()) as { events: AlertEvent[] }).events
  } catch {
    return []
  }
}
