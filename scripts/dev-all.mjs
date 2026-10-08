// Runs the auth server and the Vite dev server together.
import { spawn } from 'node:child_process'

const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' })
const children = [run(['server/index.mjs']), run(['node_modules/vite/bin/vite.js'])]
const stop = () => children.forEach((child) => child.kill())
process.on('SIGINT', stop)
process.on('exit', stop)
children.forEach((child) => child.on('exit', stop))
