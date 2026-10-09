// Serves the built app (dist/) with compression, ETags and cache headers.
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.map'])
const MIN_COMPRESS_BYTES = 1024

/** file -> { mtimeMs, raw, gzip?, br?, etag }. Rebuilt automatically when the file changes (after `npm run build`). */
const cache = new Map()

async function load(file) {
  const info = await stat(file)
  if (!info.isFile()) throw new Error('not a file')
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === info.mtimeMs) return cached
  const raw = await readFile(file)
  const entry = { mtimeMs: info.mtimeMs, raw, etag: `"${createHash('sha1').update(raw).digest('hex').slice(0, 20)}"` }
  if (COMPRESSIBLE.has(extname(file)) && raw.length >= MIN_COMPRESS_BYTES) {
    entry.gzip = gzipSync(raw, { level: 9 })
    entry.br = brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 8 } })
  }
  cache.set(file, entry)
  return entry
}

function cacheControl(urlPath) {
  // Vite names bundles by content hash, so they can be cached for a year. Everything else is revalidated.
  return urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
}

export function createStaticHandler(distDir) {
  return async function serveStatic(req, res, urlPath) {
    let decoded
    try { decoded = decodeURIComponent(urlPath) } catch { decoded = '/' }
    let file = normalize(join(distDir, decoded))
    if (file !== distDir && !file.startsWith(distDir + sep)) file = join(distDir, 'index.html')

    let entry
    let servedPath = decoded
    try {
      entry = await load(file)
    } catch {
      // Missing assets are real 404s; any other path is a client-side route and gets the app shell.
      if (decoded.startsWith('/assets/') || extname(decoded)) { res.writeHead(404); res.end('Not found'); return }
      file = join(distDir, 'index.html')
      servedPath = '/index.html'
      try { entry = await load(file) } catch { res.writeHead(404); res.end('Run `npm run build` first.'); return }
    }

    const headers = {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': cacheControl(servedPath),
      ETag: entry.etag,
      Vary: 'Accept-Encoding',
    }
    if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return }

    const accepts = String(req.headers['accept-encoding'] ?? '')
    let body = entry.raw
    if (entry.br && /\bbr\b/.test(accepts)) { body = entry.br; headers['Content-Encoding'] = 'br' }
    else if (entry.gzip && /\bgzip\b/.test(accepts)) { body = entry.gzip; headers['Content-Encoding'] = 'gzip' }
    headers['Content-Length'] = body.length
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}
