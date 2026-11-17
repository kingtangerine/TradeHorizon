import { type FormEvent, useState } from 'react'
import { logIn, signUp, type AppUser } from '../auth'
import { HorizonLogo } from '../Icons'

/** Log-in and sign-up screen shown when there is no signed-in user. */
export function AuthScreen({ onAuthenticated }: { onAuthenticated(user: AppUser): void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const user = mode === 'signup' ? await signUp(displayName, email, password) : await logIn(email, password)
      onAuthenticated(user)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <HorizonLogo />
          <div>
            <strong>TradeHorizon</strong>
            <span>Crypto Supercharts</span>
          </div>
        </div>
        <div className="auth-copy">
          <span className="preview-pill">ALPHA</span>
          <h1>{mode === 'login' ? 'Welcome back' : 'Create your trading workspace'}</h1>
          <p>Your chart tabs, drawings, Long Positions, and price alerts are saved to your account and follow you to any device.</p>
        </div>
        <div className="auth-tabs">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login')
              setError(undefined)
            }}
          >
            Log in
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => {
              setMode('signup')
              setError(undefined)
            }}
          >
            Sign up
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              <span>Display name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required />
            </label>
          )}
          <label>
            <span>Email address</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </label>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
          {mode === 'login' && (
            <details className="auth-forgot">
              <summary>Forgot your password?</summary>
              <p>
                Ask the TradeHorizon administrator for a temporary password. After you sign in with it you will be asked to choose a new
                one.
              </p>
            </details>
          )}
        </form>
        <small className="auth-disclaimer">Your account is stored on the TradeHorizon server, so you can sign in from any device.</small>
      </section>
    </main>
  )
}
