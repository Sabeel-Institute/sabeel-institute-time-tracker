import { addDoc, collection, deleteDoc, doc, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { COLLECTIONS, type ActivityDoc } from '@sabeel/shared';
import { db } from './firebase';
import { useLiveQuery } from './liveQuery';

export type Activity = ActivityDoc & { id: string };

/** Live list of activities; active-only for pickers, everything for management. */
export function useActivities(opts: { includeArchived: boolean }): Activity[] {
  return useLiveQuery(
    () => {
      const base = collection(db, COLLECTIONS.activities);
      return opts.includeArchived
        ? query(base, orderBy('name'))
        : query(base, where('status', '==', 'active'), orderBy('name'));
    },
    [opts.includeArchived],
    {
      label: 'useActivities',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as ActivityDoc) })),
      empty: [],
    },
  );
}

export function createActivity(input: { name: string; createdBy: string }): Promise<unknown> {
  const docBody: ActivityDoc = {
    name: input.name.trim(),
    status: 'active',
    createdAt: Date.now(),
    createdBy: input.createdBy,
  };
  return addDoc(collection(db, COLLECTIONS.activities), docBody);
}

export function setActivityStatus(id: string, status: 'active' | 'archived'): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.activities, id), { status });
}

/**
 * Admins only, and only an archived activity (firestore.rules). The hours logged
 * under it keep their own copy of its name, so timesheets and reports still say
 * what the work was.
 */
export function deleteActivity(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.activities, id));
}
