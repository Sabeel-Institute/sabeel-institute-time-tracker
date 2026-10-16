# Things only you can do (collected by Claude)

Manual console/account steps I can't (or shouldn't) do autonomously. Delete lines as
you complete them. Nothing here blocks Phases 0–5 — everything runs against the
Firebase emulators until deploy time (Phase 6).

## Firebase / Google Cloud (needed for deploy)

- [x] **Create the Firebase project** — done: `sabeel-institute-time-tracker`.
  `.firebaserc` updated.
- [x] **Enable Google as the only sign-in provider** — done.
- [x] **Register the Web app** — done; real config integrated into
  `app/src/firebase-config.ts`.
- [x] **Web OAuth client ID** — done; taken from the `client_type: 3` entry in
  `app/google-services.json` and set in `WEB_CLIENT_ID`
  (`packages/shared/src/constants.ts`).
- [x] **google-services.json committed** — done (Android app registered).
- [x] **Firestore location confirmed `nam5`** (2026-07-17, Faisal).
- [x] **OAuth consent screen — published** (2026-07-16, confirmed by Faisal). Any
  Google account can now sign in; access is gated by the app's own admin-approval
  flow. App uses only basic non-sensitive scopes (email/profile/openid) so no
  Google verification was required.
- [x] **Android debug SHA-1 registered** + `google-services.json` re-downloaded
  (now has the `client_type: 1` Android OAuth client). Native Google Sign-In is
  wired and the app builds; complete a real sign-in on a device/emulator with a
  Google account to confirm end to end.

## Google Drive sync — REMOVED (undo checklist)

The Drive sync feature was removed on 2026-07-25 (code, config, deployed
functions and docs all gone). Nothing in the app touches Google Drive any more.
These are the leftovers on Google's side that only **you** can clear:

- [ ] **Un-share the Drive folder from the service account.** Open the "Sabeel
  Hours" folder in Drive → Share → remove
  `858585609550-compute@developer.gserviceaccount.com`. This is the one that
  actually matters: it revokes the app's standing access to that folder.
- [ ] **Decide what to do with the folder + Sheet themselves.** They are your
  documents and hold only a copy of approved hours; keep or delete as you like.
  Nothing will write to them again.
- [ ] **Optional — disable the two APIs** now that nothing uses them:
  - Sheets: https://console.cloud.google.com/apis/api/sheets.googleapis.com/metrics?project=sabeel-institute-time-tracker
  - Drive: https://console.cloud.google.com/apis/api/drive.googleapis.com/metrics?project=sabeel-institute-time-tracker
  (Harmless to leave enabled; disabling is just tidier.)

No secrets to rotate: the two values were `DRIVE_SPREADSHEET_ID` and
`DRIVE_FOLDER_ID`, which are document identifiers, not credentials. They have
been removed from `functions/.env` and from the deployed functions' config.

## Web push notifications

Android push works out of the box. The website needed a Web Push certificate,
and it has one.

- [x] Web Push certificate generated (Firebase console → **Project settings** →
  **Cloud Messaging** → *Web configuration* → **Web Push certificates**) and
  living in `app/.env.local` as `EXPO_PUBLIC_FCM_VAPID_KEY`.
- [ ] **Confirm a web push actually arrives, after the next deploy.** The key
  reaches the bundle from the environment that runs `expo export`, so run
  `npm run check:web-push` between the export and the deploy — a keyless build
  makes every device report that it cannot receive notifications, and nothing
  else looks wrong.

  On the site: a browser that has never been asked shows **Enable
  notifications**, on Home and on Notification settings. That is expected, not a
  fault — the app no longer asks on sign-in, because a browser only honours a
  permission request raised straight from a press.

## Fix web sign-in inside in-app/partitioned browsers (missing-initial-state error)

Seen 2026-07-17: sign-in from a chat app's in-app browser dies on the
firebaseapp.com auth helper ("missing initial state"). Fix = serve the auth
helper same-origin. One console step, then Claude flips `authDomain` and
redeploys:

- [x] GCP console → **APIs & Services → Credentials** →
  https://console.cloud.google.com/apis/credentials?project=sabeel-institute-time-tracker
  → under **OAuth 2.0 Client IDs** open the **Web client** (the one Firebase
  auto-created) and add:
  - to **Authorized JavaScript origins**:
    `https://sabeel-institute-time-tracker.web.app`
  - to **Authorized redirect URIs**:
    `https://sabeel-institute-time-tracker.web.app/__/auth/handler`
  Save. (Additive — existing sign-ins keep working.)
- [x] Tell Claude "redirect URI added" → authDomain flips to
  `sabeel-institute-time-tracker.web.app` in `firebase-config.ts`, website
  redeploys, and chat-app/in-app-browser sign-ins start working.

## Sentry

- [x] Done 2026-07-16: both projects created, DSNs wired (web + functions),
  events flowing with user ids.
- [x] Native @sentry/react-native wired 2026-07-17 (v1.0.0-beta.11) — Android
  crashes/ANRs/errors report with user ids.
- [ ] **Readable release stack traces** (optional, one-time): create an auth
  token at sentry.io → **Settings → Auth Tokens → Create New Token** (scope:
  `project:releases`), then on this machine copy
  `app/android/sentry.properties.example` to `sentry.properties` (same
  folder, gitignored) and fill in `auth.token=` and your org slug
  (`defaults.org=` — it's in your sentry.io URL). NEVER paste the token in
  chat or commit it. Tell Claude it's in place → the next release build
  uploads source maps automatically and stacks become readable.

## First admin (after first deploy)

- [x] Done 2026-07-16 via a temporary one-shot bootstrap function (deployed,
  called once, deleted). You are an active admin+manager.

## Phase 7 rollout (timesheets)

- [x] Done 2026-07-16: wipe confirmed and executed, admin kept (approver=self),
  live smoke passed.

## Play Store phase (not now — deferred 2026-07-20)

Nothing here blocks sideloaded testing. The APKs already ARE release builds
(minified, production bundle); only the signing key is the debug one, which is
valid to 2052 and functionally identical for testing.

- [x] **Release keystore + SHA-1** (2026-10-15) — signing config wired to the
  release key, its SHA-1 and SHA-256 registered on the Firebase Android app,
  `google-services.json` re-downloaded. Everyone with a debug-signed APK
  uninstalls once before installing a release-signed build.

## App Store phase (not now — versioning groundwork done 2026-07-26)

The version scheme is already what Apple requires (`X.Y.Z`, one source of truth,
enforced in CI — see `docs/PHASE_STATUS.md`). Nothing below blocks Android work.

- [ ] **Apple Developer Program enrolment** ($99/yr, org enrolment needs a D-U-N-S
  number and can take weeks — start it well before you want to ship). Only you
  can do this; it needs the nonprofit's legal identity and a payment method.
- [ ] **A Mac.** iOS builds and App Store uploads cannot be produced on Linux, and
  this project has no EAS. Decide between a physical Mac and a hosted one before
  planning the port — it changes the build loop, not the code.

Once those exist, the remaining work is mine, not yours:

- `CFBundleVersion` (the iOS build number) needs its own scheme — it is separate
  from the version and cannot simply mirror the Android `versionCode`.
- An `ios/` directory (the repo is Android-only today), the Google sign-in seam
  re-pointed at an iOS OAuth client, and APNs wired for push.
