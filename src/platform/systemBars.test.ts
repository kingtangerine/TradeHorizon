import { SystemBarsStyle } from '@capacitor/core'
import { describe, expect, it } from 'vitest'
import { rgbToHex, syncSystemBars, systemBarsStyleFor } from './systemBars'

describe('system bars', () => {
  it('uses light icons on the dark theme and dark icons on the light theme', () => {
    expect(systemBarsStyleFor('dark')).toBe(SystemBarsStyle.Dark)
    expect(systemBarsStyleFor('light')).toBe(SystemBarsStyle.Light)
  })

  it('converts computed colours to the hex form Android expects', () => {
    expect(rgbToHex('rgb(8, 11, 16)')).toBe('#080b10')
    expect(rgbToHex(' rgb(239,242,247) ')).toBe('#eff2f7')
  })

  it('gives no colour for values it cannot use', () => {
    expect(rgbToHex('rgba(0, 0, 0, 0)')).toBeUndefined()
    expect(rgbToHex('transparent')).toBeUndefined()
    expect(rgbToHex('rgb(300, 0, 0)')).toBeUndefined()
  })

  it('does nothing in a browser', async () => {
    await expect(syncSystemBars('light')).resolves.toBeUndefined()
  })
})
