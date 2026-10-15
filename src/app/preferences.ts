// Per-user chart preferences (synced with the account like the rest of the user's data).

export interface Preferences {
  /** Time left until the current candle closes, under the last price on the axis. */
  readonly candleCountdown: boolean
}

export const DEFAULT_PREFERENCES: Preferences = { candleCountdown: true }

export function preferencesKey(userId: string): string {
  return `trade-horizon:user:${userId}:prefs:v1`
}

export function parsePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES
  const raw = value as Record<string, unknown>
  return { candleCountdown: typeof raw.candleCountdown === 'boolean' ? raw.candleCountdown : DEFAULT_PREFERENCES.candleCountdown }
}

export function loadPreferences(userId: string): Preferences {
  try {
    return parsePreferences(JSON.parse(localStorage.getItem(preferencesKey(userId)) ?? 'null'))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(userId: string, preferences: Preferences): void {
  try {
    localStorage.setItem(preferencesKey(userId), JSON.stringify(preferences))
  } catch {
    // Storage full or blocked: the choice is simply not remembered.
  }
}
