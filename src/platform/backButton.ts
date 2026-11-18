// Android's Back button. Capacitor hands it to the page once a listener is registered; without one it would walk the
// WebView's history, which this single-page app does not use.
import { App } from '@capacitor/app'
import { reportProblem } from '../app/errorReport'
import { handleBack } from './backStack'
import { isNative } from './native'

/** What to do when Back is pressed with nothing open. */
type LeaveApp = () => Promise<void>

/**
 * Handles one Back press: closes the most recently opened window, panel or menu, and when nothing is open sends the
 * app to the background (it keeps running, as Back from an app's first screen does on Android).
 */
export async function onBackPressed(leaveApp: LeaveApp): Promise<'closed' | 'left'> {
  if (handleBack()) return 'closed'
  await leaveApp()
  return 'left'
}

/** Starts listening for Back in the Android app. Does nothing in a browser. */
export function installBackButton(): void {
  if (!isNative) return
  const report = (error: unknown) => reportProblem(`Back button: ${error instanceof Error ? error.message : String(error)}`, 'back-button')
  App.addListener('backButton', () => {
    onBackPressed(() => App.minimizeApp()).catch(report)
  }).catch(report)
}
