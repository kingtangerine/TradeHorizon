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

const API = 'https://api.telegram.org'
const CODE_TTL_MS = 10 * 60_000
const MAX_CHATS_PER_USER = 5
const POLL_SECONDS = 25
const TOKEN_FORMAT = /^\d{5,}:[A-Za-z0-9_-]{30,}$/

export const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** "/start abc", "/start@MyBot abc", "/stop" -> { command, arg }. Anything else is undefined. */
export function parseCommand(text) {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+(\S+))?/i.exec(String(text ?? '').trim())
  return match ? { command: match[1].toLowerCase(), arg: match[2] } : undefined
}

/** A Telegram or network error as a sentence that says what to fix. */
export function explainError(error) {
  if (error?.status === 401 || error?.status === 404) return 'Telegram rejected the bot token (it is wrong or was revoked). Copy the current token from @BotFather into TH_TELEGRAM_TOKEN and restart the app.'
  if (error?.status === 409) return 'Another process is reading this bot\'s messages: the same token runs on two servers, or the app runs twice. Only one may use the token.'
  if (error?.status === 429) return 'Telegram is rate-limiting this bot; it retries automatically.'
  const code = error?.cause?.code ?? error?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `This server cannot look up api.telegram.org (DNS ${code}). Check the server's DNS settings.`
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || error?.name === 'TimeoutError') {
    return `This server cannot reach api.telegram.org (${code ?? 'timeout'}). A firewall or the hosting provider is probably blocking outgoing HTTPS to Telegram.`
  }
  return `Telegram request failed: ${error?.message ?? error}${code ? ` (${code})` : ''}.`
}

export function formatAlertMessage(payload) {
  return `🔔 <b>${escapeHtml(payload.title)}</b>\n${escapeHtml(payload.body)}`
}

/**
 * @param userName userId -> display name (for the greeting), or undefined when unknown
 * @param fetchImpl injectable for tests
 */
export function createTelegramService({ dataDir, token, apiBase = API, userName = () => undefined, fetchImpl = (url, init) => fetch(url, init), log = console, now = () => Date.now() }) {
  const file = join(dataDir, 'telegram.json')
  const enabled = typeof token === 'string' && TOKEN_FORMAT.test(token)
  if (token && !enabled) log.warn?.('[telegram] TH_TELEGRAM_TOKEN does not look like a bot token, so Telegram alerts are off.')

  /** links: userId -> [{ chatId, name, linkedAtMs }]; offset: next getUpdates offset */
  let state = { links: {}, offset: 0 }
  if (existsSync(file)) {
    try { state = { links: {}, offset: 0, ...JSON.parse(readFileSync(file, 'utf8')) } } catch { /* start empty */ }
  }
  const persist = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(state))
    renameSync(`${file}.tmp`, file)
  }

  /** code -> { userId, expiresAtMs } (memory only: a restart simply invalidates open codes) */
  const codes = new Map()
  let botUsername
  /** The latest reason the bot is not working, in plain words (cleared by a successful poll). */
  let problem
  let startedPollingAtMs
  let stopped = false
  const stopSignal = new AbortController()

  async function call(method, body, timeoutMs = 15_000) {
    const response = await fetchImpl(`${apiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), stopSignal.signal]),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.ok) {
      const error = new Error(payload.description ?? `Telegram answered ${response.status}`)
      error.status = response.status
      throw error
    }
    return payload.result
  }

  const reply = (chatId, text) => call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })

  function dropChat(chatId) {
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

  function link(userId, chatId, name) {
    dropChat(chatId) // a chat belongs to one account at a time
    state.links[userId] = [...(state.links[userId] ?? []), { chatId, name, linkedAtMs: now() }].slice(-MAX_CHATS_PER_USER)
    persist()
  }

  async function handleMessage(message) {
    const chat = message?.chat
    if (!chat || chat.type !== 'private') return // alerts are personal; ignore groups and channels
    const command = parseCommand(message.text)
    if (!command) return
    const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || chat.username || 'Telegram'

    if (command.command === 'start') {
      const entry = command.arg ? codes.get(command.arg) : undefined
      if (entry && entry.expiresAtMs > now()) {
        codes.delete(command.arg)
        link(entry.userId, chat.id, name)
        const account = userName(entry.userId)
        await reply(chat.id, `✅ <b>Connected${account ? ` to ${escapeHtml(account)}'s TradeHorizon account` : ''}.</b>\nYou will get a message here whenever one of your price alerts triggers.\n\nSend /stop to disconnect.`)
        return
      }
      await reply(chat.id, command.arg
        ? '⚠️ This link has expired or was already used. Open TradeHorizon, go to Alerts and press Connect Telegram again.'
        : 'Hi! I send your TradeHorizon price alerts.\nOpen TradeHorizon, go to Alerts and press <b>Connect Telegram</b> to link this chat.')
      return
    }
    if (command.command === 'stop') {
      const removed = dropChat(chat.id)
      await reply(chat.id, removed ? '🔕 Disconnected. You will not get alerts here any more.' : 'This chat is not connected to a TradeHorizon account.')
      return
    }
    if (command.command === 'help' || command.command === 'status') {
      const linked = Object.values(state.links).some((list) => list.some((item) => item.chatId === chat.id))
      await reply(chat.id, linked
        ? '✅ This chat is connected. Price alerts you create in TradeHorizon arrive here.\n/stop – disconnect'
        : 'Not connected yet. Open TradeHorizon, go to Alerts and press <b>Connect Telegram</b>.')
    }
  }

  /** One getUpdates round. Resolves when Telegram answers (up to POLL_SECONDS later) or fails. */
  async function pollOnce() {
    if (!botUsername) {
      botUsername = (await call('getMe')).username
      // Polling does not work while a webhook is registered for the bot.
      await call('deleteWebhook', {}).catch(() => undefined)
      log.log?.(`[telegram] bot @${botUsername} is ready`)
    }
    const updates = await call('getUpdates', { offset: state.offset, timeout: POLL_SECONDS, allowed_updates: ['message'] }, (POLL_SECONDS + 15) * 1000)
    for (const update of updates) {
      state.offset = update.update_id + 1
      try { await handleMessage(update.message) } catch (error) { log.warn?.(`[telegram] could not answer a message: ${error.message}`) }
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
        if (error.status === 401 || error.status === 404) {
          log.warn?.(`[telegram] ${problem}`)
          return
        }
        log.warn?.(`[telegram] ${problem}`)
        delayMs = Math.min(60_000, delayMs ? delayMs * 2 : 3000)
        await new Promise((resolve) => { const timer = setTimeout(resolve, delayMs); timer.unref?.() })
      }
    }
  }

  return {
    enabled,
    botUsername: () => botUsername,
    /** For /healthz: whether the bot works, and if not, why (never includes the token). */
    diagnostics() {
      if (!token) return { state: 'off', problem: 'TH_TELEGRAM_TOKEN is not set for this Node process. Put TH_TELEGRAM_TOKEN=<token> in a .env file in the app folder (next to package.json), or set it as an environment variable, then restart the app.' }
      if (!enabled) return { state: 'off', problem: 'TH_TELEGRAM_TOKEN is set but does not look like a bot token (expected digits, a colon, then 30+ letters/digits; check for extra quotes or spaces).' }
      if (botUsername && !problem) return { state: 'ready', bot: `@${botUsername}`, pollingSinceMs: startedPollingAtMs ?? null }
      return { state: problem ? 'error' : 'starting', bot: botUsername ? `@${botUsername}` : null, problem: problem ?? 'Contacting Telegram… reload in a few seconds.' }
    },
    start() { if (enabled) void loop() },
    stop() { stopped = true; stopSignal.abort() },
    pollOnce,
    handleMessage,

    status(userId) {
      const chats = state.links[userId] ?? []
      return { configured: enabled, ready: Boolean(botUsername), botUsername, linked: chats.length > 0, chats: chats.map(({ name }) => ({ name })) }
    },

    /** A one-time link the user opens in Telegram. Undefined until the bot has answered getMe. */
    createLink(userId) {
      if (!enabled || !botUsername) return undefined
      const stamp = now()
      for (const [code, entry] of codes) if (entry.userId === userId || entry.expiresAtMs <= stamp) codes.delete(code)
      const code = randomBytes(12).toString('base64url')
      codes.set(code, { userId, expiresAtMs: stamp + CODE_TTL_MS })
      return { url: `https://t.me/${botUsername}?start=${code}`, expiresInSec: CODE_TTL_MS / 1000 }
    },

    linkedCount: () => Object.keys(state.links).length,

    unlink(userId) {
      if (!state.links[userId]) return
      delete state.links[userId]
      persist()
    },

    /** Sends to every chat linked to the user. Chats that blocked the bot or were deleted are forgotten. */
    async send(userId, payload) {
      if (!enabled) return
      for (const { chatId } of state.links[userId] ?? []) {
        try {
          await reply(chatId, formatAlertMessage(payload))
        } catch (error) {
          if (error.status === 403 || (error.status === 400 && /chat not found/i.test(error.message))) dropChat(chatId)
          else log.warn?.(`[telegram] delivery failed: ${error.message}`)
        }
      }
    },
  }
}
