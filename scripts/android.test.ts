import { describe, expect, it } from 'vitest'
import { EMULATOR_HOST_API, USB_HOST_API, parseAndroidArgs } from './android.ts'

describe('parseAndroidArgs', () => {
  it('uses the emulator host address for local testing', () => {
    expect(parseAndroidArgs(['--dev'])).toEqual({ apiBase: EMULATOR_HOST_API, localDev: true, apk: false })
    expect(parseAndroidArgs(['--dev', '--apk'])).toMatchObject({ localDev: true, apk: true })
  })

  it('uses a port on the phone itself for local testing over a USB cable', () => {
    expect(parseAndroidArgs(['--usb'])).toEqual({ apiBase: USB_HOST_API, localDev: true, apk: false })
    expect(parseAndroidArgs(['--usb', '--apk'])).toMatchObject({ localDev: true, apk: true })
  })

  it('refuses the emulator and the cable mode together', () => {
    expect(() => parseAndroidArgs(['--dev', '--usb'])).toThrow(/not both/)
  })

  it('takes an HTTPS server address and keeps only its origin', () => {
    expect(parseAndroidArgs(['--api', 'https://app.example.com/some/path'])).toEqual({
      apiBase: 'https://app.example.com',
      localDev: false,
      apk: false,
    })
  })

  it('refuses a missing, malformed or non-HTTPS server address', () => {
    expect(() => parseAndroidArgs([])).toThrow(/which server/)
    expect(() => parseAndroidArgs(['--api'])).toThrow(/which server/)
    expect(() => parseAndroidArgs(['--api', 'app.example.com'])).toThrow(/full address/)
    expect(() => parseAndroidArgs(['--api', 'http://app.example.com'])).toThrow(/https/)
  })
})
