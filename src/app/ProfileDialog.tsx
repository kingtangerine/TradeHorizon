import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { changePassword, type AppUser } from './auth'
import { backupFileName, buildBackup, parseBackup, restoreBackup, type BackupFile } from './dataTransfer'
import { CloseIcon, UserIcon } from './Icons'
import type { Theme } from './theme'

interface ProfileDialogProps {
  user: AppUser
  theme: Theme
  tabCount: number
  layoutCount: number
  onTheme(theme: Theme): void
  onLogout(): void
  onClose(): void
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function ProfileDialog({ user, theme, tabCount, layoutCount, onTheme, onLogout, onClose }: ProfileDialogProps) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<{ ok: boolean, text: string }>()
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [pendingImport, setPendingImport] = useState<BackupFile>()
  const [dataMessage, setDataMessage] = useState<{ ok: boolean, text: string }>()
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setPasswordMessage(undefined)
    if (next !== confirm) { setPasswordMessage({ ok: false, text: 'The new passwords do not match.' }); return }
    setPasswordBusy(true)
    try {
      await changePassword(current, next)
      setCurrent(''); setNext(''); setConfirm('')
      setPasswordMessage({ ok: true, text: 'Password changed. Other devices have been signed out.' })
    } catch (error) {
      setPasswordMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the password.' })
    } finally {
      setPasswordBusy(false)
    }
  }

  const exportData = () => {
    const backup = buildBackup(user.id, user)
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = backupFileName()
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setDataMessage({ ok: true, text: `Exported ${Object.keys(backup.items).length} items.` })
  }

  const chooseFile = async (file: File | undefined) => {
    setDataMessage(undefined)
    setPendingImport(undefined)
    if (!file) return
    try {
      setPendingImport(parseBackup(await file.text()))
    } catch (error) {
      setDataMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not read that file.' })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const confirmImport = () => {
    if (!pendingImport) return
    const count = restoreBackup(user.id, pendingImport)
    setPendingImport(undefined)
    setDataMessage({ ok: true, text: `Restored ${count} items. Reloading…` })
    // Give the sync layer a moment to upload the restored data before the page reloads.
    setTimeout(() => window.location.reload(), 1500)
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="profile-dialog" role="dialog" aria-modal="true" aria-label="Account" onMouseDown={(event) => event.stopPropagation()}>
        <header className="profile-dialog-header">
          <span className="profile-large-avatar"><UserIcon /></span>
          <div><strong>{user.displayName}</strong><span>{user.email}</span></div>
          <button type="button" className="object-icon-button" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </header>

        <div className="profile-dialog-body">
          <section>
            <h3>Account</h3>
            <dl className="profile-facts">
              <div><dt>Display name</dt><dd>{user.displayName}</dd></div>
              <div><dt>Email</dt><dd>{user.email}</dd></div>
              <div><dt>Member since</dt><dd>{formatDate(user.createdAtMs)}</dd></div>
              <div><dt>Open chart tabs</dt><dd>{tabCount}</dd></div>
              <div><dt>Saved layouts</dt><dd>{layoutCount}</dd></div>
              <div><dt>Storage</dt><dd>TradeHorizon server, synced across devices</dd></div>
            </dl>
          </section>

          <section>
            <h3>Appearance</h3>
            <div className="segmented" role="group" aria-label="Theme">
              <button type="button" className={theme === 'dark' ? 'active' : ''} aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}>Dark</button>
              <button type="button" className={theme === 'light' ? 'active' : ''} aria-pressed={theme === 'light'} onClick={() => onTheme('light')}>Light</button>
            </div>
          </section>

          <section>
            <h3>Change password</h3>
            <form className="profile-form" onSubmit={submitPassword}>
              <input type="password" placeholder="Current password" aria-label="Current password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required />
              <input type="password" placeholder="New password (8+ characters)" aria-label="New password" autoComplete="new-password" minLength={8} value={next} onChange={(event) => setNext(event.target.value)} required />
              <input type="password" placeholder="Repeat new password" aria-label="Repeat new password" autoComplete="new-password" minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
              {passwordMessage && <p className={passwordMessage.ok ? 'profile-note ok' : 'profile-note error'} role="status">{passwordMessage.text}</p>}
              <button type="submit" disabled={passwordBusy}>{passwordBusy ? 'Saving…' : 'Change password'}</button>
            </form>
          </section>

          <section>
            <h3>Your data</h3>
            <p className="profile-help">Download your chart tabs, saved layouts, drawings, groups and alerts as a file, or restore them from one. Importing replaces what is currently saved.</p>
            <div className="profile-actions">
              <button type="button" onClick={exportData}>Export data</button>
              <button type="button" onClick={() => fileRef.current?.click()}>Import data…</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void chooseFile(event.target.files?.[0])} />
            </div>
            {pendingImport && (
              <div className="profile-confirm" role="alert">
                <p>
                  Restore {Object.keys(pendingImport.items).length} items from a backup
                  {pendingImport.account.email ? ` of ${pendingImport.account.email}` : ''}
                  {pendingImport.exportedAtMs ? ` made on ${formatDate(pendingImport.exportedAtMs)}` : ''}?
                  Your current layouts, drawings and alerts will be replaced.
                </p>
                <div className="profile-actions">
                  <button type="button" className="danger" onClick={confirmImport}>Replace my data</button>
                  <button type="button" onClick={() => setPendingImport(undefined)}>Cancel</button>
                </div>
              </div>
            )}
            {dataMessage && <p className={dataMessage.ok ? 'profile-note ok' : 'profile-note error'} role="status">{dataMessage.text}</p>}
          </section>
        </div>

        <footer className="profile-dialog-footer">
          <button type="button" className="profile-logout" onClick={onLogout}>Log out</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
