// Bumps the app version everywhere it lives and starts the changelog entry.
//   npm run version:bump -- minor        (0.10.0 -> 0.11.0: a new feature or a batch of them)
//   npm run version:bump -- patch        (0.10.0 -> 0.10.1: a fix)
//   npm run version:bump -- major        (0.10.0 -> 1.0.0: a big or breaking release)
//   npm run version:bump -- 0.12.0       (an exact version)
// Then fill in the new CHANGELOG.md section and commit. The number shows next to the logo in the app.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(join(root, name), 'utf8')
const write = (name, text) => writeFileSync(join(root, name), text)

export function nextVersion(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind
  const [major, minor, patch] = current.split('.').map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error('Use: major | minor | patch | <x.y.z>')
}

export function changelogStub(version, dateIso) {
  return `## [${version}] - ${dateIso}\n\n### Added\n- \n\n### Changed\n- \n\n### Fixed\n- \n\n`
}

function main() {
  const kind = process.argv[2]
  if (!kind) throw new Error('Use: npm run version:bump -- major | minor | patch | <x.y.z>')
  const pkg = JSON.parse(read('package.json'))
  const next = nextVersion(pkg.version, kind)
  if (next === pkg.version) throw new Error(`Already at ${next}`)

  write('package.json', read('package.json').replace(`"version": "${pkg.version}"`, `"version": "${next}"`))
  const lock = JSON.parse(read('package-lock.json'))
  lock.version = next
  if (lock.packages?.['']) lock.packages[''].version = next
  write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`)

  const changelog = read('CHANGELOG.md')
  const marker = changelog.indexOf('## [')
  write('CHANGELOG.md', `${changelog.slice(0, marker)}${changelogStub(next, new Date().toISOString().slice(0, 10))}${changelog.slice(marker)}`)
  console.log(`Version ${pkg.version} -> ${next}. Fill in the new section of CHANGELOG.md, then commit.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
