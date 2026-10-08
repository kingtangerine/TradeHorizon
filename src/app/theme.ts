export type Theme = 'dark' | 'light'

// The device key makes the sign-in screen and the first paint use the last theme without a flash.
// The per-user key is part of the synced data, so the choice follows the account to other computers.
const DEVICE_KEY = 'trade-horizon:theme'

export function userThemeKey(userId: string): string {
  return `trade-horizon:user:${userId}:theme:v1`
}

function parse(value: unknown): Theme | undefined {
  return value === 'light' || value === 'dark' ? value : undefined
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(DEVICE_KEY, theme) } catch { /* storage unavailable */ }
}

export function initialTheme(): Theme {
  try { return parse(localStorage.getItem(DEVICE_KEY)) ?? 'dark' } catch { return 'dark' }
}

export function loadUserTheme(userId: string): Theme {
  try { return parse(localStorage.getItem(userThemeKey(userId))) ?? initialTheme() } catch { return 'dark' }
}

export function saveUserTheme(userId: string, theme: Theme): void {
  try { localStorage.setItem(userThemeKey(userId), theme) } catch { /* storage unavailable */ }
}
