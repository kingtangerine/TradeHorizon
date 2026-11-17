import { useEffect, useState } from 'react'
import { disablePush, enablePush, getPushStatus, type PushStatus } from '../backgroundAlerts'
import { getTelegramStatus, startTelegramLink, type TelegramStatus } from '../telegram'

/**
 * Where triggered alerts are delivered besides the open app: browser push notifications on this device and the
 * user's Telegram chat. The status is fetched when the alerts panel opens.
 */
export function useAlertChannels(alertsOpen: boolean) {
  const [pushStatus, setPushStatus] = useState<PushStatus>('off')
  const [pushBusy, setPushBusy] = useState(false)
  const [telegram, setTelegram] = useState<TelegramStatus>()
  const [telegramPending, setTelegramPending] = useState(false)
  const [telegramBusy, setTelegramBusy] = useState(false)
  const [telegramMessage, setTelegramMessage] = useState('')
  const [pushError, setPushError] = useState('')

  useEffect(() => {
    if (alertsOpen) void getPushStatus().then(setPushStatus)
  }, [alertsOpen])

  useEffect(() => {
    if (alertsOpen) void getTelegramStatus().then(setTelegram)
  }, [alertsOpen])

  // After "Connect Telegram", wait for the user to press Start in the chat (the server sees it within seconds).
  useEffect(() => {
    if (!telegramPending || !alertsOpen) return
    const deadline = Date.now() + 10 * 60_000
    const timer = globalThis.setInterval(() => {
      void getTelegramStatus().then((status) => {
        setTelegram(status)
        if (status?.linked) {
          setTelegramPending(false)
          setTelegramMessage('')
        } else if (Date.now() > deadline) setTelegramPending(false)
      })
    }, 3000)
    return () => globalThis.clearInterval(timer)
  }, [telegramPending, alertsOpen])

  const runTelegram = async (action: () => Promise<string | void>) => {
    setTelegramBusy(true)
    setTelegramMessage('')
    try {
      const message = await action()
      if (message) setTelegramMessage(message)
    } catch (error) {
      setTelegramMessage(error instanceof Error ? error.message : 'Telegram request failed.')
    } finally {
      setTelegramBusy(false)
    }
  }

  const connectTelegram = () =>
    runTelegram(async () => {
      const url = await startTelegramLink()
      // Opens the Telegram app (or web.telegram.org) at the bot with the one-time code attached.
      window.open(url, '_blank', 'noopener')
      setTelegramPending(true)
      return 'Press Start in Telegram to finish. This page updates by itself.'
    })

  const togglePush = async () => {
    setPushBusy(true)
    setPushError('')
    try {
      setPushStatus(pushStatus === 'on' ? await disablePush() : await enablePush())
    } catch (error) {
      setPushError(error instanceof Error ? error.message : 'Could not change notifications.')
    } finally {
      setPushBusy(false)
    }
  }

  return {
    pushStatus,
    pushBusy,
    pushError,
    telegram,
    setTelegram,
    telegramPending,
    telegramBusy,
    telegramMessage,
    runTelegram,
    connectTelegram,
    togglePush,
  }
}

/** Push and Telegram state and actions, for the notification settings in the alerts panel. */
export type AlertChannels = ReturnType<typeof useAlertChannels>
