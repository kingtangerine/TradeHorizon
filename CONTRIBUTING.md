# Contributing to TradeHorizon

This repository is private and proprietary (see [LICENSE](./LICENSE)). These rules keep the history readable and the code safe to ship.

## One-time setup

1. Install Node.js 22.18 or newer, then `npm ci`. Node runs the TypeScript server and scripts directly (`npm run dev`).
2. Install [gitleaks](https://github.com/gitleaks/gitleaks) and [Lefthook](https://github.com/evilmartians/lefthook)
   (Windows: `winget install Gitleaks.Gitleaks evilmartians.lefthook`; macOS: `brew install gitleaks lefthook`).
3. Run `lefthook install` in the repository. Every commit is then scanned for secrets and its staged files are
   checked with Prettier and ESLint (see `lefthook.yml`). `npm run format` fixes formatting.
4. Run `git config blame.ignoreRevsFile .git-blame-ignore-revs` so `git blame` skips formatting-only commits.
5. Set your Git identity to the agreed team identity (your GitHub noreply address), before your first commit.
6. Only for work on the Android app: the Android SDK and JDK 21 or newer (see "Android app" in the README). Android
   code is Kotlin, and Gradle build files use the Kotlin DSL (`*.gradle.kts`). Never commit keystores or
   `google-services.json`; `android/.gitignore` blocks both.

## Branches

- One branch per feature or fix, created from `main`:
  `feat/...`, `fix/...`, `refactor/...` or `test/...` (for example `fix/alert-expiry`).
- Never push directly to `main`, never rewrite shared history and never change commit dates.

## Commits

- Small, working steps: one logical change per commit, and every commit builds and passes `npm run check`
  (formatting, lint with no warnings, type-check and tests).
- [Conventional Commits](https://www.conventionalcommits.org/) messages, with a scope where it helps:
  `feat(alerts): add expiry to price alerts`, `fix(sync): resolve offline edit conflict`.
- Never commit build output (`dist/`), dependencies (`node_modules/`), IDE files, logs, databases,
  `.env` files, keys or certificates. `.gitignore` covers these; check `git status` before committing.
- No secrets anywhere: use environment variables, with placeholders in `.env.example`.
- Synthetic data only in tests, fixtures and screenshots (use `example.com` addresses).

## Pull requests

Each pull request:

- covers one feature or fix and links its issue (`Closes #12`);
- describes **what** changed, **why**, and **how it was tested**;
- includes screenshots for any visible UI change;
- passes CI (lint, type-check, tests, build and the server health check) before it is merged.

Plan work with GitHub Issues and milestones.

## Code standards

- Strict TypeScript everywhere; business logic stays out of UI components so it can be unit-tested.
- Clear names, explicit error handling (no silent failures), and comments that explain *why*.
- Doc comments on exported functions and types.
- No stubs, placeholder features, TODOs, commented-out code or debug prints in merged code.

## Dependencies and assets

- Only dependencies under MIT, BSD, Apache-2.0, ISC or zlib, added through npm.
- No GPL, LGPL, AGPL, MPL or other copyleft code, no purchased scripts, no assets of unknown origin.
- Add every new dependency to [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and every asset to [ASSETS.md](./ASSETS.md).
