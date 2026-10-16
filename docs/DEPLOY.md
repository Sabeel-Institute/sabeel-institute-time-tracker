# Deploy guide

Everything through Phase 5b runs against the Firebase emulators with no real
project. Deploy is the point where the human console steps in `TODO.md` must be
done first. Prerequisites: complete the Firebase/GCP/OAuth items in `TODO.md`,
then update `.firebaserc` with the real project id.

## One-time
1. `TODO.md` — create the Firebase project (Blaze), enable Google sign-in, register
   the Android + Web apps, wire SHA-1s and `WEB_CLIENT_ID`, download
   `google-services.json`.
2. `firebase functions:secrets:set SENTRY_DSN` (optional until launch).

## Deploy
```sh
# Rules + indexes + functions + hosting (web). Predeploy builds the web bundle.
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
```
- Hosting serves `app/dist-web` (built by `npm run web:export -w @sabeel/app`, run
  automatically by the hosting predeploy hook in `firebase.json`).
- **Run `npm run check:web-push` before the hosting deploy.** The VAPID key
  reaches the bundle from `EXPO_PUBLIC_FCM_VAPID_KEY` in the environment that
  runs the export. Miss it and nothing fails: the client is inert by design, so
  the build succeeds, the site deploys, and every device quietly reports that it
  cannot receive notifications. The check reads the exported bundle and refuses
  when the key is absent or the wrong shape.
- Indexes: the composite indexes in `firestore.indexes.json` deploy with the above;
  first queries will error until they finish building (a few minutes).

## First admin (after first deploy)
Sign in once with your Google account (lands pending), then:
```sh
GCLOUD_PROJECT=<real-project-id> node scripts/grant-admin.mjs you@example.com
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
#     before signing in (docs/STORE-RELEASE.md, "Deploy order")
firebase deploy --only functions --project dev

# 1. cut it — version is X.Y.Z, no suffix, and must increase (see check-version.mjs)
npm run release -- 0.26.0 --notes notes.md

# 2. deploy the web from the commit the release just pushed
firebase deploy --only hosting --project dev
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
differently. It never makes the app's first release: that one is made in Play
Console, where the app signing key is chosen (`TODO.md`), and an upload through
the API first would have Google generate a key of its own, for good. Everyone on
the "Sabeel staff" tester list gets each release from Play; the join link never
changes. The publishing key is in `docs/SECRETS.md`.

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
  commit the remote already has. Left to a later manual push it tagged the
  commit *before* the release — v0.26.0 and v0.27.0 both shipped that way, and
  nothing disagreed except `git rev-parse`.
- Deploying hosting before the push would stamp the web build with a commit that
  is not on `main`, and the sign-in footer would disagree with the APK. Both
  surfaces must read `v<version> · <same hash>`.

Everything before the push is local, so a failed build or AVD check still
recovers with `git reset --hard HEAD~1`.

The sign-in gate (`beforeSignUp`, `beforeSignIn`) registers with Identity
Platform when the functions deploy. Email/Password stays disabled until it is
live, so the provider is never open without the gate; the one password account
is then made with the Admin SDK (`docs/STORE-RELEASE.md` § 7).

After a functions deploy, `npm run check:push` asks FCM and Apple whether they
accept a message from the project (needs Google credentials for FCM and
`gcloud` access to the `APNS_KEY` secret).

The iPhone build of the release is the iOS workflow started on its tag
(`docs/IOS-BUILD.md`, "Releasing to TestFlight").

### After shipping
- Download page shows the new version **and a fresh timestamp** (Pages lags ~1 min):
  `curl -s "https://faisal-shah.github.io/sabeel-time-tracker/?cb=$RANDOM" -H 'Cache-Control: no-cache' | grep -A1 'Current build'`
- Both surfaces agree: the web bundle's `BUILD_INFO` matches the APK's.
- Record the deploy in `docs/PHASE_STATUS.md`.

Signing: release builds (the APKs and the Play bundle) sign with the app's own
key, `~/keystores/sabeel-time-tracker-release.jks`, named by
`~/.config/sabeel-time-tracker/keystore.properties` (`app/android/app/build.gradle`
refuses to package a release without it). Google Play signs with the same key,
uploaded as its app signing key, so a Play install and an APK from the download
page update each other. Builds before this were signed with the public debug key:
a phone that has one must uninstall it once before installing a release-signed
build (Android refuses an update signed by another key); nothing is lost, all
data is in Firestore. Both keys' SHA-1s are on the Firebase Android app, so
Google sign-in works on either.

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
The functions emulator accepts connections on 5001 *before* it registers any
function; until then calls 404, and a 404 carries no CORS headers, so the browser
blames CORS and the app shows a bare `internal`. It is a startup race, not a
callable bug. `scripts/web-e2e.mjs` now waits for a known callable to exist
(`waitForFunctionRegistered`) rather than for the port to answer.

## Verify after deploy
- **Query/index probe** (REQUIRED after any change to `firestore.indexes.json`
  or to a query shape — the emulator does NOT enforce composite indexes, so
  only production can confirm them):
  `curl "https://us-central1-<project>.cloudfunctions.net/probeQueries?token=$PROBE_TOKEN"`
  (token in `functions/.env`; every line must read `OK`). Keep the shapes in
  `functions/src/probe.ts` in sync with the app's queries.
- Emulator suite still green locally: `npm test && npm run test:emulator`.
- Smoke the live site: sign in, get approved, clock in/out, add manual hours, check a
  report + CSV export.

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
firebase firestore:databases:get "(default)"          # PITR state
firebase firestore:backups:schedules:list             # schedule + retention
firebase firestore:backups:list                       # actual backups taken
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
  `users`/`activities` have **zero tolerance** (activities can't be deleted at
  all per the rules; users only by deliberate admin action), while
  `timeEntries`/`timesheets` tolerate `max(5, 20%)` since routine deletion is
  normal there;
- sends a Sentry **cron check-in**, so the job going *silent* is itself an alert.

Tune the thresholds in `DROP_RULES`. It always re-baselines, so a single bad day
alerts once rather than forever. Limitation: it compares run-to-run, so a slow
bleed of a few documents a day stays under the threshold — it is built to catch
sudden loss, which is what accidents and bad deploys look like.

**Remaining gap.** Beyond 14 weeks Firestore cannot retain natively; the cheap
mitigation is a deliberate export to Cloud Storage before a long break.
