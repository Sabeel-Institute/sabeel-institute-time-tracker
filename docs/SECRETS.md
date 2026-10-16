# Secrets & config (names only — never commit values)

Client Firebase config is **not** secret and is committed (`app/src/firebase-config.ts`).
Everything below is either a server secret or gitignored local config.

## Cloud Functions secrets (Secret Manager)
Set with `firebase functions:secrets:set <NAME>`; bind in code via `defineSecret`.

| Name | Used by | Where to find the value |
|---|---|---|
| `SENTRY_DSN` | functions error capture (`functions/src/sentry.ts`) | Sentry → Project → Client Keys (DSN) |

## Cloud Functions env vars (`functions/.env`, gitignored)
Plain env vars (NOT `defineString` params — those hang the emulator on a stdin prompt).
See `functions/.env.example`.

| Name | Used by | Value |
|---|---|---|
| `PROBE_TOKEN` | `probeQueries` (post-deploy index check) | Any long random string |

## App client env (`app/.env.local`, gitignored)
| Name | Used by | Value |
|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | app Sentry seam (`app/src/sentry*.ts`) | Sentry DSN (deferred to launch) |
| `EXPO_PUBLIC_USE_EMULATORS` | dev only — point the app at local emulators | `1` |

## Android release signing key
`~/keystores/sabeel-time-tracker-release.jks` (alias and password in
`sabeel-time-tracker-release.credentials.txt` beside it), named for Gradle by
`~/.config/sabeel-time-tracker/keystore.properties` (mode 600, outside the repo).
It is also Google Play's app signing key for this app. Losing it means no update
can ever be signed again: back it up (Faisal's vault holds a copy).

## Non-secret client config in the repo
- `app/src/firebase-config.ts` — Firebase web app config (public).
- `packages/shared/src/constants.ts` → `WEB_CLIENT_ID` — the **Web** OAuth client id
  (public; needed by native Google Sign-In). Not the Android client id.
- `app/google-services.json` (and its copy under `app/android/app/`) — the Firebase
  Android app's config, with an OAuth client for the debug key and one for the
  release key.

## iOS build (the Mac and GitHub)
`app/.env.sentry-build-plugin` (gitignored) holds `SENTRY_ORG`, `SENTRY_PROJECT`,
`SENTRY_AUTH_TOKEN`, `IOS_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, read by
`scripts/load-build-env.sh`. The App Store Connect key lives at
`~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8`. On GitHub the same values
come from the secrets `IOS_BUILD_ENV`, `APP_ENV_LOCAL`, `ASC_KEY_P8`, `IOS_DIST_P12`,
`IOS_DIST_P12_PASSWORD` and `IOS_PROFILE`; `docs/IOS-BUILD.md` says what each is.
