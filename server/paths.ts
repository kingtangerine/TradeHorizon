// Where the app folder is. Source files run from server/ and scripts/, compiled files from build/server/ and
// build/scripts/, so the folder is found by looking upward for package.json instead of a fixed number of "..".
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The nearest folder at or above `start` that holds a package.json. */
export function findProjectRoot(start: string): string {
  let folder = start
  for (;;) {
    if (existsSync(join(folder, 'package.json'))) return folder
    const parent = dirname(folder)
    if (parent === folder) throw new Error(`No package.json found above ${start}`)
    folder = parent
  }
}

/** The app folder: package.json, .env, dist/ and the default server/data/ live here. */
export const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)))
