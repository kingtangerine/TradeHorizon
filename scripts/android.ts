// Builds the web app for the Android shell and copies it into the Android project.
//   npm run android:sync -- --dev                          local testing: the emulator talks to the server on this
//                                                          computer (start it with `npm run android:server`)
//   npm run android:sync -- --api https://app.example.com  the server the app should use (HTTPS required)
//   npm run android:apk  -- --dev | --api <url>            the same, then builds a debug APK with Gradle
// The server address is compiled into the app (VITE_API_BASE, see src/platform/api.ts).
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { projectRoot } from '../server/paths.ts'

/** How the Android emulator reaches a server running on the computer that hosts it. */
export const EMULATOR_HOST_API = 'http://10.0.2.2:8787'

/** What to build, read from the command line. */
export interface AndroidBuildOptions {
  /** The server address compiled into the app. */
  readonly apiBase: string
  /** Local testing over plain HTTP against this computer. */
  readonly localDev: boolean
  /** Also build the debug APK. */
  readonly apk: boolean
}

/** Reads `--dev`, `--api <url>` and `--apk`. Throws with a usage hint when the server address is missing or unsafe. */
export function parseAndroidArgs(args: readonly string[]): AndroidBuildOptions {
  const apk = args.includes('--apk')
  if (args.includes('--dev')) return { apiBase: EMULATOR_HOST_API, localDev: true, apk }
  const index = args.indexOf('--api')
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value) throw new Error('Say which server the app should use: --api https://your-server.example, or --dev for local testing.')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`--api needs a full address such as https://your-server.example (got "${value}").`)
  }
  if (url.protocol !== 'https:') throw new Error('--api must be an https:// address. Use --dev for local testing over HTTP.')
  return { apiBase: url.origin, localDev: false, apk }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd = projectRoot): void {
  // shell: true so that npx and gradlew resolve on Windows as well.
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: true })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status ?? 'unknown'}).`)
}

function main(): void {
  const options = parseAndroidArgs(process.argv.slice(2))
  const env = { ...process.env, VITE_API_BASE: options.apiBase, TH_ANDROID_DEV: options.localDev ? '1' : '' }
  console.log(`Building the Android app for ${options.apiBase}${options.localDev ? ' (local testing)' : ''}`)
  run('npx', ['tsc', '-b'], env)
  run('npx', ['vite', 'build'], env)
  run('npx', ['cap', 'sync', 'android'], env)
  if (options.apk) {
    const androidDir = join(projectRoot, 'android')
    // The wrapper is named by its full path: Windows does not look in the current folder for commands.
    run(`"${join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`, ['assembleDebug'], env, androidDir)
    console.log(`APK: ${join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')}`)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
