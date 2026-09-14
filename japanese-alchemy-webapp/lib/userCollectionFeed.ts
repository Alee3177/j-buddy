'use client';

/**
 * P7.3-I — shared realtime-subscription hook for a signed-in user's owned
 * Firestore subcollections (vocabularies / grammars / analysis_pages).
 *
 * All three follow the identical shape (owner-scoped, unpaginated, live) and
 * previously duplicated the same `useState` + `useEffect` wiring three times
 * in `app/page.tsx`. This hook factors that out; each caller only supplies
 * the corresponding `subscribeToUserX` service function (a stable, module-
 * level reference — never an inline closure, or the effect below would
 * re-subscribe on every render).
 *
 * Mirrors the auth-lifecycle rules of `useLearningItemsFeed`
 * (`lib/learningItemsFeed.ts`):
 *  - nothing is subscribed until `authResolved` is `true`;
 *  - `uid === null` clears the list and subscribes to nothing;
 *  - a new `uid` bumps a generation counter (so a stale emission from a
 *    torn-down listener can never apply) and (re-)subscribes. The previous
 *    subscription is always unsubscribed first via the effect cleanup, which
 *    React runs before re-running the effect — so a user switch or unmount
 *    never leaves a duplicate listener behind.
 *  - an error resets the list to empty rather than fabricating stale data.
 */

import { useEffect, useReducer, useRef } from 'react';

export type UserCollectionSubscriber<T> = (
  uid: string,
  onData: (items: T[]) => void,
  onError: (error: unknown) => void
) => () => void;

type Action<T> = { type: 'RESET' } | { type: 'DATA'; items: T[] };

function reducer<T>(state: T[], action: Action<T>): T[] {
  switch (action.type) {
    case 'RESET':
      return [];
    case 'DATA':
      return action.items;
    default:
      return state;
  }
}

export function useUserCollectionFeed<T>(
  uid: string | null,
  authResolved: boolean,
  subscribe: UserCollectionSubscriber<T>
): T[] {
  const [items, dispatch] = useReducer(reducer<T>, [] as T[]);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!authResolved) return;
    const generation = ++generationRef.current;
    if (!uid) {
      dispatch({ type: 'RESET' });
      return;
    }
    const unsubscribe = subscribe(
      uid,
      (next) => {
        if (generationRef.current !== generation) return;
        dispatch({ type: 'DATA', items: next });
      },
      () => {
        if (generationRef.current !== generation) return;
        dispatch({ type: 'RESET' });
      }
    );
    return unsubscribe;
  }, [uid, authResolved, subscribe]);

  return items;
}
