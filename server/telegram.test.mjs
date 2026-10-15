import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTelegramService, escapeHtml, formatAlertMessage, parseCommand } from './telegram.mjs'

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'
const dirs = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** A fake Telegram: records every call and answers from `handlers`. */
function fakeTelegram(handlers = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const method = url.split('/').pop()
    const body = JSON.parse(init.body)
    calls.push({ method, body })
    const result = handlers[method] ? handlers[method](body) : (method === 'getMe' ? { username: 'TradeHorizonBot' } : method === 'getUpdates' ? [] : true)
    if (result instanceof Error) return { ok: false, status: result.status ?? 400, json: async () => ({ ok: false, description: result.message }) }
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  return { calls, fetchImpl, sent: () => calls.filter((call) => call.method === 'sendMessage').map((call) => call.body) }
}

function make(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'th-telegram-'))
  dirs.push(dir)
  const telegram = fakeTelegram(options.handlers)
  const service = createTelegramService({
    dataDir: dir,
    token: 'token' in options ? options.token : TOKEN,
    userName: (id) => (id === 'u1' ? 'Sam' : undefined),
    fetchImpl: telegram.fetchImpl,
    log: { log() {}, warn() {} },
    now: options.now,
  })
  return { service, telegram, dir }
}

const start = (code, chatId = 77) => ({ chat: { id: chatId, type: 'private' }, from: { first_name: 'Sam', last_name: 'Lee' }, text: `/start ${code}` })

describe('helpers', () => {
  it('parses commands, with or without the bot name and argument', () => {
    expect(parseCommand('/start abc123')).toEqual({ command: 'start', arg: 'abc123' })
    expect(parseCommand('/start@TradeHorizonBot abc')).toEqual({ command: 'start', arg: 'abc' })
    expect(parseCommand('/STOP')).toEqual({ command: 'stop', arg: undefined })
    expect(parseCommand('hello')).toBeUndefined()
  })

  it('escapes HTML in alert messages so symbols cannot break the formatting', () => {
    expect(escapeHtml('<b>&')).toBe('&lt;b&gt;&amp;')
    expect(formatAlertMessage({ title: 'A<B price alert', body: 'Price reached 1 & 2' })).toBe('🔔 <b>A&lt;B price alert</b>\nPrice reached 1 &amp; 2')
  })
})

describe('telegram service', () => {
  it('stays off without a valid token', () => {
    expect(make({ token: undefined }).service.enabled).toBe(false)
    expect(make({ token: 'not-a-token' }).service.enabled).toBe(false)
    expect(make().service.enabled).toBe(true)
  })

  it('cannot create a link before the bot is ready, then links a chat when the user presses Start', async () => {
    const { service, telegram } = make({
      handlers: { getUpdates: () => [{ update_id: 5, message: start('PLACEHOLDER') }] },
    })
    expect(service.createLink('u1')).toBeUndefined()
    await service.pollOnce() // getMe + deleteWebhook happen here (the placeholder code is unknown)
    const link = service.createLink('u1')
    expect(link.url).toMatch(/^https:\/\/t\.me\/TradeHorizonBot\?start=[\w-]{16}$/)

    await service.handleMessage(start(new URL(link.url).searchParams.get('start')))
    expect(service.status('u1')).toMatchObject({ configured: true, ready: true, linked: true, chats: [{ name: 'Sam Lee' }] })
    expect(telegram.sent().at(-1).text).toContain("Connected to Sam's TradeHorizon account")
  })

  it('rejects unknown, reused and expired codes', async () => {
    let time = 1_000
    const { service, telegram } = make({ now: () => time })
    await service.pollOnce()
    const code = new URL(service.createLink('u1').url).searchParams.get('start')

    await service.handleMessage(start('nope'))
    expect(service.status('u1').linked).toBe(false)
    expect(telegram.sent().at(-1).text).toContain('expired or was already used')

    time += 11 * 60_000
    await service.handleMessage(start(code))
    expect(service.status('u1').linked).toBe(false)

    const fresh = new URL(service.createLink('u1').url).searchParams.get('start')
    await service.handleMessage(start(fresh))
    expect(service.status('u1').linked).toBe(true)
    await service.handleMessage(start(fresh, 88)) // same code again from another chat
    expect(service.status('u1').chats).toHaveLength(1)
  })

  it('ignores group chats', async () => {
    const { service, telegram } = make()
    await service.pollOnce()
    const code = new URL(service.createLink('u1').url).searchParams.get('start')
    await service.handleMessage({ chat: { id: 5, type: 'group' }, text: `/start ${code}` })
    expect(service.status('u1').linked).toBe(false)
    expect(telegram.sent()).toHaveLength(0)
  })

  it('sends alerts to linked chats and forgets a chat that blocked the bot', async () => {
    const blocked = Object.assign(new Error('Forbidden: bot was blocked by the user'), { status: 403 })
    let blockedNow = false
    const { service, telegram } = make({ handlers: { sendMessage: (body) => (blockedNow && body.chat_id === 99 ? blocked : true) } })
    await service.pollOnce()
    for (const chatId of [77, 99]) {
      const code = new URL(service.createLink(chatId === 77 ? 'u1' : 'u2').url).searchParams.get('start')
      await service.handleMessage(start(code, chatId))
    }
    expect(service.status('u2').linked).toBe(true)
    blockedNow = true

    await service.send('u1', { title: 'BTCUSDT price alert', body: 'Price reached 101 (target 100).' })
    const alertMessage = telegram.sent().at(-1)
    expect(alertMessage).toMatchObject({ chat_id: 77, parse_mode: 'HTML' })
    expect(alertMessage.text).toContain('BTCUSDT price alert')

    await service.send('u2', { title: 'x', body: 'y' })
    expect(service.status('u2').linked).toBe(false)
    expect(service.status('u1').linked).toBe(true)
  })

  it('/stop and unlink disconnect, and links survive a restart', async () => {
    const first = make()
    await first.service.pollOnce()
    const code = new URL(first.service.createLink('u1').url).searchParams.get('start')
    await first.service.handleMessage(start(code))

    const restarted = createTelegramService({ dataDir: first.dir, token: TOKEN, fetchImpl: first.telegram.fetchImpl, log: { log() {}, warn() {} } })
    expect(restarted.status('u1').linked).toBe(true)

    await restarted.handleMessage({ chat: { id: 77, type: 'private' }, text: '/stop' })
    expect(restarted.status('u1').linked).toBe(false)

    first.service.unlink('u1')
    expect(first.service.status('u1').linked).toBe(false)
  })

  it('advances the update offset so a message is never handled twice', async () => {
    const { service, telegram } = make({ handlers: { getUpdates: () => [{ update_id: 41, message: { chat: { id: 1, type: 'private' }, text: '/help' } }] } })
    await service.pollOnce()
    await service.pollOnce()
    const polls = telegram.calls.filter((call) => call.method === 'getUpdates')
    expect(polls[0].body.offset).toBe(0)
    expect(polls[1].body.offset).toBe(42)
  })
})
