export interface AppUser {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly createdAtMs: number
}

interface StoredUser extends AppUser {
  readonly passwordHash: string
}

const USERS_KEY = 'trade-horizon:users:v1'
const SESSION_KEY = 'trade-horizon:session:v1'

function readUsers(): StoredUser[] {
  try {
    const value = JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is StoredUser => (
      typeof item === 'object' && item !== null &&
      typeof (item as StoredUser).id === 'string' &&
      typeof (item as StoredUser).email === 'string' &&
      typeof (item as StoredUser).passwordHash === 'string'
    )) : []
  } catch {
    return []
  }
}

async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function publicUser(user: StoredUser): AppUser {
  const { passwordHash: _, ...safe } = user
  return safe
}

export function restoreSession(): AppUser | null {
  try {
    const userId = localStorage.getItem(SESSION_KEY)
    const user = readUsers().find((item) => item.id === userId)
    return user ? publicUser(user) : null
  } catch {
    return null
  }
}

export async function signUp(displayName: string, email: string, password: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedName = displayName.trim()
  if (normalizedName.length < 2) throw new Error('Enter a display name of at least 2 characters.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.')
  if (password.length < 8) throw new Error('Password must contain at least 8 characters.')

  const users = readUsers()
  if (users.some((user) => user.email === normalizedEmail)) throw new Error('An account already exists for this email.')
  const user: StoredUser = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    displayName: normalizedName,
    createdAtMs: Date.now(),
    passwordHash: await hashPassword(password),
  }
  localStorage.setItem(USERS_KEY, JSON.stringify([...users, user]))
  localStorage.setItem(SESSION_KEY, user.id)
  return publicUser(user)
}

export async function logIn(email: string, password: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase()
  const passwordHash = await hashPassword(password)
  const user = readUsers().find((item) => item.email === normalizedEmail && item.passwordHash === passwordHash)
  if (!user) throw new Error('Email or password is incorrect.')
  localStorage.setItem(SESSION_KEY, user.id)
  return publicUser(user)
}

export function logOut(): void {
  localStorage.removeItem(SESSION_KEY)
}
