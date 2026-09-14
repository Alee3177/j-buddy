/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserCollectionFeed } from './userCollectionFeed';

// React 19 act() environment flag.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface Row {
  id: string;
}

/** Each `subscribe()` call gets its own unsubscribe spy and captured emitters. */
interface Subscription {
  unsubscribe: ReturnType<typeof vi.fn>;
  emit: (items: Row[]) => void;
  fail: (error: unknown) => void;
}

function stubSubscriber() {
  const subs: Subscription[] = [];
  const subscribe = vi.fn(
    (
      _uid: string,
      onData: (items: Row[]) => void,
      onError: (error: unknown) => void
    ) => {
      const unsubscribe = vi.fn();
      subs.push({ unsubscribe, emit: onData, fail: onError });
      return unsubscribe;
    }
  );
  return { subscribe, subs };
}

function mountFeed(
  subscribe: ReturnType<typeof stubSubscriber>['subscribe'],
  initial: { uid: string | null; authResolved: boolean },
  refetchOnFocus?: (uid: string) => Promise<Row[]>
) {
  const sink = { current: null as Row[] | null };
  let props = initial;

  function Probe() {
    sink.current = useUserCollectionFeed<Row>(
      props.uid,
      props.authResolved,
      subscribe,
      refetchOnFocus
    );
    return null;
  }

  const root = createRoot(document.createElement('div'));

  const rerender = async () => {
    await act(async () => {
      root.render(<Probe />);
    });
  };

  return {
    mount: rerender,
    async set(next: Partial<typeof props>) {
      props = { ...props, ...next };
      await rerender();
    },
    unmount() {
      act(() => root.unmount());
    },
    items() {
      if (sink.current == null) throw new Error('not mounted');
      return sink.current;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUserCollectionFeed', () => {
  it('subscribes exactly once after auth resolves and applies the initial snapshot', async () => {
    const { subscribe, subs } = stubSubscriber();
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true });
    await feed.mount();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith('u1', expect.any(Function), expect.any(Function));

    await act(async () => {
      subs[0].emit([{ id: 'a' }]);
    });
    expect(feed.items()).toEqual([{ id: 'a' }]);

    feed.unmount();
  });

  it('updates live on a later emission from the same subscription (e.g. an external write)', async () => {
    const { subscribe, subs } = stubSubscriber();
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true });
    await feed.mount();

    await act(async () => {
      subs[0].emit([{ id: 'a' }]);
    });
    expect(feed.items()).toHaveLength(1);

    await act(async () => {
      subs[0].emit([{ id: 'a' }, { id: 'b' }]);
    });
    expect(feed.items()).toHaveLength(2);
    expect(subscribe).toHaveBeenCalledTimes(1);

    feed.unmount();
  });

  it('does not subscribe while auth is unresolved', async () => {
    const { subscribe } = stubSubscriber();
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: false });
    await feed.mount();

    expect(subscribe).not.toHaveBeenCalled();
    feed.unmount();
  });

  it('does not subscribe and returns an empty list when there is no signed-in user', async () => {
    const { subscribe } = stubSubscriber();
    const feed = mountFeed(subscribe, { uid: null, authResolved: true });
    await feed.mount();

    expect(subscribe).not.toHaveBeenCalled();
    expect(feed.items()).toEqual([]);
    feed.unmount();
  });

  it('resets to empty on a subscription error, and logs it (P7.4 — no silent swallow)', async () => {
    const { subscribe, subs } = stubSubscriber();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true });
    await feed.mount();
    await act(async () => {
      subs[0].emit([{ id: 'a' }]);
    });

    const error = new Error('permission-denied');
    await act(async () => {
      subs[0].fail(error);
    });
    expect(feed.items()).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), error);

    consoleError.mockRestore();
    feed.unmount();
  });

  it('unsubscribes on unmount', async () => {
    const { subscribe, subs } = stubSubscriber();
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true });
    await feed.mount();

    feed.unmount();
    expect(subs[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the previous listener before subscribing for a new user (no duplicate subscriptions)', async () => {
    const { subscribe, subs } = stubSubscriber();
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true });
    await feed.mount();
    expect(subscribe).toHaveBeenCalledTimes(1);

    await feed.set({ uid: 'u2' });

    expect(subs[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subs[1].unsubscribe).not.toHaveBeenCalled();

    feed.unmount();
    expect(subs[1].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('discards a stale emission from a listener torn down by a user switch', async () => {
    const { subscribe, subs } = stubSubscriber();
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true });
    await feed.mount();

    await feed.set({ uid: 'u2' });
    await act(async () => {
      subs[1].emit([{ id: 'b' }]);
    });
    expect(feed.items()).toEqual([{ id: 'b' }]);

    // u1's torn-down listener fires late — must be ignored.
    await act(async () => {
      subs[0].emit([{ id: 'a-late' }]);
    });
    expect(feed.items()).toEqual([{ id: 'b' }]);

    feed.unmount();
  });

  it('clears the list and unsubscribes on sign-out, issuing no further subscription', async () => {
    const { subscribe, subs } = stubSubscriber();
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true });
    await feed.mount();
    await act(async () => {
      subs[0].emit([{ id: 'a' }]);
    });

    await feed.set({ uid: null });

    expect(subs[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(feed.items()).toEqual([]);
    expect(subscribe).toHaveBeenCalledTimes(1);

    feed.unmount();
  });
});

// P7.3-I hybrid fallback — focus/visibility one-shot refresh layered on top
// of the live subscription above.
describe('useUserCollectionFeed focus/visibility fallback', () => {
  it('applies a fresh one-shot read when the window regains focus', async () => {
    const { subscribe, subs } = stubSubscriber();
    const refetchOnFocus = vi.fn(async () => [{ id: 'a' }, { id: 'b' }]);
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true }, refetchOnFocus);
    await feed.mount();
    await act(async () => {
      subs[0].emit([{ id: 'a' }]);
    });
    expect(feed.items()).toHaveLength(1);

    // No onSnapshot emission arrives — only the fallback fires.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(refetchOnFocus).toHaveBeenCalledWith('u1');
    expect(feed.items()).toEqual([{ id: 'a' }, { id: 'b' }]);
    // onSnapshot itself was never re-subscribed for this.
    expect(subscribe).toHaveBeenCalledTimes(1);

    feed.unmount();
  });

  it('does nothing on hidden visibilitychange', async () => {
    const { subscribe } = stubSubscriber();
    const refetchOnFocus = vi.fn(async () => [{ id: 'a' }]);
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true }, refetchOnFocus);
    await feed.mount();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(refetchOnFocus).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    feed.unmount();
  });

  it('does nothing when signed out', async () => {
    const { subscribe } = stubSubscriber();
    const refetchOnFocus = vi.fn(async () => [{ id: 'a' }]);
    const feed = mountFeed(subscribe, { uid: null, authResolved: true }, refetchOnFocus);
    await feed.mount();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(refetchOnFocus).not.toHaveBeenCalled();
    feed.unmount();
  });

  it('dedupes focus + visibilitychange firing together into one read', async () => {
    const { subscribe } = stubSubscriber();
    let resolveFetch!: (items: Row[]) => void;
    const refetchOnFocus = vi.fn(
      () => new Promise<Row[]>((resolve) => { resolveFetch = resolve; })
    );
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true }, refetchOnFocus);
    await feed.mount();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(refetchOnFocus).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFetch([{ id: 'a' }]);
    });

    feed.unmount();
  });

  it('removes the focus/visibility listeners on unmount', async () => {
    const { subscribe } = stubSubscriber();
    const refetchOnFocus = vi.fn(async () => [{ id: 'a' }]);
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true }, refetchOnFocus);
    await feed.mount();
    feed.unmount();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(refetchOnFocus).not.toHaveBeenCalled();
  });

  it('keeps last-known-good data when the fallback read fails', async () => {
    const { subscribe, subs } = stubSubscriber();
    const refetchOnFocus = vi.fn(async () => {
      throw new Error('network blip');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true }, refetchOnFocus);
    await feed.mount();
    await act(async () => {
      subs[0].emit([{ id: 'a' }]);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(feed.items()).toEqual([{ id: 'a' }]);
    consoleError.mockRestore();
    feed.unmount();
  });

  it('does not attach focus/visibility listeners when no refetchOnFocus is provided', async () => {
    const { subscribe } = stubSubscriber();
    const feed = mountFeed(subscribe, { uid: 'u1', authResolved: true }); // no 4th arg
    await feed.mount();

    // Nothing to assert on directly other than: no crash and subscribe still
    // fires once — the fallback simply isn't wired when unused.
    expect(subscribe).toHaveBeenCalledTimes(1);
    feed.unmount();
  });
});
