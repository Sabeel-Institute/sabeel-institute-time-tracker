# Dev tooling — what each script is for, and the bug that paid for it

Every entry here exists because something cost hours. The scripts encode the
fix; this file keeps the reasoning, so nobody "simplifies" a guard back into a
bug.

**Scope:** this file covers *our* scripts and conventions. The underlying
stack behaviour they guard against is documented once, in the shared
`expo-firebase-stack` skill — see `docs/STACK-GOTCHAS.md`. Facts about Expo,
Firebase or the emulators belong there; what we built in response belongs here.

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | the fast CI gates in one shot: lint + typecheck + knip + unit — **run before pushing** |
| `npm run lint` | eslint + `check:text` (see below) |
| `npm run typecheck` | tsc across all workspaces |
| `npm test` | Vitest units (functions + shared) |
| `npm run test:emulator` | rules/integration suite (frees ports first) |
| `npm run test:e2e` | full browser e2e against emulators — the product LIFECYCLE |
| `npm run test:screens` | every screen at five widths, asserted — the LAYOUT sweep (in CI) |
| `npm run knip` | dead-code audit |
| `npm run emulators:free` | kill whatever is squatting on emulator ports |
| `npm run release -- <version> --notes FILE` | open a release pull request; `-- --ship --notes FILE` after the merge publishes the GitHub release and Play internal testing (`docs/DEPLOY.md`) |
| `npm run publish:play -- --check` / `-- --internal` | the Play gates alone / rerun the Play upload alone |
| `npm run check:web-push` | the exported web bundle carries the VAPID key (`docs/DEPLOY.md`) |
| `npm run check:push` | FCM and Apple accept a message from the project |
| `npm run check:ios` | the iOS config: app.json against the plist, plugins, export compliance, icon, privacy manifest, DSN |
| `npm run build:ios` | `scripts/build-ios.sh`: every gate, then archive and export a signed `.ipa` (Mac only, never uploads) |

## Setting up a machine

Node 22+, **two** JDKs — 21 for the Firebase emulators (they are Java), 17 as
the default `java` because the Android Gradle Plugin targets it — plus the
Android SDK and the `tb_emu` AVD.

Do not install these by hand. The `expo-firebase-stack` skill in
`../agent-skills/` carries a bootstrap that installs the lot under `$HOME` with
no root, and is idempotent:

```sh
../agent-skills/skills/expo-firebase-stack/tools/check-host.sh   # what is missing
../agent-skills/skills/expo-firebase-stack/tools/bootstrap-linux.sh \
    --jdk21-aliases ST --repo "$PWD"
```

`--jdk21-aliases ST` sets `ST_JDK21_HOME`, which
`scripts/test-emulator.sh` reads to find JDK 21 without disturbing the Gradle
default.

Releasing needs more (access, the download-page clone, the keys, the manual
renderer's tools): `docs/DEPLOY.md`, "Before your first release".

**The Android emulator needs hardware virtualization, which a VM may not have.**
`emulator -accel-check` is authoritative — `accel: 3` means no KVM, and if
`/proc/cpuinfo` shows `hypervisor` with neither `vmx` nor `svm` then nested
virtualization is off at the host and nothing inside the machine, root
included, can enable it. The AVD still boots in software: measured at **805 s
to boot and ~14 s per `screencap`**, so screenshot-based verification stops
being practical while input events (~1.4 s) remain usable. **Builds are
unaffected** — Gradle needs no KVM. `check-host.sh` gives the verdict.

## `scripts/free-emulator-ports.sh`

A killed run leaves emulators holding 5001/8080/9099. The next run then talks to
a **half-dead emulator**: it answers on the port but has registered no
functions, so every callable 404s.

The symptom chain is vicious — a 404 carries no CORS headers, so the browser
reports *"blocked by CORS policy"*, and the app surfaces a bare **`internal`**.
Three misleading symptoms, none pointing at the leftover process. On 2026-07-20
this made a clean `HEAD` fail identically to a working branch, which is the only
reason it was caught: **when a failure reproduces on stashed changes, it is
environmental.** Bisect against clean HEAD before debugging your own diff.

Ports are looked up **by port**, never `pkill -f firebase` — that pattern also
matches the script's own command line and kills the caller (seen as a shell
exiting 144). This is easy to re-learn the hard way: on 2026-07-26 a
`pkill -f functionsEmulatorRuntime` typed by hand killed the agent shell the
same way. Kill by PID, skipping `$$`/`$PPID`:

```sh
for p in $(pgrep -f "emulator/functionsEmulatorRuntime"); do
  case " $$ $PPID " in *" $p "*) continue;; esac
  kill -9 "$p"
done
```

**What this script cannot clean up:** orphaned `functionsEmulatorRuntime`
children. They hold no fixed port, so a port-based sweep never sees them, and
`npm run emulators:free` will happily report *"emulator ports clear"* while
several are still resident. Check for them directly when a run misbehaves:

```sh
ps -eo pid,args --no-headers | grep [f]unctionsEmulatorRuntime
```

(`pgrep -f` counts its own subshell, so it reports one or two phantom hits —
use `ps | grep [f]…` when you want a truthful count.)

## The emulator suite dies with `ECONNREFUSED` and most tests "skipped"

Signature: the run lasts ~6 seconds, a dozen tests fail with
`connect ECONNREFUSED 127.0.0.1:61002` (this checkout's auth port; the
signature predates the port move and used to read 9099), and 80+ are skipped.
Buried above the vitest output — and easy to miss, because the tail of the log
is all test noise — is the real cause:

```
⚠  Firestore Emulator has exited upon receiving signal: SIGKILL
Killed
```

That is the **OOM killer**, not a bug in your diff.

**Correction (verified 2026-08-28).** This file used to say the machine runs
`earlyoom` with a `--prefer` list that makes the Java Firestore emulator the
designated victim. **It does not run here at all** — no binary, no unit, no
process. That mattered because it taught the wrong triage. With no `earlyoom`
the kernel picks by RSS, so under real pressure the first things to go are the
**AVD (~5 GB)** and a **Gradle daemon (~3.7 GB)**, not the emulator. The
emulator dying is usually a *consequence* of memory another process took — quite
possibly a process in a **sibling repo**, since `~/.gradle` and the AVD are
shared machine-wide.

The memory picture, checked the same day: **15 GiB of RAM plus a 16 GiB swapfile**
(`/proc/swaps`, `vm.swappiness=10`). An earlier note here said "no swap", which
was wrong and pointed at the wrong failure: with swap present, memory pressure
usually shows up first as **thrashing** — an AVD or emulator that has gone
treacle-slow — and only later as a kill. Treat a suite that suddenly takes
minutes per step as a memory symptom, not a flaky test.

The usual culprit is a **Gradle daemon left resident by an APK build** — after a
release it sits on ~3.7 GB indefinitely. Seen 2026-07-26: the emulator suite
failed three times in a row, looking exactly like a broken change, until:

```sh
cd app/android && ./gradlew --stop    # freed 4.1 GB; suite immediately green
```

So when the suite fails right after you have built an APK or run the AVD, check
`free -h` and `ps -eo pid,rss,comm --sort=-rss | head` **before** reading the
failures. Always `./gradlew --stop` and kill the AVD when finishing build work —
it also keeps the machine usable for anyone else working in the repo.

## `scripts/check-text-sources.mjs` (runs inside `npm run lint`)

A functions source file once contained a **raw NUL byte** inside a template
literal used as a composite Map-key separator. It compiled and ran correctly —
but `file` called the source "data", git diffed it as binary, and **grep
silently skipped the entire file**.

During a dead-code audit that made a live constant (`ENTRIES_HEADER`) look
unreferenced. A verification tool that returns "no matches" for a file it cannot
read is worse than no tool at all. Write control characters as escapes
(`\u0000`): identical runtime value, readable source.

## `knip.json` + `npm run knip`

Knip has three failure modes in this stack. All three fired on the first run:

1. **Platform seams are false positives.** Every `.web.ts(x)` is resolved by the
   bundler, not by an import, so knip called all 13 of them unused. They are
   entry points in `knip.json`.
2. **An export used only from a seam reads as unused.** The `app` export in
   `firebase.ts` is used solely by `notify.web.ts`. Grep across `.ts` *and*
   `.tsx` and typecheck before believing the report.
3. **"Unused dependency" ≠ removable.** `@sentry/react` (used by `sentry.web.ts`),
   `react-native-worklets` (babel plugin + reanimated peer) and `playwright`
   (drives the e2e) all showed as unused because their consumers were invisible.

**`@sabeel/shared` is deliberately absent from `functions/package.json`** —
esbuild inlines it, and declaring it makes Cloud Build fail with
*"404 not in this registry"*. It is in `ignoreDependencies` so nobody "fixes" it.

Exported **types** are kept even when only used in their own file: each names the
parameter or return of an exported function, i.e. it documents a public surface.
That is what `ignoreExportsUsedInFile` encodes.

One judgement call knip cannot make: **some unused code marks a missing feature
rather than cruft.** If deleting it would erase the only trace of a user-facing
gap, fix the gap instead.

**`npm run knip` is a SEPARATE CI step — `npm run lint` does not include it.**
On 2026-07-22 CI sat red for many commits (since the Option-1 migration added an
unused `useTheme` export) because local validation ran lint/typecheck/test but
not knip, and CI status wasn't re-checked after those pushes. Guard against the
whole class: **run `npm run verify` before pushing** (lint + typecheck + knip +
unit), and don't assume green — check the actual CI run.

## `scripts/lib/e2e-stack.mjs`

Both browser suites need the same bring-up — build the shared lib and functions,
export the web bundle in emulator mode, free the emulator ports, start
auth/firestore/functions, wait for a callable to be *registered*, serve
`dist-web` on an ephemeral port, launch a browser, do the dev sign-in. That was
`web-e2e.mjs`'s private preamble until `screens-e2e.mjs` needed it too;
duplicating it would have meant two copies of every guard below, drifting apart.

One deliberate change came with the extraction: **the browser is Playwright's own
Chromium, not `/usr/bin/google-chrome`.** `playwright` was already a
devDependency (it drives the e2e — see the knip notes above); pointing at a
system Chrome was the only thing keeping a browser suite off a CI runner.

## `scripts/screens-e2e.mjs` — the layout sweep

`npm run test:screens`. Every screen, five accounts, five viewport widths, looked at
**and checked**; `SWEEP_WIDTHS=320 npm run test:screens` runs one width for a
tight loop.

**Review a sweep in its report.** The sweep writes its screenshots and every
check (`results.json`) to `e2e-shots/screens/`, emptied at the start of each run;
`scripts/screens-report.mjs` turns them into one page: every screen at every
width side by side, the failed checks beside the screenshot they are about,
and what changed against a baseline sweep as before / after / difference. A
filter narrows it to a screen or a width, or to what failed or changed.
`manifest.json` beside the page holds the same data for an agent.

```bash
node scripts/screens-report.mjs e2e-shots/screens --baseline-from-main   # → e2e-shots/screens-report/index.html
node scripts/screens-report.mjs e2e-shots/screens --baseline <dir of screenshots>
```

`--baseline-from-main` compares with the report of the latest successful CI
run on main (it needs `gh`). CI builds the report on every sweep, pass or
fail, and keeps it for 30 days as the run's `screens-report` artifact; the run
page's summary lists the failed checks and the changed screens and gives the
command that downloads the page: `gh run download <run id> -n screens-report`.

It exists because this repo had no multi-width coverage at all: `web-e2e.mjs`
proves the flows but looks at one 420x860 viewport, so every layout decision on
the other side of the 700px breakpoint shipped unphotographed. It found a real
bug on its first run — at 320px the Add-hours **date field was squashed to
"08"**, and at 390px and above it was perfect. That is the whole argument for
straddling the breakpoint rather than picking one width that looks reasonable.

**A tour that cannot fail is a screenshot generator.** So it asserts and exits
non-zero, and `functions/test/unit/ci-coverage.test.ts` fails if CI ever stops
running it. What it checks, and the failure each one is for:

| Check | The failure it exists for |
|---|---|
| the page never scrolls sideways | the classic responsive failure a top-of-page screenshot never reveals |
| nothing extends past the right edge | react-native-web's vertical ScrollView sets `overflow-x: hidden`, so an over-wide row is sliced off silently and the page width never moves |
| no two same-layer controls overlap | crowding that appears at one width and not another |
| every screen has a way out | a pushed screen with no header Back is a dead end on a phone browser — there is no hardware Back there; the root answers with Sign out |
| a native field fits its own value | a field squashed by a flex row neither bleeds nor overlaps, so nothing else can see it |
| the width produced the layout it should | buttons stretch below the breakpoint and hug their label above it; card grids stack below and flow above |
| targets under 44px | **reported, never failed** — informational |

Design decisions worth not undoing:

- **The breakpoint is read from `app/src/theme/layout.ts`**, never copied — and a
  regex that stops matching *throws* rather than falling back to a default,
  because a silent fallback is the same drift wearing a default.
- **Widths straddle it** (320, 390, 700, 1024, 1440) rather than looking
  thorough. A bug on one side of a breakpoint is invisible from the other.
- **Seeding is Admin SDK, provisioning is not.** Data goes in directly —
  deterministic, seconds not minutes, and rules would refuse most of it from a
  client. Accounts still sign in through the UI, because `onUserCreate` is the
  sole provisioner and a hand-written user doc is a shape production never makes.
- **The seeds are the shapes that BREAK layouts**: the longest realistic activity
  name, a note longer than its row, a rejection reason of real length, an
  overlapping pair, a week with nothing in it.
- **The interesting weeks live in the previous month, always, and are its
  INTERIOR ones.** The month strip shows one month, so a tour wanting three past
  weeks in the current one would break on the 1st — a harness that fails on some
  days of the year for reasons unrelated to layout teaches everyone to ignore it.
  Interior, because only a month's first and last period are clipped and the last
  can be a **single day**: a week seeded across it spills its later entries into
  the next month, out of the timesheet they belong to and — sharing a day now —
  into accidental overlaps the conflict check would report as real. Reaching them
  also exercises the month arrows, which nothing else touches.
- **A picker is its own screen.** It is a modal with a text field over a capped
  list, and no structural check can see a dialog that is never opened. Clicks
  inside one are scoped to `role="dialog"`: the field that opened the picker
  carries the same text as the selected row inside it, and an unscoped click
  lands on the field, which the backdrop is covering, and hangs.
- **Every sign-in settles before it is measured** (`settle`, in
  `scripts/lib/e2e-stack.mjs`, used by both browser suites): the account's own
  first screen, or the app's "Still setting up your account", answered with
  the app's own Try again (a page reload on the web), once, and counted. Every
  account here exists and has a profile, so that screen means the page's
  database connection delivered nothing. On a freshly started emulator stack
  the first sign-in has done exactly that, often: the profile made in a second,
  the Listen channel open and silent until the page reloaded (2026-10-16,
  reproduced with a stand-alone script; closing and reopening the connection
  did not cure it, and waiting does not either). Any throw outside the tour
  also tears the emulators down, so a failed run leaves nothing holding the
  ports.
- **Five accounts, because gated screens have no other coverage.** The admin
  sees every screen; the member's Home and the non-admin manager's read-only
  Users are layouts the person who owns the app never renders; the pending gate
  and the institute's rules (an approved account that never taps I agree) are
  screens with no navigator, where Sign out is the only way out. The other
  three accounts are seeded as having accepted the rules, as `acceptRules`
  records it; `web-e2e.mjs` drives the real acceptance.

**It is not part of `release.mjs`, deliberately.** That script's AVD step exists
to check the one thing CI cannot — that the production APK boots and is not an
emulator-mode bundle. The sweep checks the *web* layout, which CI has already run
on every push; re-proving it would add ~2.5 minutes to every release for a result
that is already green. The only commit a release builds that CI has not yet seen
is the version bump the script makes itself, whose diff is a version string and a
build-info stamp — nothing that can move a layout.

Two checks in the sibling kanban's version were deliberately **not** ported, and
both times for the same reason — *a check that fires on correct code is worse
than no check*:

- **generic "is any text truncated"**: every `numberOfLines` in this app is an
  intentional clamp (the picker field, an entry note, a rejection reason), so it
  would fire at every width on correct code. The one place truncation is never
  intentional — a native `<input>` — gets its own narrow check instead.
- **"no interactive content nested inside a `<button>`"**: this app sets no
  `accessibilityRole`, so react-native-web emits `<div tabindex>` and never
  `<button>`; the one nesting it does have (the picker backdrop wrapping the
  sheet and its TextInput) is the correct dismiss pattern, not the invalid-HTML
  bug that check is for.

**Two holes this harness had before anyone watched it fail**, both found by
deliberately breaking a screen and confirming it went red — do that again after
changing a check:

1. The right-edge check looped over *controls that still had visible area*
   (kanban's shape, correct there because its board pager lays whole columns
   off-screen by design). Here, a control pushed **entirely** past the edge had
   no visible area left and was skipped — a card widened to 520px at 320px wide
   was toured, screenshotted, and passed. It now walks every element and reports
   only the outermost offender.
2. The squashed-field check compared `scrollWidth` to `clientWidth`. A
   `type="date"` clips its segments rather than scrolling them, so the obvious
   test passed on the exact bug it was written for. It now clones the field
   outside the flex row and measures what it would take naturally.

## `scripts/web-e2e.mjs`

Beyond the flows themselves, the harness encodes:

- **Frees emulator ports first** (above).
- **Waits for a callable to EXIST, not for the port to answer**
  (`waitForFunctionRegistered`). Port-open is not function-ready.
- **Truncates `e2e-shots/emulator.log` per run.** A stale log from days earlier
  once produced confident, wrong conclusions.
- **Captures failed calls to the functions emulator with their response bodies**,
  and dumps them (plus console errors and per-page screenshots) on failure. This
  replaced hand-writing a one-off repro script to see a server error.
- **Injects latency** around week switching — the stale-week bug class only
  appears when snapshots lag (see `POSTMORTEM-2026-07-16-stale-week.md`).

Two races in it were fixed on 2026-08-27, both **reproduced on clean `HEAD`** —
they predate the `e2e-stack` extraction and had been failing this suite roughly
one run in two. Both are stack behaviour, so the *why* lives in the
`expo-firebase-stack` skill ("The screen underneath is still in the DOM…" and
"A fire-and-forget write, then a navigation…"); what this repo did about it:

- **Every positional text locator in the file goes through `firstOnScreen` /
  `lastOnScreen`**, which filter to `{ visible: true }`. That is a property of
  the file, not a patch at the two sites that happened to bite — a bare
  `.first()`/`.last()` anywhere here is the same bug waiting for a different day.
  `screens-e2e.mjs` needs none of this because it navigates by ROLE, and role
  selectors skip hidden subtrees the way a screen reader does.
- **The notification toggle waits for the switch to read OFF before navigating.**
  The switch is driven by the profile listener, so it flipping is proof the write
  round-tripped — without that wait the reload read the pref unchanged, which
  looks exactly like the bug the check exists to catch.

**When this suite fails, check which of the two it is before believing the
step.**

The shared-machine hazard behind them is **fixed as of 2026-08-28**: this
checkout owns ports **61000–61008** and `free-emulator-ports.sh` sweeps nothing
outside that block. Previously this repo and its two siblings all pinned
8080/9099/5001 and all called that script at the start of every run, so a run in
one repo SIGTERMed the other's Firestore (`exited with code: 143`) — or, worse,
silently cost it a write. See **"Emulator ports are this checkout's own"** below.

## Emulator ports are this checkout's own

**This repo owns 61000–61008.** The sibling projects own 61100+ and 61200+.

| port | service |
|---|---|
| 61000 | firestore |
| 61001 | firestore websocket |
| 61002 | auth |
| 61003 | functions |
| 61004 | emulator UI |
| 61005 | hub |
| 61006 | logging |
| 61007 | eventarc |
| 61008 | tasks (Cloud Tasks) |

Three repos share this machine and all three used to pin 8080/9099/5001, so
whichever suite started second killed the other's Firestore. `61003` also reads
as "this project, functions" at a glance — which is the diagnostic that was
missing when one session killed another's emulator after misreading a truncated
`ps` line.

**Why 61000+, and not some other free-looking numbers.** The ephemeral range on
this box is 32768–60999 (`/proc/sys/net/ipv4/ip_local_port_range`), so anything
above it is never handed out at random; and Firebase's own defaults top out at
9499 (`firebase-tools/lib/emulator/constants.js`), so the block cannot collide
with something the CLI picks for itself.

**Four files state these numbers and they cannot share a representation** —
`firebase.json` (JSON), `app/src/env.ts` (TS, inlined into the client bundle),
`scripts/lib/ports.mjs` (ESM) and the `PORTS=(…)` array in
`free-emulator-ports.sh` (shell). Four copies are unavoidable; four copies
drifting is not. `functions/test/unit/emulator-ports.test.ts` asserts they agree,
that every port is inside the block, and that the kill list contains **nothing
this checkout does not own**. Change one, change all four, and let `npm run
verify` prove it in seconds rather than discovering it when an emulator answers
on a port nobody expected.

**Two ports nobody asked for.** The functions emulator starts the Eventarc
and Cloud Tasks emulators beside itself, used or not, on 9299 and 9499 unless
`firebase.json` pins them. Unpinned, every checkout's functions emulator wants
those two, and the second to start logs `EADDRINUSE` twice as "An unexpected
error has occurred", never brings Auth up, and the suite dies with "timeout
waiting for auth emulator". Seen 2026-10-16 with a sibling's sweep running:
indistinguishable from a broken diff until the debug log names the port. Both
are pinned inside this block.

**Two ports are easy to move wrongly:**

- `firestore.websocketPort` is a **nested** key under `firestore`, defaults to
  **9150**, and is *not* derived from `firestore.port`. Left unset it silently
  **increments** on collision instead of erroring
  (`controller.js` sets `portFixed = !!wsPortConfig`), so moving `firestore.port`
  alone would leave every checkout still sharing 9150.
- `ui`, `hub` and `logging` have `FIND_AVAILBLE_PORT_BY_DEFAULT = true` — they
  drift silently rather than failing. Pinning them turns a collision into a hard
  error, which is what you want.

**The ports are source literals, never `EXPO_PUBLIC_*`.** On a native debug build
those come from the environment that started *Metro*, and one Metro serves every
Sabeel project here — an env-driven port would make the app's backend address a
property of an unrelated process's environment. An env-with-default is worse
still: it fails *toward* the collision, since an unset or mistyped var falls back
to the old shared port and connects to a sibling.

**Metro (8081) is not in the scheme and cannot be.** The AVD reaches the host
directly at `10.0.2.2:8081`, so `adb reverse` does not redirect it and the port
cannot move without rebuilding the native app. Concurrent *web* work is fine;
concurrent *native* work is one session at a time — and on 15 GiB of RAM,
memory settles that argument before ports do.

### The Metro transform cache is repo-local for the same reason

Ports were not the only thing three checkouts were sharing. Expo's default
transform cache is `os.tmpdir()/metro-cache` — **one directory for every Expo
project on the machine** — and Expo overrides `FileStore.clear()` so that a root
inside `os.tmpdir()` is `renameSync`d away wholesale and deleted in the
background (`@expo/metro-config/build/file-store.js`). Every e2e entry point here
passes `--clear`, and each one is documented as load-bearing, because
`EXPO_PUBLIC_*` is inlined at bundle time and a stale cache serves a bundle built
under different env.

So `--clear` did not clear *this project's* entries. It deleted all three
projects' — a full cold transform of an Expo + RN monorepo for whoever ran next,
and any Metro already running elsewhere kept writing into shard directories that
no longer existed.

`app/metro.config.js` now points `cacheStores` at `app/.metro-cache`
(gitignored). It is set as a **function**: Metro calls it with the `metro-cache`
module (`metro-config/src/loadConfig.js`, `mergeConfigObjects`), so the config
does not have to `require('metro-cache')` — which would mean declaring a
dependency whose version is pinned transitively by `@expo/metro`, free to drift
from it, and flagged by knip. Being repo config rather than a wrapper-script env
var, it also covers a hand-run `npx expo start`, which no script sets `TMPDIR`
for.

## The iOS scripts

The iPhone build has its own runbook, `docs/IOS-BUILD.md`. What each script is
for, in one line:

- `scripts/check-ios-config.mjs` — the iOS settings live in two files that must
  agree (`app/app.json`, `app/GoogleService-Info.plist`), and every mismatch it
  catches surfaces otherwise at upload, at review or at runtime.
- `scripts/build-ios.sh` — the gates first (a locked keychain is found in a
  second, not twenty minutes into an archive), then prebuild, the pods held to
  `app/Podfile.lock`, archive, export. Automatic signing on the Mac, manual with
  `IOS_PROFILE_NAME` on GitHub.
- `scripts/load-build-env.sh` — the build machine's values from the gitignored
  `app/.env.sentry-build-plugin`, parsed rather than sourced.
- `scripts/testflight-check.mjs` — before an upload: is this commit the
  `v<version>` tag on GitHub, and has Apple not taken the build number.

`scripts/free-emulator-ports.sh` and `scripts/preflight-metro.mjs` find port
owners with `ss` and `/proc`, which a Mac does not have, so on the Mac both
report every port free. Check by hand there: `lsof -nP -iTCP:<port>
-sTCP:LISTEN`.

## `scripts/release.mjs`

One script, because a hand-run release lets the version and the build stamps
drift apart. It runs in two steps, because main takes changes only by pull
request. `npm run release -- X.Y.Z --notes FILE` bumps the version in
`app/app.json` (the only copy) and the manual's label, re-renders the manual
PDF, commits that on `release/vX.Y.Z` from origin/main and opens the pull
request. After the merge, `npm run release -- --ship --notes FILE` on main
builds both APKs and the Play bundle, verifies on the AVD, publishes the GitHub
release, and last puts the bundle on Play internal testing
(`scripts/publish-play.mjs`).

Guards worth keeping:

- **Every channel ships the one verified build**: the GitHub release
  (APKs), Play internal testing (the bundle). Never attach an APK
  to chat.
- **Both variants, every time.** arm64-only crashes on an x86_64 emulator with
  "Unexpected CPU variant" — which is what verification runs on.
- **The production check is the ABSENCE of the dev sign-in row.** An
  emulator-mode bundle looks identical otherwise, and Metro will serve a cached
  bundle built under different `EXPO_PUBLIC_*` env. The AVD step is
  `npm run check:release` on the universal APK, the check the Android workflow
  runs on every bundle: three cold starts, each failing the release if that row
  is present, the label is not `v<version> · <commit>`, or the device log shows
  a crash.
- **`versionCode` must increase**, or installs silently refuse to upgrade.
- Refuses to run on a dirty tree, so a release is reproducible from a commit.
- **Builds only main's merged head.** `--ship` refuses unless the checkout is a
  clean main identical to origin/main, then stamps `app/src/build-info.ts` from
  that commit. The APK bundles it and the later `firebase deploy --only hosting`
  regenerates it from the SAME commit — so the sign-in footer
  (`v<version> · <hash>`) is identical on the APK and the web.
- **Tags the built commit by name**: `gh release create --target <sha>`. Without
  a target the tag lands on whatever the remote branch head is, which is how
  v0.26.0 and v0.27.0 tagged their predecessors. A failure before the tag
  leaves nothing published; rerun `--ship`. Finish with `firebase deploy --only
  hosting --project dev`.

`--dry-run` bumps the version and renders the manual in place, with no branch or
commit; `--verify-only` re-runs the AVD check against already-built APKs.

### Android distribution

Testers install through Play internal testing:
https://play.google.com/apps/internaltest/4701451587936876375

`release.mjs` attaches APKs and the manual to the versioned Institute GitHub
release. It does not publish to a personal site or Pages repository.

## Working with the Firebase emulators generally

- **The emulator enforces no composite indexes.** A query that passes every
  local test can fail for the first real user. Probe production with
  `probeQueries` after any index or query-shape change.
- **`EMULATOR_HOST` is the literal `127.0.0.1`**, never `localhost`: the
  emulators bind IPv4-only, and `localhost` can resolve to IPv6 `::1` first.
- Secret Manager 403s in emulator logs are expected noise (`secrets: [...]`
  makes the emulator reach for real Secret Manager); they are not the failure
  you are chasing.
