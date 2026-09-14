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
 *
 * P7.3-I hybrid fallback: an optional `refetchOnFocus` one-shot reader (e.g.
 * `getUserVocabularies`) is re-run whenever the tab regains focus or becomes
 * visible again (`lib/focusRefresh.ts`), and its result is applied through
 * the exact same `DATA` reducer action `onSnapshot` uses — `onSnapshot`
 * remains the primary/live mechanism; this is purely a safety net for the
 * "webapp open, extension saves, user tabs back" workflow in case the live
 * Listen transport didn't deliver an update while the tab was away. A failed
 * fallback read is swallowed (logged) rather than clearing good data — unlike
 * an `onSnapshot` error, which does indicate the live subscription itself is
 * broken and resets to empty.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useFocusRefresh } from './focusRefresh';

export type UserCollectionSubscriber<T> = (
  uid: string,
  onData: (items: T[]) => void,
  onError: (error: unknown) => void
) => () => void;

export type UserCollectionOneShotFetcher<T> = (uid: string) => Promise<T[]>;

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
  subscribe: UserCollectionSubscriber<T>,
  refetchOnFocus?: UserCollectionOneShotFetcher<T>
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

  const refreshOnFocus = useCallback(async () => {
    if (!uid || !refetchOnFocus) return;
    const generation = generationRef.current;
    try {
      const next = await refetchOnFocus(uid);
      if (generationRef.current !== generation) return;
      dispatch({ type: 'DATA', items: next });
    } catch (error) {
      console.error('Focus-refresh read failed:', error);
    }
  }, [uid, refetchOnFocus]);

  useFocusRefresh(authResolved && uid != null && refetchOnFocus != null, refreshOnFocus);

  return items;
}
