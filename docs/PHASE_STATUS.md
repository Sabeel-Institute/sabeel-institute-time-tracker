# Phase status

Live build status. Phases from `docs/PRODUCT_BRIEF.md`; commit lands at each
phase boundary.

| Phase | What | Status |
|---|---|---|
| 0 | Repo + monorepo scaffold + CI green | **complete** (2026-07-15: CI green, 22 tests, hello screen verified on tb_emu AVD + web export) |
| 1 | Google auth + admin approval of users | **complete** (2026-07-15: web e2e + Android emulator verified; live claims-refresh un-gating works) |
| 2 | Activities CRUD | **complete** (2026-07-15: rules tests + web e2e) |
| 3 | Time entry (clock + manual) | **complete** (2026-07-15: 11 new rules tests + e2e clock/manual flow) |
| 4 | Timesheets (day/week) | **complete** (2026-07-15: epochFor tz tests + e2e edit/delete flow) |
| 5 | Reporting + CSV + statements | **complete** (2026-07-15: reporting integration tests + e2e CSV download + statement) |
| 5b | Drive sync (Sheet + CSV snapshots) | **removed 2026-07-25** — see the decision log |
| 6 | Polish + deploy readiness | **complete** (2026-07-15: auto-close + nudge, Sentry seams, deploy/secrets docs) |
| 7 | Weekly timesheets: submit/approve workflow | **complete** (2026-07-16: full lifecycle e2e green; deployed to prod; greenfield wipe done — 2 test users + 8 docs removed, admin kept, approver=self) |
| 8 | Push notifications (FCM) + overlap guard + activities rename | **complete** (2026-07-17: triggers for submit/decide/new-user + Tuesday-local weekly reminder w/ per-event prefs; overlap detection blocks submission; project/event distinction dropped; 85 emulator + 17 functions-unit + 33 shared tests + full e2e green) |

## Deploy log

Newest first, one entry per release, written with the version bump and
headed `### <YYYY-MM-DD> — <summary> — vX.Y.Z`: `npx sabeel-ci release` takes
the release's title and notes from it (`docs/DEPLOY.md`). Deploys that shipped
no app version carry no version in their heading.

### 2026-10-24 — A smaller website — v0.30.1

- **The website is smaller.** The build leaves out code the app never
  calls, including the parts of the error reporter it does not use, so a
  first visit downloads less.
- The browser tests run on the website exactly as it is built for release,
  so a part left out by mistake fails a test first.
- Nothing changes on the phone apps.

### 2026-10-23 — Web notifications open their page; Expo 57.0.30 — v0.30.0

- **Tapping a notification on the web opens its page**, in the open tab or a
  new one.
- **The website fills a phone's screen**: no white band under the app as the
  address bar slides away, and the buttons at the bottom stay in reach.
- **"Please update"**: when an old version is retired, the app asks for the
  update rather than misbehaving.
- **Android**: a request over a dead connection gives up within a minute and
  says so; the app no longer backs up its data, so after moving to a new phone
  you sign in again; the download is smaller; and the storage and "draw over
  other apps" permissions are gone, which nothing used.
- After a Google sign-in that fails, the next try opens the account chooser
  again, so a different account can be picked.
- Expo 57.0.30 and React Native 0.86.3 with the month's patch updates; the
  backend on firebase-admin 14; Android crash reports read as source in Sentry.
- The release APK on GitHub is the one Play signs, so it and a Play install
  update each other.

### 2026-10-21 — Dependency and security maintenance — v0.29.1

Functions (all 16) deployed from `08228dd`: an unauthenticated `reportTotals`
answered UNAUTHENTICATED and `probeQueries` read OK on all 13 lines. `npm run
release` now opens a pull request for the version bump and `--ship` builds the
merged commit, since main takes no direct pushes. **v0.29.1** released with it,
tag `v0.29.1` at `ba63147`: GitHub release; Play internal testing 0.29.1
(29001); TestFlight 0.29.1 build 1 from the tag; hosting from the Web
workflow's artifact through Deploy Web. Before the release, a debug build
against the emulators on the AVD: sign-in, the new rules wording and I agree,
an activity added, clock in and out, My timesheet, Reports, Approvals and
Users. The release APK booted five times in a row with no crash, no dev sign-in
row and `v0.29.1 · ba63147`.

### 2026-10-16 — The app's own Play signing key; the first TestFlight build — v0.28.0

**Play app signing key** changed from the Google-generated one to the app's own
release key (Change key, Export and upload a key from Java keystore, PEPK).
**v0.28.0** released, tag `v0.28.0` at `f387267`: GitHub release, download
page, hosting with `/privacy` and `/support`. Play internal testing: 0.28.0
(28000) a completed release, its Play-generated APKs signed with the app's own
key; the earlier 0.27.1 (27001) bundle left unreleased, its APKs
Google-signed. First TestFlight build (0.28.0, build 1) from the tag: built on
GitHub, uploaded at the sixth try (App Store Connect answered 500 or hung on
about one request in five that day; a 23-minute validation also hit the job's
30-minute limit, now 90, with altool retried), VALID and in internal testing.

### 2026-10-15 — Functions: accountExists, the sign-in gate, iPhone push

`accountExists` (native sign-in asks it first), the sign-in gate
`beforeSignUp`/`beforeSignIn` (registered with Identity Platform by the
deploy), and iPhone push sent to Apple directly (`apns.ts`, secret
`APNS_KEY`). Email/Password enabled once the gate was live. The review account
`apps-reviewer@oursabeel.com` made with the Admin SDK, approved as a member,
approver Faisal. The Android release signing key made; its SHA-1 and SHA-256 on
the Firebase Android app.

### 2026-08-29 — The notification channel and icon — v0.27.0, v0.27.1

The notification channel and icon; the dead "Miscellaneous" channels retired.
GitHub releases and the download page.

### 2026-07-16 — Phase 7 deploy

Indexes → rules → functions → one-time token-guarded `wipeForTimesheets`
(deployed, curled once, deleted) → hosting. `web:export` now always `--clear`s
Metro's cache (it can serve a bundle built under different `EXPO_PUBLIC_*` env
— an emulator-mode bundle must never ship). Live smoke: prod sign-in page
clean, no dev row, no console errors.

### 2026-07-16 — First live deploy

To `sabeel-institute-time-tracker`. Firestore rules + indexes, all 6 Cloud
Functions (us-central1, nodejs22), and Hosting
(https://sabeel-institute-time-tracker.web.app, HTTP 200). Functions are now
bundled with esbuild (commit de32168) so Cloud Build resolves the private
`@sabeel/shared` workspace package. The first admin promoted via a temporary
one-shot bootstrap function (deployed, called, deleted). OAuth consent screen
is **published** (any Google account can sign in; app admin-approval gates
access). **Pending:** the release keystore/SHA-1 for a shareable Android APK —
see `TODO.md`.

## Decision log

- 2026-10-28 — **An admin may delete an archived activity, and archived
  activities wait in a closed section below the list** (#62, #63). Deleting
  takes two steps, archive and then delete, and the rules hold it to admins and
  to archived activities, so nothing anyone is picking disappears from a picker
  under them. Entries carry `activityName`, so their timesheets and reports keep
  the name, and reports group by `activityId`, which needs no live activity. The
  daily health check counts activities among the collections that shrink in
  normal use (`max(5, 20%)`) instead of with zero tolerance.

- 2026-10-28 — **Editing an entry keeps the times it does not change** (#64).
  The edit form shows whole minutes and read both times back from them, so a
  clocked session inside one minute could not be saved (start equal to end),
  one past midnight ended before it began, and a note-only save moved any
  other session's ends down to the minute, sometimes taking a minute off its
  hours. `editedEntryTimes` (`packages/shared/src/entryForm.ts`) keeps each
  untouched time to the millisecond, and for an entry that already ends on a
  later day reads a To at or before From on the next day. Reproduced, then
  shown fixed, in the web app with times set by Playwright's clock: 20 s
  inside a minute, 20 s across one, 4 m 30 s, 5 m on whole minutes and 2 m
  across midnight.

- 2026-10-16 — **A slow account set-up is waited for, not refused; the report
  email reads well on a phone.** "Can't sign in" ("This app is for Sabeel
  Institute accounts only") used to follow ten seconds without a profile, which
  a cold start of `onUserCreate` can exceed: a genuine colleague was told the
  app was not for them. The app now waits 45 s on "Setting up your account…",
  asking Auth every few seconds whether the account still exists
  (`accounts:lookup`, `app/src/auth/accountLookup.ts`, not `user.reload()`,
  which signs the person out on the answer); a deleted account (the trigger's
  refusal) is refused within seconds, and anything else ends on "Still setting
  up your account. Try again in a minute." with Try again (a page reload on
  the web, the connection reopened on a phone, the wait over) and Sign out. An
  outside address deleted before sign-in even finishes now reads the same
  refusal on the sign-in screen instead of `auth/user-token-expired`. Proved
  by `app/src/session.test.ts`, red against the old session logic, and by the
  e2e holding the page's Firestore traffic; the old logic, run through the
  e2e, refused the admin's own first sign-in. The sweep's reload workaround
  became `settle` (`scripts/lib/e2e-stack.mjs`, both suites), which answers
  that screen with the app's own Try again: on a fresh emulator stack the
  first sign-in's Listen channel can stay silent until the page reloads,
  which no wait cures. The report email is
  multipart/alternative: plain text one line per paragraph (Gmail on a phone
  broke the fixed-width lines a second time) and plain HTML of the same
  content, the reporter's words escaped.

- 2026-10-16 — **The institute's rules and Report a problem** (the
  `sabeel-app-stores` skill, decision 4, decided by Faisal for every Sabeel
  app; `docs/STORE-RELEASE.md`, 4). An active account sees the rules once,
  after the pending gate and instead of the navigator, until I agree records
  `rulesVersion`/`rulesAcceptedAt` through the new `acceptRules` callable;
  the rules keep both fields out of client writes. Report a problem sits on
  Home beside Notification settings: one field and Send. The new
  `reportProblem` callable takes active accounts only, five reports an hour,
  keeps `reports/{id}` (no client access) and emails it from
  `apps-noreply@oursabeel.com` to `apps-reports@oursabeel.com`, Reply-To the
  reporter, by keyless domain-wide delegation as `report-mailer@`; a failed
  send is kept as `failed` and the person told so. Proved by 3 new
  integration and rules test files, 3 new unit test files and both browser
  suites, each denial shown red with its lock removed. Deploy order: rules, indexes and
  functions before the first build with the rules screen, plus the Token
  Creator grant (`docs/DEPLOY.md`). Not deployed or released yet. The
  emulator ports gained two pins (Eventarc 61007, Cloud Tasks 61008): the
  functions emulator starts both on 9299/9499 otherwise, and a sibling
  checkout's suite holding them failed this one's start.

- 2026-10-15 — **The iPhone app, and the phone apps stop creating accounts.**
  The app builds for iOS (`docs/IOS-BUILD.md`): on the build Mac, and on
  GitHub's macOS runners with manual signing (first green run 38842003528, a
  signed 17 MB `.ipa` whose entitlements, profile and commit stamp the workflow
  asserts). A TestFlight upload must be the commit tagged `v<version>`, so every
  version goes up once, as build 1. Two iPhone-only bugs found on the simulator
  and fixed: the Home title sat inside the Dynamic Island inset (Screen now pads
  by the safe-area insets; Android moves only on a status bar taller than 32dp),
  and the date/time field closed after one wheel column (`DateTimeField.ios.tsx`
  opens a sheet with Done). Then, for App Review, Faisal's standing rule that
  the phone apps never create an account: native sign-in asks the new
  `accountExists` callable first and refuses an identity with no account, the
  web keeps creating them, and `/privacy` and `/support` are static pages with
  the policy linked from the sign-in screen and Home (`docs/STORE-RELEASE.md`).
  Deploy order: functions before the first build that calls `accountExists`.
  **iPhone push**: an iPhone registers Apple's device token, which FCM cannot
  address, so the functions now send to Apple directly (`apns.ts`, HTTP/2, the
  team's `APNS_KEY`), routed per device in `messaging.ts` with FCM for the rest;
  one service failing does not undo the other, and the stale-token codes no
  longer include `invalid-argument`, which FCM also returns for a bad message
  and which would have unregistered everyone at once. The rules accept exactly
  two row shapes. Proved on the simulator with a real sandbox push whose banner
  tap opened the week it named. Nothing raises the notification prompt by
  itself any more: Home's card and the settings screen ask, from a press.
  **Review access** (Faisal, 2026-10-15): one email-and-password account,
  `apps-reviewer@oursabeel.com`, an ordinary member made by an admin with Faisal as
  its approver, behind a neutral "Sign in with email". Held there by the
  server: blocking functions on Identity Platform refuse every password sign-up
  and any other address's password sign-in; rules and callables never give a
  password session a manager or admin role; setUserAccess will not promote a
  password-only account (`docs/STORE-RELEASE.md`, "Review access").

- 2026-08-29 — **One notification channel id across all three Sabeel apps**
  (`sabeel-alerts`), each with its own display name — here "Timesheet alerts and
  reminders". Ids are namespaced per application, so sharing one costs nothing
  and makes the three read as one family in a phone's settings. Importance HIGH,
  fixed at creation: Android never lets an app raise it afterwards, which is why
  the old `'default'` channel was replaced rather than repaired, and deleted so
  it stops appearing as a switch that does nothing. Registration also retires the
  two channels the TRANSPORTS invented while no send named one —
  `fcm_fallback_notification_channel` and
  `expo_notifications_fallback_notification_channel`, both of which Android
  labels "Miscellaneous", so an upgraded phone showed two identical dead entries
  by that name. The manifest names PUSH_CHANNEL_ID as FCM's default channel, so
  nothing can recreate them.

- 2026-08-27 — **The layout sweep (`npm run test:screens`).** This repo's
  highest-value missing test, named as such in `CLAUDE.md`, now exists:
  `scripts/screens-e2e.mjs` tours every screen — 17 as an admin, plus the
  member's Home and two timesheet states, the non-admin manager's read-only
  Users and empty Approvals, and the pending gate — at **five widths straddling
  the 700px
  breakpoint** (320/390/700/1024/1440), asserting rather than screenshotting:
  the page never scrolls sideways, nothing extends past the right edge, no two
  same-layer controls overlap, every screen has a way out, native fields fit
  their own value, and the width produced the layout it should (breakpoint read
  from `theme/layout.ts`, never copied). Under-44px targets are reported, not
  failed. **It runs in CI** on Playwright's own Chromium, guarded by
  `functions/test/unit/ci-coverage.test.ts`; `web-e2e.mjs` and it now share
  their bring-up (`scripts/lib/e2e-stack.mjs`), which is also what moved
  `web-e2e` off a system Google Chrome.
  **First catch, on the first real run:** at 320px the Add-hours **date field
  was squashed to "08"** — `flex: 1` on its wrapper set flexBasis to 0 while the
  two shortcut buttons refused to shrink. It is perfect at 390px and above,
  which is the argument for straddling a breakpoint rather than picking one
  reasonable width. Fixed by letting that row wrap. Rules, data model and every
  other screen unchanged.

- 2026-07-31 — **Shipped: v0.26.0 — the app icon.** All three Sabeel apps now
  share one calligraphic mark with a Dark Raspberry badge per app (stopwatch
  here). Generated by the shared `scripts/make-app-icons.py` in the kanban repo;
  see `docs/BRAND.md` for the rules, including why `expo prebuild` must not be
  used to regenerate them and why the `res/` mipmaps are part of the commit
  rather than droppable build output.
  - Verified rather than inferred: re-running the generator produced
    **byte-identical** files (so what is committed really is generator output,
    and it is reproducible); the safe-zone invariant holds with all ink at 338
    of the 341 radius; and an independent pixel measurement found the only
    content outside the 72dp circle is the badge's ivory keyline — `#F6EBDD` on
    an `#F6EBDD` background, so a circular mask clipping it is invisible.
  - Confirmed by **installing the release APK and looking at the launcher**,
    which is the only proof available: resource shrinking renames every icon to
    `res/-6.webp`, so the APK listing shows nothing. Kanban and Time Tracker sit
    next to each other in the drawer, clearly one family and clearly distinct.
  - Web: exported `index.html` carries `<link rel="icon" href="/favicon.ico"/>`
    and the live URL returns **200**, byte-identical to the freshly exported
    file (i.e. not a stale cached favicon).
  - First release to exercise the new tooling end to end: the download-page
    stamp came out in pinned Houston time (`31 July 2026, 1:04 PM CDT`) and the
    release stopped the Gradle daemon on its way out.
- 2026-07-26 — **Shipped: v0.25.0**, the first release under the new scheme and
  the proof of it: the universal APK installed straight over the AVD's
  `versionCode=24` build and reported `versionCode=25000 / versionName=0.25.0`,
  both derived from `app.json`. Hosting redeployed from the release commit
  (`0.25.0 · cccb9bd` on web and APK); download page updated. Release notes lead
  with why the number looks smaller, since every user sees it.
- 2026-07-26 — **Store-legal versioning, ahead of iOS.** Adopted the sibling
  kanban app's rule: the version is exactly `X.Y.Z` with one source of truth
  (`app/app.json` → `expo.version`). Apple's `CFBundleShortVersionString` takes
  at most three numeric components, so `1.0.0-beta.24` could never have shipped
  to the App Store — and nothing on Android would have said so until submission,
  by which point the version is tagged, built and installed.
  - **`1.0.0-beta.24` → `0.24.0`, and the next release is `0.25.0`.** Staying on
    the `0.x` train is the honest signal (still pre-1.0) and matches the kanban
    app. The 24 carries the release count across.
  - **versionCode is now derived**, `major*1000000 + minor*1000 + patch`
    (`0.24.0` → 24000). Three digits per field, because the common two-digit
    scheme collides (`0.1.100` and `0.2.0` both give 200) and Android then
    refuses the upgrade. The jump from a hand-incremented 24 to 24000 increases,
    so beta.24 installs upgrade cleanly; it is one-way (narrowing the
    multipliers later would break upgrades).
  - Gradle no longer carries its own `versionName`/`versionCode` — two copies
    desync silently, and every release then reports the same version to Sentry.
  - Enforced in three places that each catch what the others cannot:
    `scripts/check-version.mjs` (from lint/CI and `web:export`, for a web-only
    release that never runs Gradle), `build.gradle` (fails even if nobody ran the
    script), and `release.mjs` (refuses a version whose versionCode does not
    increase). The validator self-tests against the shapes it exists to stop on
    every run — which is how it caught that `^\d+\.\d+\.\d+$` accepts
    `2026.07.01`, where `07` and `7` are the same number. Leading zeros are now
    rejected outright, a step stricter than the kanban implementation.
  - Still outstanding for iOS: `CFBundleVersion` (the build number) is a
    separate scheme and cannot just mirror `versionCode`. See `TODO.md`.
- 2026-07-26 — **Shipped: v1.0.0-beta.24** (notification tap routing). Deployed
  `functions` (11 updated; no rules/index change in this diff) and `hosting`;
  APK verified production-mode on the AVD, GitHub release + public download page
  published. Web and APK carry the same stamp (`1.0.0-beta.24 · 52a898a`), and
  the deployed web bundle was confirmed to contain the VAPID key and the
  service-worker registration — without both, the web half of tap routing is
  inert.
- 2026-07-26 — **Notification taps route to the screen they are about.** Every
  push now carries its destination, encoded once in `@sabeel/shared` as flat
  string key/values and shipped over both transports: an FCM `data` map on
  Android, the query string of `webpush.fcmOptions.link` in the browser (a web
  push click can only open a URL). A tapped route is **queued** until the
  navigator is ready and the session is known — a cold-start tap lands seconds
  before auth resolves — and dropped if the destination is an approver-only
  screen the account no longer has. Screens that seed state from a param
  (`Timesheet`, `TimesheetReview`) now re-anchor when the param changes;
  `navigate()` to a mounted screen swaps params without remounting, so without
  that a second tap left you on the previous week. Verified on the AVD with a
  local notification carrying the same payload: cold start (process killed),
  warm tap, re-target of a mounted screen, and a plain launch that must NOT
  route. Web transport is covered in `web-e2e` (right week, approver-only route
  dropped for a member, query stripped, garbage → Home). FCM's own hop remains
  the one untestable link.
- 2026-07-26 — **Shipped: v1.0.0-beta.23** (both hardening passes). Deployed
  `firestore:rules,firestore:indexes,functions,hosting`; `onTimesheetWritten`
  created, so timesheet history starts accruing from this deploy — transitions
  before it are unrecoverable. APK verified production-mode on the AVD, GitHub
  release + public download page published, hosting redeployed from the release
  commit so the web and APK build stamps match (`1f1aa60`). `probeQueries`
  all-OK in prod across 12 shapes, including the two new `users` ones.
- 2026-07-26 — **Second hardening pass (A1–A8), emulator-driven.** Prompted by
  M5b: if one "validated once, never revisited" bug existed, how many more?
  Hypotheses were **run against the rules**, not reasoned about — ten probes,
  eight confirmed gaps. Fixed: on-behalf entries stamped the *writer's* timezone
  instead of the target's (A1, straight contradiction of the work-local
  invariant); `closeStaleSessions` could rewrite an approved timesheet's hours
  silently, since the admin SDK bypasses the period lock (A2); withdraw/reopen
  **deleted** the doc and with it the record that a period was ever approved —
  now an append-only `timesheetEvents` written by a trigger (A3); losing access
  didn't revoke refresh tokens (A4); the weekly reminder skipped users with no
  timezone in silence (A5); a batch of rules gaps confirmed permitted before
  being closed (A6); overlap detection couldn't see overnight collisions (A7);
  session snapshots could emit out of order (A8). L11 upgraded from "accepted,
  inherent" to a real bound — rules can't do tz math, but they *can* require
  `start` to lie within [dayKey − 14h, dayKey + 36h), which covers every UTC
  offset. **That check immediately exposed a year of drift in our own fixtures**
  (`T0` was 2025-07-15 paired with 2026 dayKeys). Details and residuals in
  `docs/PRODUCTION-REVIEW.md`. 111 emulator + 47 unit + e2e green.
- 2026-07-25 — **Self-approval formalised; approver authority now expires with the
  role.** Managers and admins alike may be their own timesheet approver
  (PRODUCTION-REVIEW **M5**, flipped from ❎ won't-fix to ✅ by design): flexibility
  beats enforced second-party review at this org size, and it is the only exit
  from having no eligible approver — the dead end hit for real on 2026-07-19.
  Rules had *always* permitted it; only two client filters enforced the old
  policy, so rules and UI disagreed. Filters removed; self now sorts last in the
  picker, labelled "(myself)", so choosing it stays deliberate. Deliberately NOT
  changed: the admin-only auto-fallback (self-approval is chosen, never
  defaulted), and the submitted-period freeze — `canTouchPeriod` excludes the
  owner outright, so a self-approver still withdraws rather than editing in place
  (now pinned by a test, with a positive control). **Bug found and fixed in the
  same batch (M5b):** `approverUid` was validated only when written, never again,
  so a demoted or disabled manager kept deciding every sheet stamped to them —
  their own included. DECIDE now revalidates `isManager()`, and `applyUserAccess`
  clears every pointer at an account losing eligibility (self-pointer included),
  the same orphan class that had to be hand-cleaned on 2026-07-19. 8 new emulator
  tests (98 total, green).
- 2026-07-25 — **Native Firestore disaster recovery enabled** (replaces the Drive
  sync as the actual safety net). Two complementary layers, both Google-managed,
  no code to rot:
  - **PITR** — rolling **7-day** rewind to any microsecond. Covers "someone
    deleted it this morning."
  - **Weekly scheduled backup, Mondays, 98-day (14-week) retention** — the
    maximum Firestore allows. Covers "we noticed in September that something
    broke in July."
  Cost is negligible at this data size (~200 KB), but note PITR/backup data are
  **excluded from the free tier**, so they appear as (sub-cent) billed line items.
  Beyond 14 weeks Firestore cannot retain natively — an export to Cloud Storage
  would be needed; deliberately deferred, with a manual pre-summer archive as the
  cheap alternative. **Known gap:** nothing yet *detects* a problem, so discovery
  can still outrun retention — **closed the same day** by the `healthCheck`
  canary (`functions/src/health.ts`): a daily document-count check that raises to
  Sentry on an unexpected drop, plus a Sentry cron check-in so the job's own
  silence alerts. Thresholds live in `DROP_RULES`; see `docs/DEPLOY.md`.
  **Delete protection ENABLED** too — the whole database cannot be deleted
  without explicitly disabling it first.
- 2026-07-25 — **Google Drive sync removed entirely** (Phase 5b reverted). It was
  a *mirror*, not a backup: one live Sheet rewritten nightly (so a deletion
  propagated within 24h), approved-hours-only, and covering time entries alone —
  no users/activities/timesheets. A weekly timestamped full-snapshot design was
  scoped and then dropped in favour of removing the feature rather than leaving a
  half-useful one lingering. Deleted: `drive.ts`, `driveRows.ts`, their two test
  suites, `syncToDrive`/`syncDriveNow` (also deleted from production), the
  `googleapis` dependency, `DRIVE_*` config, the Reports "Sync to Google Drive
  now" button, and the e2e beat. **Kept:** in-app CSV export, report totals and
  person statements — those are reporting, not backup. Undo steps for the Drive
  folder/service-account share are in `TODO.md`. Replaced the same day by native
  Firestore protection (below) — which is what a backup should have been.
- 2026-07-24 — **Greenfield cleanup pass** (auth architecture + reporting dedup).
  Standing principle recorded in CLAUDE.md: no backwards-compat; converge on the
  global-optimal, never band-aids. **Auth/provisioning made server-authoritative**
  (kanban parity): the `onUserCreate` trigger is now the SOLE provisioner (sets
  pending claims + creates the doc via the pure `decideProvision`, or deletes a
  non-org account); `firestore.rules` users `allow create: if false` and the
  `isOrgEmail()` helper is deleted — the domain check lives once, in shared
  `isAllowedEmail`. The client (`session.ts`) is now a watch-only state machine
  (`loading/signedOut/provisioning/notProvisioned/signedIn`) that un-gates on a
  `claimsUpdatedAt` stamp instead of a 3s poll, with a real "can't sign in" screen
  for rejected accounts. New `provision`/`authTrigger` tests; the rules
  self-registration tests collapse to "client create denied". **Reporting dedup:**
  one `ReportFilter`/`Totals` contract + one `REPORT_COLUMNS`/`reportRow`
  projection in `@sabeel/shared`, consumed by the client and the CSV export
  (removed the drifted hand-mirrors). Plus stale doc/comment fixes.
- 2026-07-24 — **Sign-in restricted to the @oursabeel.com domain** (deployed).
  Mirrors the sibling kanban app. A gen-1 `onUserCreate` auth trigger
  (`functions/src/authTrigger.ts`) deletes any account whose verified email is
  not `@oursabeel.com`; `firestore.rules` gains `isOrgEmail()` and gates user
  self-registration on it (defense-in-depth so a non-org account can't even
  create an orphan pending doc); the client passes Google an `hd`/`hostedDomain`
  hint (UX only). `isAllowedEmail` lives in `@sabeel/shared` (exact-domain match,
  unit-tested). Dev/e2e sign-in emails moved to `@oursabeel.com` since the gate
  applies against the emulator too. Rules + trigger deployed; 91 emulator tests
  (incl. new domain-gate cases) + full e2e green. **Also this session:** removed
  the 5 remaining non-org (test/personal) accounts completely — auth, profiles,
  entries, timesheets, push tokens — via a temp deploy→curl→delete function, and
  set khadija (whose approver was a removed account) to self-approve. Roster is
  now 8 `@oursabeel.com` accounts, 4 of them admins.
- 2026-07-22 — **Responsive wide/desktop layout** (client-only, not yet released).
  The phone-first web surface no longer renders as a stretched phone on a laptop.
  Keyed off available WIDTH, never platform (`app/src/theme/layout.ts`, `useLayout`,
  700px breakpoint — matches the sibling kanban app). `Button` de-stretches to hug
  its label on wide (full-width bar stays on phone); `Screen` gained a
  `width` variant (`read` 640 / `content` 840 / `list` 1160 / `full`) that caps and
  centres the column; `CardGrid` flows the Users/Approvals/Needs-attention cards
  into multiple columns on desktop, one column on a phone; native date/time inputs
  hug their value (`fieldSizing`). Verified at 1500px and 420px past auth; phone
  layout unchanged (full e2e green). Ships in the next APK/hosting release on
  Faisal's go.
- 2026-07-22 — **Production hardening (v1.0.0-beta.15)** from the 2026-07-21
  review (`docs/PRODUCTION-REVIEW.md`): React error boundary (H1); rules tie
  `durationMinutes` to the logged span (M2); admin implies full manager access —
  reports/activities (M3); CSV formula-injection guard (M4); web security headers
  (`X-Frame-Options: SAMEORIGIN` etc., M6); completed the index probe (M7); patched
  a high transitive vuln (L8). M5 (manager self-approve) is **won't-fix** for a
  very small org; L9 deferred; L10/L11 accepted. No outage blockers — the app was
  already live.
- 2026-07-21 — **Brand palette → "Option 1"** and theme restructured to match the
  kanban app. Raspberry #82163A→#83114F (brick red→plum), gold #D09749→#C6A15B.
  Flat `app/src/theme.ts` replaced by `app/src/theme/{palette,index}.ts` (raw
  values + semantic tokens + `useTheme()`/`getTheme()`); ~19 import sites and the
  print stylesheet + manual-PDF generator migrated. No dark mode (light-only,
  pinned). Hardcoded colors now ESLint-banned under `app/**` (theme + print
  exempt). Authority: `docs/BRAND.md` and the shared `sabeel-color-scheme` skill.
- 2026-07-17 — **Activities are just names**: the project/event `type` field is
  gone from UI, rules, and types (existing docs may carry a vestigial field —
  ignored). Admins/managers encode whatever taxonomy they want in the name.
- 2026-07-17 — **Notifications (Phase 8)**: FCM push on Android + web; events =
  rejected/approved (owner), submitted/resubmitted (stamped approver), new
  pending account (admins), plus a submit reminder covering the previous
  period — first at Tuesday 10:00 local time, then daily until submitted
  (2026-07-17 refinement) — sent only when the period has unsubmitted hours or
  a rejected sheet. Per-event opt-outs (`notifPrefs`, missing = on)
  with the reminder separately silenceable. Same-day overlapping entries are
  flagged in the UI and block submission (back-to-back is fine) — client-side
  only; approvers see the same highlight.
- 2026-07-16 — **Timesheet workflow supersedes the honor system** (Phase 7):
  Sun–Sat calendar-week periods clipped to month boundaries; users submit each
  period; a sticky self-chosen approver (any active manager/admin; assignable by
  managers/admins too, stamped at submission) approves or rejects with reason;
  approved = locked, admin-only reopen (delete = back to draft); zero-hour submits
  OK, mid-period submit of the current week OK, never future periods; reporting/
  CSV reporting counts approved timesheets only (manager opt-in unofficial view).
- 2026-07-16 — Admin grants move in-app (Manage users); self-demotion still
  blocked server-side. Greenfield wipe at deploy: all data + users except the
  admin.
- 2026-07-15 — Approval is **admin-only** (Faisal): no org-domain auto-approval;
  every new sign-in is pending; admins see name+email when approving. Managers are
  operational only (activities, reports, entry corrections).
- 2026-07-15 — Phone-first for everyone including managers; web = big screen/print.
