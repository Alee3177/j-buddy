/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initialLearningItemsFeedState,
  useLearningItemsFeed,
  type LearningItemsFeed,
} from './learningItemsFeed';
import type { LearningItem, ListLearningItemsResult } from '@/types';

const listLearningItems = vi.fn();
vi.mock('@/services/firestoreService', () => ({
  listLearningItems: (...args: unknown[]) => listLearningItems(...args),
}));

// React 19 act() environment flag.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function item(id: string): LearningItem {
  return {
    id,
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
  };
}

const pageResult = (
  ids: string[],
  nextCursor: string | null
): ListLearningItemsResult => ({ items: ids.map(item), nextCursor });

function mountFeed(initial: { uid: string | null; authResolved: boolean }) {
  const sink = { current: null as LearningItemsFeed | null };
  let props = initial;

  function Probe() {
    sink.current = useLearningItemsFeed(props.uid, props.authResolved);
    return null;
  }

  const root = createRoot(document.createElement('div'));

  const rerender = async () => {
    await act(async () => {
      root.render(<Probe />);
    });
  };

  return {
    sink,
    mount: rerender,
    async set(next: Partial<typeof props>) {
      props = { ...props, ...next };
      await rerender();
    },
    async flush() {
      await act(async () => {});
    },
    unmount() {
      act(() => root.unmount());
    },
    state() {
      if (!sink.current) throw new Error('not mounted');
      return sink.current.state;
    },
    loadMore() {
      sink.current?.loadMore();
    },
  };
}

beforeEach(() => {
  listLearningItems.mockReset();
});

describe('useLearningItemsFeed', () => {
  it('loads the first page exactly once after auth resolves', async () => {
    listLearningItems.mockResolvedValue(pageResult(['a'], 'c1'));

    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await feed.flush();

    expect(listLearningItems).toHaveBeenCalledTimes(1);
    expect(listLearningItems).toHaveBeenCalledWith();
    expect(feed.state().phase).toBe('ready');
    expect(feed.state().items.map((i) => i.id)).toEqual(['a']);
    expect(feed.state().cursor).toBe('c1');

    feed.unmount();
  });

  it('does not query while auth is unresolved', async () => {
    const feed = mountFeed({ uid: 'u1', authResolved: false });
    await feed.mount();
    await feed.flush();

    expect(listLearningItems).not.toHaveBeenCalled();
    feed.unmount();
  });

  it('does not query when there is no signed-in user', async () => {
    const feed = mountFeed({ uid: null, authResolved: true });
    await feed.mount();
    await feed.flush();

    expect(listLearningItems).not.toHaveBeenCalled();
    expect(feed.state()).toEqual(initialLearningItemsFeedState);
    feed.unmount();
  });

  it('appends the next page in returned order on loadMore()', async () => {
    listLearningItems.mockResolvedValueOnce(pageResult(['a'], 'c1'));
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await feed.flush();

    listLearningItems.mockResolvedValueOnce(pageResult(['b', 'c'], null));
    await act(async () => {
      feed.loadMore();
    });
    await feed.flush();

    expect(listLearningItems).toHaveBeenNthCalledWith(2, { cursor: 'c1' });
    expect(feed.state().items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(feed.state().cursor).toBeNull();
    feed.unmount();
  });

  it('ignores a concurrent second loadMore() while one is pending', async () => {
    listLearningItems.mockResolvedValueOnce(pageResult(['a'], 'c1'));
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await feed.flush();

    let resolveSecond!: (r: ListLearningItemsResult) => void;
    listLearningItems.mockReturnValueOnce(
      new Promise<ListLearningItemsResult>((resolve) => {
        resolveSecond = resolve;
      })
    );

    await act(async () => {
      feed.loadMore();
    });
    expect(feed.state().loadingMore).toBe(true);

    await act(async () => {
      feed.loadMore(); // guarded — must not fire a 3rd request
    });
    expect(listLearningItems).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond(pageResult(['b'], null));
    });
    expect(feed.state().items.map((i) => i.id)).toEqual(['a', 'b']);
    feed.unmount();
  });

  it('keeps already-loaded items when the next page fails', async () => {
    listLearningItems.mockResolvedValueOnce(pageResult(['a'], 'c1'));
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await feed.flush();

    listLearningItems.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      feed.loadMore();
    });
    await feed.flush();

    expect(feed.state().items.map((i) => i.id)).toEqual(['a']);
    expect(feed.state().cursor).toBe('c1');
    expect(feed.state().loadingMore).toBe(false);
    expect(feed.state().loadMoreFailed).toBe(true);
    feed.unmount();
  });

  it('clears the list on sign-out and issues no further query', async () => {
    listLearningItems.mockResolvedValue(pageResult(['a'], 'c1'));
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await feed.flush();
    expect(feed.state().items).toHaveLength(1);

    listLearningItems.mockClear();
    await feed.set({ uid: null });

    expect(feed.state()).toEqual(initialLearningItemsFeedState);
    expect(listLearningItems).not.toHaveBeenCalled();
    feed.unmount();
  });

  it('reloads a fresh first page on user switch and discards the previous user\'s late response', async () => {
    let resolveFirstUser!: (r: ListLearningItemsResult) => void;
    listLearningItems.mockReturnValueOnce(
      new Promise<ListLearningItemsResult>((resolve) => {
        resolveFirstUser = resolve;
      })
    );

    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();

    // Switch before u1's first page resolves.
    listLearningItems.mockResolvedValueOnce(pageResult(['b2'], null));
    await feed.set({ uid: 'u2' });
    await feed.flush();

    expect(feed.state().items.map((i) => i.id)).toEqual(['b2']);
    expect(feed.state().cursor).toBeNull();

    // u1's stale response arrives — must be ignored.
    await act(async () => {
      resolveFirstUser(pageResult(['a1'], 'cX'));
    });
    expect(feed.state().items.map((i) => i.id)).toEqual(['b2']);
    expect(feed.state().cursor).toBeNull();
    expect(listLearningItems).toHaveBeenCalledTimes(2);
    feed.unmount();
  });
});
