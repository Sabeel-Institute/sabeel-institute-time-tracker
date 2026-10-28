# Sabeel Institute Time Tracker — User Manual

*For app version 0.30.1 · July 2026*

Welcome! This guide explains everything you can do in the Sabeel Institute Time
Tracker — from logging your first hour to approving your team's timesheets. It is
organized by role: **everyone** starts with Part 1; **managers/approvers** add
Part 2; **admins** add Part 3. Part 4 is a quick "How do I…?" index you can skim
any time.

The app works the same on the website
(https://sabeel-institute-time-tracker.web.app), the Android app and the iPhone
app — same account, same data, live everywhere.

**Getting the phone app.** Android: [Google Play](https://play.google.com/apps/internaltest/4701451587936876375),
by invitation from your administrator. iPhone: TestFlight, by invitation from
your administrator.

---

## The big picture (2 minutes)

1. **You log hours** against an *activity* — either by clocking in and
   out while you work, or by adding hours manually afterwards. Every hour
   belongs to a **week** (Sunday to Saturday, never crossing a month boundary —
   so the first or last week of a month can be short).
2. **At the end of the week you submit a timesheet.** That freezes the week and
   sends it to your **approver** — a manager you pick once, in the app.
3. **Your approver approves it** (it becomes official and counts in reports) or
   **rejects it with a reason** (it comes back to you to fix and resubmit).
4. **Official reports count approved timesheets only.** Until a week is
   approved, its hours exist but aren't part of the official record.

That's the whole system. Everything below is detail.

---

# Part 1 — For everyone

## 1.1 Signing in

![Sign-in screen](manual/img/signin.png)

Open the app or website and tap **Sign in with Google**. Google's account
chooser appears — pick your account (or "Use another account" to switch).
There are no passwords to remember; access is entirely through your Google
account. (**Sign in with email**, under the Google button, is not for staff
accounts: always use Google.)

**The very first time, sign in on the website**
(https://sabeel-institute-time-tracker.web.app) with your `@oursabeel.com`
account. That is what creates your account. The phone apps only sign in
accounts that already exist: until you have signed in on the website once, they
say *"This account isn't set up for the app yet. Contact your administrator."*

The **Privacy policy** link under the sign-in card (and at the bottom of Home)
says what the app stores and how to ask for your account to be deleted.

### First time? You'll wait for approval

![Pending approval](manual/img/pending.png)

New accounts land on an **"Almost there"** screen. An administrator has to
approve your account before you can use the app — this screen updates by
itself the moment they do, no refresh needed. If you seem stuck here, contact
your admin.

The very first sign-in can show **"Setting up your account…"** for a few
seconds while the account is made. If that takes unusually long, the app says
**"Still setting up your account. Try again in a minute."**: wait a minute and
tap **Try again**. **"Can't sign in"** appears only for an address outside
`@oursabeel.com`, which the app does not accept.

### Then, once: the institute's rules

![The institute's rules](manual/img/rules.png)

Once you are approved, the app shows the institute's rules before anything
else: what you post is seen only by members of your team, post only what
belongs to your work, and nothing abusive, harassing, hateful, sexual or
otherwise objectionable. Read them and tap **I agree**. You see them once: not
again on this device or any other, and not after signing out and in. Until you
agree, nothing else in the app opens (**Sign out** is there if you would rather
not continue).

## 1.2 Your home screen

![Home screen](manual/img/home-member.png)

From top to bottom:

- **Today's total** — hours logged so far today.
- **This week strip** — the current week's dates and its timesheet status
  (*Not submitted*, *Awaiting approval*, *Approved*, or *Rejected*). Tap it to
  open the week.
- **Clock in card** — pick what you're working on and clock in.
- **Add hours manually / My timesheet** — the other two things you'll use daily.
- **My timesheet approver** — who approves your weeks (see 1.5).
- **Notification settings** — choose which push notifications you get (see 1.9).
- **Report a problem** — tell the institute's administrators about something
  or someone in the app (see 1.11).
- If a timesheet of yours was rejected, a **red banner** appears at the very
  top — tap it to fix things (see 1.7).

Managers and admins see extra buttons here (Approvals, Reports, Activities,
Manage users) — covered in Parts 2 and 3.

## 1.3 Logging hours

### Clocking in and out (live tracking)

![Clocked in](manual/img/clocked-in.png)

1. On Home, tap **Pick an activity**, search or scroll, tap one.
2. Tap **Clock in**. The raspberry card shows what you're working on and a
   running clock.
3. When you finish, tap **Clock out**. The session becomes an entry on today's
   timesheet.

Good to know:

- You can only have **one running session** at a time.
- Forgot to clock out? Sessions are **automatically closed after 12 hours**
  and marked "auto-closed" — edit the entry afterwards to correct the times.
- The app reminds you on-screen once a session passes 8 hours.

### Adding hours manually

![Add hours manually](manual/img/add-hours.png)

For work you didn't clock (yesterday's event, off-site work):

1. Home → **Add hours manually**.
2. Pick the activity, the date (**Today** / **Yesterday** shortcuts, or the
   date picker), and the from/to times with the time pickers.
3. Watch the **"= 8h 00m"** line under the times — it shows the duration you're
   about to save, so AM/PM mistakes jump out before you save.
4. Optionally describe what you did, then **Save hours**.

### Copying last week

If your weeks look alike: open an **empty** week in My timesheet and tap
**"Copy last week's hours"**. Every entry from the previous week is copied to
the same weekday and time, ready to adjust. (Only offered while the week has
no entries yet.)

## 1.4 Your timesheet week by week

![My timesheet](manual/img/timesheet.png)

Home → **My timesheet**. What you're looking at, top to bottom:

- **The month and year**, with **‹ › arrows** that step month by month.
- **Week chips** — one per week of the month; tap a chip to open that week.
  The colored dots are a status legend (also printed right below the chips):
  - **sage/green dot** — hours logged, not submitted yet (work in progress)
  - **gold dot** — submitted, awaiting the approver
  - **raspberry dot** — approved (final)
  - **red dot** — rejected (needs your attention)
  - **no dot** — empty week
- **Week total** — the selected week's hours, with its status next to it.
- **Day groups** — each day's entries with times and durations. **Tap an entry
  to edit or delete it** (activity, date, times, note). Times you leave alone
  stay exactly as they were clocked. On a session that ran past midnight, a
  **To** earlier than **From** is the next morning.
- Future weeks are dimmed — there's nothing to do there yet. Wandered off?
  **Jump to current week** brings you back.

### Overlapping entries

![Overlapping entries](manual/img/overlap.png)

Two entries on the same day whose times overlap are **highlighted in red**
("Overlaps another entry") — usually a double-log or an AM/PM slip. A week
with overlaps **can't be submitted** until you fix the times (tap an entry to
edit it). Back-to-back entries are fine: one ending at 2:00 PM and the next
starting at 2:00 PM don't overlap.

## 1.5 Picking your approver (one-time setup)

Before your first submission, tell the app who approves your hours: on Home,
under **My timesheet approver**, tap the selector and pick from the list of
managers. This is sticky — it applies to all future submissions until you
change it. Changing it never affects a timesheet you've already submitted.

If you are a manager or an admin yourself, your own name appears at the bottom
of the list as **"(myself)"** — managers and admins may approve their own hours.
Even then you still submit first and approve after: a submitted week is locked
to you like anyone else's, so withdraw it if you need to make a change.

*Can't submit and see "Pick your timesheet approver on the home screen
first"?* This is why.

## 1.6 Submitting your week

![Submitted week](manual/img/submitted.png)

1. Open the week in **My timesheet** and give it a once-over.
2. Tap **Submit timesheet**. The status turns **Submitted** (gold) and the
   week **locks** — you can't add or edit entries while your approver has it.
3. Change your mind? **Withdraw submission** unlocks it (only until it's
   approved).

Rules of thumb:

- You can submit the **current week early** (say, Friday) — but you can't log
  more hours into it afterwards without withdrawing first. If you're clocked
  in, clock out before submitting.
- **Overlapping entries block submission** (see 1.4) — fix the highlighted
  times first.
- **Past weeks can be submitted any time, in any order.** No deadlines.
- **Empty weeks can be submitted too** ("Submit timesheet (no hours)") — useful
  to close out a week you were away.
- Future weeks can't be submitted.

## 1.7 When a timesheet is rejected

![Needs attention list](manual/img/needs-attention.png)

If your approver rejects a week, a **red banner appears on Home**. Tap it to
open **Needs attention** — a single list of every rejected week (even from
months back), each showing the approver's reason, who rejected it, and when.

![Rejected week](manual/img/rejected-week.png)

Tap a row and you land on that week, with the reason at the top:

1. Fix the entries the reason points at (tap to edit, add what's missing).
2. Tap **Resubmit timesheet**. It goes back to your approver, and the item
   disappears from Needs attention.

## 1.8 After approval

![Approved week](manual/img/approved.png)

An approved week shows **Approved** and is locked for everyone — that's what
makes it official. Spot a mistake after approval? Ask an **admin** to reopen
the week; it returns to draft and goes through submit → approve again.

## 1.9 Notifications

![Notification settings](manual/img/notification-settings.png)

The app sends push notifications so nothing sits unnoticed:

- **Your timesheet was rejected** (with the reason) or **approved**.
- *Approvers:* someone **submitted or resubmitted** a timesheet to you.
- *Admins:* a **new account** is waiting for approval.
- A **submit reminder** — if last week has logged hours that were never
  submitted (or a rejected sheet), you get a nudge on **Tuesday morning** in
  your local timezone, and then **daily** until you submit it. Weeks with
  nothing to submit don't nag.

**Tapping a notification opens the screen it is about**, not just the app: a
decision on your timesheet opens that week; a submission opens that person's
week ready to review; a new account request opens the user list. This works from
a closed app too — the app finishes signing you in first, then goes there. In a
browser it opens in the tab you already have open, or in a new one.

Push notifications need the device's own permission. The app never asks by
itself: it offers to set it up once, with an **Enable notifications** card on the
Home screen after you sign in — or you can open Home → **Notification settings**
any time and use **Enable notifications**. The phone's own question appears only
when you tap one of those (on an iPhone it can be asked only once, so answer
**Allow**). If they have
been blocked, that button becomes **Open settings** on a phone; in a browser,
allow them from the site settings behind the icon in the address bar. That screen
also lets you switch each kind off individually; the **weekly reminder has its own switch**, so
people who don't submit every week can silence the nagging while keeping the
important notifications on.

On Android these all arrive under one entry in the phone's own notification
settings — **Timesheet alerts and reminders**. Turning that entry off silences
every kind at once, whatever the switches inside the app say.

Notifications follow the account signed in on the device: signing out stops
this phone or browser from receiving that account's notifications.

## 1.10 Switching accounts / signing out

**Sign out** is at the bottom of Home. Signing out fully clears your Google
session in the app, so the next sign-in always shows Google's account chooser —
that's how you switch between accounts.

## 1.11 Reporting a problem

![Report a problem](manual/img/report-problem.png)

If something in the app breaks the institute's rules (a note, an entry, a
rejection reason) or someone is behaving badly, or anything else is wrong, tap
**Report a problem** on Home. Say what or who you are reporting and what is
wrong, in your own words: name the week, the entry or the person, so an
administrator can find it. Then tap **Send**.

- **"Sent. An administrator will reply by email within a day."** Your report
  has gone to the institute's administrators, with your name and email
  address. They reply to you by email, and act on it by correcting or removing
  the content or disabling the account.
- **"Your report was saved but the email did not go out; it will be looked
  at."** The report is kept in the app, and the administrators will see it
  there. You need not send it again.
- If you go **Back** before sending, what you typed is still there when you
  come back.
- You can send up to five reports an hour.

---

# Part 2 — For managers & approvers

Managers see three extra buttons on Home — **Approvals**, **Reports**, and
**Activities** — plus **Manage users** (approver assignment).

## 2.1 Approving timesheets

![Approvals queue](manual/img/approvals.png)

Home → **Approvals**. The badge on the button shows how many submissions are
waiting for *you* (you see the sheets whose submitters picked you as their
approver; admins also get an "All submitted" toggle to see everyone's queue).

![Reviewing a timesheet](manual/img/review.png)

Tap a submission to review it:

- Every day of the week is laid out Sunday→Saturday, including empty days —
  so missing days are as visible as logged ones.
- **Tap any entry to correct it** (times, activity, note) — your edit is
  flagged "corrected" on the entry.
- **Add entry for {name}** logs hours on the person's behalf (e.g. they forgot
  their Saturday setup hours). **Times are read in *their* timezone, not yours** —
  enter the hours as that person worked them, and if their zone differs from
  yours the screen says so under their name. That way an entry always means what
  the person actually did, whoever typed it in.
- Then either:
  - **Approve timesheet** — the week becomes official and locks, or
  - type a reason and **Reject timesheet** — it returns to the owner, who sees
    your reason word for word. A reason is required; "fix it" helps nobody.

Use the **‹ › arrows** on this screen to step through the person's other
weeks — you can review or correct any non-approved week, not just the
submitted one.

## 2.2 Browsing someone's timesheets (before they submit)

Reports → tap a person in the **By person** list → **View timesheets**. Same
week-by-week view as above — handy mid-week to see how someone's week is
shaping up, or to add hours they forgot, without waiting for a submission.

## 2.3 Activities

![Activities](manual/img/activities.png)

Home → **Activities**. Create the activities people log hours against — a
name is all it takes, whether it's an ongoing program ("Tutoring") or a
one-off event ("Food Drive").

**Archive** an activity to take it out of the pickers. Archived activities
wait at the bottom of the list under **Archived**, closed until you open it,
and keep their history in every report. **Restore** brings one back.

An admin can also **Delete** an archived activity. It can't be undone, and the
hours already logged under it keep its name.

## 2.4 Reports & exports

![Reports](manual/img/reports.png)

Home → **Reports**:

- **Period** — this week / this month / this year / all time.
- **Person / Activity** — searchable filters; default is everyone/everything.
- **Hours counted** — the important switch:
  - **Official (approved only)** — the default. Only hours from *approved*
    timesheets. This is the number for the board, grants, and records.
  - **Include unapproved** — adds hours still awaiting approval (marked
    unofficial; CSV exports get an `_unofficial` filename so nobody mistakes
    them).
- **Export CSV** — downloads the filtered entries with person, email,
  activity, date, times, timezone, and hours per row.

![Person detail](manual/img/person-detail.png)

Tapping a person shows their lifetime approved hours by activity, plus
**Print statement** (on the website) — a clean printable statement of their
volunteer hours, e.g. for school credit letters.

### A note on timezones

Every entry remembers *where* it happened. Someone working 9:00–17:00 in
Singapore shows 9:00–17:00 on the correct day for every viewer — reports never
shift hours into the viewer's timezone.

---

# Part 3 — For admins

Admins manage people. On Home: **Manage users** (admins also see Approvals —
an admin can approve or reject *any* submitted timesheet, including their own).

## 3.1 Approving new users

![Approving a new user](manual/img/users-pending.png)

When someone signs in for the first time they appear in **Manage users** with a
gold *pending* card showing their name and email — the Home button reads
**"Manage users (1)"** while requests are waiting, and admins get a push
notification. Tap **Approve** and their screen unlocks live, wherever they are.

## 3.2 Managing a user

![User controls](manual/img/users-controls.png)

Each active user's card shows their state directly:

- **Approver** — who approves their timesheets. Set it here, or let them pick
  their own on their home screen. (Managers can set this for non-admins too.)
  A manager or admin may be listed as their own approver. Note that **changing
  someone's role, or disabling them, clears every approver pointing at them** —
  those people will be asked to pick a new approver before their next submission.
- **Role: member | manager** — managers get Approvals, Reports, and
  Activities.
- **Admin** — the full-control switch (see below).
- **Active** — turn off to disable an account: they're locked out immediately
  and can't log hours. Turn back on to restore. Nothing is ever deleted.

Every change asks for confirmation, so a stray tap can't promote or disable
anyone. You cannot demote, disable, or un-admin **yourself** — so the
organization can never lock itself out.

![Admin confirmation](manual/img/admin-confirm.png)

**Grant admin sparingly.** As the dialog says: an admin can approve, disable,
and manage *any* user, grant admin to others, change roles, and reopen
approved timesheets. Admin is different from manager — a manager runs the
operation (activities, reports, approvals); an admin controls the people.

## 3.3 Reopening an approved timesheet

Approved weeks are locked for everyone — except that an admin can **reopen**
one: open the person's week (Reports → person → View timesheets, or your own
in My timesheet) and tap **Reopen (admin)**. The week returns to draft; the
owner fixes it and it goes through submit → approve again. Use it for genuine
mistakes discovered after the fact.

## 3.4 Odds and ends

- **Reports from "Report a problem"** arrive by email at
  `apps-reports@oursabeel.com`, not in the app; nobody reviews them inside it.
  Each says who sent it (name, email, role), when, from which app version, and
  what they wrote. **Reply** to the email to answer them (it goes to the
  person), and act through the app's ordinary screens: correct or delete the
  entry, or disable the account (3.2), which signs them out and keeps them
  out. The rules promise a response **within 24 hours**.
- **First admin** of the system is created once during deployment; every
  further admin is granted in-app with the Admin switch.
- **Error banner**: if a red "Live data error" bar ever appears at the top of
  a screen, the app couldn't load live data (permissions or connectivity).
  It's also reported automatically to the error dashboard — tell the developer,
  mentioning what you were doing.

---

# Part 4 — "How do I…?" quick answers

**…log the hours I worked right now?**
Home → pick the activity → Clock in → work → Clock out.

**…log yesterday's hours?**
Home → Add hours manually → date "Yesterday" → set times → Save hours.

**…fix a wrong entry?**
Home → My timesheet → open the week → tap the entry → change → Save changes.

**…delete an entry?**
Tap the entry, then **Delete entry**.

**…submit my week?**
My timesheet → check the week → Submit timesheet. (Clock out first; pick an
approver once if you haven't.)

**…submit a week I missed a while ago?**
My timesheet → ‹ back to its month, tap its week chip → Submit. Old weeks have
no deadline. Empty weeks can be submitted as "(no hours)".

**…add more hours after I submitted?**
Withdraw submission (while it's still awaiting approval) → add hours →
Submit again. If it was already approved, ask an admin to reopen it.

**…see why my timesheet was rejected, and fix it?**
Tap the red banner on Home → tap the rejected week → read the reason → fix
entries → Resubmit timesheet.

**…change who approves my timesheets?**
Home → My timesheet approver → pick someone else. Applies from your next
submission.

**…sign in with a different Google account?**
Sign out (bottom of Home) → Sign in with Google → the account chooser appears.

**…use the phone app when it says "This account isn't set up for the app yet"?**
Sign in once on the website (https://sabeel-institute-time-tracker.web.app)
with the same account; that creates it. Then sign in on the phone.

**…report something or someone?**
Home → Report a problem → say what or who, and what is wrong → Send. An
administrator replies by email within a day.

**…stop the weekly reminder without losing other notifications?**
Home → Notification settings → switch off **Weekly submit reminder**.

**…approve or reject someone's week?** *(managers)*
Home → Approvals → tap the submission → Approve, or type a reason and Reject.

**…add hours for someone who forgot?** *(managers)*
Approvals → their submission → "Add entry for {name}". Or before they submit:
Reports → the person → View timesheets → Add entry.

**…create a new activity?** *(managers)*
Home → Activities → name it → Add.

**…get official hours for a grant report?** *(managers)*
Reports → set the period → keep "Official (approved only)" → Export CSV.

**…print a volunteer's hours statement?** *(managers, website)*
Reports → tap the person → Print statement.

**…let a new team member in?** *(admins)*
They sign in once with Google → Manage users → Approve on their pending card.

**…make someone a manager / an admin?** *(admins)*
Manage users → their card → flip Role to manager, or the Admin switch →
confirm the dialog.

**…disable someone who left?** *(admins)*
Manage users → their card → Active switch off → confirm. Their history stays.

**…fix an already-approved week?** *(admins)*
Open that week → Reopen (admin) → the owner fixes and resubmits.

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| "Update needed" when the app opens | This version of the phone app is too old to keep working | Tap **Open Google Play** (or **Open TestFlight** on an iPhone) and install the update; nothing you recorded is lost |
| "Almost there" screen after signing in | Your account awaits admin approval | Ask your admin; the screen unlocks by itself once approved |
| "Still setting up your account. Try again in a minute." | Your new account is taking longer than usual to be made | Wait a minute and tap **Try again** |
| "Can't sign in" | The address is not an `@oursabeel.com` account | Sign out and sign in with your `@oursabeel.com` Google account |
| "Before you continue" screen | The institute's rules, shown once to every account | Read them and tap **I agree** |
| "Your report was saved but the email did not go out" | The report is kept, but its email failed | Nothing: the administrators will see it; no need to send it again |
| "Pick your timesheet approver…" when submitting | No approver chosen yet | Home → My timesheet approver → pick one |
| "This week's timesheet is submitted/approved…" when clocking in | The current week is locked | Withdraw the submission (or ask an admin to reopen an approved week) |
| "Clock out before submitting this week" | A session is still running | Clock out, then submit |
| An entry is outlined red: "Overlaps another entry" | Two entries on that day have overlapping times | Tap one and fix its times; submission unlocks once no entries overlap |
| No push notifications arriving | Permission not granted on this device, or that kind is switched off | Allow notifications when the app asks (or in system settings), and check Home → Notification settings |
| Red "Live data error" bar | The app couldn't load live data | Check connectivity; if it persists, tell the developer — it's also auto-reported |
| A week chip has a red dot | That week was rejected | Tap the red banner on Home → fix → resubmit |

*Manual source: `docs/USER-MANUAL.md` (images in `docs/manual/img/`). PDF:
`docs/USER-MANUAL.pdf`. Update both together when the app changes.*
