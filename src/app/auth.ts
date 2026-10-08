export interface AppUser {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly createdAtMs: number
}

// Accounts live on the server (server/index.mjs) so they work from any device.
// Only the session token and a cached copy of the public profile stay in this browser.
const SESSION_KEY = 'trade-horizon:session:v2'
const LEGACY_USERS_KEY = 'trade-horizon:users:v1'
const LEGACY_SESSION_KEY = 'trade-horizon:session:v1'

interface StoredSession {
  readonly token: string
  readonly user: AppUser
}

interface AuthResponse {
  readonly user: AppUser
  readonly token: string
}

function readSession(): StoredSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as StoredSession | null
    return value && typeof value.token === 'string' && typeof value.user?.id === 'string' ? value : null
  } catch {
    return null
  }
}

function writeSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

class AuthRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function request<T>(path: string, init: { method?: string, body?: unknown, token?: string } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new AuthRequestError('Cannot reach the TradeHorizon server. Check your connection and that the server is running.', 0)
  }
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new AuthRequestError(data.error ?? 'Authentication failed.', response.status)
  return data as T
}

/** Instant, offline-safe restore of the cached session. Call `verifySession` afterwards. */
export function restoreSession(): AppUser | null {
  return readSession()?.user ?? null
}

/** Confirms the cached session with the server. Resolves false only when the server rejects it. */
export async function verifySession(): Promise<boolean> {
  const session = readSession()
  if (!session) return false
  try {
    const { user } = await request<{ user: AppUser }>('/api/auth/me', { token: session.token })
    writeSession({ token: session.token, user })
    return true
  } catch (error) {
    if (error instanceof AuthRequestError && error.status === 401) {
      localStorage.removeItem(SESSION_KEY)
      return false
    }
    return true // server unreachable: keep working with the cached session
  }
}

export async function signUp(displayName: string, email: string, password: string, legacyId?: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedName = displayName.trim()
  if (normalizedName.length < 2) throw new Error('Enter a display name of at least 2 characters.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.')
  if (password.length < 8) throw new Error('Password must contain at least 8 characters.')
  const { user, token } = await request<AuthResponse>('/api/auth/signup', {
    method: 'POST',
    body: { displayName: normalizedName, email: normalizedEmail, password, legacyId },
  })
  writeSession({ token, user })
  return user
}

export async function logIn(email: string, password: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase()
  try {
    const { user, token } = await request<AuthResponse>('/api/auth/login', { method: 'POST', body: { email: normalizedEmail, password } })
    writeSession({ token, user })
    return user
  } catch (error) {
    if (error instanceof AuthRequestError && error.status === 401) {
      const migrated = await migrateLegacyAccount(normalizedEmail, password)
      if (migrated) return migrated
    }
    throw error
  }
}

export async function logOut(): Promise<void> {
  const session = readSession()
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(LEGACY_SESSION_KEY)
  if (session) await request('/api/auth/logout', { method: 'POST', token: session.token }).catch(() => undefined)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface LegacyUser extends AppUser {
  readonly passwordHash: string
}

/**
 * Accounts created before server auth only exist in this browser's localStorage.
 * If the entered credentials match one, create the account on the server (keeping the
 * same user id so existing local charts/drawings stay attached) and sign in.
 */
async function migrateLegacyAccount(email: string, password: string): Promise<AppUser | null> {
  try {
    const users = JSON.parse(localStorage.getItem(LEGACY_USERS_KEY) ?? '[]') as LegacyUser[]
    const hash = await sha256Hex(password)
    const legacy = Array.isArray(users) ? users.find((item) => item.email === email && item.passwordHash === hash) : undefined
    if (!legacy) return null
    return await signUp(legacy.displayName, email, password, legacy.id)
  } catch {
    return null
  }
}
