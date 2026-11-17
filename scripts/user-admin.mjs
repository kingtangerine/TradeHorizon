// Account tools for the server, for when nobody can sign in to the admin page (e.g. the admin forgot their password).
//   npm run user:list                         every account: email, name, joined, last active, admin or not
//   npm run user:password -- someone@example.com    set a new temporary password (printed once) and sign them out everywhere
// Run in the app folder on the server (Plesk: "Run Node.js commands", or SSH). Uses the same database and .env as the app.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from '../server/envfile.mjs'
import { adminEmails } from '../server/admin.mjs'
import { makeHash, temporaryPassword } from '../server/passwords.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadEnvFile(join(root, '.env'))
const dataDir = process.env.TH_DATA_DIR ?? join(root, 'server', 'data')
const databaseFile = join(dataDir, 'tradehorizon.db')

const [command, argument] = process.argv.slice(2)
const fail = (message) => { console.error(message); process.exit(1) }
const date = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : 'never')

if (!existsSync(databaseFile)) {
  fail(`No database at ${databaseFile}. Start the app once (it creates the database and moves old JSON accounts into it), then run this again.`)
}
const { openDatabase } = await import('../server/database.mjs')
const store = openDatabase(databaseFile)
const admins = adminEmails(process.env.TH_ADMIN_EMAILS)

try {
  if (command === 'list') {
    const users = store.users.all()
    console.log(`${users.length} account(s) in ${databaseFile}`)
    for (const user of users) {
      console.log(`${admins.has(user.email) ? '[admin] ' : ''}${user.email}  "${user.displayName}"  joined ${date(user.createdAtMs)}  last active ${date(user.lastSeenAtMs)}`)
    }
    if (admins.size === 0) console.log('No admin emails are set: add TH_ADMIN_EMAILS=you@example.com to .env and restart the app.')
  } else if (command === 'password') {
    const email = String(argument ?? '').trim().toLowerCase()
    if (!email) fail('Usage: npm run user:password -- someone@example.com')
    const user = store.users.byEmail(email)
    if (!user) fail(`No account for ${email}. "npm run user:list" shows every account.`)
    const password = temporaryPassword()
    store.users.setPassword(user.id, await makeHash(password), true)
    store.sessions.removeForUser(user.id)
    console.log(`Temporary password for ${email}: ${password}`)
    console.log('They are signed out everywhere and will be asked to choose their own password after signing in with it.')
  } else {
    fail('Commands:\n  npm run user:list\n  npm run user:password -- someone@example.com')
  }
} finally {
  store.close()
}
