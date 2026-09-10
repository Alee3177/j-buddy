'use client';

/**
 * Japanese Reader v0.4 P4.4 — persistent "已加入複習" state for the 學習項目 tab.
 *
 * Owns the set of `lexicalKey`s that already have a review card for the
 * signed-in user, so every occurrence of a word/grammar point (there can be
 * duplicates across saved analyses) shows the same add / already-added state,
 * and that state survives a page reload. A pure reducer + a thin async runner
 * around `listReviewCardKeys()` + an auth-lifecycle hook (mirrors
 * `useLearningItemsFeed`). No polling, no realtime listener.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { listReviewCardKeys } from '@/services/reviewService';

export interface ReviewCardKeysState {
  keys: Set<string>;
  loading: boolean;
  /** the load failed — the set is empty, nothing is marked reviewed */
  error: boolean;
}

export const initialReviewCardKeysState: ReviewCardKeysState = {
  keys: new Set<string>(),
  loading: true,
  error: false,
};

export type ReviewCardKeysEvent =
  | { type: 'RESET' }
  | { type: 'LOAD_PENDING' }
  | { type: 'LOAD_OK'; keys: Set<string> }
  | { type: 'LOAD_FAILED' }
  | { type: 'ADD_KEY'; key: string };

export function reviewCardKeysReducer(
  state: ReviewCardKeysState,
  event: ReviewCardKeysEvent
): ReviewCardKeysState {
  switch (event.type) {
    case 'RESET':
      return { keys: new Set<string>(), loading: false, error: false };

    case 'LOAD_PENDING':
      return { keys: new Set<string>(), loading: true, error: false };

    case 'LOAD_OK':
      return { keys: event.keys, loading: false, error: false };

    case 'LOAD_FAILED':
      // Never fabricate reviewed state on failure — the set stays empty.
      return { keys: new Set<string>(), loading: false, error: true };

    case 'ADD_KEY': {
      if (state.keys.has(event.key)) return state; // idempotent
      const next = new Set(state.keys);
      next.add(event.key);
      return { ...state, keys: next };
    }

    default:
      return state;
  }
}

type KeysFetcher = () => Promise<Set<string>>;

/**
 * Load the reviewed-key set. `isCurrent()` is checked after the await so a
 * response that arrives after a logout / user switch is discarded.
 */
export async function runLoadReviewCardKeys(
  dispatch: (event: ReviewCardKeysEvent) => void,
  isCurrent: () => boolean,
  fetchKeys: KeysFetcher = () => listReviewCardKeys()
): Promise<void> {
  if (!isCurrent()) return;
  dispatch({ type: 'LOAD_PENDING' });
  try {
    const keys = await fetchKeys();
    if (!isCurrent()) return;
    dispatch({ type: 'LOAD_OK', keys });
  } catch {
    if (!isCurrent()) return;
    dispatch({ type: 'LOAD_FAILED' });
  }
}

export interface ReviewCardKeys {
  keys: ReadonlySet<string>;
  loading: boolean;
  error: boolean;
  /** Optimistically record that `lexicalKey` now has a review card. */
  addKey: (lexicalKey: string) => void;
}

/**
 * Drive the reviewed-key set from the auth lifecycle (mirrors
 * `useLearningItemsFeed` / `useReviewSession`):
 *  - nothing is queried until `authResolved`;
 *  - `uid === null` clears the set and issues no query;
 *  - a new `uid` bumps a generation counter (an in-flight request for the
 *    previous user can never land) and loads a fresh set.
 */
export function useReviewCardKeys(
  uid: string | null,
  authResolved: boolean
): ReviewCardKeys {
  const [state, dispatch] = useReducer(
    reviewCardKeysReducer,
    initialReviewCardKeysState
  );
  const generationRef = useRef(0);

  useEffect(() => {
    if (!authResolved) return;
    const generation = ++generationRef.current;
    if (!uid) {
      dispatch({ type: 'RESET' });
      return;
    }
    void runLoadReviewCardKeys(
      dispatch,
      () => generationRef.current === generation
    );
  }, [uid, authResolved]);

  const addKey = useCallback((lexicalKey: string) => {
    if (typeof lexicalKey !== 'string' || lexicalKey.length === 0) return;
    dispatch({ type: 'ADD_KEY', key: lexicalKey });
  }, []);

  return {
    keys: state.keys,
    loading: state.loading,
    error: state.error,
    addKey,
  };
}
