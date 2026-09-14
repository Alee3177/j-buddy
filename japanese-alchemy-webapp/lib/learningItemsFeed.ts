'use client';

/**
 * Japanese Reader v0.4 P2.2 — client feed state for the read-only "學習項目"
 * dashboard tab.
 *
 * This module owns ALL of the tab's stateful behaviour so it can be unit-tested
 * without a DOM: a pure reducer, a live first-page subscription (P7.3-I), a
 * thin async runner for "load more" around the P2.1 `listLearningItems()`
 * service, and a hook that wires them to React.
 *
 * Occurrence semantics from P2.1 are preserved verbatim — pages are appended in
 * returned order with NO client-side de-duplication, grouping, or re-sorting.
 *
 * P7.3-I: the first page is now driven by `subscribeToLearningItems` (an
 * `onSnapshot` listener) instead of a one-shot fetch, so an external Firestore
 * write (e.g. a Chrome-extension save) updates the tab and its count without a
 * browser reload. Trade-off: because the listener always reports the current
 * first page, a live update replaces the whole `items` array — any additional
 * pages appended via `loadMore` are dropped and `cursor` is recomputed from the
 * fresh first page. This mirrors what a manual reload already did (start over
 * from page 1); it only makes it automatic.
 *
 * P7.3-I hybrid fallback: on top of the live listener, the first page is also
 * re-fetched (one-shot, via `listLearningItems()`) whenever the tab regains
 * focus or becomes visible again — a safety net for when the live Listen
 * transport doesn't deliver an update while the tab was away. Applied through
 * the same `FIRST_PAGE_OK` action the listener uses, so the trade-off above
 * applies here too. A failed fallback read is swallowed rather than clearing
 * good data (unlike a live-listener error, which does reset to empty).
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { listLearningItems, subscribeToLearningItems } from '@/services/firestoreService';
import { useFocusRefresh } from './focusRefresh';
import type { ListLearningItemsResult } from '@/types';
import type { LearningItem } from '@/types';

export type LearningItemsFeedPhase = 'loading' | 'ready' | 'error';

export interface LearningItemsFeedState {
  phase: LearningItemsFeedPhase;
  items: LearningItem[];
  /** `nextCursor` from the most recent successful page; `null` ⇒ no more rows. */
  cursor: string | null;
  /** A "load more" request is in flight. */
  loadingMore: boolean;
  /** The most recent "load more" request failed (already-loaded items kept). */
  loadMoreFailed: boolean;
}

export const initialLearningItemsFeedState: LearningItemsFeedState = {
  phase: 'loading',
  items: [],
  cursor: null,
  loadingMore: false,
  loadMoreFailed: false,
};

export type LearningItemsFeedEvent =
  | { type: 'RESET' }
  | { type: 'FIRST_PAGE_PENDING' }
  | { type: 'FIRST_PAGE_OK'; result: ListLearningItemsResult }
  | { type: 'FIRST_PAGE_FAILED' }
  | { type: 'NEXT_PAGE_PENDING' }
  | { type: 'NEXT_PAGE_OK'; result: ListLearningItemsResult }
  | { type: 'NEXT_PAGE_FAILED' };

export function learningItemsFeedReducer(
  state: LearningItemsFeedState,
  event: LearningItemsFeedEvent
): LearningItemsFeedState {
  switch (event.type) {
    case 'RESET':
      return initialLearningItemsFeedState;

    case 'FIRST_PAGE_PENDING':
      return { ...initialLearningItemsFeedState, phase: 'loading' };

    case 'FIRST_PAGE_OK':
      return {
        phase: 'ready',
        items: event.result.items,
        cursor: event.result.nextCursor,
        loadingMore: false,
        loadMoreFailed: false,
      };

    case 'FIRST_PAGE_FAILED':
      return { ...initialLearningItemsFeedState, phase: 'error' };

    case 'NEXT_PAGE_PENDING':
      return { ...state, loadingMore: true, loadMoreFailed: false };

    case 'NEXT_PAGE_OK':
      return {
        ...state,
        // Raw append in returned order — no dedup, no re-sort.
        items: [...state.items, ...event.result.items],
        cursor: event.result.nextCursor,
        loadingMore: false,
        loadMoreFailed: false,
      };

    case 'NEXT_PAGE_FAILED':
      // Keep items AND cursor so the user can retry.
      return { ...state, loadingMore: false, loadMoreFailed: true };

    default:
      return state;
  }
}

type NextPageFetcher = (cursor: string) => Promise<ListLearningItemsResult>;
type FirstPageSubscriber = (
  onResult: (result: ListLearningItemsResult) => void,
  onError: (error: unknown) => void
) => () => void;

const NOOP_UNSUBSCRIBE = () => {};

/**
 * Subscribe to the live first page. Fires `FIRST_PAGE_PENDING` immediately,
 * then `FIRST_PAGE_OK` on every emission (the initial snapshot AND every
 * later one caused by an external write) or `FIRST_PAGE_FAILED` on error.
 * `isCurrent()` is checked on every emission so a listener left over from a
 * logout / user switch can never apply a stale result — belt-and-suspenders
 * alongside the returned unsubscribe, which the caller must invoke on
 * cleanup.
 *
 * Returns the unsubscribe function (a no-op if subscribing failed outright,
 * e.g. no authenticated user — matching `listLearningItems`'s fail-closed
 * behaviour).
 */
export function startFirstPageFeed(
  dispatch: (event: LearningItemsFeedEvent) => void,
  isCurrent: () => boolean,
  subscribeFirstPage: FirstPageSubscriber = (onResult, onError) =>
    subscribeToLearningItems(undefined, onResult, onError)
): () => void {
  if (!isCurrent()) return NOOP_UNSUBSCRIBE;
  dispatch({ type: 'FIRST_PAGE_PENDING' });
  try {
    return subscribeFirstPage(
      (result) => {
        if (!isCurrent()) return;
        dispatch({ type: 'FIRST_PAGE_OK', result });
      },
      (error) => {
        // P7.4 — see the matching comment in lib/userCollectionFeed.ts: this
        // previously reset the feed with no trace anywhere.
        console.error('Live subscription failed:', error);
        if (!isCurrent()) return;
        dispatch({ type: 'FIRST_PAGE_FAILED' });
      }
    );
  } catch (error) {
    console.error('Live subscription failed to start:', error);
    if (isCurrent()) dispatch({ type: 'FIRST_PAGE_FAILED' });
    return NOOP_UNSUBSCRIBE;
  }
}

/**
 * P7.3-I hybrid fallback: one-shot re-fetch of the first page, applied via
 * the same `FIRST_PAGE_OK` action `startFirstPageFeed` uses. Driven only by
 * `useFocusRefresh` (window focus / visibilitychange), never by a timer.
 */
export async function runFocusRefresh(
  dispatch: (event: LearningItemsFeedEvent) => void,
  isCurrent: () => boolean,
  fetchFirstPage: () => Promise<ListLearningItemsResult> = () => listLearningItems()
): Promise<void> {
  if (!isCurrent()) return;
  try {
    const result = await fetchFirstPage();
    if (!isCurrent()) return;
    dispatch({ type: 'FIRST_PAGE_OK', result });
  } catch (error) {
    console.error('Focus-refresh read failed:', error);
  }
}

/** Load the page after `cursor` and append it. Same staleness guard as above. */
export async function runNextPage(
  cursor: string,
  dispatch: (event: LearningItemsFeedEvent) => void,
  isCurrent: () => boolean,
  fetchNextPage: NextPageFetcher = (c) => listLearningItems({ cursor: c })
): Promise<void> {
  if (!isCurrent()) return;
  dispatch({ type: 'NEXT_PAGE_PENDING' });
  try {
    const result = await fetchNextPage(cursor);
    if (!isCurrent()) return;
    dispatch({ type: 'NEXT_PAGE_OK', result });
  } catch {
    if (!isCurrent()) return;
    dispatch({ type: 'NEXT_PAGE_FAILED' });
  }
}

export interface LearningItemsFeed {
  state: LearningItemsFeedState;
  loadMore: () => void;
}

/**
 * Drive the feed from the app's auth lifecycle.
 *
 * @param uid          the signed-in user's id, or `null` when signed out
 * @param authResolved `false` until Firebase Auth has reported a state
 *
 * Behaviour:
 *  - nothing is queried until `authResolved` is `true`;
 *  - `uid === null` clears the feed and issues no query;
 *  - a new `uid` bumps an internal generation counter (so an in-flight request
 *    for the previous user can never land) and (re-)subscribes to a fresh live
 *    first page. The previous subscription is always unsubscribed first (via
 *    the effect cleanup, which React runs before re-running the effect) so a
 *    user switch or unmount never leaves a duplicate listener behind.
 */
export function useLearningItemsFeed(
  uid: string | null,
  authResolved: boolean
): LearningItemsFeed {
  const [state, dispatch] = useReducer(
    learningItemsFeedReducer,
    initialLearningItemsFeedState
  );
  const generationRef = useRef(0);

  useEffect(() => {
    if (!authResolved) return;
    const generation = ++generationRef.current;
    if (!uid) {
      dispatch({ type: 'RESET' });
      return;
    }
    const unsubscribe = startFirstPageFeed(
      dispatch,
      () => generationRef.current === generation
    );
    return unsubscribe;
  }, [uid, authResolved]);

  const refreshOnFocus = useCallback(() => {
    const generation = generationRef.current;
    return runFocusRefresh(dispatch, () => generationRef.current === generation);
  }, []);

  useFocusRefresh(authResolved && uid != null, refreshOnFocus);

  const loadMore = useCallback(() => {
    if (state.loadingMore || state.cursor == null) return;
    const generation = generationRef.current;
    void runNextPage(
      state.cursor,
      dispatch,
      () => generationRef.current === generation
    );
  }, [state.loadingMore, state.cursor]);

  return { state, loadMore };
}
