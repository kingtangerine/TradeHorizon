import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./errorReport', () => ({ reportProblem: vi.fn() }))

import { reportProblem } from './errorReport'
import { loadScripts, scriptsKey, unreadableScriptsKey } from './scripts'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.mocked(reportProblem).mockClear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  })
})

describe('loadScripts', () => {
  it('returns an empty list when nothing is saved, without reporting anything', () => {
    expect(loadScripts('u1')).toEqual([])
    expect(reportProblem).not.toHaveBeenCalled()
  })

  it('loads valid scripts', () => {
    values.set(scriptsKey('u1'), JSON.stringify([{ id: 's1', name: 'EMA', source: 'plot(close)', updatedAtMs: 5 }]))
    expect(loadScripts('u1')).toEqual([{ id: 's1', name: 'EMA', source: 'plot(close)', updatedAtMs: 5 }])
  })

  it.each([
    ['not JSON', '{broken'],
    ['JSON that is not a list', '{"id":"s1"}'],
  ])('keeps a copy of %s and reports it instead of losing it', (_case, raw) => {
    values.set(scriptsKey('u1'), raw)
    expect(loadScripts('u1')).toEqual([])
    expect(values.get(unreadableScriptsKey('u1'))).toBe(raw)
    expect(reportProblem).toHaveBeenCalledOnce()
  })

  it('treats blocked storage as nothing saved', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(loadScripts('u1')).toEqual([])
    expect(reportProblem).not.toHaveBeenCalled()
  })
})
