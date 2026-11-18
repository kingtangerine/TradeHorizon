# Third-party notices

TradeHorizon uses the open-source packages below, installed through npm. Each remains under its own licence;
the full licence text ships with the package in `node_modules/<package>/`. Versions are those in `package-lock.json`.

Allowed licences: MIT, BSD, Apache-2.0, ISC and zlib (see CONTRIBUTING.md).

## Runtime dependencies (shipped with the app)

| Package | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| @capacitor/android | 8.6.2 | MIT | Drifty Co. and contributors | https://github.com/ionic-team/capacitor |
| @capacitor/app | 8.1.2 | MIT | Drifty Co. and contributors | https://github.com/ionic-team/capacitor-plugins |
| @capacitor/core | 8.6.2 | MIT | Drifty Co. and contributors | https://github.com/ionic-team/capacitor |
| @capacitor/keyboard | 8.0.6 | MIT | Drifty Co. and contributors | https://github.com/ionic-team/capacitor-plugins |
| @capacitor/splash-screen | 8.0.2 | MIT | Drifty Co. and contributors | https://github.com/ionic-team/capacitor-plugins |
| @capacitor/status-bar | 8.0.4 | MIT | Drifty Co. and contributors | https://github.com/ionic-team/capacitor-plugins |
| klinecharts | 10.0.3 | Apache-2.0 | KLineChart contributors | https://github.com/klinecharts/KLineChart |
| react | 19.3.0 | MIT | Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |
| react-dom | 19.3.0 | MIT | Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |

The `@capacitor/*` packages are used by the Android app only; `@capacitor/core` is also in the web bundle.

### Android app (resolved by Gradle, shipped in the APK)

| Library | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| AndroidX AppCompat | 1.7.1 | Apache-2.0 | The Android Open Source Project | https://developer.android.com/jetpack/androidx |
| AndroidX CoordinatorLayout | 1.3.0 | Apache-2.0 | The Android Open Source Project | https://developer.android.com/jetpack/androidx |
| AndroidX Core SplashScreen | 1.2.0 | Apache-2.0 | The Android Open Source Project | https://developer.android.com/jetpack/androidx |
| AndroidX Activity, Core, Fragment, WebKit (through Capacitor) | see `android/build.gradle.kts` | Apache-2.0 | The Android Open Source Project | https://developer.android.com/jetpack/androidx |
| Apache Cordova Android framework (through Capacitor) | 14.0.1 | Apache-2.0 | The Apache Software Foundation | https://github.com/apache/cordova-android |
| Kotlin standard library | 2.3.0 | Apache-2.0 | JetBrains s.r.o. and Kotlin contributors | https://github.com/JetBrains/kotlin |

Browser push notifications are sent with our own implementation (`server/webPush.ts`, built on `node:crypto`).

## Development dependencies (build, lint and test only; not shipped)

| Package | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| @capacitor/cli | 8.6.2 | MIT | Drifty Co. and contributors | https://github.com/ionic-team/capacitor |
| @eslint/js | 10.0.1 | MIT | OpenJS Foundation and other contributors | https://github.com/eslint/eslint |
| @types/node | 24.19.1 | MIT | Microsoft Corporation | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | 19.3.0 | MIT | Microsoft Corporation | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | 19.3.0 | MIT | Microsoft Corporation | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @vitejs/plugin-react | 5.2.0 | MIT | Yuxi (Evan) You and Vite contributors | https://github.com/vitejs/vite-plugin-react |
| eslint | 10.12.0 | MIT | OpenJS Foundation and other contributors | https://github.com/eslint/eslint |
| prettier | 3.10.1 | MIT | James Long and contributors | https://github.com/prettier/prettier |
| eslint-plugin-react-hooks | 7.1.1 | MIT | Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |
| globals | 17.13.0 | MIT | Sindre Sorhus | https://github.com/sindresorhus/globals |
| http_ece | 1.2.0 | MIT | Martin Thomson | https://github.com/martinthomson/encrypted-content-encoding |
| typescript | 5.9.3 | Apache-2.0 | Microsoft Corporation | https://github.com/microsoft/TypeScript |
| typescript-eslint | 8.71.1 | MIT | typescript-eslint and other contributors | https://github.com/typescript-eslint/typescript-eslint |
| vite | 7.3.6 | MIT | VoidZero Inc. and Vite contributors | https://github.com/vitejs/vite |
| vitest | 4.1.11 | MIT | VoidZero Inc. and Vitest contributors | https://github.com/vitest-dev/vitest |

Indirect development dependencies come in through the packages above. One of them, `caniuse-lite` (browser support
data used by the build tools), is under CC-BY-4.0; it is used at build time only and is not part of the shipped app.

Android build tools: the Android Gradle Plugin 8.13.0 and the Kotlin Gradle Plugin 2.3.0 (both Apache-2.0) are
downloaded by Gradle. The Gradle wrapper (`android/gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`,
Apache-2.0, Gradle, Inc.) is kept in the repository, as Gradle projects do, and downloads Gradle 9.3.1 (Apache-2.0).

## Developer tools (installed separately, not part of the repository)

| Tool | Licence | Source |
|---|---|---|
| gitleaks | MIT | https://github.com/gitleaks/gitleaks |
| Lefthook | MIT | https://github.com/evilmartians/lefthook |
