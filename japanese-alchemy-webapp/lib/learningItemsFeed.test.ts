import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initialLearningItemsFeedState,
  learningItemsFeedReducer,
  startFirstPageFeed,
  runNextPage,
  type LearningItemsFeedState,
} from './learningItemsFeed';
import type { LearningItem, ListLearningItemsResult } from '@/types';

vi.mock('@/services/firestoreService', () => ({
  listLearningItems: vi.fn(),
  subscribeToLearningItems: vi.fn(),
}));

function item(overrides: Partial<LearningItem> = {}): LearningItem {
  return {
    id: 'id-1',
    userId: 'me',
    sourceAnalysisId: 'page-1',
    type: 'vocab',
    surface: '改善',
    status: 'NEW',
    createdAt: 100,
    updatedAt: 100,
    lexicalKey: 'vocab|改善|かいぜん',
    reading: 'かいぜん',
    meaning: '改善',
    sourceSentence: 'S',
    sourceUrl: null,
    ...overrides,
  };
}

const page = (
  items: LearningItem[],
  nextCursor: string | null
): ListLearningItemsResult => ({ items, nextCursor });

describe('learningItemsFeedReducer', () => {
  const ready: LearningItemsFeedState = {
    phase: 'ready',
    items: [item({ id: 'a' })],
    cursor: 'c1',
    loadingMore: false,
    loadMoreFailed: false,
  };

  it('RESET returns the initial state', () => {
    expect(learningItemsFeedReducer(ready, { type: 'RESET' })).toEqual(
      initialLearningItemsFeedState
    );
  });

  it('FIRST_PAGE_PENDING clears items and shows loading', () => {
    const next = learningItemsFeedReducer(ready, { type: 'FIRST_PAGE_PENDING' });
    expect(next).toEqual({ ...initialLearningItemsFeedState, phase: 'loading' });
  });

  it('FIRST_PAGE_OK stores items + cursor and becomes ready', () => {
    const next = learningItemsFeedReducer(initialLearningItemsFeedState, {
      type: 'FIRST_PAGE_OK',
      result: page([item({ id: 'a' }), item({ id: 'b' })], 'cursor-2'),
    });
    expect(next.phase).toBe('ready');
    expect(next.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(next.cursor).toBe('cursor-2');
  });

  it('FIRST_PAGE_FAILED becomes error with no items', () => {
    const next = learningItemsFeedReducer(ready, { type: 'FIRST_PAGE_FAILED' });
    expect(next.phase).toBe('error');
    expect(next.items).toEqual([]);
    expect(next.cursor).toBeNull();
  });

  it('NEXT_PAGE_PENDING sets loadingMore and keeps items', () => {
    const next = learningItemsFeedReducer(ready, { type: 'NEXT_PAGE_PENDING' });
    expect(next.loadingMore).toBe(true);
    expect(next.items).toEqual(ready.items);
  });

  it('NEXT_PAGE_OK appends in returned order without dedup or re-sort', () => {
    const dupKey = 'vocab|改善|かいぜん';
    const start: LearningItemsFeedState = {
      ...ready,
      items: [item({ id: 'a', createdAt: 100, lexicalKey: dupKey })],
      loadingMore: true,
    };
    const next = learningItemsFeedReducer(start, {
      type: 'NEXT_PAGE_OK',
      result: page(
        [
          item({ id: 'b', createdAt: 90, lexicalKey: dupKey }),
          item({ id: 'c', createdAt: 200, lexicalKey: dupKey }),
        ],
        null
      ),
    });
    expect(next.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(next.cursor).toBeNull();
    expect(next.loadingMore).toBe(false);
  });

  it('NEXT_PAGE_FAILED keeps items and cursor, flags the failure', () => {
    const start: LearningItemsFeedState = { ...ready, loadingMore: true };
    const next = learningItemsFeedReducer(start, { type: 'NEXT_PAGE_FAILED' });
    expect(next.items).toEqual(ready.items);
    expect(next.cursor).toBe('c1');
    expect(next.loadingMore).toBe(false);
    expect(next.loadMoreFailed).toBe(true);
  });
});

describe('startFirstPageFeed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches PENDING then OK on the initial emission, and OK again on a later live emission', () => {
    const dispatch = vi.fn();
    let onResult!: (r: ListLearningItemsResult) => void;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((res: typeof onResult) => {
      onResult = res;
      return unsubscribe;
    });

    const result = startFirstPageFeed(dispatch, () => true, subscribe);

    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual([
      'FIRST_PAGE_PENDING',
    ]);

    // Initial snapshot: count = 2.
    onResult(page([item({ id: 'a' }), item({ id: 'b' })], null));
    expect(dispatch.mock.calls[1][0]).toEqual({
      type: 'FIRST_PAGE_OK',
      result: page([item({ id: 'a' }), item({ id: 'b' })], null),
    });

    // External write lands — the same subscription fires again: count = 4.
    onResult(
      page([item({ id: 'c' }), item({ id: 'd' }), item({ id: 'a' }), item({ id: 'b' })], null)
    );
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dispatch.mock.calls[2][0].type).toBe('FIRST_PAGE_OK');
    expect(dispatch.mock.calls[2][0].result.items).toHaveLength(4);

    expect(typeof result).toBe('function');
  });

  it('dispatches PENDING then FAILED when the subscription reports an error', () => {
    const dispatch = vi.fn();
    let onError!: (e: unknown) => void;
    const subscribe = vi.fn((_res: unknown, err: typeof onError) => {
      onError = err;
      return vi.fn();
    });

    startFirstPageFeed(dispatch, () => true, subscribe);
    onError(new Error('boom'));

    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual([
      'FIRST_PAGE_PENDING',
      'FIRST_PAGE_FAILED',
    ]);
  });

  it('dispatches PENDING then FAILED when subscribing throws synchronously', () => {
    const dispatch = vi.fn();
    const subscribe = vi.fn(() => {
      throw new Error('not signed in');
    });

    const unsubscribe = startFirstPageFeed(dispatch, () => true, subscribe);

    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual([
      'FIRST_PAGE_PENDING',
      'FIRST_PAGE_FAILED',
    ]);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('discards an emission that arrives after the generation changed', () => {
    const dispatch = vi.fn();
    let onResult!: (r: ListLearningItemsResult) => void;
    let current = true;
    const subscribe = vi.fn((res: typeof onResult) => {
      onResult = res;
      return vi.fn();
    });

    startFirstPageFeed(dispatch, () => current, subscribe);
    current = false; // simulate a user switch
    onResult(page([item()], null));

    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual([
      'FIRST_PAGE_PENDING',
    ]);
  });

  it('does nothing and returns a no-op unsubscribe when already stale before it starts', () => {
    const dispatch = vi.fn();
    const subscribe = vi.fn();

    const unsubscribe = startFirstPageFeed(dispatch, () => false, subscribe);

    expect(dispatch).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('runNextPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the cursor through and dispatches PENDING then OK', async () => {
    const dispatch = vi.fn();
    const fetchNextPage = vi.fn(async () => page([item({ id: 'b' })], 'c2'));

    await runNextPage('c1', dispatch, () => true, fetchNextPage);

    expect(fetchNextPage).toHaveBeenCalledWith('c1');
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual([
      'NEXT_PAGE_PENDING',
      'NEXT_PAGE_OK',
    ]);
  });

  it('dispatches PENDING then FAILED when the fetch rejects', async () => {
    const dispatch = vi.fn();

    await runNextPage('c1', dispatch, () => true, async () => {
      throw new Error('nope');
    });

    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual([
      'NEXT_PAGE_PENDING',
      'NEXT_PAGE_FAILED',
    ]);
  });
});
