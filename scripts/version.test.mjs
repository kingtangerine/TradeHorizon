import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { changelogStub, nextVersion } from './bump-version.mjs'

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('version tracking', () => {
  it('keeps package.json, package-lock.json and the newest changelog entry on the same version', () => {
    const pkg = JSON.parse(read('package.json'))
    const lock = JSON.parse(read('package-lock.json'))
    const newest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(read('CHANGELOG.md'))?.[1]
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
    expect(newest).toBe(pkg.version)
  })

  it('bumps major, minor and patch, or takes an exact version', () => {
    expect(nextVersion('0.10.2', 'patch')).toBe('0.10.3')
    expect(nextVersion('0.10.2', 'minor')).toBe('0.11.0')
    expect(nextVersion('0.10.2', 'major')).toBe('1.0.0')
    expect(nextVersion('0.10.2', '0.20.1')).toBe('0.20.1')
    expect(() => nextVersion('0.10.2', 'huge')).toThrow()
  })

  it('starts a changelog entry for the new version', () => {
    expect(changelogStub('0.11.0', '2026-10-12')).toMatch(/^## \[0\.11\.0\] - 2026-10-12\n\n### Added\n/)
  })
})
