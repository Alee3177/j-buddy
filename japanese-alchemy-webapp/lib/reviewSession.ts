'use client';

/**
 * Japanese Reader v0.4 P3.4 — client state for the "複習" review flow.
 *
 * Owns all of the review tab's stateful behaviour so it can be unit-tested
 * without a DOM: a pure reducer, thin async runners around the P3.2 / P3.3
 * services (`listDueReviewCards`, `applyReviewRating`), and a hook that wires
 * them to React and the auth lifecycle.
 *
 * It never changes scheduling — the batch is loaded from `listDueReviewCards`,
 * cards are rated one at a time via `applyReviewRating`, and a card that leaves
 * the batch (Good/Easy → future dueAt, Again → +10min) is simply advanced past;
 * it is never re-inserted into the in-memory batch. When the batch is exhausted
 * the queue is re-fetched (the backend naturally excludes what was just rated).
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { applyReviewRating, listDueReviewCards } from '@/services/reviewService';
import type { ReviewCard, ReviewRating } from '@/types';

export type ReviewSessionPhase = 'loading' | 'ready' | 'error';

export interface ReviewSessionState {
  phase: ReviewSessionPhase;
  cards: ReviewCard[];
  currentIndex: number;
  revealed: boolean;
  /** an `applyReviewRating` call is in flight */
  rating: boolean;
  /** the most recent rating failed (current card kept, still revealed) */
  mutationError: boolean;
  /** the last card of the batch was rated → the hook must re-fetch */
  pendingRefetch: boolean;
}

export const initialReviewSessionState: ReviewSessionState = {
  phase: 'loading',
  cards: [],
  currentIndex: 0,
  revealed: false,
  rating: false,
  mutationError: false,
  pendingRefetch: false,
};

export type ReviewSessionEvent =
  | { type: 'RESET' }
  | { type: 'LOAD_PENDING' }
  | { type: 'LOAD_OK'; cards: ReviewCard[] }
  | { type: 'LOAD_FAILED' }
  | { type: 'REVEAL' }
  | { type: 'RATE_PENDING' }
  | { type: 'RATE_OK' }
  | { type: 'RATE_FAILED' };

export function reviewSessionReducer(
  state: ReviewSessionState,
  event: ReviewSessionEvent
): ReviewSessionState {
  switch (event.type) {
    case 'RESET':
      return initialReviewSessionState;

    case 'LOAD_PENDING':
      return { ...initialReviewSessionState, phase: 'loading' };

    case 'LOAD_OK':
      return {
        phase: 'ready',
        cards: event.cards,
        currentIndex: 0,
        revealed: false,
        rating: false,
        mutationError: false,
        pendingRefetch: false,
      };

    case 'LOAD_FAILED':
      return { ...initialReviewSessionState, phase: 'error' };

    case 'REVEAL':
      if (state.currentIndex >= state.cards.length) return state;
      return { ...state, revealed: true };

    case 'RATE_PENDING':
      return { ...state, rating: true, mutationError: false };

    case 'RATE_OK': {
      const nextIndex = state.currentIndex + 1;
      const exhausted = nextIndex >= state.cards.length;
      return {
        ...state,
        currentIndex: nextIndex,
        revealed: false,
        rating: false,
        mutationError: false,
        pendingRefetch: exhausted,
      };
    }

    case 'RATE_FAILED':
      // Keep the current card AND its revealed state so the user can retry.
      return { ...state, rating: false, mutationError: true };

    default:
      return state;
  }
}

type QueueFetcher = () => Promise<{ cards: ReviewCard[] }>;
type RatingApplier = (cardId: string, rating: ReviewRating) => Promise<unknown>;

/**
 * (Re)load the due-review batch. `isCurrent()` is checked after the await so a
 * response that arrives after a logout / user switch is discarded.
 */
export async function runLoadQueue(
  dispatch: (event: ReviewSessionEvent) => void,
  isCurrent: () => boolean,
  fetchQueue: QueueFetcher = () => listDueReviewCards()
): Promise<void> {
  if (!isCurrent()) return;
  dispatch({ type: 'LOAD_PENDING' });
  try {
    const { cards } = await fetchQueue();
    if (!isCurrent()) return;
    dispatch({ type: 'LOAD_OK', cards });
  } catch {
    if (!isCurrent()) return;
    dispatch({ type: 'LOAD_FAILED' });
  }
}

/**
 * Apply one rating. On success the reducer advances to the next card; on failure
 * the current card is kept (still revealed) for retry. A stale completion (after
 * a user switch) is discarded via `isCurrent()`.
 */
export async function runRate(
  cardId: string,
  rating: ReviewRating,
  dispatch: (event: ReviewSessionEvent) => void,
  isCurrent: () => boolean,
  applyRating: RatingApplier = (id, r) => applyReviewRating(id, r)
): Promise<void> {
  if (!isCurrent()) return;
  dispatch({ type: 'RATE_PENDING' });
  try {
    await applyRating(cardId, rating);
    if (!isCurrent()) return;
    dispatch({ type: 'RATE_OK' });
  } catch {
    if (!isCurrent()) return;
    dispatch({ type: 'RATE_FAILED' });
  }
}

export interface ReviewSession {
  state: ReviewSessionState;
  currentCard: ReviewCard | null;
  /** cards left in this batch, including the current one */
  remaining: number;
  reveal: () => void;
  rate: (rating: ReviewRating) => void;
}

/**
 * Drive the review session from the auth lifecycle (mirrors
 * `useLearningItemsFeed`):
 *  - nothing is queried until `authResolved`;
 *  - `uid === null` resets and issues no query;
 *  - a new `uid` bumps a generation counter so an in-flight request / rating for
 *    the previous user can never land, then loads a fresh batch.
 */
export function useReviewSession(
  uid: string | null,
  authResolved: boolean
): ReviewSession {
  const [state, dispatch] = useReducer(
    reviewSessionReducer,
    initialReviewSessionState
  );
  const generationRef = useRef(0);
  const ratingRef = useRef(false);

  useEffect(() => {
    if (!authResolved) return;
    const generation = ++generationRef.current;
    ratingRef.current = false;
    if (!uid) {
      dispatch({ type: 'RESET' });
      return;
    }
    void runLoadQueue(dispatch, () => generationRef.current === generation);
  }, [uid, authResolved]);

  useEffect(() => {
    if (!state.pendingRefetch) return;
    const generation = generationRef.current;
    void runLoadQueue(dispatch, () => generationRef.current === generation);
  }, [state.pendingRefetch]);

  const reveal = useCallback(() => {
    dispatch({ type: 'REVEAL' });
  }, []);

  const rate = useCallback(
    (rating: ReviewRating) => {
      if (ratingRef.current || !state.revealed) return;
      const currentCard = state.cards[state.currentIndex];
      if (!currentCard) return;
      ratingRef.current = true;
      const generation = generationRef.current;
      void runRate(
        currentCard.id,
        rating,
        dispatch,
        () => generationRef.current === generation
      ).finally(() => {
        ratingRef.current = false;
      });
    },
    [state.revealed, state.cards, state.currentIndex]
  );

  const currentCard = state.cards[state.currentIndex] ?? null;
  const remaining = Math.max(0, state.cards.length - state.currentIndex);

  return { state, currentCard, remaining, reveal, rate };
}
