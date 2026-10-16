# Sabeel Institute Time Tracker — Implementation Plan

## Context

Faisal is building a time-tracking platform (Android app + website) for Sabeel Institute, a small nonprofit, to track and monitor volunteer hours — though by design it is a **general-purpose time tracker** (nothing volunteer-specific in the data model). Regular users clock in/out or enter hours manually against activities; admins approve new accounts; managers manage the activity list and run reports. The stack mirrors what Faisal already runs: tajweed-bytes-dev for the Firebase/monorepo/testing conventions, PineTimeCompanion for the one-Expo-codebase-multi-target pattern. New GitHub repo: **`sabeel-institute-time-tracker` (private)**, under `~/repos/faisal-shah/`. All project artifacts (docs, plans, protocols) live in that repo from creation onward.

## Decisions (settled with Faisal)

| Topic | Decision |
|---|---|
| Auth | Sign in with Google, restricted to the **@oursabeel.com** Workspace domain (mirrors the sibling kanban app), plus **one** email-and-password member account for App Review (`PASSWORD_ACCOUNT_EMAIL`, made by an admin; the server refuses every password sign-up and any other address's password sign-in, and never gives a password session a manager or admin role; `docs/STORE-RELEASE.md`, "Review access"). Provisioning is **server-authoritative**: the gen-1 `onUserCreate` function is the sole provisioner — it deletes any non-org account outright, or (for a verified org address) sets pending claims and creates a forced-pending user doc. The client never writes its own profile (`firestore.rules`: users `allow create: if false`); it only watches the doc. The domain gate lives once, in the trigger (shared `isAllowedEmail`); the client passes Google an `hd` hint (UX only). **Every** org account lands `pending` until an **admin** approves — no domain auto-approval (the approver sees the requester's name and email). **Accounts are created on the web only**: the phone apps ask the `accountExists` callable before `signInWithCredential` and refuse an identity with no account ("This account isn't set up for the app yet. Contact your administrator."), so neither store's in-app account-deletion requirement applies (`docs/STORE-RELEASE.md`). |
| Trust model | **Weekly timesheets with submit/approve** (supersedes the v1 honor system, decided 2026-07-16). Users log hours freely into the current period (Sun–Sat calendar week, clipped to month boundaries); they review and **submit** each period's timesheet; their sticky, self-chosen **approver** (an active manager/admin; assignment changeable by managers/admins too) approves or rejects with a reason. Approved periods are locked (admin reopen only). **Official reporting counts approved timesheets only** (managers get an explicit unofficial include-unapproved view). Managers/approvers can correct and add entries on a user's behalf. **Managers and admins may be their own approver and self-approve** (decided 2026-07-25 — flexibility over enforced second-party review at this org size; also the only way out of having no eligible approver). Approver eligibility is revalidated when a decision is made, and losing the role clears the pointers at you. |
| Scope | Generic time tracking; roles are member / manager (+ admin flag). **Admins** approve/disable users and change roles; **managers** create/archive activities, run reports, and correct entries. |
| Platforms v1 | Android app + responsive website from **one Expo codebase** (react-native-web, PineTimeCompanion-style). No iOS, no EAS. |
| Clock-in | Own device, anywhere; one active session per user; plus manual entry (start/end or duration) with activity + optional note. |
| Reporting | Dashboard totals, CSV export (person/activity/date filters), lifetime hours per person + printable statement. No email digests, no email at all in v1. |
| Usage reality | Everyone — managers included — primarily uses the phone app; the website is the occasional big-screen/printing surface. All manager screens are designed phone-first. |
| Timezones | Entries are bucketed/displayed in **the timezone where the work happened** (captured per entry). A volunteer in Singapore logging Monday hours shows as Monday, 9am–5pm local — never shifted into the viewer's timezone. |
| Repo | Private; GitHub Actions CI (light, fits free tier). |

## Architecture

npm-workspaces monorepo (tajweed conventions), but a **single Expo app** instead of separate mobile/web apps:

```
sabeel-institute-time-tracker/
├── package.json               # workspaces: packages/*, functions, app
├── tsconfig.base.json         # copy from tajweed (strict)
├── eslint.config.mjs          # copy from tajweed (flat config)
├── firebase.json              # functions + firestore + hosting(dist-web) + emulators; NO storage/remoteconfig/extensions
├── .firebaserc                # { "projects": { "dev": "<placeholder>" } }
├── firestore.rules / firestore.indexes.json
├── CLAUDE.md, README.md, TODO.md (human-only tasks), docs/
├── scripts/                   # emulator.sh, test-emulator.sh (from tajweed, --project demo-sabeel)
├── .github/workflows/ci.yml   # copy: lint / typecheck / unit / emulator tests
├── packages/shared/           # @sabeel/shared — types, time math, constants, entry validation
├── functions/                 # nodejs22 TS, Vitest unit + @firebase/rules-unit-testing integration
└── app/                       # @sabeel/app — Expo ~57, RN 0.86, react-native-web
    ├── app.json               # android package com.sabeelinstitute.timetracker; plugins: @react-native-google-signin
    ├── android/               # committed (local Gradle builds, no EAS)
    ├── App.tsx / App.web.tsx  # platform seams as needed (PineTimeCompanion pattern)
    └── src/…                  # React Navigation native-stack (as in PineTimeCompanion)
```

Key stack points:
- **Firebase JS SDK everywhere** (`firebase` package) — react-native-firebase doesn't support web. RN auth persistence via `initializeAuth` + `getReactNativePersistence` + `@react-native-async-storage/async-storage`.
- **Sentry** on all surfaces via a seam: `src/sentry.ts` (`@sentry/react-native`) / `src/sentry.web.ts` (`@sentry/react`); `@sentry/node` in functions with `defineSecret('SENTRY_DSN')` (copy `functions/src/sentry.ts` from tajweed).
- **Google sign-in seam**: `src/auth/google.ts` (native, iOS and Android: `@react-native-google-signin/google-signin` → ID token → `accountExists` → `signInWithCredential` only for an existing account) / `google.web.ts` (`signInWithPopup`, redirect fallback; creates accounts).
- Functions region us-central1 with `invoker: 'public'` — copy `functions/src/setup.ts` verbatim (codifies a real gen-2 callable 403 fix).
- Web deploy: `npx expo export --platform web` → `app/dist-web` → Firebase Hosting with SPA rewrite.
- **Push goes out through two services** (`functions/src/messaging.ts`): FCM for Android phones and browsers, and **Apple's push service directly for iPhones** (`functions/src/apns.ts`, HTTP/2 with the team's `.p8` key as the `APNS_KEY` secret), because an iPhone registers Apple's own device token, which FCM cannot address. An iPhone's row in `pushTokens` names the Apple service (sandbox or production) that issued its token. One service failing does not undo the other. Nothing asks for notification permission by itself: the Home card and the settings screen do, from a press (on iOS the prompt is one-shot).
- **Push notifications carry their destination**, so a tap opens the screen the notification is about. One shared encoding (`packages/shared/src/notifRoute.ts`) travels as flat strings over all three transports: an FCM `data` payload on Android, the `body` dictionary of an APNs payload on an iPhone (all expo-notifications hands the app there), and the query string of `webpush.fcmOptions.link` in the browser (which can only be handed a URL). The client parks a tapped route until the navigator exists — a cold-start tap lands seconds before sign-in resolves — and drops routes whose screen the account no longer has.
- **Both halves of an Android push name the same channel**, `PUSH_CHANNEL_ID` in `packages/shared/src/constants.ts`: the client creates it before handing over a token, the server sets `android.notification.channelId` on every send. A send that names none is not rejected — it lands in the transport's fallback, which Android labels "Miscellaneous" — so nothing errors and the channel the app made is addressed by nothing. All three Sabeel apps use the id `sabeel-alerts` (channel ids are namespaced per app). The small icon is a hand-written silhouette, `app/android/.../res/drawable/ic_notification.xml`, wired through four manifest meta-data entries — FCM's pair and expo-notifications' pair, since both display notifications here.

Reference files to copy/adapt (all under `~/repos/faisal-shah/tajweed-bytes-dev/` unless noted): root `package.json` (shared-first build scripts), `tsconfig.base.json`, `eslint.config.mjs`, `.github/workflows/ci.yml`, `firebase.json`, `firestore.rules` (claims-helper style), `functions/src/setup.ts`, `functions/src/sentry.ts`, `functions/vitest.config.ts`, `scripts/emulator.sh`, `scripts/test-emulator.sh`; from `~/repos/faisal-shah/PineTimeCompanion/`: `App.web.tsx` + `.web.ts` seam pattern, React Navigation setup, web export scripts.

## Firestore data model

Flat `activities` collection — just names (the project/event `type` distinction was dropped 2026-07-17: managers name activities however they like; hierarchy and categorization buy nothing at this scale).

```
users/{uid}
  displayName, email, photoURL
  status: 'pending' | 'active' | 'disabled'
  role: 'member' | 'manager'
  admin: boolean
  activeEntryId: string | null        # running clock session pointer
  approverUid: string | null          # sticky timesheet approver (active manager/admin)
  notifPrefs?: { rejected?, approved?, submitted?, newUser?, reminder? }  # missing = on
  timeZone?: string                   # last-seen device tz (weekly reminder scheduling)
  lastReminderPeriodKey?: string      # server-only reminder dedup
  createdAt, approvedAt?, approvedBy?
  rulesVersion?, rulesAcceptedAt?     # the institute's rules, accepted; server-written
                                      #   only (acceptRules); absent = rules screen first
  pushTokens/{token}                  # subcollection, owner-only: an FCM token (web/android), or Apple's (ios) with its apnsEnvironment
    token, platform: 'web' | 'android', updatedAt

activities/{id}
  name, description?
  status: 'active' | 'archived', createdAt, createdBy

timeEntries/{id}                      # top-level: managers query across users
  uid, activityId, activityName       # name denormalized for display/CSV
  start, end: Timestamp | null        # end == null ⇒ running
  durationMinutes?: number            # set on close; ABSENT while running (excludes from sums)
  timeZone: string                    # IANA tz captured from device at creation (work-local)
  dayKey: string                      # 'YYYY-MM-DD' of start in `timeZone` — the bucketing key
  periodKey: string                   # periodKeyFor(dayKey) — the entry's timesheet period;
                                      # recomputed canonically by rules (spoof-proof)
  source: 'clock' | 'manual'
  note?, autoClosed?, createdAt, updatedAt, lastEditedBy?

timesheets/{uid}_{periodKey}          # one doc per (user, period) once submitted; no doc = draft
  uid, periodKey, toKey               # Sun–Sat week clipped to the month (first/last may be partial)
  status: 'submitted' | 'approved' | 'rejected'
  approverUid                         # stamped from users/{uid}.approverUid at (re)submission
  submittedAt, decidedAt?, decidedBy?, rejectReason?
  totalMinutes, entryCount            # informational snapshot; live truth = the period's entries
  createdAt, updatedAt

reports/{id}                          # Report a problem; written by reportProblem only,
  app, uid, displayName, email, role  #   no client access; also emailed to apps-reports@
  text, createdAt, platform?, appVersion?
  mail: { status: 'pending' | 'sent' | 'failed' | 'skipped', messageId?, error? }

timesheetEvents/{id}                  # append-only history; server-written, no client access
  sheetId, uid, periodKey             # submit/approve/reject/withdraw/reopen all mutate or
  kind, actorUid, at                  #   DELETE the single timesheet doc, so without this the
  totalMinutes, entryCount            #   record of who approved a period — and that it was
  approverUid, rejectReason?          #   later reopened — would not exist anywhere
```

**Timesheet lifecycle**: submit = owner creates the doc (zero-hour OK; current week may
be submitted mid-period; never future periods); decide = stamped approver or any admin
(reject requires a reason); resubmit after rejection re-stamps the owner's current
approver; withdraw = owner deletes pre-approval; admin delete reopens anything.
Entry writes per period state: draft/rejected → owner + any manager/admin (on-behalf
creates are closed-only and flagged `lastEditedBy`); submitted → stamped approver +
admins only; approved → nobody. Exception: the owner may always close their own
running session (clock-out is never bricked).

**Timezone semantics** (Faisal's Singapore example is the spec): every entry carries the IANA timezone **the work happened in** — the device's when you log your own hours, and the *target user's* (`users/{uid}.timeZone`, refreshed on each active sign-in) when a manager logs hours on someone's behalf. Using the writer's zone there was a real bug (PRODUCTION-REVIEW A1): it recorded the wrong instant and could file the entry in the wrong week. `dayKey` is the local calendar date of `start` in that timezone, computed by a shared helper (`Intl.DateTimeFormat`-based, no date library). Timesheets and reports bucket by `dayKey` (string range queries), and times display in `entry.timeZone` with a tz label (e.g. "09:00–17:00 SGT") — so the manager in California sees Monday 9–5, not Sunday 9pm. Edits recompute `dayKey` via the same helper. Rules can't do tz math, but they do require `start` to lie within [`dayKey` − 14h, + 36h), which spans every real UTC offset.

**Totals** (dashboard, lifetime): Firestore aggregation queries (`getAggregateFromServer` + `sum('durationMinutes')`) on the fly — no counter docs; effectively free at this scale and running sessions are excluded automatically.

**Indexes** (`firestore.indexes.json`): `timeEntries (uid, dayKey DESC)`, `(activityId, dayKey DESC)`, `(uid, activityId, dayKey DESC)`, `(end, start)`; `activities (status, name)`; `timesheets (status, periodKey)`, `(approverUid, status)`, `(uid, periodKey)`, `(uid, status)`.

**Reporting scope**: `reportTotals`/`exportCsv` filter entries through the
approved-timesheet set (`${uid}_${periodKey}` membership) by default; `includeUnapproved`
is an explicit manager opt-in and marks the CSV filename `_unofficial`.

## Security rules (deny-by-default, tajweed style)

Roles via **custom claims** (`role`, `status`, `admin`) set only by the `setUserAccess` callable; user doc mirrors them for UI. Client refreshes token (`getIdToken(true)`) when its user doc disagrees with its claims.

- `users/{uid}`: **no client create** (`allow create: if false`) — the `onUserCreate` trigger provisions the forced-pending doc `{status:'pending', role:'member', admin:false, activeEntryId:null, approverUid:null, claimsUpdatedAt}` server-side; read = self, manager/admin, or (for manager/admin profiles) any active user — people must see the approver choices; self-update limited via `diff().affectedKeys().hasOnly(['activeEntryId','displayName','photoURL','approverUid','notifPrefs','timeZone'])` with the approver validated as an active manager/admin (`notifPrefs` a map, `timeZone` a string); managers may set any non-admin's `approverUid`, admins anyone's (that single field only).
- `activities`: read = any active user; create/update = manager; delete = never (archive only).
- `timeEntries`: read = owner or manager; writes gated by the covering timesheet's state (`canTouchPeriod`, one `get()` on `timesheets/{uid}_{periodKey}`) and `periodKey == periodKeyOf(dayKey)` recomputed in rules (pure integer date math — spoofing a periodKey cannot dodge a lock); clock-in create requires the same batch to set `users/{uid}.activeEntryId` (checked with `getAfter()`); on-behalf writes are closed-entries-only and must set `lastEditedBy`; the owner's clock-out carve-out bypasses the period lock but may touch only `end/durationMinutes/updatedAt`.
- `timesheets/{uid}_{periodKey}`: the full lifecycle state machine lives in rules (submit/resubmit/decide/withdraw/reopen — see the data-model section); the doc id must equal `uid + '_' + periodKey` so entry rules can `get()` it deterministically. Deciding revalidates the stamped approver as a *current* manager, so authority can't outlive the role.
- `meta`, `timesheetEvents`, `reports`: server-only (`allow read, write: if false`) — the canary's count baseline, the append-only timesheet history, and Report a problem's records. A client that could write the history could forge the record it exists to preserve; a report names who sent it and what they said about someone, and is for the administrators alone, who read it in their email.
- `users/{uid}.rulesVersion`/`rulesAcceptedAt` are in no client allow-list: accepting the institute's rules is recorded by the `acceptRules` callable only.
- One-active-session enforced by the `activeEntryId == null` precondition at clock-in; the rare race is harmless at this scale.

Rules tests with `@firebase/rules-unit-testing` (tajweed's exact harness).

## Cloud Functions (minimal)

1. `setUserAccess` (callable, **admin-only** — only admins approve/disable users or change roles) — writes user doc + custom claims atomically.
2. `exportCsv` (callable, manager) — filters `{uid?, activityId?, from, to}` (dayKey range), returns CSV string (well under the 10 MB callable limit).
3. `autoCloseStaleSessions` (scheduled hourly, Phase 6) — closes sessions running >12h at start+12h, `autoClosed: true`, clears pointer.
4. `acceptRules` (callable, active accounts) — records the institute's rules as accepted on the caller's profile (`docs/STORE-RELEASE.md`, 4).
5. `reportProblem` (callable, active accounts) — Report a problem: keeps `reports/{id}` (five an hour per account) and emails it from `apps-noreply@` to `apps-reports@`, Reply-To the reporter, by keyless domain-wide delegation (`functions/src/gmail.ts`).

Not functions: profile creation (client create under rules), totals (aggregation queries), statements (print view).

## Screens (one codebase — every screen works on every platform; everyone, managers included, is primarily on the phone, so all screens including manager tools are designed phone-first; web is the occasional big-screen/print surface)

- SignIn (Google button), Pending/Disabled gate screens
- Rules: the institute's rules, once per account, after the gate and before Home (I agree / Sign out)
- Report a problem (from Home): one field and Send
- Home: big Clock In/Out, activity picker, running-timer banner, today's total
- ManualEntry; Timesheet (day/week toggle, edit own entries); Account
- Manager: Users (pending approvals, roles), Activities (create/archive), Dashboard (totals per activity/person, week/month/year), Reports (filters → CSV), PersonDetail (lifetime hours + printable statement — web print CSS)

`packages/shared`: types, tz/dayKey/week-range helpers, `formatDuration`, entry validation mirroring the rules, collection-name and region constants.

## Phases (emulator-first; commit at each phase per working agreement)

- **Phase 0 — Repo + scaffold + CI.** Create private GitHub repo `sabeel-institute-time-tracker`, scaffold monorepo, copied configs, placeholder Firebase configs (committed placeholder `google-services.json` + `firebase-config.ts` so builds succeed), emulators boot, one trivial unit + rules test, CI green, hello-screen renders on `tb_emu` AVD **and** in the web export.
- **Phase 1 — Auth + approval.** Google sign-in seams (emulator-backed on web; device flow documented), self-created pending profile, gate screens, `setUserAccess` + claims + token-refresh-on-mismatch, Users screen. Rules tests: pending user locked out; self can't escalate.
- **Phase 2 — Activities.** Manager CRUD/archive, pickers. Rules tests for member-write denial.
- **Phase 3 — Time entry.** Clock in/out batches + `activeEntryId` + `getAfter` rules, manual entry with tz/dayKey capture, running indicator. Rules tests incl. one-active-session.
- **Phase 4 — Timesheets.** Day/week views via shared dayKey helpers; self-edit; manager corrections. Unit tests: dayKey/week math incl. DST transitions and a Singapore-entry-viewed-from-California case.
- **Phase 5 — Reporting.** Dashboard aggregations, `exportCsv` (emulator integration test with seeded entries), PersonDetail + printable statement.
- **Phase 6 — Polish + deploy.** `autoCloseStaleSessions` + long-session nudge, Sentry wiring, real Firebase project per TODO.md, release keystore + SHA-1s, `firebase deploy` (hosting + functions + rules), release APK.

## Verification

- Unit: Vitest in `functions/` and `packages/shared` (tz math especially).
- Rules/integration: `scripts/test-emulator.sh` → `firebase emulators:exec --project demo-sabeel`.
- Web: `expo start --web` (or export + serve) against emulators (`connectAuthEmulator` etc. behind an env flag); Playwright smoke later (PineTimeCompanion `web:e2e` pattern available).
- Android: build via `expo run:android` onto `tb_emu` (headless, `scripts/emulator.sh`), Firebase emulators reached at `10.0.2.2`; screenshot-verify via adb.
- CI: lint/typecheck/unit/emulator on every push (no Android build in CI, matching tajweed).

## Manual steps for Faisal (→ repo TODO.md; agent writes exact checklists, never touches consoles)

1. Create Firebase project (Blaze — required for Functions); enable **Google** as the only Auth provider; OAuth consent screen in GCP console.
2. Add Android app `com.sabeelinstitute.timetracker` with debug-keystore SHA-1 (+ release SHA-1 later); download `google-services.json` → `app/`.
3. Add Web app; paste client config into the committed config file; copy the **Web** OAuth client ID as `webClientId` (mobile Google Sign-In needs the *web* one — classic `DEVELOPER_ERROR` pitfall).
4. Sentry project + `firebase functions:secrets:set SENTRY_DSN`; web/app DSN in gitignored env.
5. Update `.firebaserc` with real project id; first deploy; seed first admin (sign in once, then `scripts/grant-admin.mjs` one-time promotion run by Faisal).

## Risks / gotchas

- Android Google sign-in `DEVELOPER_ERROR` = SHA-1/webClientId/stale `google-services.json` — documented in TODO.md.
- Stale claims after approval → doc-vs-token mismatch triggers forced token refresh.
- `getAfter()` clock-batch rules are fiddly — heavy rules-test coverage in Phase 3.
- After adding the google-signin config plugin, run `expo prebuild --platform android` once, commit the `android/` diff, then avoid gratuitous prebuilds.
- Aggregation queries need the same composite indexes as their filters — declared up front; emulator surfaces gaps early.
- Firebase JS SDK on RN: must use `initializeAuth` with AsyncStorage persistence before any `getAuth()` call.
