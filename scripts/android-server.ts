// Starts the server for testing the Android app on an emulator or a phone (`npm run android:sync -- --dev` or `--usb`).
// In those modes the app's pages are served from http://localhost on the device, so that origin must be allowed
// to call the API (see server/cors.ts). Everything else is the normal development server.
import { spawn } from 'node:child_process'
import { DEFAULT_ALLOWED_ORIGINS } from '../server/cors.ts'

const env = { ...process.env, TH_ALLOWED_ORIGINS: `${DEFAULT_ALLOWED_ORIGINS},http://localhost` }
const server = spawn(process.execPath, ['server/index.ts'], { stdio: 'inherit', env })
const stop = () => server.kill()
process.on('SIGINT', stop)
process.on('exit', stop)
server.on('exit', (code) => process.exit(code ?? 0))
