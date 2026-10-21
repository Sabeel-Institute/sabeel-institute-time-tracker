# Sabeel Institute Time Tracker — Working Rules for Claude

## What this project is

Hours tracking for Sabeel Institute (small nonprofit): clock in/out + manual
entries against activities, admin-approved Google sign-in, and reports. Faisal is
the developer; the nonprofit's staff are the admins/managers in the app.

**It is in production and the team uses it.** Live at
`sabeel-institute-time-tracker.web.app` since 2026-07-16. Android: the APK from
Google Play internal testing for
invited staff. iPhone: TestFlight for invited staff, built on GitHub's macOS
runners (App Store Connect app 6823429437). Destination: the App Store,
unlisted, and Google Play production. Where it stands and the store answers:
`docs/STORE-RELEASE.md`.

Source of truth: `docs/PRODUCT_BRIEF.md` (decisions & data model),
`docs/PHASE_STATUS.md` (live build status, deploy log), `docs/DEPLOY.md`
(deploy and the release runbook), `docs/IOS-BUILD.md` (the iPhone build and
TestFlight), `docs/DEV-TOOLING.md` (what each script guards against — **read it
before debugging the harness or cutting a release**).

## Converge on the optimum; do not accrete

At every step — bug fix or feature — target the **globally-optimal** solution for
the current understanding of the product: architecture, UX, data model, all of
it. As the vision evolves, converge the whole solution on the new optimum rather
than layering a patch on top. Prefer deleting and replacing over accreting; where
the sibling kanban app already has the clean pattern, converge onto it. The goal
is that this does not quietly become a legacy codebase.

**What that does and does not license.** There is no public API and no public
store listing, so internal refactoring is cheap and should be taken. But the
team is *on this app*: Firestore holds their real hours, and they have APKs installed. So
a change to stored shapes needs a migration, and a change that breaks an older
installed build needs a release they can actually get. "Breaking is free" was
true before the first deploy and has not been true since.

## Stack knowledge lives in a shared skill, not here

Recurring traps of this stack (Expo, Metro, react-native-web, Firebase JS SDK,
Cloud Functions, FCM, emulator behaviour, build/export mechanics) live in the
**`expo-firebase-stack` skill** — source `faisal-shah/agent-skills`, installed at
`~/.claude/skills/expo-firebase-stack/`. Read its closing section, **"How this
stack fools you"**, *before* a debugging session, not during one.

**The boundary is one question: would this be true for a different company
building on the same stack?** Yes → the skill (stack behaviour, SDK quirks,
tooling, build mechanics). No → this file (product invariants, brand, ports/AVD
conventions, division of labour, anything naming this project). The test is not
"is it secret", it is "is it about the stack or about us".

**The skill repo is PUBLIC.** Nothing naming this project goes into it — no
project ids, internal domains, email addresses, AVD names, secrets or product
decisions. Generalise first, then grep for identifiers before pushing.

**Contribute back in the same batch as the fix.** When a stack problem costs real
time, write the entry into the skill alongside the code change — not only into a
commit message. The knowledge only compounds if it lands where both projects read.

**Never copy the skill's content into this repo.** A second copy drifts and the
sync is manual; `docs/STACK-GOTCHAS.md` is a stub for that reason. A stub cannot
drift. **Installation is a COPY, not a symlink** — editing a skill changes
nothing an agent reads until `install.sh --claude` runs again, and a stale
installed copy looks identical to a current one.

The skill also carries `tools/bootstrap-linux.sh`, which installs this whole
toolchain on a fresh machine under `$HOME` with no root. See
`docs/DEV-TOOLING.md`.

## Product invariants

Do not silently change any of these.

- **General-purpose time tracker** — nothing volunteer-specific in the data model.
- **Google sign-in, restricted to `@oursabeel.com`**, server-enforced: the
  `onUserCreate` function deletes non-org accounts and rules block non-org
  self-register. The client `hd` hint is UX only. Every new org account lands
  `pending`; **only admins** approve/disable users or change roles.
- **One email-and-password account, and only one**: `PASSWORD_ACCOUNT_EMAIL`,
  an ordinary member made by an admin, so an App Store reviewer can sign in.
  The server holds it there (blocking functions refuse every password sign-up
  and any other address's password sign-in; rules and callables never give a
  password session a manager or admin role, and treat any other address's as
  signed out). The sign-in screen says only "Sign in with email": nothing a user
  sees mentions reviewers. `docs/STORE-RELEASE.md`, "Review access".
- **The phone apps never create an account, and must not learn how** (iOS and
  Android alike). Both stores require in-app account DELETION only if an app
  supports account CREATION, and Play also if it merely points at a sign-up
  elsewhere. So `accountExists` gates `signInWithCredential` on native, accounts
  are made on the web, and **no screen in the app names the website as somewhere
  to get an account**: the refusal says "Contact your administrator."
  `docs/STORE-RELEASE.md` is the decision record.
- **The institute's rules, and Report a problem; no blocking** (the store
  decision, `docs/STORE-RELEASE.md` 4). An active account sees the rules once,
  before anything it could post with (`App.tsx` renders them instead of the
  navigator), and only the `acceptRules` callable records the acceptance.
  Report a problem on Home keeps `reports/{id}`, which no client reads or
  writes, and emails `apps-reports@`. No blocking between members and no word
  filter: administrators remove content and disable accounts.
- **Honor system** — entries count immediately; managers may edit/correct. (The
  Phase 7 submit/approve workflow layers on top of this; it does not replace the
  principle.)
- **Work-local timezones** — entries bucket and display in the timezone where the
  work happened (`timeZone` + `dayKey` on each entry), never the viewer's. This is
  deliberate and is why this project has **no org timezone at all**, unlike the
  sibling kanban. ALL timezone math lives in `@sabeel/shared` — never do ad-hoc
  date math elsewhere.
- **Phone-first for everyone**, managers included; web is the big-screen and print
  surface.
- **Brand colours are fixed** — the designer's Option 1 palette, shared exactly
  with the sibling kanban. Single light theme, no dark mode. Never hardcode a
  colour.

## Stack (locked)

- One Expo codebase (`app/`): Android (local Gradle builds, committed `android/`)
  + iOS (`expo prebuild --platform ios` into a gitignored `app/ios/`, pods pinned by
  `app/Podfile.lock`, built on a Mac or GitHub's macOS runners; `docs/IOS-BUILD.md`)
  + web via react-native-web (`expo export --platform web` → Firebase Hosting).
  **NO EAS.** Never a bare `npx expo prebuild`: it deletes the committed
  `android/`. Platform seams as `.web.ts(x)` siblings, plus `.ios.tsx` where iOS's
  native control behaves differently from Android's (`DateTimeField`).
- Firebase **JS SDK on all surfaces** (not react-native-firebase — no web support).
- Backend: Cloud Functions (TS, nodejs22, us-central1) + Firestore. No Storage.
  One email path: Report a problem, sent as `apps-noreply@oursabeel.com` through
  Gmail by keyless domain-wide delegation (`functions/src/gmail.ts`). Sentry on
  web/native/functions.
- Monorepo (npm workspaces): `app`, `functions`, `packages/shared`.
- Config-as-code: rules and indexes deploy from the repo, never console-edited.
- **The version is three integers and lives only in `app/app.json` →
  `expo.version`.** Gradle derives `versionName` and `versionCode` from it — never
  add a second copy. `scripts/check-version.mjs` enforces store legality from
  lint/CI, `web:export`, `publish-play.mjs` and the release. A published version is
  spent forever — never reuse one. The rule and the traps behind it are in the
  skill ("The version number is a store contract"). `expo.ios.buildNumber` stays
  `"1"`: every version goes to TestFlight once, from its own tag.

## Dev & test loops

- `npm run verify` — lint + typecheck + knip + unit, the fast CI gates in one
  shot. **Run it before pushing.**
- Unit: `npm test` (Vitest: functions + shared).
- Rules/integration: `npm run test:emulator` (needs JDK 21).
- **This checkout owns emulator ports 61000–61008**; the sibling repos own 61100+
  and 61200+. Three projects share this machine and all three used to pin
  8080/9099/5001, so whichever suite started second killed the other's Firestore.
  Four files state the ports and `functions/test/unit/emulator-ports.test.ts`
  asserts they agree and that the kill list reaches no further. Never widen
  `free-emulator-ports.sh` past this block. Details in `docs/DEV-TOOLING.md`.
- Browser e2e: `npm run test:e2e` — the full product LIFECYCLE against the
  emulators, at a 420x860 viewport.
- Layout sweep: `npm run test:screens` — every screen, five accounts, five widths
  straddling the breakpoint, **asserted**. In CI. `SWEEP_WIDTHS=320` runs one
  width for a tight loop. See `docs/DEV-TOOLING.md`.
- Dead code: `npm run knip` (a **separate** CI step; `npm run lint` does not
  include it). Its false positives in this stack are documented in
  `docs/DEV-TOOLING.md` — check there before deleting anything.
- Web: `npx expo start --web` in `app/` (emulator-backed via env flag).
- Android: `scripts/emulator.sh headless` (AVD `tb_emu`), then `npx expo
  run:android` in `app/`. Firebase emulators from the AVD = `10.0.2.2`. There are
  NO physical devices. The dev sign-in row on a phone refuses an address with no
  account, as production does; create the account with the web dev row first.
- iOS (on the Mac): the simulator loop in `docs/IOS-BUILD.md` — Metro on its own
  port (another project holds 8081), the app pinned to it with `RCT_jsLocation`,
  emulators at `127.0.0.1`. `npm run check:ios` checks the iOS config;
  `scripts/build-ios.sh` builds an `.ipa`; `.github/workflows/ios.yml` builds on
  GitHub and, with `testflight=true` on a release tag, uploads.
- Releases, in two steps because main takes changes only by pull request:
  `npm run release -- <X.Y.Z> --notes FILE` bumps the version, rebuilds the
  manual PDF and opens the release pull request; after Faisal merges it,
  `npm run release -- --ship --notes FILE` on main builds both APK variants and
  the Play bundle, verifies the production bundle on the AVD, publishes the
  GitHub release tagged on that commit and the Play internal testing. **Never
  hand-bump versions.** The
  web deploy follows it (`docs/DEPLOY.md`); the iPhone build of that release is
  the iOS workflow run on its tag (`docs/IOS-BUILD.md`, "Releasing to
  TestFlight").
- CI (GitHub Actions): lint + typecheck + knip + unit + emulator tests + the
  layout sweep on every push. Keep it green, and **check the actual run** —
  don't assume. No deploys from CI. `functions/test/unit/ci-coverage.test.ts`
  fails if a browser suite on disk stops being run by CI.
- **If a suite fails, first ask whether it fails on stashed changes too.** A
  clean-HEAD repro means the cause is environmental — usually a leftover emulator
  (`npm run emulators:free`) — not your diff.

## Verification — what counts as evidence

**Never claim a screen works because the code looks right.** Look at a rendered,
authenticated screenshot. Correct hex values in `palette.ts` survive right up
until you look at the rendered screen; contrast misuse and layout gaps pass every
code-level check.

**A check that cannot fail is a screenshot generator.** A tour wrapped in a
try/catch that logs and continues reports success either way.

### The browser is the default surface for verification

**Prove a change on the web app unless it touches a seam a browser cannot
reach.** `npm run test:e2e` drives the real web build at a phone-width viewport
and `npm run test:screens` sweeps every screen at five widths — between them they
cover almost everything, and they are faster and far more repeatable than a human
on an emulator. That is the default for layout, flows, rules, data and copy.

**`npm run test:screens` is the multi-width version, and it is the one to reach
for on any layout change.** Every screen, five accounts, five widths straddling the
700px breakpoint — asserted rather than merely screenshotted, and non-zero on any
failure. It found a real bug on its first run: at 320px the Add-hours date field
was squashed to `08`, and at 390px and above it was perfect. **That is why one
viewport is not enough** — a bug on one side of a breakpoint is invisible from
the other. The checks, the design decisions and the two holes it had before
anyone watched it fail are in `docs/DEV-TOOLING.md`.

Both browser suites share their bring-up (`scripts/lib/e2e-stack.mjs`) and both
run on Playwright's own Chromium, so neither needs a system browser.

### The Android emulator is reserved for the seams a browser cannot reach

Not for routine layout work. Use it for:

| Seam | Why the browser cannot cover it |
|---|---|
| **Flex shrink / wrap / overflow** | Yoga ≠ CSS — Yoga defaults `flexShrink` to **0** |
| **Keyboard / IME** | Emulators misreport IME insets; edge-to-edge makes `Keyboard` events no-ops |
| **Gestures** | Long-press and swipe have no web path |
| **Native modules** | FCM/push, pickers, sharing |
| **Safe area / insets** | No browser equivalent |

Plus **before a release** — `scripts/release.mjs` already verifies the production
bundle on the AVD, and that gate is mandatory — and whenever Faisal asks.

**Check who owns the AVD before booting it.** There is one `tb_emu` on this
machine and all three repos default to it, so a boot can walk into another
session's run:

```sh
ps -eo pid,args --no-headers | grep "[q]emu-system"   # empty = no AVD running
```

Use that, not `adb devices` — `adb devices` *starts* a daemon as a side effect,
and a live adb server does **not** mean an emulator is running (verified: adb
listens on 5037 with zero AVDs booted). If one is already running it belongs to
someone else: ask before killing it or starting a second. The box has 15 GiB of
RAM and a 16 GiB swapfile, so a second AVD (~5 GB) will not simply be killed —
it will swap, and an AVD that is swapping is slower than the software renderer
already is. Either way the symptom looks like a broken diff rather than a
resource problem.

**Why this is safe, and exactly where it is not.** react-native-web resolves
flexbox through the browser's engine, so a narrow viewport tests *your layout
intent* but not *Yoga's behaviour*. The one documented native-only layout bug in
this family was precisely that — a button shrinking below its basis, which "never
reproduced under react-native-web at any width" (sibling recording app,
`docs/PHASE_STATUS.md` 2026-07-24). That is the gap, and it is narrow enough to
name rather than to fear.

**Two traps when you do run native:** `BUILD SUCCESSFUL` is not proof the APK
installed — if the AVD drops mid-run, yesterday's build stays on the device and
every screenshot after it is a lie, so confirm `versionName` with `adb shell
dumpsys package`. And a native debug build takes `EXPO_PUBLIC_*` from the
environment that started **Metro**, not from the APK; if a flag looks unset,
restart Metro with `--clear`.

**The AVD needs hardware virtualization and a VM may not have it.**
`emulator -accel-check` is authoritative; without it the AVD still boots in
software at ~805 s and ~14 s per screenshot, which retires the screenshot loop
while leaving input usable. Builds are unaffected — Gradle needs no KVM.
`check-host.sh` in the skill's `tools/` gives the verdict.

**A rules test that only asserts denials must be shown to fail when the rules are
opened.** `assertFails` passes when an operation fails for *any* reason, including
a broken connection — so flip the rule to `if true`, watch the suite go red, and
flip it back.

## Secrets (zero tolerance)

NEVER ask for, accept, or echo real API keys/DSNs/tokens in chat; never hardcode
them. Server secrets: output the exact `firebase functions:secrets:set NAME`
command for Faisal to run. Client-side non-secrets (Firebase web config) are
committed by design — rules are enforced server-side. Client DSNs go in gitignored
`.env.local` (key names only in docs).

## Division of labor

- Agent: all code, rules, indexes, tests, emulator runs, CI, exact click-by-click
  console checklists, diagnosing pasted logs.
- Faisal only: third-party consoles (Firebase/GCP/Sentry, Google Play Console,
  App Store Connect, Apple Developer), OAuth/SHA-1 registration, anything with
  production secrets, and the go-ahead for every release and TestFlight upload.
  Everything Faisal must do himself is tracked in `TODO.md` — keep it current.

## Conventions

- All eight phases are complete; work now ships as **numbered releases**. Commit
  at the end of a coherent change and work autonomously within one.
- **Production hardening backlog lives in `docs/PRODUCTION-REVIEW.md`** — a tracked
  checklist (H/M/L findings + emulator-verification list) worked across sessions;
  update its Status and Changelog as items land.
- Before ANY significant install (global/system/major framework), ask first;
  routine project-local npm deps of the locked stack are fine.
- All repo artifacts (docs, plans, protocols) live in this repo.
- **User-visible changes ship with their documentation in the same batch as the
  code** — update `docs/USER-MANUAL.md`, regenerate the affected
  `docs/manual/img/` screenshots and the PDF via `docs/render-manual.py`, and
  update PRODUCT_BRIEF/PHASE_STATUS. Never let the manual lag a release.
- **Live Firestore reads in `app/src` go through `useLiveQuery`/`useLiveDoc`**
  (`app/src/liveQuery.ts`) — never hand-roll `onSnapshot` state (lint-enforced;
  see `docs/POSTMORTEM-2026-07-16-stale-week.md`). Async UI must be e2e-tested at
  least once under **injected latency**, not just localhost speed.
- **Android distribution:** Play internal testing. `release.mjs` attaches APKs
  and the manual to the versioned Institute app release. Never commit APKs or
  publish to a personal Pages repository.
