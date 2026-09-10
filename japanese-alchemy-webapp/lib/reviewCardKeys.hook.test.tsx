/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initialReviewCardKeysState,
  reviewCardKeysReducer,
  runLoadReviewCardKeys,
  useReviewCardKeys,
  type ReviewCardKeys,
} from './reviewCardKeys';

const listReviewCardKeys = vi.fn();
vi.mock('@/services/reviewService', () => ({
  listReviewCardKeys: (...a: unknown[]) => listReviewCardKeys(...a),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- reducer ---------------------------------------------------------------

describe('reviewCardKeysReducer', () => {
  it('initial state: empty set, loading, no error', () => {
    expect(initialReviewCardKeysState.keys.size).toBe(0);
    expect(initialReviewCardKeysState.loading).toBe(true);
    expect(initialReviewCardKeysState.error).toBe(false);
  });

  it('LOAD_PENDING → loading, empty', () => {
    const s = reviewCardKeysReducer(
      { keys: new Set(['x']), loading: false, error: true },
      { type: 'LOAD_PENDING' }
    );
    expect(s).toEqual({ keys: new Set(), loading: true, error: false });
  });

  it('LOAD_OK stores the set', () => {
    const s = reviewCardKeysReducer(initialReviewCardKeysState, {
      type: 'LOAD_OK',
      keys: new Set(['a', 'b']),
    });
    expect([...s.keys].sort()).toEqual(['a', 'b']);
    expect(s.loading).toBe(false);
    expect(s.error).toBe(false);
  });

  it('LOAD_FAILED → error, empty set (never fabricates reviewed state)', () => {
    const s = reviewCardKeysReducer(
      { keys: new Set(['a']), loading: true, error: false },
      { type: 'LOAD_FAILED' }
    );
    expect(s).toEqual({ keys: new Set(), loading: false, error: true });
  });

  it('ADD_KEY inserts a new key (new Set reference) and is idempotent', () => {
    const s0 = reviewCardKeysReducer(initialReviewCardKeysState, {
      type: 'LOAD_OK',
      keys: new Set(['a']),
    });
    const s1 = reviewCardKeysReducer(s0, { type: 'ADD_KEY', key: 'b' });
    expect([...s1.keys].sort()).toEqual(['a', 'b']);
    expect(s1.keys).not.toBe(s0.keys);

    const s2 = reviewCardKeysReducer(s1, { type: 'ADD_KEY', key: 'b' });
    expect(s2).toBe(s1); // no-op
  });

  it('RESET → empty, not loading', () => {
    const s = reviewCardKeysReducer(
      { keys: new Set(['a']), loading: true, error: true },
      { type: 'RESET' }
    );
    expect(s).toEqual({ keys: new Set(), loading: false, error: false });
  });
});

// ---- runner ---------------------------------------------------------------

describe('runLoadReviewCardKeys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches PENDING then OK', async () => {
    const dispatch = vi.fn();
    await runLoadReviewCardKeys(dispatch, () => true, async () => new Set(['k']));
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(['LOAD_PENDING', 'LOAD_OK']);
    expect([...dispatch.mock.calls[1][0].keys]).toEqual(['k']);
  });

  it('dispatches PENDING then FAILED on rejection', async () => {
    const dispatch = vi.fn();
    await runLoadReviewCardKeys(dispatch, () => true, async () => {
      throw new Error('x');
    });
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(['LOAD_PENDING', 'LOAD_FAILED']);
  });

  it('discards a response after the generation changed', async () => {
    const dispatch = vi.fn();
    let current = true;
    await runLoadReviewCardKeys(dispatch, () => current, async () => {
      current = false;
      return new Set(['k']);
    });
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(['LOAD_PENDING']);
  });
});

// ---- hook ---------------------------------------------------------------

function mount(initial: { uid: string | null; authResolved: boolean }) {
  const sink = { current: null as ReviewCardKeys | null };
  let props = initial;
  function Probe() {
    sink.current = useReviewCardKeys(props.uid, props.authResolved);
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
    async flush() {
      await act(async () => {});
    },
    unmount() {
      act(() => root.unmount());
    },
    v() {
      if (!sink.current) throw new Error('not mounted');
      return sink.current;
    },
  };
}

beforeEach(() => {
  listReviewCardKeys.mockReset();
});

describe('useReviewCardKeys', () => {
  it('does not query while auth is unresolved', async () => {
    const h = mount({ uid: 'u1', authResolved: false });
    await h.mount();
    await h.flush();
    expect(listReviewCardKeys).not.toHaveBeenCalled();
    h.unmount();
  });

  it('does not query when signed out; keys are empty', async () => {
    const h = mount({ uid: null, authResolved: true });
    await h.mount();
    await h.flush();
    expect(listReviewCardKeys).not.toHaveBeenCalled();
    expect(h.v().keys.size).toBe(0);
    expect(h.v().loading).toBe(false);
    h.unmount();
  });

  it('loads keys once when signed in', async () => {
    listReviewCardKeys.mockResolvedValue(new Set(['vocab|改善|かいぜん']));
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    expect(listReviewCardKeys).toHaveBeenCalledTimes(1);
    expect(h.v().loading).toBe(false);
    expect(h.v().error).toBe(false);
    expect(h.v().keys.has('vocab|改善|かいぜん')).toBe(true);
    h.unmount();
  });

  it('exposes a loading state until the fetch resolves', async () => {
    let resolve!: (s: Set<string>) => void;
    listReviewCardKeys.mockReturnValue(new Promise<Set<string>>((r) => (resolve = r)));
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    expect(h.v().loading).toBe(true);
    await act(async () => resolve(new Set()));
    expect(h.v().loading).toBe(false);
    h.unmount();
  });

  it('empty success → empty set, not loading, no error', async () => {
    listReviewCardKeys.mockResolvedValue(new Set());
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    expect(h.v().keys.size).toBe(0);
    expect(h.v().error).toBe(false);
    h.unmount();
  });

  it('load failure → error flag, empty set (nothing marked reviewed)', async () => {
    listReviewCardKeys.mockRejectedValue(new Error('permission-denied'));
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    expect(h.v().error).toBe(true);
    expect(h.v().keys.size).toBe(0);
    expect(h.v().loading).toBe(false);
    h.unmount();
  });

  it('logout clears the set and issues no further query', async () => {
    listReviewCardKeys.mockResolvedValue(new Set(['a']));
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    expect(h.v().keys.size).toBe(1);

    listReviewCardKeys.mockClear();
    await h.set({ uid: null });
    expect(h.v().keys.size).toBe(0);
    expect(listReviewCardKeys).not.toHaveBeenCalled();
    h.unmount();
  });

  it('user switch clears the old set and discards the previous user\'s response', async () => {
    let resolveU1!: (s: Set<string>) => void;
    listReviewCardKeys.mockReturnValueOnce(
      new Promise<Set<string>>((r) => (resolveU1 = r))
    );
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();

    listReviewCardKeys.mockResolvedValueOnce(new Set(['u2-key']));
    await h.set({ uid: 'u2' });
    await h.flush();
    expect([...h.v().keys]).toEqual(['u2-key']);

    await act(async () => resolveU1(new Set(['u1-key'])));
    expect([...h.v().keys]).toEqual(['u2-key']); // stale response discarded
    h.unmount();
  });

  it('addKey inserts immediately and is idempotent; ignores empty', async () => {
    listReviewCardKeys.mockResolvedValue(new Set());
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();

    await act(async () => h.v().addKey('vocab|新|しん'));
    expect(h.v().keys.has('vocab|新|しん')).toBe(true);

    const before = h.v().keys;
    await act(async () => h.v().addKey('vocab|新|しん')); // idempotent
    // (a re-render may occur but the set contents are unchanged)
    expect(h.v().keys.size).toBe(before.size);

    await act(async () => h.v().addKey(''));
    expect(h.v().keys.has('')).toBe(false);
    h.unmount();
  });
});
