import { reportProblem } from './errorReport'
import { syncSystemBars } from '../platform/systemBars'

/** The app's color theme. */
export type Theme = 'dark' | 'light'

// The device key makes the sign-in screen and the first paint use the last theme without a flash.
// The per-user key is part of the synced data, so the choice follows the account to other computers.
const DEVICE_KEY = 'trade-horizon:theme'

/** Per-user localStorage key for the theme, synced with the account. */
export function userThemeKey(userId: string): string {
  return `trade-horizon:user:${userId}:theme:v1`
}

function parse(value: unknown): Theme | undefined {
  return value === 'light' || value === 'dark' ? value : undefined
}

/** Switches the page to a theme and remembers it on this device for the next first paint. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(DEVICE_KEY, theme)
  } catch {
    /* storage unavailable */
  }
  // In the Android app the status and navigation bars follow the theme; a failure there only affects their colour.
  syncSystemBars(theme).catch((error: unknown) => {
    reportProblem(`System bars could not follow the theme: ${error instanceof Error ? error.message : String(error)}`, 'system-bars')
  })
}

// Reading localStorage throws when storage is blocked; the dark default is then the right answer, not an error.
/** The theme last used on this device, defaulting to dark. */
export function initialTheme(): Theme {
  try {
    return parse(localStorage.getItem(DEVICE_KEY)) ?? 'dark'
  } catch {
    return 'dark'
  }
}

/** The user's synced theme, falling back to this device's last theme. */
export function loadUserTheme(userId: string): Theme {
  try {
    return parse(localStorage.getItem(userThemeKey(userId))) ?? initialTheme()
  } catch {
    return 'dark'
  }
}

/** Stores the user's theme choice in the synced per-user key; ignores storage failures. */
export function saveUserTheme(userId: string, theme: Theme): void {
  try {
    localStorage.setItem(userThemeKey(userId), theme)
  } catch {
    /* storage unavailable */
  }
}
