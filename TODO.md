# Things only you can do (collected by Claude)

Manual console/account steps I can't (or shouldn't) do autonomously. Delete lines as
you complete them.

## Firebase / Google Cloud (needed for deploy)

- [x] **Create the Firebase project** — done: `sabeel-institute-time-tracker`.
  `.firebaserc` updated.
- [x] **Institute ownership:** `oursabeel.com` Cloud organization,
  `faisal.shah@oursabeel.com` as Owner, Institute billing. See `docs/DEPLOY.md`.
- [x] **Enable Google as the only sign-in provider** — done.
- [x] **Register the Web app** — done; real config integrated into
  `app/src/firebase-config.ts`.
- [x] **Web OAuth client ID** — done; taken from the `client_type: 3` entry in
  `app/google-services.json` and set in `WEB_CLIENT_ID`
  (`packages/shared/src/constants.ts`).
- [x] **google-services.json committed** — done (Android app registered).
- [x] **Firestore location confirmed `nam5`** (2026-07-17, Faisal).
- [x] **OAuth consent screen — published** (2026-07-16, confirmed by Faisal). The
  consent screen admits any Google account; the server keeps only verified
  `@oursabeel.com` accounts (`onUserCreate`), and an admin approves each. App
  uses only basic non-sensitive scopes (email/profile/openid) so no Google
  verification was required.
- [ ] **Report a problem's email: the Token Creator grant**, at the deploy
  that first brings `reportProblem`: the functions' runtime service account
  may sign as `report-mailer@sabeel-institute-time-tracker.iam.gserviceaccount.com`.
  The exact `gcloud` command is `docs/DEPLOY.md`, "One-time, per Firebase
  project", step 4. Without it every report is kept but its email fails.
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
  **Cloud Messaging** → *Web configuration* → **Web Push certificates**); its
  public key is committed as `VAPID_PUBLIC_KEY` in `app/src/firebase-config.ts`.
- [ ] **Confirm a web push actually arrives, after the next deploy.**
- [x] **Drop `EXPO_PUBLIC_FCM_VAPID_KEY`** from `app/.env.local`, its vault copy
  and the `APP_ENV_LOCAL` secret: nothing reads it.

  On the site: a browser that has never been asked shows **Enable
  notifications**, on Home and on Notification settings. That is expected, not a
  fault — the app does not ask on sign-in, because a browser only honours a
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
- [ ] **The Sentry setup every Sabeel app shares** (ci-tools README, "Sentry"),
  now that this app reads `EXPO_PUBLIC_SENTRY_DSN_NATIVE` and
  `EXPO_PUBLIC_SENTRY_DSN_WEB`:
  - [x] drop the old `EXPO_PUBLIC_SENTRY_DSN` line from `app/.env.local`, its
    vault copy and `APP_ENV_LOCAL`;
  - drop the `SENTRY_ORG` and `SENTRY_PROJECT` lines from
    `app/.env.sentry-build-plugin` and its vault copy (`ci-tools.json`'s
    `sentry` names them), on this machine;
  - delete `app/android/sentry.properties` and its vault entry: the Android
    build takes the token from `app/.env.sentry-build-plugin`;
  - [x] delete the `IOS_BUILD_ENV` secret: the workflows read `BUILD_ENV`;
  - after the next release, check one Android and one web crash read as
    source in Sentry.

## First admin (after first deploy)

- [x] Done 2026-07-16 via a temporary one-shot bootstrap function (deployed,
  called once, deleted). You are an active admin+manager.

## Phase 7 rollout (timesheets)

- [x] Done 2026-07-16: wipe confirmed and executed, admin kept (approver=self),
  live smoke passed.

## Google Play, internal testing

Staff install from Play through the join link on the app's Internal testing →
Testers page. `npx sabeel-ci release --ship` publishes every release there
(the Publish Android workflow); `docs/DEPLOY.md`, "Play testers".

- [x] **Release keystore + SHA-1** (2026-10-15) — signing config wired to the
  release key, its SHA-1 and SHA-256 registered on the Firebase Android app,
  `google-services.json` re-downloaded. Everyone with a debug-signed APK
  uninstalls once before installing a release-signed build.
- [x] **The app in Play Console, and the publishing account on it** (2026-10-15).
- [x] **Play signs with this app's own key** (2026-10-16): App integrity, App
  signing, "Change key", "Export and upload a key from Java keystore".
- [x] **Testers:** the "Sabeel staff" email list (account-wide, shared with the
  other Sabeel apps) is ticked on Internal testing → Testers (2026-10-16).
- [ ] **Send staff the join link** (Play sends no email): `https://play.google.com/apps/internaltest/4701451587936876375`.

## The stores: TestFlight, App Review, Play production

- [ ] **TestFlight staff:** 19 staff are invited to App Store Connect (Developer
  role); add each to "Sabeel Time Tracker Internal" once they accept (`docs/IOS-BUILD.md`,
  "Releasing to TestFlight").
- [ ] **The production native sign-in round trip, on a phone** (a Play or
  download-page APK, or TestFlight): a Google account with no account in the
  project is refused and no Auth user appears; then an `@oursabeel.com` account
  signs in. Before submitting to App Review (`docs/STORE-RELEASE.md`).
- [ ] **Confirm `privacy@oursabeel.com` exists** and reaches someone: the
  privacy policy and the support page name it, and a reviewer may write to it.
- [ ] **App Review submission** (App Store Connect), after Kanban is through
  review, with the answers and text in `docs/STORE-RELEASE.md`, "Before
  submitting": App Privacy, age rating, the listing, App Review Information
  (the review account in the sign-in fields), manual release; then the unlisted
  request.
- [ ] **Google Play production** (Play Console), the same file: App content
  (privacy policy URL, App access, ads, content rating, target audience, Data
  safety), the store listing, then a production release, which Play reviews.
- [ ] **Texas SB 2420:** ask a lawyer before the first public listing (Play
  production is one).
- [ ] **Renew the distribution certificate and the three App Store profiles
  before 2027-10-16**, starting in September 2027 (`docs/IOS-BUILD.md`,
  "Renewal").
