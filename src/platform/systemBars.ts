// Keeps the Android status and navigation bars in step with the app's dark or light theme.
// Newer phones let the page draw under the bars, so only the icon colour needs setting. Older WebViews keep the page
// between the bars and show the window behind them, so the window gets the page's background colour too
// (WindowBackgroundPlugin.kt).
import { SystemBars, SystemBarsStyle, registerPlugin } from '@capacitor/core'
import { isNative } from './native'

/** The Kotlin plugin in android/app/src/main/kotlin/com/kollshai/tradehorizon/WindowBackgroundPlugin.kt. */
interface WindowBackgroundPlugin {
  setColor(options: { color: string }): Promise<void>
}

const WindowBackground = registerPlugin<WindowBackgroundPlugin>('WindowBackground')

/** Capacitor's "DARK" style means light icons, for a dark background; "LIGHT" is the opposite. */
export function systemBarsStyleFor(theme: 'dark' | 'light'): SystemBarsStyle {
  return theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light
}

/** "rgb(8, 11, 16)" (how browsers report computed colours) -> "#080b10". Undefined for anything else, e.g. a transparent colour. */
export function rgbToHex(value: string): string | undefined {
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value.trim())
  if (!match) return undefined
  const channels = match.slice(1).map(Number)
  if (channels.some((channel) => channel > 255)) return undefined
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** Applies a theme to the Android system bars. Call it after the theme is set on the page. Does nothing in a browser. */
export async function syncSystemBars(theme: 'dark' | 'light'): Promise<void> {
  if (!isNative) return
  // The style call resets the window colour to the Android theme's default, so the colour is set after it.
  await SystemBars.setStyle({ style: systemBarsStyleFor(theme) })
  // The page's own background is the single source for the colour, so the bars cannot drift from the stylesheet.
  const color = rgbToHex(getComputedStyle(document.body).backgroundColor)
  if (color) await WindowBackground.setColor({ color })
}
