import { getTelegramStatus, sendTelegramTest, unlinkTelegram } from '../telegram'
import type { AlertChannels } from './useAlertChannels'

/** Alerts panel section: background (push) notifications on this device and Telegram alerts. */
export function AlertNotifications({ channels }: { channels: AlertChannels }) {
  const {
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
  } = channels
  return (
    <>
      <div className="alert-background">
        <div>
          <strong>Alerts when TradeHorizon is closed</strong>
          <small>
            {pushStatus === 'on' && 'On for this device. The server watches prices and notifies you even with the browser closed.'}
            {pushStatus === 'off' && 'Get a notification on this device when a price alert triggers, even with TradeHorizon closed.'}
            {pushStatus === 'blocked' && 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'}
            {pushStatus === 'unsupported' &&
              'This browser does not support background notifications. On iPhone, add TradeHorizon to the Home Screen first.'}
          </small>
          {pushError && (
            <small className="alert-error" role="alert">
              {pushError}
            </small>
          )}
        </div>
        {pushStatus !== 'unsupported' && pushStatus !== 'blocked' && (
          <button type="button" onClick={() => void togglePush()} disabled={pushBusy}>
            {pushBusy ? 'Please wait…' : pushStatus === 'on' ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>
      {telegram?.configured && (
        <div className="alert-background alert-telegram">
          <div>
            <strong>Telegram alerts</strong>
            <small>
              {telegram.linked
                ? `Connected${telegram.chats[0]?.name ? ` as ${telegram.chats[0].name}` : ''}. Triggered alerts are sent to your Telegram chat, on your phone too.`
                : 'Get triggered alerts as Telegram messages on your phone, with TradeHorizon closed.'}
            </small>
            {telegramMessage && (
              <small className={telegramPending ? '' : 'alert-error'} role="status">
                {telegramMessage}
              </small>
            )}
          </div>
          {telegram.linked ? (
            <span className="alert-telegram-actions">
              <button
                type="button"
                disabled={telegramBusy}
                onClick={() =>
                  void runTelegram(async () => {
                    await sendTelegramTest()
                    return 'Test message sent.'
                  })
                }
              >
                Send test
              </button>
              <button
                type="button"
                disabled={telegramBusy}
                onClick={() =>
                  void runTelegram(async () => {
                    await unlinkTelegram()
                    setTelegram(await getTelegramStatus())
                  })
                }
              >
                Disconnect
              </button>
            </span>
          ) : (
            <button type="button" disabled={telegramBusy || !telegram.ready} onClick={() => void connectTelegram()}>
              {telegramPending ? 'Waiting…' : 'Connect Telegram'}
            </button>
          )}
        </div>
      )}
    </>
  )
}
