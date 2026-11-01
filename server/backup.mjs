// Automatic database backups: a full copy of the database in server/data/backups once a day (and on demand from
// the admin page), keeping the newest `keep` copies. Each copy is a complete SQLite file: to restore, stop the app,
// replace tradehorizon.db with it (and delete tradehorizon.db-wal / -shm), and start the app again.
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000
const PREFIX = 'tradehorizon-'

const fileStamp = (now) => new Date(now).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')

export function createBackupService({ store, dir, keep = 14, everyMs = DAY_MS, log = console, now = () => Date.now() }) {
  mkdirSync(dir, { recursive: true })
  let timer
  let lastError

  function list() {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.startsWith(PREFIX) && name.endsWith('.db'))
      .map((name) => {
        const stats = statSync(join(dir, name))
        return { name, bytes: stats.size, createdAtMs: stats.mtimeMs }
      })
      .sort((a, b) => b.name.localeCompare(a.name))
  }

  function run() {
    const at = now()
    const name = `${PREFIX}${fileStamp(at)}.db`
    const file = join(dir, name)
    try {
      if (existsSync(file)) unlinkSync(file) // VACUUM INTO refuses to overwrite
      store.backup(file)
      store.meta.set('lastBackupAtMs', at)
      lastError = undefined
      for (const old of list().slice(keep)) unlinkSync(join(dir, old.name))
      log.log?.(`[backup] database copied to ${file}`)
      return { name, bytes: statSync(file).size, createdAtMs: at }
    } catch (error) {
      lastError = error.message
      log.warn?.(`[backup] failed: ${error.message}`)
      throw error
    }
  }

  /** Backs up when the newest copy is older than `everyMs`. */
  function runIfDue() {
    const last = Number(store.meta.get('lastBackupAtMs')) || 0
    if (now() - last >= everyMs) {
      try { run() } catch { /* reported in status() */ }
    }
  }

  return {
    run,
    runIfDue,
    start() {
      runIfDue()
      timer = setInterval(runIfDue, Math.min(everyMs, 60 * 60 * 1000))
      timer.unref?.()
    },
    stop() { clearInterval(timer) },
    status() {
      const copies = list()
      return {
        dir,
        keep,
        count: copies.length,
        lastBackupAtMs: Number(store.meta.get('lastBackupAtMs')) || null,
        newest: copies[0] ?? null,
        lastError: lastError ?? null,
      }
    },
  }
}
