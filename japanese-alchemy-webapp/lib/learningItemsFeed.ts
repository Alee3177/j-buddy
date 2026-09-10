'use client';

/**
 * Japanese Reader v0.4 P2.2 — client feed state for the read-only "學習項目"
 * dashboard tab.
 *
 * This module owns ALL of the tab's stateful behaviour so it can be unit-tested
 * without a DOM: a pure reducer, two thin async runners around the P2.1
 * `listLearningItems()` service, and a hook that wires them to React.
 *
 * Occurrence semantics from P2.1 are preserved verbatim — pages are appended in
 * returned order with NO client-side de-duplication, grouping, or re-sorting.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { listLearningItems } from '@/services/firestoreService';
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

type FirstPageFetcher = () => Promise<ListLearningItemsResult>;
type NextPageFetcher = (cursor: string) => Promise<ListLearningItemsResult>;

/**
 * Load the first page. `isCurrent()` is checked after the await so a response
 * that arrives after a logout / user switch is discarded instead of applied.
 */
export async function runFirstPage(
  dispatch: (event: LearningItemsFeedEvent) => void,
  isCurrent: () => boolean,
  fetchFirstPage: FirstPageFetcher = () => listLearningItems()
): Promise<void> {
  if (!isCurrent()) return;
  dispatch({ type: 'FIRST_PAGE_PENDING' });
  try {
    const result = await fetchFirstPage();
    if (!isCurrent()) return;
    dispatch({ type: 'FIRST_PAGE_OK', result });
  } catch {
    if (!isCurrent()) return;
    dispatch({ type: 'FIRST_PAGE_FAILED' });
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
 *    for the previous user can never land) and triggers a fresh first page.
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
    void runFirstPage(
      dispatch,
      () => generationRef.current === generation
    );
  }, [uid, authResolved]);

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
