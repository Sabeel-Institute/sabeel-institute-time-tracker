# Production-readiness review

Living checklist from the full static review on **2026-07-21**. The app is
already live, so these are **hardening items on an in-production system** — no
outage-level blockers were found. Work through them across sessions; update the
**Status** and the **Changelog** as items land.

**Status legend:** ⬜ open · 🟡 in progress · ✅ done · ⏭️ deferred (with reason) ·
❎ won't-fix (with reason)

Review method: static inspection of `firestore.rules`, `functions/src/**`,
`app/src/**`, `packages/shared/src/**`, config, and `npm audit`. **No emulator
was run.** Rules reasoning is by inspection, backed by the existing 85 emulator
tests (read, not re-run this session). See "Not verified" at the end.

---

## High

### H1 — No React error boundary ✅ done (v1.0.0-beta.15, 2026-07-22)
Shipped `app/src/components/ErrorBoundary.tsx` wrapping the whole app tree.
Verified by injecting a throw: the themed "Try again" fallback rendered AND the
error reached Sentry tagged `source: ErrorBoundary`, `handled: yes`.
A thrown error during render tears down the whole RN tree with no recovery — the
user is stuck on a blank screen until they force-quit. Most likely real-world
outage for a phone app fed live Firestore data of varying shape.
- **Where:** `app/App.tsx` (no boundary anywhere in `app/src`).
- **Fix:** an `ErrorBoundary` around the navigator with a "something went wrong —
  reload" fallback + `captureError` to Sentry.

---

## Medium

### M2 — `durationMinutes` not tied to `start`/`end`; reporting sums it ✅ done (2026-07-22)
Rule bound added; emulator-verified (inflation rejected, 90s→2 accepted).
**Pre-flight ran against prod before the rules deploy: 0 violators / 32 entries**,
so no live document was locked out.
Rules validate `durationMinutes` only as `1..1440`, independent of the times, and
reporting sums it. A modified client could write times 1 min apart with
`durationMinutes: 1440` and, if an approver isn't careful, inflate official
hours. Honor-system-with-approval defense-in-depth (an approver would see the
row's times contradict its duration).
- **Where:** `firestore.rules:150-155`; summed in `functions/src/reporting.ts:157`
  and `functions/src/driveRows.ts`.
- **Fix:** enforce `durationMinutes` within ±1 of `(end-start)/60000` in the rule
  (allow for the client's `Math.round`).
- **Verify in emulator:** legitimate rounded durations still pass across boundary
  cases (e.g. 30-second rounding).

### M3 — Admins who aren't managers can't run reports / manage activities ✅ done (2026-07-22)
Broadened to `manager || admin`: `requireManager`→`requireManagerOrAdmin` (3 call
sites), activities rules, and the UI gates (reuse the existing `isApprover`). All
deployed; unit + rules tests added.
`exportCsv`/`reportTotals` all `requireManagerOrAdmin`, and the UI gates
Reports/Activities/PersonDetail on `role === 'manager'`. The org's admins
(`sameera@`, `faisal.shah@oursabeel.com`) are `member` + `admin`, so they can
approve timesheets and manage users but **cannot see any report or the activity
list.** Likely a surprise for people who expect "admin sees everything."
- **Where:** `functions/src/reporting.ts:177,189`, `functions/src/drive.ts:169`;
  UI gates in `HomeScreen.tsx` / `App.tsx`.
- **Fix (policy call — Faisal):** either grant those accounts `manager` too, or
  broaden the gate to `manager || admin`.

### M4 — CSV formula injection in exported/synced CSVs ✅ done (2026-07-22)
`csvCell` prefixes leading `=+-@`/tab/CR with `'`. Unit-tested; deployed.
`csvCell` only quotes cells containing `" , \n`. A user-controlled `note`,
`activityName`, `displayName`, or `email` starting with `= + - @` is written raw
and executes as a formula when the monthly `hours-YYYY-MM.csv` (Drive) or a
downloaded export is opened in Excel. The live Google Sheet is safe (`RAW`
input); CSV files only.
- **Where:** `functions/src/reporting.ts:74-77` (`csvCell`).
- **Fix:** prefix at-risk cells (leading `=+-@`, tab, CR) with `'`.

### M5 — A manager can be their own approver and self-approve ✅ by design (Faisal, 2026-07-25)
**Resolved as policy, not as a defect.** Managers and admins alike may be their
own approver. Flexibility is worth more than enforced second-party review at this
org size and trust level, and self-approval is the only escape from a real dead
end: a manager with no eligible approver — the sole manager, or one whose approver
account was removed (this happened on 2026-07-19) — cannot submit at all.
- **Revisit trigger:** if managers/admins grow beyond Faisal's immediate circle,
  or volume makes self-review non-obvious. The lever is one clause:
  `av != request.auth.uid` on the self-update `approverOk` path
  (`firestore.rules:91-96`), which would leave admin self-approval intact via
  `stampOk`'s admin clause.
- **Landed 2026-07-25:** the client filters that had been enforcing the *old*
  policy alone are gone (`HomeScreen.tsx`, `UsersScreen.tsx`); self is now listed
  last in the picker so choosing it stays deliberate. Rules and UI had disagreed
  since launch — the rules always permitted this — which is the worst state to
  leave a policy in.
- **Audit trail is intact:** `decidedBy`/`decidedAt` record every decision, so a
  self-approval is identifiable after the fact. Nothing surfaces it in the UI;
  that is a deliberate omission, not an oversight.
- **What self-approval does NOT weaken:** the submitted-period freeze.
  `canTouchPeriod` (`firestore.rules:57-63`) excludes the owner outright before it
  considers who the approver is, so a self-approver still withdraws rather than
  editing a submitted week in place. Pinned by an emulator test.

### M5b — An approver's authority outlived their role ✅ done (2026-07-25)
Found while formalising M5. `approverUid` was validated only when **written**
(`approverOk`), never afterwards: the DECIDE branch checked identity alone, so a
manager who was demoted or disabled kept deciding every sheet still stamped to
them — their own included, once self-approval is allowed. Dangling pointers also
outlived deleted accounts (hand-fixed once, 2026-07-19).
- **Fixed in two places.** `firestore.rules` DECIDE now requires the stamped
  approver to be a *current* `isManager()` (admins unaffected). `applyUserAccess`
  clears every `approverUid` pointing at an account that loses eligibility
  (demotion, disable, admin revoked from a non-manager), the account's own
  self-pointer included.
- **Verified in emulator:** demoted and disabled approvers rejected, admin still
  decides, promotion leaves pointers alone, self-pointer cleared on demotion.

### M6 — No web security headers ✅ done (2026-07-22)
Hosting sends `X-Frame-Options: DENY`, `Content-Security-Policy:
frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: strict-origin-when-cross-origin` on every path but
Firebase's own `/__/**`, whose auth iframe the redirect sign-in frames
(`DENY` there would break it): the shape every Sabeel app serves, held by
`sabeel-ci check-app`. (Full CSP left as a separate, carefully-tested
follow-up. Real-account OAuth popup is a residual manual check.)
`firebase.json` sets only `Cache-Control`. No `X-Frame-Options`/`frame-ancestors`
(clickjacking), `X-Content-Type-Options: nosniff`, or `Referrer-Policy`.
- **Where:** `firebase.json` hosting `headers`.
- **Fix:** add `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin` (optionally a CSP).

### M7 — Production index probe is incomplete ✅ done (2026-07-22)
Added approval-queue, needs-attention, and approver-choices shapes.
`probeQueries` against prod returns OK for all 10 shapes.
The probe that catches missing/mis-directed composite indexes (the July-16
stale-week cause) omits live query shapes: approver-choices
`or(role==manager, admin==true)` (`users.ts:31`), approval queue
`(approverUid, status)` (`timesheets.ts:168`), rejected sheets `(uid, status)`
(`timesheets.ts:187`). Indexes are declared, but a future mis-edit wouldn't be
caught.
- **Where:** `functions/src/probe.ts`.
- **Fix:** add those three shapes.
- **Verify in emulator/prod:** re-run `probeQueries` after adding them.

---

## Low

### L8 — One high-severity transitive vuln ✅ done (2026-07-22)
`npm audit fix` patched `fast-xml-parser` (lockfile only); audit now shows only
moderate.
`fast-xml-parser` (DOCTYPE entity-expansion DoS), reached via `googleapis` —
which was removed entirely with the Drive sync on 2026-07-25. (Other 22 are
moderate Expo/RN noise.)
- **Fix:** `npm audit fix`, then re-test.

### L9 — Drive sync reads the entire `timeEntries` collection every run ❎ moot (2026-07-25)
The Drive sync was removed entirely, taking this with it.

### L10 — Public-invoker callables have no rate limiting ❎ accepted (2026-07-22)
`maxInstances: 10` caps cost; auth enforced in-code.
`setup.ts` `invoker: 'public'` (documented workaround). Unauthenticated calls fail
in-code but still spin instances; `maxInstances: 10` caps cost. Acceptable; noted.

### L11 — `dayKey` not validated against `start`+`timeZone` in rules ✅ partly done (2026-07-26)
Originally accepted as inherent: rules can't do IANA tz math, so `dayKey` was a
pure trust boundary. **Exact** validation is still impossible, but a *bound* is
not: every real UTC offset lies in [-12h, +14h], so the instant behind local day
D must fall in [D_utc − 14h, D_utc + 36h). `dayKeyPlausible` in `firestore.rules`
now enforces that on every entry write.
- Catches gross incoherence (an entry filed days from when it happened, which is
  what would move hours into the wrong week or past a period lock); does not catch
  an off-by-an-hour DST slip, and does not try to.
- Confirmed by probe **before** the fix: a `dayKey` three days from `start` was
  accepted. Now rejected, with both UTC-offset extremes still passing.
- **It immediately found a real defect in our own fixtures:** `rules.timeEntries`
  used `T0 = 1752570000000`, which is 2025-07-15, paired with `dayKey`s labelled
  2026-07-15 — a year of drift nothing had ever checked. Fixture corrected.

---

## Second pass — 2026-07-26

Prompted by M5b: if one "validated once, never revisited" bug existed, how many
more? Method differed from the 2026-07-21 review — **hypotheses were run against
the rules in the emulator, not reasoned about**. Ten probes; eight confirmed a
gap, two came back clean (malformed dayKeys and a dangling `approverUid` were
already rejected). All findings below are fixed.

### A1 — Hours logged on someone's behalf used the *writer's* timezone ✅ done
`createManualEntry` and `ManualEntryScreen` stamped `deviceTimeZone()` — the
manager's. A manager in Chicago entering 09:00–17:00 for someone in Singapore
recorded a Chicago instant with a Chicago `dayKey`, so the entry showed the wrong
hours and, near a week boundary, landed in the **wrong timesheet period** — a
locked one at worst. Straight contradiction of the work-local-timezone invariant,
and the edit path (`EntryEditScreen`) had always done it correctly.
- Now resolved from the TARGET's profile (`useUser` → `timeZone`, kept fresh by
  `App.tsx`), falling back to the device. Wall-clock input is interpreted via
  `epochFor` in that zone, and the on-behalf banner names the zone when it differs.

### A2 — Auto-close could silently rewrite an approved timesheet ✅ done
`closeStaleSessions` runs on the admin SDK and so bypasses the approved-period
lock every client obeys. Probing confirmed rules permit submitting a period that
still holds a running entry (only the client blocks it), so an approved period
could contain one — and the hourly job would then change its hours with no trace,
leaving the sheet's stored `totalMinutes` contradicting its own entries.
- Now: still closes (leaving someone clocked in forever is worse), then repairs
  the sheet's snapshot and raises a Sentry message. An approved period changing
  after the fact is exactly what must not be silent.

### A3 — Withdraw and reopen destroyed the approval record ✅ done
Both transitions **delete** the timesheet doc, so who approved a period, when, and
the fact it was later reopened simply vanished — the worst thing to lose in the
official record of an org's hours.
- New append-only `timesheetEvents`, written by the `onTimesheetWritten` trigger
  (server-side: a client could otherwise forge or omit the very events this
  exists to preserve), deny-all in rules, counted by the health canary. A delete
  from `approved` is recorded as a reopen, from anything else as a withdrawal.

### A4 — Losing access didn't evict a live session ✅ done
`applyUserAccess` never revoked refresh tokens, and rules trust the ID token,
which lives up to an hour. A connected client re-gates instantly (it watches
`claimsUpdatedAt`), but a backgrounded or offline one kept its rights.
- Now revokes on any loss of access (disable, demote, admin revoked).
  **Residual, unavoidable:** an ID token already in hand stays valid until it
  expires — Firestore rules cannot check revocation time.

### A5 — The weekly reminder skipped users silently ✅ done
`weeklyReminder` skips anyone with no recorded `timeZone`, and the write that
populates it swallows failures. If that write ever regressed the entire feature
would die while the schedule kept reporting success every hour.
- Now counts skips, and raises to Sentry when *no* active user is reachable —
  "nobody has a timezone" is a broken feature, not a quiet week.

### A6 — Rules hardening (all confirmed permitted by probe first) ✅ done
Entry `uid` and `activityName` are now non-empty; `activityId`/`uid` must exist
(create only — references don't rot, and re-reading on every clock-out is waste);
activity updates are validated like creates, with `createdAt`/`createdBy`
immutable (archiving used to be able to blank a name); push registration requires
an **active** account, while delete stays open to any signed-in owner so sign-out
cleanup survives being disabled mid-session; `displayName`/`photoURL` are typed
and bounded. See L11 for the `dayKey` bound.
- **Not fixed, by design:** a timesheet's `totalMinutes`/`entryCount` remain
  unverified against real entries. Rules cannot aggregate, and it doesn't matter —
  reports recompute from entries (see "Verified solid"). The figure is display-only.
- **Not fixable:** a member can still choose a display name matching a colleague's.
  Names legitimately collide; reports and CSV carry the email alongside.

### A7 — Overlap detection missed overnight collisions ✅ done
`overlappingEntryIds` grouped by `dayKey`, but an overnight entry carries the day
it *started* — so 23:00–01:00 could never be seen to collide with the next day's
00:30–02:00. Now compared on absolute instants, which is also correct across
entries in different timezones.

### A8 — Session snapshot ordering ✅ done
`handleSnapshot` awaits a token read (up to 8s), so two snapshots in flight could
finish out of order and let an older profile overwrite a newer one. Sequence guard
added; `stopWatching` invalidates in-flight work so a sign-out can't be undone by
a late emit.

---

## Verified solid (on record, no action)

- **Period math ↔ rules** (`periodKeyFor` vs `periodKeyOf`): epoch-day/`dowSun0`
  derivations match, month-clipping agrees, property-tested 2024–2027. Linchpin
  of the lock model; holds.
- **Timesheet lifecycle rules:** correct `hasOnly` guards; stamp checks use
  `resource` not `request.resource`; client writes match allowed key sets.
- **Reporting integrity:** totals recompute from approved entries; the
  client-supplied `totalMinutes` snapshot is display-only (hence M2 targets the
  *entry* `durationMinutes`, not the snapshot).
- **Disable propagation:** `session.ts` watches `claimsUpdatedAt` and force-refreshes
  the token when it moves, so an online user re-gates within a second. Refresh
  tokens are now revoked too (A4); residual is a live ID token within its ≤1h TTL.
- **`useLiveQuery`/`useLiveDoc`**, auth seams, `guarded()` (rethrows, excludes
  HttpsError from Sentry, flushes), secret hygiene (`debug.keystore` intentional;
  no real secrets tracked), callable auth guards.

---

## Not verified this session
Static review only — no dynamic rules execution, no index build, no load test, no
supply-chain/license audit. Emulator was intentionally not run (shared machine).

### Emulator checklist (run when the machine is free)
1. Rules `get()` budget on a cross-period entry edit (approver moving an entry
   between two submitted periods) stays under the 10-access limit.
2. The `or()` approver query executes without demanding an undeclared index.
3. M2 fix (if applied) still passes legitimate rounded durations.
4. M5 fix (if applied) blocks manager self-stamp, keeps admin self-approve, and
   lets already-stamped sheets decide.
5. Full `npm run test:emulator` + `npm run test:e2e` after any rule change; re-run
   `probeQueries` once M7 shapes are added.

---

## Changelog
- 2026-07-21 — Initial review; H1, M2–M7, L8–L11 opened.
- 2026-07-22 — Executed the hardening plan. H1/M2/M3/M4/M6/M7/L8 fixed and
  deployed (backend+web + APK v1.0.0-beta.15); M5 won't-fix; L9 deferred;
  L10/L11 accepted. Full suites green (33 shared, 23 functions unit, 88
  emulator, e2e); prod verified (probe all-OK, headers live, sign-in clean,
  M2 pre-flight 0 violators).
- 2026-07-25 — M5 settled as by-design (managers may self-approve); M5b found and
  fixed in the same batch.
- 2026-07-26 — Second pass, emulator-driven. A1–A8 opened and all fixed; L11
  upgraded from accepted to bounded. 111 emulator tests + 47 unit + e2e green.
  **Method note for the next pass:** every finding here came from running a
  hypothesis against the rules, and the one claim made by inspection alone
  (a self-approver escaping the submitted-period freeze) was wrong. Probe, then
  pair each `assertFails` with a positive control — several existing tests were
  passing for reasons other than the one they named.
- 2026-10-22 — M6 moved to the Sabeel apps' shared Hosting shape: `DENY` and
  `frame-ancestors 'none'` everywhere but `/__/**`, in place of
  `SAMEORIGIN` on every path.
