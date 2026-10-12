import { describe, expect, it } from 'vitest'
import pkg from '../package.json'
import { APP_VERSION, versionDetails, versionLabel } from './version'

describe('version display', () => {
  it('shows the version from package.json', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(versionLabel()).toBe(`v${pkg.version}`)
    expect(versionDetails()).toContain(`Version ${pkg.version}`)
  })
})
