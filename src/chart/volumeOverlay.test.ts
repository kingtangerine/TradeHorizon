import { describe, expect, it } from 'vitest'
import { volumeBarHeights } from './volumeBars'

describe('volume bars', () => {
  it('scales the tallest visible bar to the full height and keeps tiny volumes visible', () => {
    expect(volumeBarHeights([10, 5, 0.001, undefined, 0], 100)).toEqual([100, 50, 1, 0, 0])
    expect(volumeBarHeights([0, undefined], 100)).toEqual([0, 0])
  })
})
