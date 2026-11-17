import { useEffect, useState } from 'react'
import { logOut, restoreSession, verifySession, type AppUser } from './auth'
import { AuthScreen } from './shell/AuthScreen'
import { WorkspaceApp } from './shell/WorkspaceApp'
import { hasSyncedBefore, startUserSync, stopUserSync } from './userSync'

/** Root component: the sign-in screen, then the signed-in workspace once the account data is ready. */
export function App() {
  const [user, setUser] = useState<AppUser | null>(() => restoreSession())
  const [syncedUserId, setSyncedUserId] = useState<string>()
  // Keyed on the id, not the user object: setUser() below replaces the object for the same account.
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let live = true
    void (async () => {
      // A browser that has synced this account before already holds a good copy, so open the workspace from it
      // right away (no loading screen when you come back to the app) and check with the server in the background.
      // A first visit on a new device waits for the server copy instead.
      const returning = hasSyncedBefore(userId)
      if (returning) setSyncedUserId(userId)
      const sync = startUserSync(userId)
      if (!(await verifySession())) {
        stopUserSync()
        if (live) setUser(null)
        return
      }
      if (live) setUser((current) => restoreSession() ?? current)
      await sync
      // Newer data from other devices is applied in place (subscribeRemoteData), so no reload is needed.
      if (live && !returning) setSyncedUserId(userId)
    })()
    return () => {
      live = false
    }
  }, [userId])
  if (!user) return <AuthScreen onAuthenticated={setUser} />
  if (syncedUserId !== user.id)
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-copy">
            <h1>Loading your workspace…</h1>
          </div>
        </section>
      </main>
    )
  return (
    <WorkspaceApp
      key={user.id}
      user={user}
      onUserRefresh={() => {
        void verifySession().then(() => setUser((current) => restoreSession() ?? current))
      }}
      onLogout={() => {
        stopUserSync()
        void logOut()
        setSyncedUserId(undefined)
        setUser(null)
      }}
    />
  )
}
