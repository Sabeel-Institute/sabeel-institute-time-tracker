/**
 * THE FILMS' SCRIPTS: one per film `HELP_VIDEOS` lists, in its order. Each
 * step pairs a line of narration (`say`) with what happens on screen while it
 * is said (`do`); the step lasts as long as its line. `cut` keeps a step to the
 * phone or the computer film.
 *
 * Written as a friendly colleague talking someone through the screen:
 * contractions, "you", whole sentences, a short reason where it helps. Never a
 * label read out. Read each line aloud before rendering it; a reworded line is
 * rendered again (`sabeel-ci films tts`).
 *
 * `t` is ci-tools' film helpers (lib/films/record.mjs) and films.mjs's own:
 * `tabOf`, `moreRow`, `inSheet`, `entryRow`, `devSignIn`. The world is
 * world.mjs's: Sara is a member whose hours Omar approves; Amina is the admin.
 * Weeks come from `t.world.weeks`, never from dates written here.
 */
import { periodLabel } from '@sabeel/shared';
import { PEOPLE } from './world.mjs';

/** The form's browser time box: 0 is From, 1 is To. */
const timeBox = (t, n) => t.page.locator('input[type="time"]').filter({ visible: true }).nth(n);

/** The form's browser date box. */
const dateBox = (t) => t.page.locator('input[type="date"]').filter({ visible: true }).first();

/** A group of pills, as a whole: the weeks of the month, the periods of Reports. */
const pills = (t, name) => t.page.getByRole('radiogroup', { name, exact: true }).filter({ visible: true }).first();

/** The key under the week pills: the dots and what each one means. */
const legend = (t) => t.text('in progress').locator('xpath=../..');

/** The button `name` on the list row that shows `label`. */
const onRow = (t, label, name) =>
  t.page
    .locator('div')
    .filter({ has: t.page.getByText(label, { exact: true }) })
    .filter({ has: t.page.getByRole('button', { name, exact: true }) })
    .last()
    .getByRole('button', { name, exact: true });

/**
 * A week's pill tapped, a month back first only when the week is not in the
 * month shown: right whatever day the film is recorded on.
 */
async function openWeek(t, week) {
  const label = periodLabel(week).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pill = t.radio(new RegExp(`^${label}(,|$)`));
  if (!(await pill.isVisible())) await t.tap(t.btn('Previous month'));
  await t.tap(pill);
}

/** The way back that every pushed screen's header carries: "<screen>, back". */
const back = (t) => t.link(/,\s*back$/i);

/** Open a picker and choose from it, holding the list on screen long enough to read. */
async function pick(t, field, option) {
  await t.tap(field);
  await t.wait(1500);
  await t.tap(t.inSheet(option));
}

/** Open More and one of its rows. */
async function openMore(t, row) {
  await t.tap(t.tabOf('more'));
  await t.tap(t.moreRow(row));
}

export const FILMS = [
  // ---------------------------------------------------------------- everyone
  {
    id: 'signing-in',
    start: '',
    steps: [
      {
        say: "Welcome! This is the sign-in screen. You sign in with your institute Google account, so there's no new password to remember.",
        do: (t) => t.highlight(t.btn('Sign in with Google')),
      },
      {
        say: "So tap Sign in with Google, and choose your institute account when Google asks.",
        do: async (t) => {
          await t.fakeTap(t.btn('Sign in with Google'));
          await t.devSignIn(t.world.newcomer.email);
          await t.waitFor(t.text('Almost there'), 40000);
        },
      },
      {
        say: "The first time, you'll land here, because an administrator has to approve your account before you can use the app.",
        do: (t) => t.highlight(t.text('Almost there')),
      },
      {
        say: "There's nothing you need to do. Just leave this open, and it moves on by itself as soon as you're approved.",
        do: async (t) => {
          await t.wait(2500);
          await t.world.setAccess(await t.world.uidOf(t.world.newcomer.email), { status: 'active', role: 'member', admin: false });
          await t.waitFor(t.text('Before you continue'), 30000);
        },
      },
      {
        say: "Next come the institute's rules. They're short, so give them a read. You'll only see them this once.",
        do: (t) => t.highlight(t.text('Before you continue')),
      },
      {
        say: "They also tell you where to go if something's wrong: Report a problem, which you'll find under More.",
        do: (t) => t.highlight(t.text('Report a problem')),
      },
      {
        say: "Once you've read them, tap I agree to carry on.",
        do: (t) => t.tap(t.btn('I agree')),
      },
      {
        say: "And you're in! This is Today, where you clock in and keep an eye on your hours.",
        do: (t) => t.waitFor(t.text('What are you working on?'), 30000),
      },
    ],
  },
  {
    id: 'getting-around',
    as: PEOPLE.omar.email,
    start: '',
    steps: [
      {
        say: "On a phone, the tabs sit along the bottom of the screen, and they stay there wherever you go in the app.",
        cut: 'phone',
        do: (t) => t.highlight(t.tabOf('today')),
      },
      {
        say: "On a computer, the same tabs run down the left-hand side instead, and they stay put wherever you go.",
        cut: 'computer',
        do: (t) => t.highlight(t.tabOf('today').locator('xpath=..')),
      },
      {
        say: "Today is where the app opens. It's your clock, and a quick look at how your day and your week are going.",
        do: (t) => t.highlight(t.text('What are you working on?')),
      },
      {
        say: "Timesheet shows your week, day by day. It's also where you send your hours to your approver.",
        do: async (t) => {
          await t.tap(t.tabOf('timesheet'));
          await t.waitFor(t.text(/logged$/));
        },
      },
      {
        say: "You're a manager, so you also get Approvals, which shows a number when someone's waiting on you, and Reports for the totals.",
        do: async (t) => {
          await t.highlight(t.tabOf('approvals'));
          await t.highlight(t.tabOf('reports'));
        },
      },
      {
        say: "And More holds everything else. Tap it, and you'll see People, Activities, your notifications and so on.",
        do: async (t) => {
          await t.tap(t.tabOf('more'));
          await t.highlight(t.moreRow('People'));
        },
      },
      {
        say: "Help is in there too. It has short films like this one, so you can come back whenever you need a reminder.",
        do: (t) => t.highlight(t.moreRow('Help')),
      },
      {
        say: "Whenever you're lost, those tabs are one tap away, and Today is always a good place to start again.",
        do: async (t) => {
          await t.tap(t.btn('Close'));
          await t.tap(t.tabOf('today'));
        },
      },
    ],
  },
  {
    id: 'clocking',
    as: PEOPLE.sara.email,
    start: '',
    steps: [
      {
        say: "This is Today, the screen the app opens on. The card at the top is your clock.",
        do: (t) => t.highlight(t.text('What are you working on?')),
      },
      {
        say: "First, pick what you're working on. Tap the box and choose an activity from the list.",
        do: async (t) => {
          await t.tap(t.text('Pick an activity'));
          await t.tap(t.inSheet('Tutoring'));
        },
      },
      {
        say: "Then tap Clock in, and your time is running.",
        do: (t) => t.tap(t.btn('Clock in')),
      },
      {
        say: "While you're clocked in, the card says what you're on and how long you've been at it.",
        do: (t) => t.highlight(t.text('CLOCKED IN')),
      },
      {
        say: "You can close the app or put your phone away. The clock keeps going without you.",
        do: (t) => t.wait(200),
      },
      {
        say: "When you're done, come back and tap Clock out.",
        do: (t) => t.tap(t.btn('Clock out')),
      },
      {
        say: "Your time is saved as an entry, and you'll see it add up under So far.",
        do: (t) => t.highlight(t.text('So far')),
      },
    ],
  },
  {
    id: 'adding-hours',
    as: PEOPLE.sara.email,
    start: '',
    steps: [
      {
        say: "Forgot to clock in? You can add the hours afterwards. Tap Add hours, just under the clock on Today.",
        do: async (t) => {
          await t.highlight(t.btn('Add hours'));
          await t.tap(t.btn('Add hours'));
        },
      },
      {
        say: "Start by choosing what you were working on. Tap the box and pick an activity from the list.",
        do: (t) => pick(t, t.text('Pick an activity'), 'Youth Mentoring'),
      },
      {
        say: "Then pick the day. Today and Yesterday are right there, or you can change the date for any other day.",
        do: (t) => t.highlight(t.radio('Yesterday')),
      },
      {
        say: "Now set when you started and finished. The app adds up how long that is, so you can spot a morning and afternoon mix-up.",
        do: async (t) => {
          await t.fill(timeBox(t, 0), '12:00');
          await t.fill(timeBox(t, 1), '13:00');
          await t.highlight(t.text(/^That's /));
        },
      },
      {
        say: "If it helps, add a note about what you did. Your approver will see it, and it's optional.",
        do: (t) => t.type(t.label('What did you work on? (optional)'), 'Lunchtime mentoring session.'),
      },
      {
        say: "When everything looks right, tap Save hours and you're done.",
        do: (t) => t.tap(t.btn('Save hours')),
      },
      {
        say: "It counts straight away. Here it is on your timesheet, marked as added by hand so everyone can tell it wasn't clocked.",
        do: async (t) => {
          await t.tap(t.tabOf('timesheet'));
          await t.highlight(t.entryRow('Youth Mentoring'));
        },
      },
    ],
  },
  {
    id: 'fixing-an-entry',
    as: PEOPLE.sara.email,
    start: '',
    steps: [
      {
        say: "Spotted a mistake? Open the Timesheet tab, where your week's entries are listed day by day.",
        do: (t) => t.tap(t.tabOf('timesheet')),
      },
      {
        say: "Tap the entry you want to change. You can fix the activity, the day, the times or the note.",
        do: (t) => t.tap(t.entryRow('Tutoring')),
      },
      {
        say: "Say you stayed longer than you wrote down. Change the end time, and the length underneath updates as you go.",
        do: async (t) => {
          await t.fill(timeBox(t, 1), '12:00');
          await t.highlight(t.text(/^That's /));
        },
      },
      {
        say: "Then tap Save changes. You land back on your week, with the entry showing its new time.",
        do: async (t) => {
          await t.tap(t.btn('Save changes'));
          await t.highlight(t.entryRow('Tutoring'));
        },
      },
      {
        say: "To remove an entry altogether, open it the same way.",
        do: (t) => t.tap(t.entryRow('Food Drive')),
      },
      {
        say: "Delete entry sits well away from Save so you won't hit it by mistake, and it always asks you first, because it can't be undone.",
        do: async (t) => {
          await t.tap(t.btn('Delete entry'));
          await t.wait(2400);
        },
      },
      {
        say: "And it's gone, and its hours have come off your week's total.",
        do: async (t) => {
          await t.waitGone(t.entryRow('Food Drive'));
          await t.highlight(t.text(/logged$/));
        },
      },
    ],
  },
  {
    id: 'timesheet',
    as: PEOPLE.sara.email,
    start: '',
    steps: [
      {
        say: "The Timesheet tab shows your week. At the top is the month, with a pill for each of its weeks.",
        do: async (t) => {
          await t.tap(t.tabOf('timesheet'));
          await t.highlight(pills(t, 'Week'));
        },
      },
      {
        say: "The dot on a pill says where that week stands, and the key just underneath tells you what each colour means.",
        do: (t) => t.highlight(legend(t)),
      },
      {
        say: "To look further back, tap an earlier week. The arrows beside the month go back a whole month at a time.",
        do: (t) => openWeek(t, t.world.weeks.PREV),
      },
      {
        say: "Your approver sent this week back, which is why it has a red dot. The reason is shown right at the top.",
        do: (t) => t.highlight(t.text(/^Rejected by/)),
      },
      {
        say: "Tap another pill to open that week. This one has a green dot, which means it's approved.",
        do: (t) => openWeek(t, t.world.weeks.PREV2),
      },
      {
        say: "An approved week is closed, so its entries can't be changed. Only an administrator can reopen it.",
        do: (t) => t.highlight(t.text(/^Approved, so this week is closed/)),
      },
      {
        say: "To get back to the present, tap Back to this week, and you're looking at your current week again.",
        do: (t) => t.tap(t.link('Back to this week')),
      },
    ],
  },
  {
    id: 'submitting',
    as: PEOPLE.sara.email,
    start: '',
    steps: [
      {
        say: "When your week's done, open the Timesheet tab and scroll down below your entries. Under Approver you'll see who it goes to.",
        do: async (t) => {
          await t.tap(t.tabOf('timesheet'));
          await t.highlight(t.text('Approver'));
        },
      },
      {
        say: "That's the person who checks your hours. Tap the box if you need to choose someone else.",
        do: (t) => pick(t, t.text('Omar Siddiqui'), 'Omar Siddiqui'),
      },
      {
        say: "When you're happy with the week, tap Submit timesheet. It goes straight to your approver, who'll be told it's waiting.",
        do: (t) => t.tap(t.btn('Submit timesheet')),
      },
      {
        say: "Now the week says Submitted, and it's closed for changes while your approver looks it over.",
        do: (t) => t.highlight(t.text('Submitted')),
      },
      {
        say: "Noticed something you forgot? Tap Withdraw submission to take it back, and the week is yours to edit again.",
        do: (t) => t.tap(t.btn('Withdraw submission')),
      },
      {
        say: "It's back to Not submitted, so you can fix anything you like and send it again when you're ready.",
        do: (t) => t.highlight(t.text('Not submitted')),
      },
    ],
  },
  {
    id: 'rejected',
    as: PEOPLE.sara.email,
    start: '',
    steps: [
      {
        say: "If your approver sends a week back, you'll see a red message at the top of Today. Tap it to find out why.",
        do: (t) => t.highlight(t.text(/^A timesheet was rejected/)),
      },
      {
        say: "This list shows every week that's been sent back, along with the reason your approver gave.",
        do: async (t) => {
          await t.tap(t.text(/^A timesheet was rejected/));
          await t.highlight(t.text(/mentoring session/));
        },
      },
      {
        say: "In this case the reason says the mentoring session finished at five, not half past six. Tap the week to open it.",
        do: async (t) => {
          await t.tap(t.btn(/^Fix the timesheet for/));
          await t.waitFor(t.text(/^Rejected by/));
        },
      },
      {
        say: "The reason stays at the top while you work. Tap the mentoring entry to correct it.",
        do: async (t) => {
          await t.highlight(t.text(/^Rejected by/));
          await t.tap(t.entryRow('Youth Mentoring'));
        },
      },
      {
        say: "Change the end time to five o'clock, then tap Save changes.",
        do: async (t) => {
          await t.fill(timeBox(t, 1), '17:00');
          await t.tap(t.btn('Save changes'));
        },
      },
      {
        say: "Your week is back on screen with the new time. Now tap Resubmit timesheet to send it to your approver again.",
        do: (t) => t.tap(t.btn('Resubmit timesheet')),
      },
      {
        say: "Done. The week says Submitted again, and your approver will be told it's waiting for them.",
        do: (t) => t.highlight(t.text('Submitted')),
      },
    ],
  },
  {
    id: 'notifications',
    as: PEOPLE.sara.email,
    start: '',
    permission: 'default',
    steps: [
      {
        say: "Notifications tell you when something needs you. To set them up, open More and tap Notifications.",
        do: (t) => openMore(t, 'Notifications'),
      },
      {
        say: "The first card is about this device. If it says notifications aren't on, that's the one to fix first.",
        do: (t) => t.highlight(t.text('Notifications are not enabled on this device.')),
      },
      {
        say: "Tap Enable notifications, and your phone or browser will ask if that's okay. Say yes, and this device is ready.",
        do: (t) => t.fakeTap(t.btn('Enable notifications')),
      },
      {
        say: "Underneath, you choose which kinds of message you want. Each switch turns one kind on or off.",
        do: (t) => t.highlight(t.text('Tell me when')),
      },
      {
        say: "You'll hear when one of your timesheets is approved or sent back, which is well worth leaving on.",
        do: (t) => t.highlight(t.switch('My timesheet is rejected')),
      },
      {
        say: "The weekly reminder nudges you when last week isn't submitted. If you'd rather not have it, tap its switch.",
        do: (t) => t.tap(t.switch('Weekly submit reminder')),
      },
      {
        say: "Your choices save as you tap, and they apply on every device where you use the app.",
        do: (t) => t.highlight(t.text(/^Notifications arrive on every device/)),
      },
    ],
  },
  {
    id: 'report',
    as: PEOPLE.sara.email,
    start: '',
    steps: [
      {
        say: "If something's wrong, or someone's behaving badly, you can tell the administrators. Open More and tap Report a problem.",
        do: (t) => openMore(t, 'Report a problem'),
      },
      {
        say: "Write what or who you're reporting, and what's wrong, in your own words. A sentence or two is plenty.",
        do: (t) =>
          t.type(
            t.label('What or who are you reporting, and what is wrong?'),
            'The note on my Tuesday Tutoring entry was changed to something I did not write.',
          ),
      },
      {
        say: "Your name and email go along with the report, so the administrators know who to reply to.",
        do: (t) => t.highlight(t.text(/^Your report goes to/)),
      },
      {
        say: "When you've said enough, tap Send and it goes straight to the administrators.",
        do: (t) => t.tap(t.btn('Send')),
      },
      {
        say: "You'll see a confirmation here, and an administrator will reply to you by email within a day.",
        do: async (t) => {
          await t.waitFor(t.text('Sent. An administrator will reply by email within a day.'), 30000);
          await t.highlight(t.text('Sent. An administrator will reply by email within a day.'));
        },
      },
    ],
  },
  // ---------------------------------------------------------------- managers
  {
    id: 'approving',
    as: PEOPLE.omar.email,
    start: '',
    steps: [
      {
        say: "When someone submits their week to you, a number appears on the Approvals tab. Open it to see who's waiting.",
        do: async (t) => {
          await t.highlight(t.tabOf('approvals'));
          await t.tap(t.tabOf('approvals'));
        },
      },
      {
        say: "Each row is one person's week, with the total hours and the day they submitted. Tap the one you want to check.",
        do: (t) => t.tap(t.btn("Review Yusuf Khan's timesheet")),
      },
      {
        say: "Take a minute to look through the days. Every day of the week is listed, even the empty ones, so nothing slips past.",
        do: async (t) => {
          const days = t.page.getByRole('heading', { level: 3 }).filter({ visible: true });
          await t.scrollTo(days.last());
          await t.wait(500);
          await t.scrollTo(days.first());
        },
      },
      {
        say: "If something doesn't look right, tap Reject timesheet. You'll be asked for a reason, which the person sees, so they know what to fix.",
        do: async (t) => {
          await t.tap(t.btn('Reject timesheet…'));
          await t.highlight(t.placeholder('What needs fixing?'));
        },
      },
      {
        say: "This week looks fine though, so I'll cancel that and tap Approve timesheet.",
        do: async (t) => {
          await t.tap(t.btn('Cancel'));
          await t.tap(t.btn('Approve timesheet'));
        },
      },
      {
        say: "The week leaves your list, and the person can see that it's been approved.",
        do: async (t) => {
          await t.waitFor(t.text('Nothing waiting for you. When someone submits a timesheet to you, it shows up here.'));
          await t.highlight(t.text(/^Nothing waiting for you/));
        },
      },
    ],
  },
  {
    id: 'adding-for-someone',
    as: PEOPLE.omar.email,
    start: '',
    steps: [
      {
        say: "Sometimes someone forgets to log their hours, or can't. You can add them yourself, from their week. Start in Approvals.",
        do: async (t) => {
          await t.tap(t.tabOf('approvals'));
          await t.tap(t.btn("Review Yusuf Khan's timesheet"));
        },
      },
      {
        say: "Under the days of their week you'll find Add hours, with their name on it. Tap that.",
        do: (t) => t.tap(t.btn('Add hours for Yusuf Khan')),
      },
      {
        say: "The note at the top is a reminder that these hours go on Yusuf's timesheet, not yours.",
        do: (t) => t.highlight(t.text(/^Adding hours for Yusuf Khan/)),
      },
      {
        say: "Choose the activity, just as you would for your own hours.",
        do: (t) => pick(t, t.text('Pick an activity'), 'Tutoring'),
      },
      {
        say: "The date starts on a day in Yusuf's week. Change it if you need to, then set the times.",
        do: async (t) => {
          await t.highlight(dateBox(t));
          await t.fill(timeBox(t, 0), '10:00');
          await t.fill(timeBox(t, 1), '12:00');
        },
      },
      {
        say: "Add a note so Yusuf knows what it was for, then tap Save hours.",
        do: async (t) => {
          await t.type(t.label('What did you work on? (optional)'), 'Covered the morning group.');
          await t.tap(t.btn('Save hours'));
        },
      },
      {
        say: "And there it is in Yusuf's week, marked as added by hand. The total has gone up to match.",
        do: async (t) => {
          await t.highlight(t.entryRow('Tutoring'));
          await t.highlight(t.text(/logged$/));
        },
      },
    ],
  },
  {
    id: 'reports',
    as: PEOPLE.omar.email,
    start: '',
    steps: [
      {
        say: "Reports is where you add up the hours. The pills at the top choose the period, from the last seven days to all time.",
        do: async (t) => {
          await t.tap(t.tabOf('reports'));
          await t.highlight(pills(t, 'Period'));
        },
      },
      {
        say: "Let's look at the whole year. The big number is the total, and the line under it says exactly what it counts.",
        do: async (t) => {
          await t.tap(t.radio('This year'));
          await t.highlight(t.text(/^Approved hours, this year/));
        },
      },
      {
        say: "Underneath, the same hours are split by activity and by person. Only approved weeks are counted, so these are the official figures.",
        do: async (t) => {
          await t.highlight(t.text('By activity'));
          await t.highlight(t.text('By person'));
        },
      },
      {
        say: "Tap a person to see their lifetime hours: everything they've ever had approved, activity by activity.",
        do: async (t) => {
          await t.tap(t.btn(/^Sara Malik, /));
          await t.highlight(t.text('Lifetime approved hours'));
        },
      },
      {
        say: "On the website, Print statement makes a tidy summary you can print or save as a PDF, for anyone who needs proof of their hours.",
        do: async (t) => {
          await t.tap(t.btn('Print statement'));
          await t.wait(800);
        },
      },
      {
        say: "Back on Reports, the Person and Activity boxes narrow things down. Pick Sara, and every figure is just Sara's.",
        do: async (t) => {
          await t.tap(back(t));
          await pick(t, t.text('Everyone'), 'Sara Malik');
          await t.highlight(t.text(/^Approved hours, this year, Sara Malik/));
        },
      },
      {
        say: "Export CSV saves what you're looking at as a spreadsheet, ready to open in Excel or Google Sheets.",
        do: async (t) => {
          await t.tap(t.btn('Export CSV'));
          await t.highlight(t.text(/^Downloaded /));
        },
      },
    ],
  },
  {
    id: 'activities',
    as: PEOPLE.omar.email,
    start: '',
    steps: [
      {
        say: "Activities are what people log their hours against. You'll find them in More, under Institute.",
        do: (t) => openMore(t, 'Activities'),
      },
      {
        say: "To add one, type its name in the box at the top.",
        do: (t) => t.type(t.label('New activity name'), 'Eid Bake Sale'),
      },
      {
        say: "Then tap Add. It's in the list straight away, and everyone can pick it from then on.",
        do: (t) => t.tap(t.btn('Add')),
      },
      {
        say: "When an activity is over, tap Archive next to it. It leaves everyone's pickers, but the hours already logged stay safe.",
        do: (t) => t.tap(onRow(t, 'Event Setup', 'Archive')),
      },
      {
        say: "Archived activities wait at the bottom of the page. Open that section, and Restore brings one back.",
        do: async (t) => {
          await t.tap(t.btn(/^Show Archived/));
          await t.tap(onRow(t, 'Event Setup', 'Restore'));
        },
      },
      {
        say: "And it's back in the pickers. Archiving never loses anything, so tidy up whenever you like.",
        do: (t) => t.highlight(t.text('Event Setup')),
      },
    ],
  },
  // ------------------------------------------------------------------ admins
  {
    id: 'new-accounts',
    as: PEOPLE.amina.email,
    start: '',
    steps: [
      {
        say: "When someone new signs in, they have to wait for an administrator. A number on More tells you that someone's waiting.",
        do: (t) => t.highlight(t.tabOf('more')),
      },
      {
        say: "Open More and tap People. Anyone who's waiting is listed right at the top.",
        do: (t) => openMore(t, 'People'),
      },
      {
        say: "Under Waiting for approval you'll see their name and email address. Check that you know who they are before you go on.",
        do: async (t) => {
          await t.highlight(t.text(/^Waiting for approval/));
          await t.highlight(t.text(PEOPLE.layla.email));
        },
      },
      {
        say: "If you recognise them, tap Approve, and they're let in straight away.",
        do: (t) => t.tap(t.btn('Approve')),
      },
      {
        say: "They move down into the list of everyone, and their own waiting screen updates by itself.",
        do: (t) => t.highlight(t.text(/^Everyone \(/)),
      },
      {
        say: "Their row says approver: none yet. Open their page and choose one now, or they'll be asked to pick one before they first submit.",
        do: (t) => t.highlight(t.text(/approver: none yet/)),
      },
    ],
  },
  {
    id: 'roles',
    as: PEOPLE.amina.email,
    start: '',
    steps: [
      {
        say: "Open More, then People, and tap someone to see their page. Here's Yusuf's.",
        do: async (t) => {
          await openMore(t, 'People');
          await t.tap(t.btn('Yusuf Khan. Open their account.'));
        },
      },
      {
        say: "Up top you can see whether the account is active, and whether the person is a member, a manager or an admin.",
        do: (t) => t.highlight(t.text(/^Active · /)),
      },
      {
        say: "Approver is where their timesheets go when they submit. Tap the box if you want to choose someone different.",
        do: (t) => t.highlight(t.text('Omar Siddiqui')),
      },
      {
        say: "Role is Member or Manager. Managers approve timesheets, read reports and look after activities, so the app asks you to confirm.",
        do: (t) => t.tap(t.tab('Manager')),
      },
      {
        say: "Admin is full control: accounts, roles, and reopening approved weeks. Only switch it on for people you trust completely.",
        do: (t) => t.highlight(t.switch('Admin')),
      },
      {
        say: "Active is the account's on switch. Turn it off, and the person is locked out at once and can't log hours, though their past hours stay.",
        do: (t) => t.highlight(t.switch('Active')),
      },
    ],
  },
  {
    id: 'reopening',
    as: PEOPLE.amina.email,
    start: '',
    steps: [
      {
        say: "An approved week is closed, so nobody can edit it. If one needs changing, an admin can reopen it. Start in Reports.",
        do: (t) => t.tap(t.tabOf('reports')),
      },
      {
        say: "Choose All time, so every approved week counts, and the people with approved hours are listed underneath.",
        do: (t) => t.tap(t.radio('All time')),
      },
      {
        say: "Find the person whose week needs changing in the list, and tap their name.",
        do: (t) => t.tap(t.btn(/^Yusuf Khan, /)),
      },
      {
        say: "Their page shows their lifetime hours. To get to their weeks, tap View timesheets.",
        do: (t) => t.tap(t.btn('View timesheets')),
      },
      {
        say: "It opens on the current week, so step back with the arrow until you reach the approved one.",
        do: (t) => t.tap(t.btn('Previous week'), { times: 2 }),
      },
      {
        say: "Here's the approved week. Tap Reopen, and it goes back to Not submitted, so it can be changed again.",
        do: async (t) => {
          await t.highlight(t.text('Approved'));
          await t.tap(t.btn('Reopen (admin)'));
        },
      },
      {
        say: "The week is open again. The person can fix their entries and submit it for approval a second time.",
        do: (t) => t.highlight(t.text('Not submitted')),
      },
    ],
  },
];
