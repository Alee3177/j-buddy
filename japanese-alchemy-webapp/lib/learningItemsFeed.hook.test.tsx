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
const subscribeToLearningItems = vi.fn();
vi.mock('@/services/firestoreService', () => ({
  listLearningItems: (...args: unknown[]) => listLearningItems(...args),
  subscribeToLearningItems: (...args: unknown[]) => subscribeToLearningItems(...args),
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

/**
 * Every `subscribeToLearningItems` call gets its own unsubscribe spy and its
 * own captured onData/onError, keyed by call index — so a test can drive a
 * specific subscription's live updates and assert its listener was torn down.
 */
interface Subscription {
  unsubscribe: ReturnType<typeof vi.fn>;
  emit: (result: ListLearningItemsResult) => void;
  fail: (error: unknown) => void;
}

function stubSubscriptions(): Subscription[] {
  const subs: Subscription[] = [];
  subscribeToLearningItems.mockImplementation(
    (
      _pageSize: number | undefined,
      onData: (r: ListLearningItemsResult) => void,
      onError: (e: unknown) => void
    ) => {
      const unsubscribe = vi.fn();
      subs.push({ unsubscribe, emit: onData, fail: onError });
      return unsubscribe;
    }
  );
  return subs;
}

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
  subscribeToLearningItems.mockReset();
});

describe('useLearningItemsFeed', () => {
  it('subscribes exactly once after auth resolves and applies the initial snapshot', async () => {
    const subs = stubSubscriptions();

    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await feed.flush();

    expect(subscribeToLearningItems).toHaveBeenCalledTimes(1);
    expect(subs[0]).toBeDefined();

    await act(async () => {
      subs[0].emit(pageResult(['a'], 'c1'));
    });

    expect(feed.state().phase).toBe('ready');
    expect(feed.state().items.map((i) => i.id)).toEqual(['a']);
    expect(feed.state().cursor).toBe('c1');

    feed.unmount();
  });

  // P7.3-I regression: reproduces the reported bug — an already-open webapp
  // must reflect an external Firestore write (Chrome-extension save) live,
  // with no reload, no route remount, and no user interaction.
  it('updates the count live (2 -> 4) when an external write lands, with no reload or interaction', async () => {
    const subs = stubSubscriptions();

    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await act(async () => {
      subs[0].emit(pageResult(['a', 'b'], null));
    });
    expect(feed.state().items).toHaveLength(2);

    // The Chrome extension writes two more learning items directly to
    // Firestore; the SAME onSnapshot listener fires again on its own.
    await act(async () => {
      subs[0].emit(pageResult(['c', 'd', 'a', 'b'], null));
    });

    expect(feed.state().items).toHaveLength(4);
    expect(feed.state().items.map((i) => i.id)).toEqual(['c', 'd', 'a', 'b']);
    // No fetch-based call was ever needed to pick up the change.
    expect(listLearningItems).not.toHaveBeenCalled();
    expect(subscribeToLearningItems).toHaveBeenCalledTimes(1);

    feed.unmount();
  });

  it('does not subscribe while auth is unresolved', async () => {
    stubSubscriptions();

    const feed = mountFeed({ uid: 'u1', authResolved: false });
    await feed.mount();
    await feed.flush();

    expect(subscribeToLearningItems).not.toHaveBeenCalled();
    feed.unmount();
  });

  it('does not subscribe when there is no signed-in user', async () => {
    stubSubscriptions();

    const feed = mountFeed({ uid: null, authResolved: true });
    await feed.mount();
    await feed.flush();

    expect(subscribeToLearningItems).not.toHaveBeenCalled();
    expect(feed.state()).toEqual(initialLearningItemsFeedState);
    feed.unmount();
  });

  it('appends the next page in returned order on loadMore()', async () => {
    const subs = stubSubscriptions();
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await act(async () => {
      subs[0].emit(pageResult(['a'], 'c1'));
    });

    listLearningItems.mockResolvedValueOnce(pageResult(['b', 'c'], null));
    await act(async () => {
      feed.loadMore();
    });
    await feed.flush();

    expect(listLearningItems).toHaveBeenNthCalledWith(1, { cursor: 'c1' });
    expect(feed.state().items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(feed.state().cursor).toBeNull();
    feed.unmount();
  });

  it('ignores a concurrent second loadMore() while one is pending', async () => {
    const subs = stubSubscriptions();
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await act(async () => {
      subs[0].emit(pageResult(['a'], 'c1'));
    });

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
      feed.loadMore(); // guarded — must not fire a 2nd request
    });
    expect(listLearningItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSecond(pageResult(['b'], null));
    });
    expect(feed.state().items.map((i) => i.id)).toEqual(['a', 'b']);
    feed.unmount();
  });

  it('keeps already-loaded items when the next page fails', async () => {
    const subs = stubSubscriptions();
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await act(async () => {
      subs[0].emit(pageResult(['a'], 'c1'));
    });

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

  it('unsubscribes on unmount', async () => {
    const subs = stubSubscriptions();
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await act(async () => {
      subs[0].emit(pageResult(['a'], null));
    });

    feed.unmount();

    expect(subs[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('clears the list on sign-out, unsubscribes, and issues no further query', async () => {
    const subs = stubSubscriptions();
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await act(async () => {
      subs[0].emit(pageResult(['a'], 'c1'));
    });
    expect(feed.state().items).toHaveLength(1);

    await feed.set({ uid: null });

    expect(subs[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(feed.state()).toEqual(initialLearningItemsFeedState);
    expect(listLearningItems).not.toHaveBeenCalled();

    // A late emission from the torn-down subscription must never land —
    // the reducer/generation guard is belt-and-suspenders on top of unsubscribe.
    await act(async () => {
      subs[0].emit(pageResult(['late'], null));
    });
    expect(feed.state()).toEqual(initialLearningItemsFeedState);

    feed.unmount();
  });

  it('unsubscribes the previous user\'s listener before subscribing for the new user (no duplicate subscriptions)', async () => {
    const subs = stubSubscriptions();

    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    expect(subscribeToLearningItems).toHaveBeenCalledTimes(1);

    await feed.set({ uid: 'u2' });

    expect(subs[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribeToLearningItems).toHaveBeenCalledTimes(2);
    expect(subs[1]).toBeDefined();
    expect(subs[1].unsubscribe).not.toHaveBeenCalled();

    feed.unmount();
    expect(subs[1].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reloads a fresh first page on user switch and discards the previous user's late emission", async () => {
    const subs = stubSubscriptions();

    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();

    await feed.set({ uid: 'u2' });
    await act(async () => {
      subs[1].emit(pageResult(['b2'], null));
    });

    expect(feed.state().items.map((i) => i.id)).toEqual(['b2']);
    expect(feed.state().cursor).toBeNull();

    // u1's listener is unsubscribed, but even if it fired late, it must be ignored.
    await act(async () => {
      subs[0].emit(pageResult(['a1'], 'cX'));
    });
    expect(feed.state().items.map((i) => i.id)).toEqual(['b2']);
    expect(feed.state().cursor).toBeNull();
    expect(subscribeToLearningItems).toHaveBeenCalledTimes(2);
    feed.unmount();
  });

  it('surfaces a subscription error as the error phase, and logs it (P7.4 — no silent swallow)', async () => {
    const subs = stubSubscriptions();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();

    const error = new Error('permission-denied');
    await act(async () => {
      subs[0].fail(error);
    });

    expect(feed.state().phase).toBe('error');
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), error);

    consoleError.mockRestore();
    feed.unmount();
  });
});

// P7.3-I hybrid fallback — focus/visibility one-shot first-page re-fetch,
// layered on top of the live subscription above.
describe('useLearningItemsFeed focus/visibility fallback', () => {
  it('re-fetches the first page on window focus when no onSnapshot emission arrives', async () => {
    const subs = stubSubscriptions();
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();
    await act(async () => {
      subs[0].emit(pageResult(['l1', 'l2'], null));
    });
    expect(feed.state().items).toHaveLength(2);

    listLearningItems.mockResolvedValueOnce(pageResult(['l3', 'l4', 'l1', 'l2'], null));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(listLearningItems).toHaveBeenCalledWith();
    expect(feed.state().items.map((i) => i.id)).toEqual(['l3', 'l4', 'l1', 'l2']);
    // The live listener itself was never re-subscribed for this.
    expect(subscribeToLearningItems).toHaveBeenCalledTimes(1);

    feed.unmount();
  });

  it('does nothing on hidden visibilitychange or after unmount', async () => {
    stubSubscriptions();
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(listLearningItems).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    feed.unmount();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(listLearningItems).not.toHaveBeenCalled();
  });

  it('does nothing when signed out', async () => {
    stubSubscriptions();
    const feed = mountFeed({ uid: null, authResolved: true });
    await feed.mount();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(listLearningItems).not.toHaveBeenCalled();
    feed.unmount();
  });

  it('dedupes focus + visibilitychange firing together into one re-fetch', async () => {
    stubSubscriptions();
    const feed = mountFeed({ uid: 'u1', authResolved: true });
    await feed.mount();

    let resolveFetch!: (r: ListLearningItemsResult) => void;
    listLearningItems.mockReturnValueOnce(
      new Promise<ListLearningItemsResult>((resolve) => {
        resolveFetch = resolve;
      })
    );
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(listLearningItems).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFetch(pageResult(['l1'], null));
    });

    feed.unmount();
  });
});
