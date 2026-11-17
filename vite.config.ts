import { defineConfig, transformWithEsbuild, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * The service worker is written in TypeScript (src/sw/sw.ts) but browsers load it from /sw.js:
 * served compiled on the fly in development, and written to dist/sw.js by the build.
 */
function serviceWorker(): Plugin {
  const entry = 'src/sw/sw.ts'
  const compile = async () =>
    (await transformWithEsbuild(readFileSync(entry, 'utf8'), entry, { loader: 'ts', format: 'esm', target: 'es2022' })).code
  return {
    name: 'trade-horizon-service-worker',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_request, response, next) => {
        compile().then((code) => {
          response.setHeader('Content-Type', 'text/javascript')
          response.end(code)
        }, next)
      })
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: await compile() })
    },
  }
}

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** Short git commit of this build, so a running copy can be matched to the code it came from. */
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(gitCommit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  preview: {
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
