import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initialReviewSessionState,
  reviewSessionReducer,
  runLoadQueue,
  runRate,
  type ReviewSessionState,
} from './reviewSession';
import { RATING, newReviewCard } from '@/lib/reviewCard';
import type { LearningItem, ReviewCard } from '@/types';

vi.mock('@/services/reviewService', () => ({
  listDueReviewCards: vi.fn(),
  applyReviewRating: vi.fn(),
}));

function learningItem(key: string): LearningItem {
  return {
    id: `li-${key}`,
    userId: 'alice',
    sourceAnalysisId: 'page-1',
    type: 'vocab',
    surface: key,
    status: 'NEW',
    createdAt: 0,
    updatedAt: 0,
    lexicalKey: `vocab|${key}|`,
    reading: null,
    meaning: null,
    sourceSentence: '',
    sourceUrl: null,
  };
}

const card = (key: string): ReviewCard => newReviewCard(learningItem(key), 'alice', 0);

function ready(cards: ReviewCard[], extra: Partial<ReviewSessionState> = {}): ReviewSessionState {
  return {
    phase: 'ready',
    cards,
    currentIndex: 0,
    revealed: false,
    rating: false,
    mutationError: false,
    pendingRefetch: false,
    ...extra,
  };
}

describe('reviewSessionReducer', () => {
  it('1. initial state', () => {
    expect(initialReviewSessionState).toEqual({
      phase: 'loading',
      cards: [],
      currentIndex: 0,
      revealed: false,
      rating: false,
      mutationError: false,
      pendingRefetch: false,
    });
  });

  it('2. LOAD_PENDING clears everything and shows loading', () => {
    const next = reviewSessionReducer(
      ready([card('a')], { currentIndex: 1, revealed: true, mutationError: true }),
      { type: 'LOAD_PENDING' }
    );
    expect(next).toEqual({ ...initialReviewSessionState, phase: 'loading' });
  });

  it('3. LOAD_OK stores the batch at index 0, not revealed', () => {
    const next = reviewSessionReducer(initialReviewSessionState, {
      type: 'LOAD_OK',
      cards: [card('a'), card('b')],
    });
    expect(next.phase).toBe('ready');
    expect(next.cards.map((c) => c.surface)).toEqual(['a', 'b']);
    expect(next.currentIndex).toBe(0);
    expect(next.revealed).toBe(false);
    expect(next.pendingRefetch).toBe(false);
  });

  it('4. LOAD_OK with an empty batch is a valid ready state', () => {
    const next = reviewSessionReducer(initialReviewSessionState, { type: 'LOAD_OK', cards: [] });
    expect(next.phase).toBe('ready');
    expect(next.cards).toEqual([]);
    expect(next.pendingRefetch).toBe(false);
  });

  it('5. LOAD_FAILED → error', () => {
    const next = reviewSessionReducer(initialReviewSessionState, { type: 'LOAD_FAILED' });
    expect(next).toEqual({ ...initialReviewSessionState, phase: 'error' });
  });

  it('6. REVEAL sets revealed (no-op when past the end)', () => {
    expect(reviewSessionReducer(ready([card('a')]), { type: 'REVEAL' }).revealed).toBe(true);
    const exhausted = ready([card('a')], { currentIndex: 1 });
    expect(reviewSessionReducer(exhausted, { type: 'REVEAL' })).toBe(exhausted);
  });

  it('7. RATE_PENDING sets rating, clears mutationError', () => {
    const next = reviewSessionReducer(ready([card('a')], { revealed: true, mutationError: true }), {
      type: 'RATE_PENDING',
    });
    expect(next.rating).toBe(true);
    expect(next.mutationError).toBe(false);
  });

  it('8/9. RATE_OK advances and resets revealed', () => {
    const next = reviewSessionReducer(
      ready([card('a'), card('b')], { revealed: true, rating: true }),
      { type: 'RATE_OK' }
    );
    expect(next.currentIndex).toBe(1);
    expect(next.revealed).toBe(false);
    expect(next.rating).toBe(false);
    expect(next.pendingRefetch).toBe(false);
  });

  it('12. RATE_OK on the last card flags pendingRefetch', () => {
    const next = reviewSessionReducer(
      ready([card('a'), card('b')], { currentIndex: 1, revealed: true }),
      { type: 'RATE_OK' }
    );
    expect(next.currentIndex).toBe(2);
    expect(next.pendingRefetch).toBe(true);
  });

  it('10/11. RATE_FAILED keeps the current card AND its revealed state', () => {
    const next = reviewSessionReducer(
      ready([card('a'), card('b')], { currentIndex: 1, revealed: true, rating: true }),
      { type: 'RATE_FAILED' }
    );
    expect(next.currentIndex).toBe(1);
    expect(next.revealed).toBe(true);
    expect(next.rating).toBe(false);
    expect(next.mutationError).toBe(true);
  });

  it('13. RESET returns the initial state', () => {
    expect(
      reviewSessionReducer(ready([card('a')], { currentIndex: 3 }), { type: 'RESET' })
    ).toEqual(initialReviewSessionState);
  });
});

describe('runLoadQueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches PENDING then OK on success', async () => {
    const dispatch = vi.fn();
    await runLoadQueue(dispatch, () => true, async () => ({ cards: [card('a')] }));
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(['LOAD_PENDING', 'LOAD_OK']);
    expect(dispatch.mock.calls[1][0].cards).toHaveLength(1);
  });

  it('dispatches PENDING then FAILED on rejection', async () => {
    const dispatch = vi.fn();
    await runLoadQueue(dispatch, () => true, async () => {
      throw new Error('x');
    });
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(['LOAD_PENDING', 'LOAD_FAILED']);
  });

  it('discards a response that resolves after the generation changed', async () => {
    const dispatch = vi.fn();
    let current = true;
    await runLoadQueue(dispatch, () => current, async () => {
      current = false;
      return { cards: [card('a')] };
    });
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(['LOAD_PENDING']);
  });
});

describe('runRate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the card id + rating through and dispatches PENDING then OK', async () => {
    const dispatch = vi.fn();
    const apply = vi.fn(async () => undefined);
    await runRate('card-1', RATING.GOOD, dispatch, () => true, apply);
    expect(apply).toHaveBeenCalledWith('card-1', RATING.GOOD);
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(['RATE_PENDING', 'RATE_OK']);
  });

  it('dispatches PENDING then FAILED on rejection', async () => {
    const dispatch = vi.fn();
    await runRate('card-1', RATING.AGAIN, dispatch, () => true, async () => {
      throw new Error('nope');
    });
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(['RATE_PENDING', 'RATE_FAILED']);
  });

  it('discards a completion after the generation changed', async () => {
    const dispatch = vi.fn();
    let current = true;
    await runRate('card-1', RATING.EASY, dispatch, () => current, async () => {
      current = false;
      return undefined;
    });
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(['RATE_PENDING']);
  });
});
