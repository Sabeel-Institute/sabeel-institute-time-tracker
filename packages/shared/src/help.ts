/**
 * THE HELP FILMS: one short narrated film per thing people do in the app,
 * each made twice — on a phone and on a computer — with captions.
 *
 * This list is the one source. More → Help lists from it, and
 * `scripts/films` records exactly these: the recorder fails on a film this list
 * does not name, or on one it names and nothing records.
 *
 * Everyone sees every film, whatever their role: a member who has seen what a
 * manager does knows whom to ask. The films show a made-up guide world, never
 * anyone's real hours, so they are plain public files on a Hosting site of
 * their own (`HELP_FILMS_ORIGIN`), put there by `sabeel-ci films publish` and
 * never by Deploy Web.
 */

/** Whose work a film shows: anyone's, a manager's, or an admin's. */
export type HelpAudience = 'everyone' | 'manager' | 'admin';

/** The two cuts of every film. */
export type HelpVariant = 'phone' | 'computer';

export const HELP_VARIANTS: readonly HelpVariant[] = ['phone', 'computer'];

export interface HelpVideo {
  id: string;
  title: string;
  /** One line under the title: what the film shows. */
  summary: string;
  audience: HelpAudience;
}

export const HELP_VIDEOS: readonly HelpVideo[] = [
  { id: 'signing-in', audience: 'everyone', title: 'Signing in', summary: 'Your institute Google account, waiting for approval, and the rules.' },
  { id: 'getting-around', audience: 'everyone', title: 'Finding your way around', summary: 'Today, Timesheet and More, and what managers see besides.' },
  { id: 'clocking', audience: 'everyone', title: 'Clocking in and out', summary: 'Picking what you are working on, and the clock.' },
  { id: 'adding-hours', audience: 'everyone', title: 'Adding hours by hand', summary: 'Hours you did not clock: the day, the times and a note.' },
  { id: 'fixing-an-entry', audience: 'everyone', title: 'Fixing an entry', summary: 'Changing an entry, and deleting one.' },
  { id: 'timesheet', audience: 'everyone', title: 'Your timesheet', summary: 'The month, its weeks, and what each dot means.' },
  { id: 'submitting', audience: 'everyone', title: 'Submitting your week', summary: 'Choosing your approver, submitting, and taking it back.' },
  { id: 'rejected', audience: 'everyone', title: 'When a week comes back', summary: 'A rejected week, the reason, and sending it again.' },
  { id: 'notifications', audience: 'everyone', title: 'Notifications', summary: 'Turning them on, and choosing what you are told about.' },
  { id: 'report', audience: 'everyone', title: 'Reporting a problem', summary: 'Telling the administrators about something or someone.' },
  { id: 'approving', audience: 'manager', title: 'Approving timesheets', summary: 'The weeks waiting for you: approving, and rejecting with a reason.' },
  { id: 'adding-for-someone', audience: 'manager', title: 'Adding hours for someone', summary: 'Logging hours on a person’s behalf, in their week.' },
  { id: 'reports', audience: 'manager', title: 'Reports and statements', summary: 'Totals by period, person and activity, a CSV, and a printed statement.' },
  { id: 'activities', audience: 'manager', title: 'Activities', summary: 'Adding, archiving and restoring what people log against.' },
  { id: 'new-accounts', audience: 'admin', title: 'Approving new accounts', summary: 'People waiting to get in, and letting them in.' },
  { id: 'roles', audience: 'admin', title: 'Roles and access', summary: 'Member, manager and admin, approvers, and turning an account off.' },
  { id: 'reopening', audience: 'admin', title: 'Reopening an approved week', summary: 'When an approved week needs changing.' },
];

/** The site the films are served from: public, and nothing else is on it. */
export const HELP_FILMS_ORIGIN = 'https://sabeel-time-tracker-help.web.app';

/** A film's file name on that site, and in the recorder's output folder. */
export function helpFilmFile(id: string, variant: HelpVariant, kind: 'video' | 'captions'): string {
  return `${id}-${variant}.${kind === 'video' ? 'mp4' : 'vtt'}`;
}

/** Where one cut of a film, or its captions, is played from. */
export function helpFilmUrl(id: string, variant: HelpVariant, kind: 'video' | 'captions'): string {
  return `${HELP_FILMS_ORIGIN}/${helpFilmFile(id, variant, kind)}`;
}
