import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, hasAcceptedRules, RULES_VERSION, type UserDoc } from '@sabeel/shared';
import { requireActive } from './auth';
import { guarded, sentryDsn } from './sentry';

/**
 * The institute's rules, accepted (the `sabeel-app-stores` skill, decision 4).
 *
 * Recorded here and only here: firestore.rules keeps `rulesVersion` and
 * `rulesAcceptedAt` out of the fields a person may write on their own profile,
 * so the record says the server saw an active account agree, at the server's
 * time. The app shows the rules screen until the profile carries the current
 * RULES_VERSION (`hasAcceptedRules`), and the profile listener moves it on to
 * Home the moment this lands.
 *
 * Accepting again changes nothing: the first acceptance of a version is the
 * record. A later RULES_VERSION is a new acceptance with its own time.
 */
export async function acceptRulesFor(req: CallableRequest): Promise<{ rulesVersion: number }> {
  // Active accounts only, a password session included (the review account is
  // an ordinary member). A pending or disabled account never reaches the rules
  // screen: its gate screen comes first.
  const uid = requireActive(req);
  const ref = getFirestore().collection(COLLECTIONS.users).doc(uid);
  const profile = (await ref.get()).data() as UserDoc | undefined;
  if (profile && hasAcceptedRules(profile)) return { rulesVersion: RULES_VERSION };
  // update(), not set(): an active account has a profile (onUserCreate made
  // it), and update fails rather than invent one that production never makes.
  await ref.update({ rulesVersion: RULES_VERSION, rulesAcceptedAt: Date.now() });
  return { rulesVersion: RULES_VERSION };
}

export const acceptRules = onCall({ secrets: [sentryDsn] }, guarded(acceptRulesFor));
