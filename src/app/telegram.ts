import { getSessionToken } from './auth'

// Telegram alerts: the server runs a bot; this module links the signed-in account to a Telegram chat.

export interface TelegramStatus {
  /** The server has a bot token. When false the whole feature stays hidden. */
  readonly configured: boolean
  /** The bot has answered Telegram and can hand out link codes. */
  readonly ready: boolean
  readonly botUsername?: string
  readonly linked: boolean
  readonly chats: ReadonlyArray<{ readonly name: string }>
}

function authHeaders(): Record<string, string> {
  const token = getSessionToken()
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

async function failure(response: Response, fallback: string): Promise<Error> {
  const { error } = await response.json().catch(() => ({ error: undefined })) as { error?: string }
  return new Error(error ?? fallback)
}

/** Undefined when the server cannot be reached or does not know Telegram (older server). */
export async function getTelegramStatus(): Promise<TelegramStatus | undefined> {
  try {
    const response = await fetch('/api/telegram/status', { headers: authHeaders() })
    return response.ok ? await response.json() as TelegramStatus : undefined
  } catch {
    return undefined
  }
}

/** A one-time https://t.me link that opens the bot and links this account when the user presses Start. */
export async function startTelegramLink(): Promise<string> {
  const response = await fetch('/api/telegram/link', { method: 'POST', headers: authHeaders() })
  if (!response.ok) throw await failure(response, 'Could not start the Telegram connection.')
  return ((await response.json()) as { url: string }).url
}

export async function unlinkTelegram(): Promise<void> {
  const response = await fetch('/api/telegram/unlink', { method: 'POST', headers: authHeaders() })
  if (!response.ok) throw await failure(response, 'Could not disconnect Telegram.')
}

export async function sendTelegramTest(): Promise<void> {
  const response = await fetch('/api/telegram/test', { method: 'POST', headers: authHeaders() })
  if (!response.ok) throw await failure(response, 'Could not send the test message.')
}
