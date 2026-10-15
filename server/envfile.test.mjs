import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadEnvFile, parseEnv } from './envfile.mjs'

describe('.env file', () => {
  it('parses KEY=value lines, comments, export and quotes', () => {
    expect(parseEnv([
      '# Telegram',
      'TH_TELEGRAM_TOKEN=123:abc',
      '  TH_TRUST_PROXY = 1  ',
      'export TH_VAPID_SUBJECT="mailto:me@example.com"',
      "QUOTED='a b'",
      'not a setting',
      '',
    ].join('\r\n'))).toEqual({
      TH_TELEGRAM_TOKEN: '123:abc',
      TH_TRUST_PROXY: '1',
      TH_VAPID_SUBJECT: 'mailto:me@example.com',
      QUOTED: 'a b',
    })
  })

  it('fills in settings without overriding real environment variables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'th-env-'))
    try {
      const file = join(dir, '.env')
      writeFileSync(file, 'A=from-file\nB=from-file\nC=from-file\n')
      const env = { A: 'from-env', C: '' }
      expect(loadEnvFile(file, env)).toEqual({ found: true, keys: ['A', 'B', 'C'] })
      expect(env).toEqual({ A: 'from-env', B: 'from-file', C: 'from-file' })
      expect(loadEnvFile(join(dir, 'missing'), env)).toEqual({ found: false, keys: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
