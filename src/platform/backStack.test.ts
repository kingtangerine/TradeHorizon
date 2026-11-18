import { afterEach, describe, expect, it, vi } from 'vitest'
import { onBackPressed } from './backButton'
import { backStackDepth, handleBack, pushBackHandler } from './backStack'

const removers: Array<() => void> = []
const push = (handler: () => void) => {
  const remove = pushBackHandler(handler)
  removers.push(remove)
  return remove
}

afterEach(() => {
  for (const remove of removers.splice(0)) remove()
})

describe('back stack', () => {
  it('reports nothing to close when empty', () => {
    expect(backStackDepth()).toBe(0)
    expect(handleBack()).toBe(false)
  })

  it('closes the most recently opened thing first', () => {
    const calls: string[] = []
    push(() => calls.push('panel'))
    push(() => calls.push('dialog'))
    expect(handleBack()).toBe(true)
    expect(calls).toEqual(['dialog'])
  })

  it('goes on to the one below once the top is removed', () => {
    const calls: string[] = []
    push(() => calls.push('panel'))
    const closeDialog = push(() => calls.push('dialog'))
    closeDialog()
    handleBack()
    expect(calls).toEqual(['panel'])
    expect(backStackDepth()).toBe(1)
  })

  it('removes the right entry when something lower closes first', () => {
    const calls: string[] = []
    const closePanel = push(() => calls.push('panel'))
    push(() => calls.push('dialog'))
    closePanel()
    handleBack()
    expect(calls).toEqual(['dialog'])
  })

  it('ignores a second removal of the same entry', () => {
    const remove = push(() => undefined)
    push(() => undefined)
    remove()
    remove()
    expect(backStackDepth()).toBe(1)
  })
})

describe('onBackPressed', () => {
  it('closes what is open and does not leave the app', async () => {
    const close = vi.fn()
    const leave = vi.fn(async () => undefined)
    push(close)
    await expect(onBackPressed(leave)).resolves.toBe('closed')
    expect(close).toHaveBeenCalledOnce()
    expect(leave).not.toHaveBeenCalled()
  })

  it('leaves the app when nothing is open', async () => {
    const leave = vi.fn(async () => undefined)
    await expect(onBackPressed(leave)).resolves.toBe('left')
    expect(leave).toHaveBeenCalledOnce()
  })
})
