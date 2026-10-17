# Deploy guide

How the web app, the Cloud Functions and the Android app ship, from Linux. The
iPhone build and TestFlight are `docs/IOS-BUILD.md`; the store decisions (App
Store, Google Play) are `docs/STORE-RELEASE.md`; every key and gitignored file
is in `docs/SECRETS.md`.

Production is the Firebase project `sabeel-institute-time-tracker`. It is the
only alias in `.firebaserc`, named `dev`, and there is no default, so every
`firebase` command here says `--project dev`.

## Before your first release

**Access.**
- GitHub: write access to `faisal-shah/sabeel-institute-time-tracker` (push,
  releases, Actions) and `faisal-shah/faisal-shah.github.io` (the download page
  and its rolling APK asset); `gh auth login`.
- Firebase / Google Cloud: deploy rights on `sabeel-institute-time-tracker`
  (`firebase login`); `gcloud` with Application Default Credentials for
  `grant-admin.mjs` and `check:push`.
- Google Play Console: a user on the app, for testers and App integrity.
  Uploads go through the publishing service account, not a login.
- App Store Connect: a user on the app, for TestFlight testers
  (`docs/IOS-BUILD.md`).

**Clones.**
- This repo.
- `faisal-shah/faisal-shah.github.io`, branch `master`, at
  `../faisal-shah.github.io` (or `TT_PAGES_DIR` pointing at it). Without it
  `publish-apk.sh` still uploads the APK but leaves the page's version and date
  as they were, and says only "Published".
- `faisal-shah/agent-skills` at `../agent-skills`, for the toolchain bootstrap
  (`docs/DEV-TOOLING.md`, "Setting up a machine").

**Files outside git.** Each has a copy in the vault, `~/.config/secrets-vault/`
(`docs/SECRETS.md`).

| File | Without it |
|---|---|
| `~/keystores/sabeel-time-tracker-release.jks`, `~/.config/sabeel-time-tracker/keystore.properties` | Gradle refuses to package a release |
| `~/keys/sabeel-play-publisher.json` (or `PLAY_KEY`) | `publish-play.mjs` stops; the rest of the release stands |
| `app/.env.local` (`EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_FCM_VAPID_KEY`) | the APK and the web ship with crash reporting and web push off |
| `app/android/sentry.properties` | the APK's stack traces in Sentry stay minified |
| `functions/.env` (`PROBE_TOKEN`) | a functions deploy leaves `probeQueries` refusing every call |

**Tools.** Node 22, JDK 17 as the default `java` (Gradle, and `jarsigner` and
`keytool` for `publish-play.mjs`), JDK 21 for the emulators, the Android SDK and
the `tb_emu` AVD: the bootstrap installs them. Also `firebase` (firebase-tools
15), `gh`, `unzip`, and for the manual PDF that `npm run release` re-renders
(`docs/render-manual.py`): `google-chrome` and Python's `markdown`
(`python3-markdown`).

## One-time, per Firebase project
Done for production; this is the order for a new project.
1. `TODO.md`, "Firebase / Google Cloud": the project (Blaze), Google sign-in,
   the Android and Web apps, SHA-1s, `WEB_CLIENT_ID`, `google-services.json`;
   then the project in `.firebaserc`.
2. Secrets (`docs/SECRETS.md`): `SENTRY_DSN`, and `APNS_KEY` (`--data-file` the
   `.p8`), which every push sender binds, so a functions deploy needs it;
   `PROBE_TOKEN` in `functions/.env`.
3. Upgrade Auth to Identity Platform, deploy the functions (the sign-in gate
   registers on deploy), and only then enable Email/Password, so the provider is
   never open without the gate. Then make the review account
   (`docs/STORE-RELEASE.md`).
4. Report a problem's email (`docs/STORE-RELEASE.md`, 4), sent as
   `apps-noreply@oursabeel.com` by keyless domain-wide delegation. In
   production: the **Gmail API** and the **IAM Service Account Credentials
   API** are enabled (both since 2026-10-16); the service account
   `report-mailer@sabeel-institute-time-tracker.iam.gserviceaccount.com`
   exists and is authorised for `https://www.googleapis.com/auth/gmail.send`
   in the Workspace Admin console's Domain-wide delegation (2026-10-16); its
   address is `REPORT_MAILER_SA` in `functions/.env.sabeel-institute-time-tracker`.
   What the deploy needs on top: the functions' runtime service account may
   sign as `report-mailer`, Token Creator on that one account:
   ```sh
   gcloud iam service-accounts add-iam-policy-binding \
     report-mailer@sabeel-institute-time-tracker.iam.gserviceaccount.com \
     --member=serviceAccount:858585609550-compute@developer.gserviceaccount.com \
     --role=roles/iam.serviceAccountTokenCreator \
     --project sabeel-institute-time-tracker
   ```
   The runtime account is the project's default compute service account;
   `gcloud functions describe reportProblem --region us-central1 --project
   sabeel-institute-time-tracker --format='value(serviceConfig.serviceAccountEmail)'`
   names it. Without the grant every report is kept with `mail.status:
   'failed'` and "Permission 'iam.serviceAccounts.signJwt' denied", and the
   person is told the email did not go out. Nothing else is needed: no key and
   no secret.

## Deploy
```sh
# Rules + indexes + functions + hosting (web). Predeploy builds the web bundle.
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting --project dev
```
- Hosting serves `app/dist-web`, which the hosting predeploy in `firebase.json`
  rebuilds (`npm run web:export -w @sabeel/app`) on every hosting deploy.
- **Web push needs `EXPO_PUBLIC_FCM_VAPID_KEY` in `app/.env.local`.** The key
  reaches the bundle from the environment that runs the export. Miss it and
  nothing fails: the client is inert by design, so the build succeeds, the site
  deploys, and every device quietly reports that it cannot receive
  notifications. `npm run check:web-push` reads `app/dist-web` and refuses when
  the key is absent or the wrong shape. Because the deploy exports again and
  uploads that export, the order is: `npm run web:export -w @sabeel/app && npm
  run check:web-push` (this environment yields a keyed bundle), the deploy, then
  `npm run check:web-push` again (`dist-web` now holds exactly what was
  uploaded).
- Indexes: the composite indexes in `firestore.indexes.json` deploy with the above;
  first queries will error until they finish building (a few minutes).

## First admin (after first deploy)
Sign in once with your Google account (lands pending), then:
```sh
GCLOUD_PROJECT=sabeel-institute-time-tracker node scripts/grant-admin.mjs you@example.com
```
(Needs gcloud ADC or `GOOGLE_APPLICATION_CREDENTIALS`.) Sign out/in to pick up the
admin claim. From then on, promote others in-app (Manage users).

## Ship it — the release runbook

`android/` is committed (no EAS); everything below is local. **Do not run the
Gradle/`gh release` commands by hand** — `npm run release` encodes the steps and
the checks, and skipping it is how versions and stamps drift apart.

```sh
# 0. clean tree, CI green on the commit you are shipping
npm run verify                       # lint (incl. version check) + typecheck + knip + unit
scripts/emulator.sh headless &       # the release VERIFIES on the AVD; it needs one

# 0b. server code the new app calls goes live FIRST (a callable the app has not
#     got yet fails every use of it): e.g. accountExists, which native sign-in asks
#     before signing in, and acceptRules, without which nobody gets past the
#     rules screen (docs/STORE-RELEASE.md). Rules and indexes with them: the
#     reports index serves reportProblem's five-an-hour count.
firebase deploy --only firestore:rules,firestore:indexes,functions --project dev

# 1. cut it — version is X.Y.Z, no suffix, and must increase (see check-version.mjs)
npm run release -- 0.29.0 --notes notes.md

# 2. deploy the web from the commit the release just pushed; the predeploy
#    exports again from the same commit and env, so check before and after
npm run web:export -w @sabeel/app && npm run check:web-push
firebase deploy --only hosting --project dev
npm run check:web-push
#    …plus `functions` / `firestore:rules` / `firestore:indexes` if they changed.
```

`npm run release` bumps `app/app.json` (the only place the version lives),
re-renders the manual PDF, builds both APK variants and the Play bundle,
**installs the universal APK on the AVD and refuses to publish unless it is a
production bundle** (the check that matters is the ABSENCE of the dev sign-in
row), pushes the branch, creates the GitHub release, calls
`scripts/publish-apk.sh`, and last puts the bundle on Google Play's internal
testing track with `scripts/publish-play.mjs`.

`publish-play.mjs` (`npm run publish:play -- --check`, or `-- --internal` to
rerun the upload alone) refuses a debug-signed bundle, one that does not carry
HEAD's commit or app.json's version, and an upload whose versionCode Play reads
differently. It puts the build up as a draft release no tester sees, waits for
the APKs Play generates from it, and completes the release only if they are
signed with the app's own release key. Play Console gives every new app a
Google-generated signing key the moment it is created; this app's is its own
key (App integrity, App signing, "Change key", "Export and upload a key from
Java keystore", with Google's PEPK tool), so a Play install and an APK from the
download page update each other. APKs Play generated before a key change stay
signed with the old key, which is what the check catches. Play keeps an app's
first release a draft if the API may not complete it; the script says so, and
one "Start rollout" in Play Console sends it. The publishing key is in
`docs/SECRETS.md`.

`publish-apk.sh` updates the public download page
(https://faisal-shah.github.io/sabeel-time-tracker/):

- uploads the arm64 APK as an asset on the **fixed rolling tag**
  `timetracker-latest`, so the download URL never changes;
- rewrites the version **and a published date/time** on the page. The rolling
  URL means the page is the only place a reader can tell whether what they are
  downloading is current, so it carries `published <date>, <time> <TZ>` in local
  time next to the version. Both are stamped by the script — never edit them by
  hand, and if you restructure that page keep the `Current build: <strong>v…`
  and `<time datetime="…">` anchors or the script aborts (by design).

**`npm run release` pushes the branch itself**, between the AVD check and the
GitHub release, and refuses to tag if `origin/main` does not then match the
release commit. Two reasons it belongs there and not in your hands:

- `gh release create` builds the tag server-side, so it can only point at a
  commit the remote already has. Left to a later manual push, it tags the
  commit *before* the release, and nothing disagrees except `git rev-parse`.
- Deploying hosting before the push would stamp the web build with a commit that
  is not on `main`, and the sign-in footer would disagree with the APK. Both
  surfaces must read `v<version> · <same hash>`.

Everything before the push is local, so a failed build or AVD check still
recovers with `git reset --hard HEAD~1`.

The sign-in gate (`beforeSignUp`, `beforeSignIn`) registers with Identity
Platform when the functions deploy, and Email/Password is enabled behind it.
The one password account is made with the Admin SDK (`docs/STORE-RELEASE.md`).

After a functions deploy, `npm run check:push` asks FCM and Apple whether they
accept a message from the project (needs Google credentials for FCM and
`gcloud` access to the `APNS_KEY` secret).

The iPhone build of the release is the iOS workflow started on its tag, with
Faisal's go-ahead (`docs/IOS-BUILD.md`, "Releasing to TestFlight").

### Play testers

A release on internal testing reaches the email lists ticked on the app's
**Internal testing → Testers** page: the "Sabeel staff" list. Email lists belong
to the Play Console developer account, not to one app, so the same list serves
the other Sabeel apps and a change to it reaches all of them. To add a person,
add their Google account to the list. They join once through the join link
(`https://play.google.com/apps/internaltest/4701451587936876375`, on that same Testers page and on the download page), signed in to Play with the Google account on the list,
then install the app from Play; every later release reaches them as an update.
A phone with a download-page APK older than 0.28.0 uninstalls it first
("Signing", below).

### After shipping
- Download page shows the new version **and a fresh timestamp** (Pages lags ~1 min):
  `curl -s "https://faisal-shah.github.io/sabeel-time-tracker/?cb=$RANDOM" -H 'Cache-Control: no-cache' | grep -A1 'Current build'`
- Both surfaces agree: the web bundle's `BUILD_INFO` matches the APK's.
- `publish-play.mjs` ended with "is on the internal testing track", and Play
  Console, Internal testing shows the release.
- The iOS workflow on the tag, then TestFlight (`docs/IOS-BUILD.md`).
- Record the deploy in `docs/PHASE_STATUS.md` (deploy log).

Signing: release builds (the APKs and the Play bundle) sign with the app's own
key, `~/keystores/sabeel-time-tracker-release.jks`, named by
`~/.config/sabeel-time-tracker/keystore.properties` (`app/android/app/build.gradle`
refuses to package a release without it). Google Play signs with the same key,
uploaded as its app signing key, so a Play install and an APK from the download
page update each other. APKs older than 0.28.0 are signed with the public debug
key: a phone that has one uninstalls it once before installing a release-signed
build, from the download page or Play (Android refuses an update signed by
another key); nothing is lost, all data is in Firestore. Both keys' SHA-1s are
on the Firebase Android app, so Google sign-in works on either.

## Troubleshooting

**Callables 403 with "The request was not authenticated / Empty Authorization
header" (Cloud Run layer), even though `setup.ts` sets `invoker: 'public'`.**
Seen on 2026-07-16: the very first deploy created the gen-2 functions but the
*build* failed (the `@sabeel/shared` packaging bug), so the public-invoker IAM
binding was never applied. Later update deploys don't re-apply invoker IAM when
they think it's unchanged, so the callables stayed private and every client call
bounced at the Run layer before the code ran (symptom: Reports total stuck on
`…`, CSV export silently empty). Fix: delete the affected callables and let a
deploy recreate them through the *create* path, which always applies the binding:
```sh
firebase functions:delete setUserAccess exportCsv reportTotals --region us-central1 --force --project dev
firebase deploy --only functions --project dev
```
Verify: an unauthenticated `curl -X POST .../reportTotals -d '{"data":{}}'` should
return a Firebase JSON `{"error":{... "UNAUTHENTICATED"}}` (code ran), NOT a plain
Run "request was not authenticated" 403.

**First deploy of a Firestore-trigger function fails with "Permission denied
while using the Eventarc Service Agent".** Seen on 2026-07-17 deploying
`notifyNewUser`/`notifyTimesheet`: the deploy auto-enables Eventarc, but the
service agent's permissions take a few minutes to propagate. Not a config
error — wait 2–5 minutes and redeploy just the failed functions
(`firebase deploy --only functions:<name>,functions:<name> --project dev`).

**e2e: "internal" from a callable / "blocked by CORS policy" in the browser.**
The functions emulator accepts connections on 5001 *before* it registers any
function; until then calls 404, and a 404 carries no CORS headers, so the browser
blames CORS and the app shows a bare `internal`. It is a startup race, not a
callable bug. `scripts/web-e2e.mjs` now waits for a known callable to exist
(`waitForFunctionRegistered`) rather than for the port to answer.

## Verify after deploy
- **Query/index probe** (REQUIRED after any change to `firestore.indexes.json`
  or to a query shape — the emulator does NOT enforce composite indexes, so
  only production can confirm them):
  `curl "https://us-central1-sabeel-institute-time-tracker.cloudfunctions.net/probeQueries?token=$PROBE_TOKEN"`
  (token in `functions/.env`; every line must read `OK`). Keep the shapes in
  `functions/src/probe.ts` in sync with the app's queries.
- Emulator suite still green locally: `npm test && npm run test:emulator`.
- Smoke the live site: sign in, get approved, clock in/out, add manual hours, check a
  report + CSV export.
- **Report a problem**, after a functions deploy that touches it: send one as
  yourself. It arrives at `apps-reports@oursabeel.com` from "Sabeel Apps No
  Reply", Reply-To you, and the app says "Sent."; `reports/{id}` in the
  Firestore console has `mail.status: 'sent'` and Gmail's `messageId`. A
  `failed` record carries Google's reason (a missing grant reads "Permission
  'iam.serviceAccounts.signJwt' denied", step 4 above).

## Backups / disaster recovery

Enabled 2026-07-25, both native Firestore features (no code, nothing to maintain):

| Layer | Window | What it covers |
|---|---|---|
| **PITR** | rolling **7 days** | "someone deleted it this morning" — rewind to any microsecond |
| **Weekly backup** (Mondays, 98-day retention) | **14 weeks** | "we noticed in September that something broke in July" |

14 weeks is Firestore's maximum retention. Both are **excluded from the free
tier**, but at this data size (~200 KB) they bill as fractions of a cent.

**Delete protection is ENABLED**, so the database itself cannot be deleted until
someone deliberately turns it off:
```sh
firebase firestore:databases:update "(default)" --delete-protection DISABLED --project dev
```
Expect that step to be needed if you ever legitimately tear the database down —
it is a speed bump by design, not a bug.

Inspect:
```sh
firebase firestore:databases:get "(default)" --project dev    # PITR state
firebase firestore:backups:schedules:list --project dev       # schedule + retention
firebase firestore:backups:list --project dev                 # actual backups taken
```

Restore (both are *new database* operations — they never overwrite in place, so
you restore then repoint, rather than clobbering live data):
```sh
firebase firestore:databases:restore --project dev \
  --database <new-db-id> --backup <backup-name>
```
For PITR, restore/export using a `--snapshot-time` within the last 7 days. See
https://cloud.google.com/firestore/native/docs/disaster-recovery.

### Detection — the `healthCheck` canary

Retention only helps if the problem is noticed while a good backup still exists.
`functions/src/health.ts` runs daily at 03:15 UTC and:

- counts documents per collection (via `count()` aggregations, not full reads);
- compares against the previous run stored at `meta/health` (server-only; the
  rules deny all client access);
- raises to Sentry when a collection shrinks past its tolerance —
  `users`/`activities`/`reports` have **zero tolerance** (activities can't be
  deleted at all per the rules, nothing deletes a report, and users go only by
  deliberate admin action), while
  `timeEntries`/`timesheets` tolerate `max(5, 20%)` since routine deletion is
  normal there;
- sends a Sentry **cron check-in**, so the job going *silent* is itself an alert.

Tune the thresholds in `DROP_RULES`. It always re-baselines, so a single bad day
alerts once rather than forever. Limitation: it compares run-to-run, so a slow
bleed of a few documents a day stays under the threshold — it is built to catch
sudden loss, which is what accidents and bad deploys look like.

**Remaining gap.** Beyond 14 weeks Firestore cannot retain natively; the cheap
mitigation is a deliberate export to Cloud Storage before a long break.
