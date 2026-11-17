# Third-party notices

TradeHorizon uses the open-source packages below, installed through npm. Each remains under its own licence;
the full licence text ships with the package in `node_modules/<package>/`. Versions are those in `package-lock.json`.

Allowed licences: MIT, BSD, Apache-2.0, ISC and zlib (see CONTRIBUTING.md).

## Runtime dependencies (shipped with the app)

| Package | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| klinecharts | 10.0.3 | Apache-2.0 | KLineChart contributors | https://github.com/klinecharts/KLineChart |
| react | 19.3.0 | MIT | Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |
| react-dom | 19.3.0 | MIT | Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |
| web-push | 3.6.7 | MPL-2.0 ⚠️ | Marco Castelluccio | https://github.com/web-push-libs/web-push |

⚠️ `web-push` is not under an allowed licence and is being replaced with our own implementation (issue #6).

## Development dependencies (build, lint and test only; not shipped)

| Package | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| @eslint/js | 10.0.1 | MIT | OpenJS Foundation and other contributors | https://github.com/eslint/eslint |
| @types/node | 24.19.1 | MIT | Microsoft Corporation | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | 19.3.0 | MIT | Microsoft Corporation | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | 19.3.0 | MIT | Microsoft Corporation | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @vitejs/plugin-react | 5.2.0 | MIT | Yuxi (Evan) You and Vite contributors | https://github.com/vitejs/vite-plugin-react |
| eslint | 10.12.0 | MIT | OpenJS Foundation and other contributors | https://github.com/eslint/eslint |
| eslint-plugin-react-hooks | 7.1.1 | MIT | Meta Platforms, Inc. and affiliates | https://github.com/facebook/react |
| globals | 17.13.0 | MIT | Sindre Sorhus | https://github.com/sindresorhus/globals |
| typescript | 5.9.3 | Apache-2.0 | Microsoft Corporation | https://github.com/microsoft/TypeScript |
| typescript-eslint | 8.71.1 | MIT | typescript-eslint and other contributors | https://github.com/typescript-eslint/typescript-eslint |
| vite | 7.3.6 | MIT | VoidZero Inc. and Vite contributors | https://github.com/vitejs/vite |
| vitest | 4.1.11 | MIT | VoidZero Inc. and Vitest contributors | https://github.com/vitest-dev/vitest |

Indirect development dependencies come in through the packages above. One of them, `caniuse-lite` (browser support
data used by the build tools), is under CC-BY-4.0; it is used at build time only and is not part of the shipped app.

## Developer tools (installed separately, not part of the repository)

| Tool | Licence | Source |
|---|---|---|
| gitleaks | MIT | https://github.com/gitleaks/gitleaks |
| Lefthook | MIT | https://github.com/evilmartians/lefthook |
