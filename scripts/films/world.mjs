/**
 * THE GUIDE WORLD the help films are recorded in: made-up people, activities
 * and weeks, never anyone's real hours. Built fresh for every film, so neither
 * a film nor a cut inherits what the last one did.
 *
 * The accounts are made once per run (`makeAccounts`), the way production
 * makes one — a Google sign-in the Auth emulator takes, which `onUserCreate`
 * provisions — and keep their uids. Each `buildWorld()` then empties
 * Firestore, removes any account a film made (the newcomer who signs up on
 * camera), and writes the profiles, claims and work again, under FRESH ids: a
 * trigger for the last world's documents that fires late must find nothing of
 * this one's.
 */
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  addDays,
  COLLECTIONS,
  dayKeyFor,
  deviceTimeZone,
  epochFor,
  minutesBetween,
  periodRangeFor,
  RULES_VERSION,
} from '@sabeel/shared';
import { EMULATOR_HOSTS, PROJECT } from '../lib/e2e-stack.mjs';

/** The people of the guide world. Amina runs it; Omar approves Sara's and Yusuf's hours. */
export const PEOPLE = {
  amina: { email: 'amina.rahman@oursabeel.com', name: 'Amina Rahman', role: 'manager', admin: true, approver: 'amina' },
  omar: { email: 'omar.siddiqui@oursabeel.com', name: 'Omar Siddiqui', role: 'manager', admin: false, approver: 'amina' },
  sara: { email: 'sara.malik@oursabeel.com', name: 'Sara Malik', role: 'member', admin: false, approver: 'omar' },
  yusuf: { email: 'yusuf.khan@oursabeel.com', name: 'Yusuf Khan', role: 'member', admin: false, approver: 'omar' },
  // Signed up, and waiting for an admin.
  layla: { email: 'layla.hassan@oursabeel.com', name: 'Layla Hassan', role: 'member', admin: false, approver: null, pending: true },
};

/** Who signs up on camera in the signing-in film; removed again by every world. */
const NEWCOMER = { email: 'hana.qureshi@oursabeel.com', name: 'Hana Qureshi' };

const ACTIVITIES = {
  tutoring: 'Tutoring',
  food: 'Food Drive',
  mentoring: 'Youth Mentoring',
  quran: 'Quran Circle',
  setup: 'Event Setup',
};
const ARCHIVED = { iftar: 'Iftar Nights 2025' };

const uids = {};

/** One Google sign-in, as the dev row makes it: the Auth emulator takes an unsigned token. */
async function googleSignIn({ email, name }) {
  const sub = `dev-${email.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const idToken = JSON.stringify({ sub, email, email_verified: true, name });
  const res = await fetch(`http://${EMULATOR_HOSTS.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`the Auth emulator refused ${email}: ${res.status} ${await res.text()}`);
  return (await res.json()).localId;
}

/** The guide world's accounts, made once per run. */
export async function makeAccounts() {
  const db = getFirestore();
  for (const [key, p] of Object.entries(PEOPLE)) {
    uids[key] = await googleSignIn(p);
    // onUserCreate provisions the profile; wait for it before anything overwrites it.
    for (let i = 0; ; i += 1) {
      if ((await db.doc(`${COLLECTIONS.users}/${uids[key]}`).get()).exists) break;
      if (i > 60) throw new Error(`${p.email} was never provisioned`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

let generation = 0;

/** A fresh world. Returns what a film's script reads: the people's uids, the weeks, and ways to change the world. */
export async function buildWorld() {
  const db = getFirestore();
  const auth = getAuth();
  generation += 1;
  const g = `g${generation}-${Date.now().toString(36)}`;

  await fetch(`http://${EMULATOR_HOSTS.firestore}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const keep = new Set(Object.values(uids));
  for (const u of (await auth.listUsers(1000)).users) if (!keep.has(u.uid)) await auth.deleteUser(u.uid);

  const tz = deviceTimeZone();
  const now = Date.now();
  const todayKey = dayKeyFor(now, tz);
  const CURRENT = periodRangeFor(todayKey);
  const PREV = periodRangeFor(addDays(CURRENT.fromKey, -1));
  const PREV2 = periodRangeFor(addDays(PREV.fromKey, -1));
  /** The nth day of a week, kept inside the week and never after today. */
  const dayIn = (period, n) => {
    let d = period.fromKey;
    for (let i = 0; i < n; i += 1) {
      const next = addDays(d, 1);
      if (next > period.toKey || next > todayKey) break;
      d = next;
    }
    return d;
  };

  // The people: claims and profile, as an admin's access change writes both.
  const accepted = { rulesVersion: RULES_VERSION, rulesAcceptedAt: now };
  for (const [key, p] of Object.entries(PEOPLE)) {
    const access = { status: p.pending ? 'pending' : 'active', role: p.role, admin: p.admin };
    await auth.setCustomUserClaims(uids[key], access);
    await db.doc(`${COLLECTIONS.users}/${uids[key]}`).set({
      displayName: p.name,
      email: p.email,
      photoURL: null,
      ...access,
      activeEntryId: null,
      approverUid: p.approver ? uids[p.approver] : null,
      timeZone: tz,
      createdAt: now - 90 * 86400000,
      claimsUpdatedAt: now,
      ...(p.pending ? {} : accepted),
    });
  }

  const activity = {};
  for (const [key, name] of Object.entries(ACTIVITIES)) {
    activity[key] = { id: `act-${key}-${g}`, name };
    await db.doc(`${COLLECTIONS.activities}/${activity[key].id}`).set({ name, status: 'active', createdAt: now, createdBy: uids.amina });
  }
  for (const [key, name] of Object.entries(ARCHIVED)) {
    await db.doc(`${COLLECTIONS.activities}/act-${key}-${g}`).set({ name, status: 'archived', createdAt: now, createdBy: uids.amina });
  }

  let n = 0;
  /** One closed entry, its duration computed as the app computes it. */
  const entry = async (who, act, dayKey, from, to, extra = {}) => {
    const start = epochFor(dayKey, from, tz);
    const end = epochFor(dayKey, to, tz);
    const id = `e-${(n += 1)}-${g}`;
    await db.doc(`${COLLECTIONS.timeEntries}/${id}`).set({
      uid: uids[who],
      activityId: activity[act].id,
      activityName: activity[act].name,
      start,
      end,
      durationMinutes: Math.max(1, minutesBetween(start, end)),
      timeZone: tz,
      dayKey,
      periodKey: periodRangeFor(dayKey).fromKey,
      source: 'manual',
      createdAt: start,
      updatedAt: start,
      ...extra,
    });
    return id;
  };
  /** A week's timesheet, its totals taken from the week's entries. */
  const timesheet = async (who, period, fields) => {
    const snap = await db
      .collection(COLLECTIONS.timeEntries)
      .where('uid', '==', uids[who])
      .where('periodKey', '==', period.fromKey)
      .get();
    const total = snap.docs.reduce((s, d) => s + (d.data().durationMinutes ?? 0), 0);
    await db.doc(`${COLLECTIONS.timesheets}/${uids[who]}_${period.fromKey}`).set({
      uid: uids[who],
      periodKey: period.fromKey,
      toKey: period.toKey,
      approverUid: uids[PEOPLE[who].approver],
      submittedAt: now - 86400000,
      totalMinutes: total,
      entryCount: snap.size,
      createdAt: now - 86400000,
      updatedAt: now - 86400000,
      ...fields,
    });
  };

  // Sara: this week under way, last week sent back by Omar, the week before approved.
  await entry('sara', 'tutoring', dayIn(CURRENT, 0), '09:00', '11:30', { note: 'Year 7 maths group.' });
  await entry('sara', 'food', dayIn(CURRENT, 1), '14:00', '16:00');
  await entry('sara', 'tutoring', dayIn(PREV, 0), '09:00', '11:30');
  await entry('sara', 'mentoring', dayIn(PREV, 2), '16:00', '18:30');
  await entry('sara', 'food', dayIn(PREV, 4), '10:00', '13:00');
  await entry('sara', 'tutoring', dayIn(PREV2, 0), '09:00', '11:00');
  await entry('sara', 'quran', dayIn(PREV2, 3), '18:00', '19:30');
  await timesheet('sara', PREV, {
    status: 'rejected',
    decidedAt: now - 3600000,
    decidedBy: uids.omar,
    rejectReason: 'The mentoring session finished at 5, not 6:30. Could you correct the end time?',
  });
  await timesheet('sara', PREV2, { status: 'approved', decidedAt: now - 5 * 86400000, decidedBy: uids.omar });

  // Yusuf: last week submitted to Omar, the week before approved.
  await entry('yusuf', 'setup', dayIn(PREV, 1), '17:00', '20:00');
  await entry('yusuf', 'food', dayIn(PREV, 3), '09:00', '12:30');
  await entry('yusuf', 'quran', dayIn(PREV, 5), '18:00', '19:30');
  await entry('yusuf', 'setup', dayIn(PREV2, 2), '17:00', '19:00');
  await timesheet('yusuf', PREV, { status: 'submitted' });
  await timesheet('yusuf', PREV2, { status: 'approved', decidedAt: now - 6 * 86400000, decidedBy: uids.omar });

  // Omar and Amina's own hours, so reports have more than two people in them.
  await entry('omar', 'mentoring', dayIn(PREV, 2), '16:00', '18:00');
  await entry('omar', 'quran', dayIn(PREV2, 3), '18:00', '20:00');
  await timesheet('omar', PREV2, { status: 'approved', decidedAt: now - 5 * 86400000, decidedBy: uids.amina });
  await entry('amina', 'setup', dayIn(PREV2, 1), '10:00', '14:00');
  await timesheet('amina', PREV2, { status: 'approved', decidedAt: now - 5 * 86400000, decidedBy: uids.amina });

  // The triggers on what was just written settle before anyone looks.
  await new Promise((r) => setTimeout(r, 3000));

  return {
    uid: { ...uids },
    people: PEOPLE,
    newcomer: NEWCOMER,
    activity,
    todayKey,
    weeks: { CURRENT, PREV, PREV2 },
    dayIn,
    entry,
    timesheet,
    /** Change someone's access mid-film, as an admin would: claims and profile together. */
    setAccess: async (who, access) => {
      const uid = typeof who === 'string' && uids[who] ? uids[who] : who;
      await auth.setCustomUserClaims(uid, access);
      await db.doc(`${COLLECTIONS.users}/${uid}`).set({ ...access, claimsUpdatedAt: Date.now() }, { merge: true });
    },
    /** The uid an account made on camera got, by its address. */
    uidOf: async (email) => (await auth.getUserByEmail(email)).uid,
  };
}
