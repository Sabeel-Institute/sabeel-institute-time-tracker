import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, or, query, where } from 'firebase/firestore';
import { COLLECTIONS, type UserDoc } from '@sabeel/shared';
import { db } from './firebase';
import { useLiveQuery } from './liveQuery';
import { approverChoices, type UserRow } from './users';

export type Approvers = {
  /** Everyone who may approve now, by name; undefined until the first answer. */
  list: UserRow[] | undefined;
  byUid: ReadonlyMap<string, UserRow> | undefined;
  /**
   * The server has answered once. Before that the list can be the cache's
   * partial view (a manager's own profile matches the query), so it names
   * people but must not decide that a week's approver is missing from it.
   */
  confirmed: boolean;
};

const ApproversContext = createContext<Approvers>({ list: undefined, byUid: undefined, confirmed: false });

/**
 * The possible approvers (active managers/admins), one listener for the
 * session. Every active user may read these profiles (firestore.rules), so
 * people can pick their own approver. One listener rather than one per
 * screen: offline, a new listener never hears from the server, and the list
 * it had would be withheld.
 */
export function ApproversProvider({ children }: { children: ReactNode }) {
  const answer = useLiveQuery<{ list: UserRow[]; fromServer: boolean } | undefined>(
    () => query(collection(db, COLLECTIONS.users), or(where('role', '==', 'manager'), where('admin', '==', true))),
    [],
    {
      label: 'approvers',
      includeMetadataChanges: true,
      map: (snap) => ({
        list: approverChoices(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as UserDoc) })))
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        fromServer: !snap.metadata.fromCache,
      }),
      empty: undefined,
    },
  );
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (answer?.fromServer) setConfirmed(true);
  }, [answer?.fromServer]);
  const list = answer?.list;
  const value = useMemo(
    () => ({ list, byUid: list ? new Map(list.map((a) => [a.uid, a])) : undefined, confirmed }),
    [list, confirmed],
  );
  return <ApproversContext.Provider value={value}>{children}</ApproversContext.Provider>;
}

export function useApprovers(): Approvers {
  return useContext(ApproversContext);
}
