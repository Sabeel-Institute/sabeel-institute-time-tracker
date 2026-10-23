# Deploy guide

Automatic platform builds and manual release controls are documented in
[GitHub Actions](GITHUB-ACTIONS.md).

How the web app, the Cloud Functions and the Android app ship, from Linux. The
iPhone build and TestFlight are `docs/IOS-BUILD.md`; the store decisions (App
Store, Google Play) are `docs/STORE-RELEASE.md`; every key and gitignored file
is in `docs/SECRETS.md`.

Production is the Firebase project `sabeel-institute-time-tracker`, the
`default` alias in `.firebaserc`, so the `firebase` commands here name no
project.

The Firebase project belongs to Sabeel Institute's `oursabeel.com` Cloud
organization (`833557915874`), with `faisal.shah@oursabeel.com` as Owner
and Institute billing. Authenticate Firebase CLI, gcloud and Application Default
Credentials separately as the Institute account.

Domain-restricted IAM sharing applies. Existing public callable endpoints are
reachable; new public invoker bindings may require an approved policy exception.
OAuth consent is External and published.

Repository: `Sabeel-Institute/sabeel-institute-time-tracker`. Local clone:
`/home/faisal/repos/Sabeel-Institute/sabeel-institute-time-tracker`. Secrets are backed up
in `~/.config/secrets-vault/`, with live paths in `sources.tsv`. Copy and
verify secrets when setting up a clone; deleting originals requires express
approval.

## Access and local configuration

**Access.**
- GitHub: write access to `Sabeel-Institute/sabeel-institute-time-tracker` (push,
  releases and Actions); `gh auth login`.
- Firebase / Google Cloud: deploy rights on `sabeel-institute-time-tracker`
  (`firebase login`); `gcloud` with Application Default Credentials for
  `grant-admin.mjs` and `check:push`.
- Google Play Console: a user on the app, for testers and App integrity.
  Uploads go through the publishing service account, not a login.
- App Store Connect: a user on the app, for TestFlight testers
  (`docs/IOS-BUILD.md`).

**Clone.**
- `/home/faisal/repos/Sabeel-Institute/sabeel-institute-time-tracker`.

**Files outside git.** Each has a copy in the vault, `~/.config/secrets-vault/`
(`docs/SECRETS.md`).

| File | Without it |
|---|---|
| `~/.config/sabeel-time-tracker/sabeel-time-tracker-release.jks` and the `keystore.properties` beside it | Gradle refuses to package a release |
| `~/keys/sabeel-play-publisher.json` (or `PLAY_KEY`) | `sabeel-ci publish-play` stops; the rest of the release stands |
| `app/.env.local` (`EXPO_PUBLIC_SENTRY_DSN_NATIVE`, `EXPO_PUBLIC_SENTRY_DSN_WEB`) | the Play bundle and the iPhone build refuse to build, since each would ship with crash reporting off; a hand-run web export ships with it off |
| `app/.env.sentry-build-plugin` (`SENTRY_AUTH_TOKEN`) | the Play bundle and the iPhone build refuse to build, since their crashes would reach Sentry as minified frames |
| `functions/.env` (`PROBE_TOKEN`) | a functions deploy leaves `probeQueries` refusing every call |

**Tools.** Node 22.18 or later, JDK 17 as the default `java` (Gradle, and
`jarsigner` and `keytool` for `sabeel-ci publish-play`), JDK 21 for the
emulators, the Android SDK and the `tb_emu` AVD: the bootstrap installs them.
Also `firebase` (firebase-tools 15), `gh`, `unzip`, and for the manual PDF that
`npx sabeel-ci release` re-renders (`npx sabeel-ci render-manual`): `uv` and
`google-chrome`.

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
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
```
Functions deploy from GitHub too, and that is the usual way: **Deploy
Functions** (`functions-deploy.yml`, `docs/GITHUB-ACTIONS.md`) deploys main
after CI has passed on it, refuses a deploy that would delete a live function,
and afterwards checks every callable, `probeQueries` and the error logs. It
needs no local Google login. The same guards run here:
```sh
export FIREBASE_PROJECT_ID=sabeel-institute-time-tracker PROBE_TOKEN=…   # functions/.env
npx sabeel-ci ci-functions require-ci && npx sabeel-ci ci-functions plan
firebase deploy --only functions
npx sabeel-ci ci-functions verify --since <the time the deploy started, ISO>
```
- Hosting serves `app/dist-web`, which the hosting predeploy in `firebase.json`
  rebuilds (`npm run web:export -w @sabeel/app`) on every hosting deploy.
- **Web push's public key is committed** (`VAPID_PUBLIC_KEY` in
  `app/src/firebase-config.ts`; the browser needs it to subscribe, so it is
  public by design). `npm run check:web-push` reads `app/dist-web` and refuses
  an export without it or without the permission path; the Web build runs the
  same check on every build.
- A hand-run hosting deploy publishes no source maps: Deploy Web
  (`docs/GITHUB-ACTIONS.md`) is the path that uploads the web build's maps to
  Sentry before it publishes the site.
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

`android/` is committed (no EAS); the build is local. **Do not run the
Gradle/`gh release` commands by hand** — `npx sabeel-ci release` (ci-tools)
encodes the steps and the checks, and skipping it is how versions and stamps
drift apart. The version scheme: X.Y.Z, no suffix, written only in
`app/app.json`; Android's versionCode and the iOS build number are both
`major * 1000000 + minor * 1000 + patch` (0.29.1 is 29001), and each version
must be above main's and every released tag's.

```sh
# 0. CI green on main
npm run verify                       # lint (incl. version check) + typecheck + knip + unit

# 0b. server code the new app calls goes live FIRST (a callable the app has not
#     got yet fails every use of it): e.g. accountExists, which native sign-in asks
#     before signing in, and acceptRules, without which nobody gets past the
#     rules screen (docs/STORE-RELEASE.md). Rules and indexes with them: the
#     reports index serves reportProblem's five-an-hour count. Functions can
#     also go through Deploy Functions (docs/GITHUB-ACTIONS.md).
firebase deploy --only firestore:rules,firestore:indexes,functions

# 1. the deploy-log entry, heading first, kept outside the checkout (--ship
#    refuses an untracked file):
#      ### 2026-11-02 — <summary> — v0.30.0
#      <the release notes>
#    then the release pull request; Faisal merges it once its checks pass
npx sabeel-ci release 0.30.0 --notes ../v0.30.0.md

# 2. ship the merged commit from main: build, AVD check, tag, Play internal
git switch main && git pull --ff-only
npx sabeel-ci release --ship

# 3. the web and the iPhones, from the same commit: the two runs --ship prints
gh workflow run web-deploy.yml -f build_run_id=<the Web run for that commit> -f deploy=true
gh workflow run ios.yml --ref v0.30.0 -f testflight=true    # with Faisal's go-ahead
```

`npx sabeel-ci release X.Y.Z --notes <entry>` works from origin/main in a
worktree of its own: it writes the version and the iOS build number in
`app/app.json`, moves the manual's version line and renders the manual PDF,
adds the entry to the deploy log in `docs/PHASE_STATUS.md`, commits that on
`release/vX.Y.Z`, pushes the branch and opens the pull request, titled and
described by the entry. `--dry-run` shows the change and leaves nothing behind.

`--ship`, on main after the merge, refuses unless main is clean and matches
origin/main, then builds the AAB and both APKs, checks Play's permission,
cold-starts the production APK on the AVD (booting it when no device is
attached), creates the versioned Institute GitHub release with its tag on that
commit, titled and described by the deploy-log entry, and publishes to Play
internal testing. No personal website or Pages credentials are required.

The tag targets the verified build commit. Deploy backend changes before their
clients; web hosting and iOS use that same release commit.

`npx sabeel-ci publish-play --check` checks the bundle and Play access;
`--internal` publishes it, checking version, commit and signing, including
Play's generated APK certificates, which must match
`release.appSigningCertificate` in `ci-tools.json`. Signing files are in
`docs/SECRETS.md`.

### Play testers

Add testers to the account-wide "Sabeel staff" email list and select it under
Internal testing → Testers for this app. Send them the opt-in link:
https://play.google.com/apps/internaltest/4701451587936876375
They must use the Google account on the list; later releases arrive as updates.

### After shipping

- Verify the live web and installed Android version/commit stamps.
- Check the intended release on Play internal testing.
- Run the iOS workflow on the release tag and check TestFlight when uploading.
- Complete the version's deploy-log entry in `docs/PHASE_STATUS.md` (written
  with the bump) with what shipped where, by pull request.

Android signing uses `~/.config/sabeel-time-tracker/sabeel-time-tracker-release.jks`,
named by `keystore.properties` beside it. Play signs
installed APKs with that same certificate.

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
firebase functions:delete setUserAccess exportCsv reportTotals --region us-central1 --force
firebase deploy --only functions
```
Verify: an unauthenticated `curl -X POST .../reportTotals -d '{"data":{}}'` should
return a Firebase JSON `{"error":{... "UNAUTHENTICATED"}}` (code ran), NOT a plain
Run "request was not authenticated" 403.

**First deploy of a Firestore-trigger function fails with "Permission denied
while using the Eventarc Service Agent".** Seen on 2026-07-17 deploying
`notifyNewUser`/`notifyTimesheet`: the deploy auto-enables Eventarc, but the
service agent's permissions take a few minutes to propagate. Not a config
error — wait 2–5 minutes and redeploy just the failed functions
(`firebase deploy --only functions:<name>,functions:<name>`).

**e2e: "internal" from a callable / "blocked by CORS policy" in the browser.**
The functions emulator accepts connections on its port *before* it registers any
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
firebase firestore:databases:update "(default)" --delete-protection DISABLED
```
Expect that step to be needed if you ever legitimately tear the database down —
it is a speed bump by design, not a bug.

Inspect:
```sh
firebase firestore:databases:get "(default)"   # PITR state
firebase firestore:backups:schedules:list      # schedule + retention
firebase firestore:backups:list                # actual backups taken
```

Restore (both are *new database* operations — they never overwrite in place, so
you restore then repoint, rather than clobbering live data):
```sh
firebase firestore:databases:restore \
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
