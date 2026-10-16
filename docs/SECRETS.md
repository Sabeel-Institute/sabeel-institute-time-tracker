# Secrets & config (names only — never commit values)

Client Firebase config is **not** secret and is committed (`app/src/firebase-config.ts`).
Everything below is either a server secret or gitignored local config.

## The vault
Every secret file and gitignored config file below has a copy in the vault,
`~/.config/secrets-vault/` on the Linux build machine: `sources.tsv` maps each
copy (`sabeel/time-tracker/…`, `sabeel/apple/…`, `sabeel/google-play/…`,
`sabeel/review/…`) to its live path. `bash vault.sh collect` copies every live
file in again and verifies; `bash vault.sh verify` compares the copies with the
live files. A new machine restores from it; a new secret file goes into
`sources.tsv` and is collected in the same batch.

## Cloud Functions secrets (Secret Manager)
Set with `firebase functions:secrets:set <NAME>`; bind in code via `defineSecret`.

| Name | Used by | Where to find the value |
|---|---|---|
| `SENTRY_DSN` | functions error capture (`functions/src/sentry.ts`) | Sentry → Project → Client Keys (DSN) |
| `APNS_KEY` | push to iPhones (`functions/src/messaging.ts`, bound to every sender via `PUSH_SECRETS`) | The team's APNs key, `AuthKey_X5R8FL94BC.p8` (the same key the LMS and Kanban use): `~/.config/secrets-vault/sabeel/apple/` on Linux, `~/.apns/` on the Mac. Set with `firebase functions:secrets:set APNS_KEY --data-file <the .p8> --project dev` |

The emulator reads stand-ins from the gitignored `functions/.secret.local`
(`APNS_KEY=unused-in-emulator`; CI writes the same line). The emulated functions
send no push, so the value is never used.

## Cloud Functions parameters (`functions/.env.<project>`, committed)
`defineString` params, read from the committed `functions/.env.<project>` of the
project being deployed or emulated. Both files exist, the demo one included, so
the emulator never stops to prompt for a value.

| Name | Used by | Value |
|---|---|---|
| `APNS_KEY_ID` | push to iPhones | The APNs key's id (`X5R8FL94BC`); `unused-in-emulator` for `demo-sabeel` |
| `APPLE_TEAM_ID` | push to iPhones | The Apple team (`XRKWA4QRN9`); `unused-in-emulator` for `demo-sabeel` |

## Cloud Functions env vars (`functions/.env`, gitignored)
Plain env vars for values that are not per-project parameters. (A `defineString`
param with no value in the emulated project's `.env.<project>` hangs the
emulator on a stdin prompt, which is why both parameter files above exist.)
See `functions/.env.example`.

| Name | Used by | Value |
|---|---|---|
| `PROBE_TOKEN` | `probeQueries` (post-deploy index check) | Any long random string |

## App client env (`app/.env.local`, gitignored)
| Name | Used by | Value |
|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | app Sentry seam (`app/src/sentry*.ts`) | Sentry → the app project → Client Keys (DSN); an iPhone build refuses without it (`check:ios`) |
| `EXPO_PUBLIC_FCM_VAPID_KEY` | web push (`docs/DEPLOY.md`, `npm run check:web-push`) | Firebase console → Project settings → Cloud Messaging → Web Push certificates |
| `EXPO_PUBLIC_USE_EMULATORS` | dev only — point the app at local emulators | `1` |

## Android Sentry upload (`app/android/sentry.properties`, gitignored)
`auth.token` and `defaults.org`, read by Sentry's Gradle plugin from
`app/android/` (template: `sentry.properties.example`). With it a release build
uploads its source maps; without it the build succeeds and Android stack traces
stay minified.

## Android release signing key
`~/keystores/sabeel-time-tracker-release.jks` (alias and password in
`sabeel-time-tracker-release.credentials.txt` beside it), named for Gradle by
`~/.config/sabeel-time-tracker/keystore.properties` (mode 600, outside the repo).
It is also Google Play's app signing key for this app. Losing it means no update
can ever be signed again: the vault holds a copy (`sabeel/time-tracker/android/`).

## Google Play publishing key
`~/keys/sabeel-play-publisher.json`, the key of
`sabeel-play-publisher@sabeel-institute-kanban.iam.gserviceaccount.com`, read by
`scripts/publish-play.mjs` (or the path in `PLAY_KEY`). One service account
publishes every Sabeel app; Play Console gives it "Release apps to testing
tracks" app by app. Outside the repo because the repo is public. If it leaks or
is lost, delete that key in the Google Cloud console (project
`sabeel-institute-kanban`, IAM, Service Accounts) and make a new JSON key there.

## Non-secret client config in the repo
- `app/src/firebase-config.ts` — Firebase web app config (public).
- `packages/shared/src/constants.ts` → `WEB_CLIENT_ID` — the **Web** OAuth client id
  (public; needed by native Google Sign-In). Not the Android client id.
- `app/google-services.json` (and its copy under `app/android/app/`) — the Firebase
  Android app's config, with an OAuth client for the debug key and one for the
  release key.

## The email-and-password account's password
`PASSWORD_ACCOUNT_EMAIL` (`app-review@oursabeel.com`) signs in with a long
generated password. It lives in the vault (`sabeel/review/`), and goes into App
Store Connect's App Review Information sign-in fields when the app is submitted;
nowhere else: never in this repo, a chat or a log.

## iOS build (the Mac and GitHub)
`app/.env.sentry-build-plugin` (gitignored) holds `SENTRY_ORG`, `SENTRY_PROJECT`,
`SENTRY_AUTH_TOKEN`, `IOS_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, read by
`scripts/load-build-env.sh`. The App Store Connect key lives at
`~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8`. On GitHub the same values
come from the secrets `IOS_BUILD_ENV`, `APP_ENV_LOCAL`, `ASC_KEY_P8`, `IOS_DIST_P12`,
`IOS_DIST_P12_PASSWORD` and `IOS_PROFILE`; `docs/IOS-BUILD.md` says what each is.
