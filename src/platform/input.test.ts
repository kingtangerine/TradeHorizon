import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRAWING_TOOLS } from '../chart/tools'
import { isTouchDevice, touchHint } from './input'

afterEach(() => vi.unstubAllGlobals())

describe('isTouchDevice', () => {
  it('follows the coarse-pointer media query', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }))
    expect(isTouchDevice()).toBe(true)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(isTouchDevice()).toBe(false)
  })

  it('is false where media queries are not available', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(isTouchDevice()).toBe(false)
  })
})

describe('touchHint', () => {
  it('says tap instead of click, keeping the capital', () => {
    expect(touchHint('Drag a box, or click two opposite corners.')).toBe('Drag a box, or tap two opposite corners.')
    expect(touchHint('Click a price level.')).toBe('Tap a price level.')
  })

  it('drops sentences about keyboard keys', () => {
    expect(touchHint('Click two points or drag. Hold Shift to keep it level or vertical.')).toBe('Tap two points or drag.')
  })

  it('leaves no mouse or keyboard wording in any drawing tool hint', () => {
    for (const tool of Object.values(DRAWING_TOOLS)) {
      const hint = touchHint(tool.hint)
      expect(hint).not.toMatch(/\bclick\b|\bShift\b|\bCtrl\b|\bAlt\b/i)
      expect(hint.length).toBeGreaterThan(0)
    }
  })
})
