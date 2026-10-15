// Settings from a `.env` file in the app folder (KEY=value per line), for hosts where setting environment
// variables for the Node process is unreliable (e.g. Plesk's Node.js panel). Real environment variables win.
import { existsSync, readFileSync } from 'node:fs'

/** Parses KEY=value lines. Blank lines and # comments are skipped; matching quotes around a value are removed. */
export function parseEnv(text) {
  const values = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1)
    values[match[1]] = value
  }
  return values
}

/** Copies settings from the file into `env` unless already set there. Returns the names it found (never values). */
export function loadEnvFile(path, env = process.env) {
  if (!existsSync(path)) return { found: false, keys: [] }
  const values = parseEnv(readFileSync(path, 'utf8'))
  for (const [key, value] of Object.entries(values)) {
    if (env[key] === undefined || env[key] === '') env[key] = value
  }
  return { found: true, keys: Object.keys(values) }
}
