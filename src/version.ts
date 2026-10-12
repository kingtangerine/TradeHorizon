// The version this copy of the app was built from. The number comes from package.json (bump it with
// `npm run version:bump`), the build id is the git commit, and the date is when the bundle was built.
export const APP_VERSION: string = __APP_VERSION__
export const APP_BUILD: string = __APP_BUILD__
export const APP_BUILT_AT: string = __APP_BUILT_AT__

/** "v0.11.0" */
export function versionLabel(): string {
  return `v${APP_VERSION}`
}

/** "Version 0.11.0 · build a1b2c3d · built 12 Oct 2026" for tooltips and the account window. */
export function versionDetails(): string {
  const built = new Date(APP_BUILT_AT)
  const date = Number.isNaN(built.getTime())
    ? ''
    : ` · built ${built.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  return `Version ${APP_VERSION} · build ${APP_BUILD}${date}`
}
