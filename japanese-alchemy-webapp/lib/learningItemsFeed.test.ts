import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initialLearningItemsFeedState,
  learningItemsFeedReducer,
  runFirstPage,
  runNextPage,
  type LearningItemsFeedState,
} from './learningItemsFeed';
import type { LearningItem, ListLearningItemsResult } from '@/types';

vi.mock('@/services/firestoreService', () => ({ listLearningItems: vi.fn() }));

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

describe('runFirstPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches PENDING then OK on success', async () => {
    const dispatch = vi.fn();
    const result = page([item({ id: 'a' })], 'c1');

    await runFirstPage(dispatch, () => true, async () => result);

    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual([
      'FIRST_PAGE_PENDING',
      'FIRST_PAGE_OK',
    ]);
    expect(dispatch.mock.calls[1][0].result).toBe(result);
  });

  it('dispatches PENDING then FAILED when the fetch rejects', async () => {
    const dispatch = vi.fn();

    await runFirstPage(dispatch, () => true, async () => {
      throw new Error('boom');
    });

    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual([
      'FIRST_PAGE_PENDING',
      'FIRST_PAGE_FAILED',
    ]);
  });

  it('discards a response that resolves after the generation changed', async () => {
    const dispatch = vi.fn();
    let current = true;

    await runFirstPage(
      dispatch,
      () => current,
      async () => {
        current = false; // simulate a user switch mid-flight
        return page([item()], null);
      }
    );

    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual([
      'FIRST_PAGE_PENDING',
    ]);
  });

  it('does nothing when already stale before it starts', async () => {
    const dispatch = vi.fn();
    await runFirstPage(dispatch, () => false, async () => page([], null));
    expect(dispatch).not.toHaveBeenCalled();
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
