# Sabeel Institute Time Tracker

Automatic platform builds and manual release controls are documented in
[GitHub Actions](docs/GITHUB-ACTIONS.md).

Hours tracking for a small nonprofit: an Android app, an iPhone app and a website
built from **one Expo codebase**, on Firebase (Auth, Firestore, Cloud Functions,
Hosting).

- **Sign in with Google** — `@oursabeel.com` accounts only, made on the website;
  new accounts wait as *pending* until an admin approves them.
- **Clock in/out or manual entries**, assigned to projects/events, with notes.
- **Honor system** — hours count immediately; managers can correct entries.
- **Timesheets** (daily/weekly) shown in the timezone where the work happened.
- **Reports** — dashboard totals, CSV export, lifetime hours + printable statements.
- **The institute's rules**, accepted once, and **Report a problem**, which emails
  the institute's administrators.

## Layout

| Path | What |
|---|---|
| `app/` | Expo app (Android, iOS, and web via react-native-web) |
| `functions/` | Cloud Functions (TypeScript, nodejs22) |
| `packages/shared/` | Shared types, timezone/duration math, validation |
| `firestore.rules` / `firestore.indexes.json` | Firestore config-as-code |
| `docs/` | Product brief, phase status, test protocols |
| `TODO.md` | Manual (console/account) steps only a human can do |

## Dev quickstart

```sh
npm ci
npm run lint && npm run typecheck && npm test   # static + unit
npm run test:emulator                            # rules/integration (needs JDK 21)
cd app && npx expo start --web                   # web against Firebase emulators
scripts/emulator.sh headless                     # Android AVD (tb_emu)
cd app && npx expo run:android
```

See `CLAUDE.md` for working rules and `docs/PRODUCT_BRIEF.md` for the full design.

## Releasing

`docs/DEPLOY.md` (web, functions, Android: GitHub release and Google
Play internal testing), `docs/IOS-BUILD.md` (iPhone: TestFlight),
`docs/STORE-RELEASE.md` (App Store and Play decisions), `docs/SECRETS.md`.
