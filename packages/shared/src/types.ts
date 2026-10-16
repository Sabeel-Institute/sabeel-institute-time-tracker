// Firestore document shapes shared by app and functions.
// Timestamps cross this boundary as epoch milliseconds in shared code; each
// surface converts to/from its SDK's Timestamp at the read/write edge.

export type UserStatus = 'pending' | 'active' | 'disabled';
export type UserRole = 'member' | 'manager';

/** Mirrored into the ID token by setUserAccess; what security rules trust. */
export interface TokenClaims {
  status?: UserStatus;
  role?: UserRole;
  admin?: boolean;
}

/**
 * Per-event push-notification opt-outs. A missing key means ON — everyone gets
 * everything relevant to their role until they turn something off. `reminder`
 * exists separately so the weekly nudge can be silenced without losing the
 * decision notifications.
 */
export interface NotifPrefs {
  /** My timesheet was rejected. */
  rejected?: boolean;
  /** My timesheet was approved. */
  approved?: boolean;
  /** (Approvers) a timesheet was submitted/resubmitted to me. */
  submitted?: boolean;
  /** (Admins) a new account is waiting for approval. */
  newUser?: boolean;
  /** Weekly "submit last week" nudge. */
  reminder?: boolean;
}

export interface UserDoc {
  displayName: string;
  email: string;
  photoURL: string | null;
  status: UserStatus;
  role: UserRole;
  admin: boolean;
  activeEntryId: string | null;
  /** Absent = all notifications on. */
  notifPrefs?: NotifPrefs;
  /** Last-seen device IANA timezone; the weekly reminder fires at local Tuesday 10:00. */
  timeZone?: string;
  /** Server-only dedup marker: local dayKey of the last reminder sent (the
   *  nudge is daily-until-submitted, starting Tuesday). */
  lastReminderDayKey?: string;
  /**
   * Sticky choice of who approves this user's timesheets (an active manager or
   * admin). Stamped onto each timesheet at submission — changing it affects only
   * future submissions. null until chosen; submission requires one (admins may
   * self-stamp).
   */
  approverUid: string | null;
  createdAt: number;
  approvedAt?: number;
  approvedBy?: string;
  /** Epoch ms of the last custom-claims change (trigger provision, or an admin
   *  access change). The client watches this and force-refreshes its token when
   *  it moves, so approval un-gates within a second without a sign-out. */
  claimsUpdatedAt?: number;
  /**
   * The institute's rules, accepted: the version (RULES_VERSION) and when, as
   * epoch ms on the server's clock. Server-written only, by the acceptRules
   * callable; firestore.rules keeps both out of the fields a person may write.
   * Absent until accepted, and the app shows the rules screen until then.
   */
  rulesVersion?: number;
  rulesAcceptedAt?: number;
}

/**
 * users/{uid}/pushTokens/{token} — one doc per device/browser that can receive
 * pushes, in one of two shapes (firestore.rules accepts exactly these).
 *
 * A browser or an Android phone holds an FCM token. An iPhone holds Apple's own
 * device token, which FCM cannot address, so the server sends to Apple directly
 * (functions/src/apns.ts), and the row says which of Apple's two services issued
 * the token, because each refuses the other's.
 */
export type ApnsEnvironment = 'development' | 'production';
export type PushTokenDoc =
  | { token: string; platform: 'web' | 'android'; updatedAt: number }
  | { token: string; platform: 'ios'; apnsEnvironment: ApnsEnvironment; updatedAt: number };

export type ActivityStatus = 'active' | 'archived';

export interface ActivityDoc {
  name: string;
  description?: string;
  status: ActivityStatus;
  createdAt: number;
  createdBy: string;
}

export type EntrySource = 'clock' | 'manual';

export interface TimeEntryDoc {
  uid: string;
  activityId: string;
  /** Denormalized for display and CSV. */
  activityName: string;
  start: number;
  /** null while a clock session is running. */
  end: number | null;
  /** Set on close/manual create; ABSENT while running (keeps running sessions out of sum() aggregations). */
  durationMinutes?: number;
  /** IANA timezone of the device that created the entry — the timezone the work happened in. */
  timeZone: string;
  /** 'YYYY-MM-DD' of `start` in `timeZone`. The bucketing key for all day/week views. */
  dayKey: string;
  source: EntrySource;
  note?: string;
  autoClosed?: boolean;
  createdAt: number;
  updatedAt: number;
  /** Present when someone other than the owner last edited (manager correction). */
  lastEditedBy?: string;
  /**
   * periodKeyFor(dayKey) — start dayKey of the Sun–Sat month-clipped timesheet
   * period this entry belongs to. Rules recompute it canonically (spoof-proof);
   * kept on the doc so reporting can group entries by `${uid}_${periodKey}`.
   */
  periodKey: string;
}

// Timesheets: one doc per (user, period) once the user submits; no doc while the
// period is an implicit draft. Doc id is `${uid}_${periodKey}` so rules can get()
// the covering timesheet from an entry's fields. Withdraw (owner, pre-approval)
// and admin reopen are deletes — the period returns to draft.
export type TimesheetStatus = 'submitted' | 'approved' | 'rejected';

export interface TimesheetDoc {
  uid: string;
  /** Start dayKey of the period (canonical, see periodKeyFor). */
  periodKey: string;
  /** Inclusive end dayKey (denormalized for range queries and display). */
  toKey: string;
  status: TimesheetStatus;
  /** Stamped from users/{uid}.approverUid at (re)submission; admins may self-stamp. */
  approverUid: string;
  submittedAt: number;
  /** Decision fields: set on approve/reject, cleared again on resubmit. */
  decidedAt?: number;
  decidedBy?: string;
  /** Required when status === 'rejected'. */
  rejectReason?: string;
  /**
   * Informational snapshot at submit/decide time (queue rows, reports). The live
   * truth is always the period's entries — approver edits make this stale until
   * the decision rewrites it.
   */
  totalMinutes: number;
  entryCount: number;
  createdAt: number;
  updatedAt: number;
}
