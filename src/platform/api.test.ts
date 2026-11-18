import { describe, expect, it } from 'vitest'
import { API_BASE, apiUrl, isCrossOriginApi, resolveApiUrl } from './api'

describe('resolveApiUrl', () => {
  it('returns the path unchanged when there is no base (the web app)', () => {
    expect(resolveApiUrl('', '/api/data?since=0')).toBe('/api/data?since=0')
    expect(resolveApiUrl(undefined, '/api/markets')).toBe('/api/markets')
    expect(resolveApiUrl('   ', '/api/markets')).toBe('/api/markets')
  })

  it('prefixes the server address, with or without a trailing slash', () => {
    expect(resolveApiUrl('https://app.example.com', '/api/auth/login')).toBe('https://app.example.com/api/auth/login')
    expect(resolveApiUrl('https://app.example.com/', '/api/auth/login')).toBe('https://app.example.com/api/auth/login')
    expect(resolveApiUrl('http://10.0.2.2:8787//', '/healthz')).toBe('http://10.0.2.2:8787/healthz')
  })

  it('rejects a path that does not start with a slash', () => {
    expect(() => resolveApiUrl('https://app.example.com', 'api/data')).toThrow(/must start with/)
  })
})

describe('apiUrl in the web build', () => {
  it('keeps requests same-origin when VITE_API_BASE is not set', () => {
    expect(API_BASE).toBe('')
    expect(isCrossOriginApi).toBe(false)
    expect(apiUrl('/api/cg/caps')).toBe('/api/cg/caps')
  })
})
