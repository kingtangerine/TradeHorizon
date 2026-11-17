// Telegram alerts: the server owns a bot, a user links their account to it once, and every triggered
// price alert is then also sent as a Telegram message (phone, desktop, anywhere Telegram runs).
//
// The bot receives messages by long polling (getUpdates), so no public HTTPS address or webhook is needed.
// Linking: the app asks for a one-time code, the user opens t.me/<bot>?start=<code>, and pressing Start
// sends the code to the bot, which ties that chat to the account.
// Environment: TH_TELEGRAM_TOKEN (from @BotFather). Without it everything here stays switched off.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { createSendQueue } from './sendQueue.ts'
import type { FetchLike, Logger } from './markets.ts'

const API = 'https://api.telegram.org'
const CODE_TTL_MS = 10 * 60_000
const MAX_CHATS_PER_USER = 5
const POLL_SECONDS = 25
const TOKEN_FORMAT = /^\d{5,}:[A-Za-z0-9_-]{30,}$/

/** What an alert notification says. */
export interface AlertPayload {
  title: string
  body: string
}

/** A command sent to the bot, e.g. "/start abc" -> { command: 'start', arg: 'abc' }. */
export interface ParsedCommand {
  command: string
  arg: string | undefined
}

/** The fields of a thrown value that explainError and the retry logic look at; all may be missing. */
export interface TelegramErrorInfo {
  status?: number
  code?: string
  name?: string
  message?: string
  cause?: { code?: string }
  /** How long Telegram asked to wait before the next request (429 answers). */
  retryAfterMs?: number
  /** Set when a retry cannot succeed, so the send queue gives up at once. */
  permanent?: boolean
}

/** An Error raised for a failed Telegram API call. */
export interface TelegramApiError extends Error {
  status?: number
  retryAfterMs?: number
  permanent?: boolean
}

/** The parts of a Telegram message the bot reads. */
export interface TelegramMessage {
  chat?: { id: number; type: string; username?: string }
  from?: { first_name?: string; last_name?: string }
  text?: string
}

/** One update from Telegram getUpdates: its id (for the next offset) and the message, if any. */
export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

/** One chat linked to an account. */
export interface TelegramLink {
  chatId: number
  name: string
  linkedAtMs: number
}

interface TelegramState {
  links: Record<string, TelegramLink[]>
  offset: number
}

/** Telegram's answer envelope: { ok, result } on success, { ok: false, description, parameters } on failure. */
interface TelegramResponse {
  ok?: boolean
  result?: unknown
  description?: string
  parameters?: { retry_after?: number }
}

/** Data folder for links, the bot token (the service is off without it), and replaceable API base, fetch, logging and clock. */
export interface TelegramServiceOptions {
  dataDir: string
  token?: string
  apiBase?: string
  userName?: (userId: string) => string | undefined
  fetchImpl?: FetchLike
  log?: Logger
  now?: () => number
}

/** A caught value's fields, or none when it is not an object. */
const errorInfo = (error: unknown): TelegramErrorInfo | undefined => (typeof error === 'object' && error !== null ? error : undefined)

/** Escapes &, < and > for Telegram HTML messages. */
export const escapeHtml = (text: unknown): string => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** "/start abc", "/start@MyBot abc", "/stop" -> { command, arg }. Anything else is undefined. */
export function parseCommand(text: unknown): ParsedCommand | undefined {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+(\S+))?/i.exec(String(text ?? '').trim())
  return match ? { command: match[1].toLowerCase(), arg: match[2] } : undefined
}

/** A Telegram or network error as a sentence that says what to fix. */
export function explainError(caught: unknown): string {
  const error = errorInfo(caught)
  if (error?.status === 401 || error?.status === 404)
    return 'Telegram rejected the bot token (it is wrong or was revoked). Copy the current token from @BotFather into TH_TELEGRAM_TOKEN and restart the app.'
  if (error?.status === 409)
    return "Another process is reading this bot's messages: the same token runs on two servers, or the app runs twice. Only one may use the token."
  if (error?.status === 429) return 'Telegram is rate-limiting this bot; it retries automatically.'
  const code = error?.cause?.code ?? error?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return `This server cannot look up api.telegram.org (DNS ${code}). Check the server's DNS settings.`
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    error?.name === 'TimeoutError'
  ) {
    return `This server cannot reach api.telegram.org (${code ?? 'timeout'}). A firewall or the hosting provider is probably blocking outgoing HTTPS to Telegram.`
  }
  return `Telegram request failed: ${error?.message ?? caught}${code ? ` (${code})` : ''}.`
}

/** The Telegram HTML text of an alert notification: a bell, the bold title and the body. */
export function formatAlertMessage(payload: AlertPayload): string {
  return `🔔 <b>${escapeHtml(payload.title)}</b>\n${escapeHtml(payload.body)}`
}

/**
 * @param userName userId -> display name (for the greeting), or undefined when unknown
 * @param fetchImpl injectable for tests
 */
export function createTelegramService({
  dataDir,
  token,
  apiBase = API,
  userName = () => undefined,
  fetchImpl = (url, init) => fetch(url, init),
  log = console,
  now = () => Date.now(),
}: TelegramServiceOptions) {
  const file = join(dataDir, 'telegram.json')
  const enabled = typeof token === 'string' && TOKEN_FORMAT.test(token)
  if (token && !enabled) log.warn?.('[telegram] TH_TELEGRAM_TOKEN does not look like a bot token, so Telegram alerts are off.')

  /** links: userId -> [{ chatId, name, linkedAtMs }]; offset: next getUpdates offset */
  let state: TelegramState = { links: {}, offset: 0 }
  if (existsSync(file)) {
    try {
      state = { links: {}, offset: 0, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<TelegramState>) }
    } catch {
      /* start empty */
    }
  }
  const persist = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(state))
    renameSync(`${file}.tmp`, file)
  }

  /** code -> { userId, expiresAtMs } (memory only: a restart simply invalidates open codes) */
  const codes = new Map<string, { userId: string; expiresAtMs: number }>()
  let botUsername: string | undefined
  // Telegram allows about 30 messages a second per bot and 1 a second per chat: stay under both.
  const queue = createSendQueue({ name: 'telegram', perSecond: 25, perKeyGapMs: 1000, log, now })
  /** The latest reason the bot is not working, in plain words (cleared by a successful poll). */
  let problem: string | undefined
  let startedPollingAtMs: number | undefined
  let stopped = false
  const stopSignal = new AbortController()

  async function call<T>(method: string, body?: object, timeoutMs = 15_000): Promise<T> {
    const response = await fetchImpl(`${apiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), stopSignal.signal]),
    })
    const payload = (await response.json().catch(() => ({}))) as TelegramResponse
    if (!response.ok || !payload.ok) {
      const error: TelegramApiError = new Error(payload.description ?? `Telegram answered ${response.status}`)
      error.status = response.status
      // 429 answers say how long to wait.
      if (payload.parameters?.retry_after) error.retryAfterMs = payload.parameters.retry_after * 1000
      throw error
    }
    // ok is true: the result has the shape Telegram documents for this method.
    return payload.result as T
  }

  const reply = (chatId: number, text: string) =>
    call<unknown>('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })

  function dropChat(chatId: number) {
    let changed = false
    for (const [userId, list] of Object.entries(state.links)) {
      const rest = list.filter((link) => link.chatId !== chatId)
      if (rest.length === list.length) continue
      changed = true
      if (rest.length === 0) delete state.links[userId]
      else state.links[userId] = rest
    }
    if (changed) persist()
    return changed
  }

  function link(userId: string, chatId: number, name: string) {
    dropChat(chatId) // a chat belongs to one account at a time
    state.links[userId] = [...(state.links[userId] ?? []), { chatId, name, linkedAtMs: now() }].slice(-MAX_CHATS_PER_USER)
    persist()
  }

  async function handleMessage(message: TelegramMessage | undefined) {
    const chat = message?.chat
    if (!chat || chat.type !== 'private') return // alerts are personal; ignore groups and channels
    const command = parseCommand(message.text)
    if (!command) return
    const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || chat.username || 'Telegram'

    if (command.command === 'start') {
      const entry = command.arg ? codes.get(command.arg) : undefined
      if (entry && entry.expiresAtMs > now()) {
        codes.delete(command.arg!) // entry was found under this code, so it is set
        link(entry.userId, chat.id, name)
        const account = userName(entry.userId)
        await reply(
          chat.id,
          `✅ <b>Connected${account ? ` to ${escapeHtml(account)}'s TradeHorizon account` : ''}.</b>\nYou will get a message here whenever one of your price alerts triggers.\n\nSend /stop to disconnect.`,
        )
        return
      }
      await reply(
        chat.id,
        command.arg
          ? '⚠️ This link has expired or was already used. Open TradeHorizon, go to Alerts and press Connect Telegram again.'
          : 'Hi! I send your TradeHorizon price alerts.\nOpen TradeHorizon, go to Alerts and press <b>Connect Telegram</b> to link this chat.',
      )
      return
    }
    if (command.command === 'stop') {
      const removed = dropChat(chat.id)
      await reply(
        chat.id,
        removed ? '🔕 Disconnected. You will not get alerts here any more.' : 'This chat is not connected to a TradeHorizon account.',
      )
      return
    }
    if (command.command === 'help' || command.command === 'status') {
      const linked = Object.values(state.links).some((list) => list.some((item) => item.chatId === chat.id))
      await reply(
        chat.id,
        linked
          ? '✅ This chat is connected. Price alerts you create in TradeHorizon arrive here.\n/stop – disconnect'
          : 'Not connected yet. Open TradeHorizon, go to Alerts and press <b>Connect Telegram</b>.',
      )
    }
  }

  /** One getUpdates round. Resolves when Telegram answers (up to POLL_SECONDS later) or fails. */
  async function pollOnce() {
    if (!botUsername) {
      botUsername = (await call<{ username?: string }>('getMe')).username
      // Polling does not work while a webhook is registered for the bot.
      await call('deleteWebhook', {}).catch(() => undefined)
      log.log?.(`[telegram] bot @${botUsername} is ready`)
    }
    const updates = await call<TelegramUpdate[]>(
      'getUpdates',
      { offset: state.offset, timeout: POLL_SECONDS, allowed_updates: ['message'] },
      (POLL_SECONDS + 15) * 1000,
    )
    for (const update of updates) {
      state.offset = update.update_id + 1
      try {
        await handleMessage(update.message)
      } catch (error) {
        log.warn?.(`[telegram] could not answer a message: ${errorInfo(error)?.message}`)
      }
    }
    if (updates.length > 0) persist()
    return updates.length
  }

  async function loop() {
    let delayMs = 0
    while (!stopped) {
      try {
        await pollOnce()
        delayMs = 0
        problem = undefined
        startedPollingAtMs ??= now()
      } catch (error) {
        if (stopped) return
        problem = explainError(error)
        if (errorInfo(error)?.status === 401 || errorInfo(error)?.status === 404) {
          log.warn?.(`[telegram] ${problem}`)
          return
        }
        log.warn?.(`[telegram] ${problem}`)
        delayMs = Math.min(60_000, delayMs ? delayMs * 2 : 3000)
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delayMs)
          timer.unref?.()
        })
      }
    }
  }

  return {
    enabled,
    botUsername: () => botUsername,
    /** For /healthz: whether the bot works, and if not, why (never includes the token). */
    diagnostics() {
      if (!token)
        return {
          state: 'off',
          problem:
            'TH_TELEGRAM_TOKEN is not set for this Node process. Put TH_TELEGRAM_TOKEN=<token> in a .env file in the app folder (next to package.json), or set it as an environment variable, then restart the app.',
        }
      if (!enabled)
        return {
          state: 'off',
          problem:
            'TH_TELEGRAM_TOKEN is set but does not look like a bot token (expected digits, a colon, then 30+ letters/digits; check for extra quotes or spaces).',
        }
      if (botUsername && !problem) return { state: 'ready', bot: `@${botUsername}`, pollingSinceMs: startedPollingAtMs ?? null }
      return {
        state: problem ? 'error' : 'starting',
        bot: botUsername ? `@${botUsername}` : null,
        problem: problem ?? 'Contacting Telegram… reload in a few seconds.',
      }
    },
    start() {
      if (enabled) void loop()
    },
    stop() {
      stopped = true
      stopSignal.abort()
      queue.stop()
    },
    queueStatus: () => queue.status(),
    pollOnce,
    handleMessage,

    status(userId: string) {
      const chats = state.links[userId] ?? []
      return {
        configured: enabled,
        ready: Boolean(botUsername),
        botUsername,
        linked: chats.length > 0,
        chats: chats.map(({ name }) => ({ name })),
      }
    },

    /** A one-time link the user opens in Telegram. Undefined until the bot has answered getMe. */
    createLink(userId: string) {
      if (!enabled || !botUsername) return undefined
      const stamp = now()
      for (const [code, entry] of codes) if (entry.userId === userId || entry.expiresAtMs <= stamp) codes.delete(code)
      const code = randomBytes(12).toString('base64url')
      codes.set(code, { userId, expiresAtMs: stamp + CODE_TTL_MS })
      return { url: `https://t.me/${botUsername}?start=${code}`, expiresInSec: CODE_TTL_MS / 1000 }
    },

    linkedCount: () => Object.keys(state.links).length,

    unlink(userId: string) {
      if (!state.links[userId]) return
      delete state.links[userId]
      persist()
    },

    /** Sends to every chat linked to the user. Chats that blocked the bot or were deleted are forgotten. */
    /** Queues the message for every chat linked to the user; settles when each was delivered or given up on. */
    async send(userId: string, payload: AlertPayload) {
      if (!enabled) return []
      const text = formatAlertMessage(payload)
      return Promise.all(
        (state.links[userId] ?? []).map(({ chatId }) =>
          queue.enqueue(chatId, async () => {
            try {
              await reply(chatId, text)
            } catch (caught) {
              const error = errorInfo(caught) ?? {}
              // The chat blocked the bot or no longer exists: forget it. Other 400s will not succeed on a retry either.
              if (error.status === 403 || (error.status === 400 && /chat not found/i.test(String(error.message)))) {
                dropChat(chatId)
                error.permanent = true
              } else if (error.status === 400 || error.status === 401 || error.status === 404) error.permanent = true
              throw caught
            }
          }),
        ),
      )
    },
  }
}

/** The Telegram bot service created by createTelegramService. */
export type TelegramService = ReturnType<typeof createTelegramService>
