import { afterEach, describe, expect, it, vi } from 'vitest'
import { blobToBase64, saveFile } from './files'

afterEach(() => vi.unstubAllGlobals())

describe('blobToBase64', () => {
  it('encodes text', async () => {
    expect(await blobToBase64(new Blob(['{"a":1}']))).toBe(btoa('{"a":1}'))
  })

  it('encodes binary data larger than one chunk without losing bytes', async () => {
    const bytes = new Uint8Array(100_000).map((_, index) => index % 256)
    const encoded = await blobToBase64(new Blob([bytes]))
    const decoded = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    expect(decoded).toEqual(bytes)
  })

  it('encodes an empty file as an empty string', async () => {
    expect(await blobToBase64(new Blob([]))).toBe('')
  })
})

describe('saveFile in a browser', () => {
  it('downloads the file through a temporary link with the given name', async () => {
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: vi.fn() })

    await expect(saveFile(new Blob(['x']), 'chart.png', 'Chart')).resolves.toBe('downloaded')

    expect(link.download).toBe('chart.png')
    expect(link.href).toBe('blob:test')
    expect(link.click).toHaveBeenCalledOnce()
  })
})
