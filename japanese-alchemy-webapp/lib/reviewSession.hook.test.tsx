/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReviewSession, type ReviewSession } from './reviewSession';
import { RATING, newReviewCard } from '@/lib/reviewCard';
import type { LearningItem, ReviewCard } from '@/types';

const listDueReviewCards = vi.fn();
const applyReviewRating = vi.fn();
vi.mock('@/services/reviewService', () => ({
  listDueReviewCards: (...a: unknown[]) => listDueReviewCards(...a),
  applyReviewRating: (...a: unknown[]) => applyReviewRating(...a),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function card(key: string): ReviewCard {
  const item: LearningItem = {
    id: `li-${key}`,
    userId: 'u',
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
  return { ...newReviewCard(item, 'u', 0), id: `card-${key}` };
}
const queue = (keys: string[]) => ({ cards: keys.map(card) });

function mount(initial: { uid: string | null; authResolved: boolean }) {
  const sink = { current: null as ReviewSession | null };
  let props = initial;
  function Probe() {
    sink.current = useReviewSession(props.uid, props.authResolved);
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
    s() {
      if (!sink.current) throw new Error('not mounted');
      return sink.current;
    },
  };
}

beforeEach(() => {
  listDueReviewCards.mockReset();
  applyReviewRating.mockReset();
});

describe('useReviewSession', () => {
  it('14. does not query while auth is unresolved', async () => {
    const h = mount({ uid: 'u1', authResolved: false });
    await h.mount();
    await h.flush();
    expect(listDueReviewCards).not.toHaveBeenCalled();
    h.unmount();
  });

  it('15. does not query when signed out', async () => {
    const h = mount({ uid: null, authResolved: true });
    await h.mount();
    await h.flush();
    expect(listDueReviewCards).not.toHaveBeenCalled();
    expect(h.s().state.cards).toEqual([]);
    h.unmount();
  });

  it('16. loads the batch once after auth resolves', async () => {
    listDueReviewCards.mockResolvedValue(queue(['a', 'b']));
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    expect(listDueReviewCards).toHaveBeenCalledTimes(1);
    expect(h.s().state.phase).toBe('ready');
    expect(h.s().currentCard?.id).toBe('card-a');
    expect(h.s().remaining).toBe(2);
    h.unmount();
  });

  it('17. logout resets the session and issues no further query', async () => {
    listDueReviewCards.mockResolvedValue(queue(['a']));
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    listDueReviewCards.mockClear();
    await h.set({ uid: null });
    expect(h.s().state).toMatchObject({ phase: 'loading', cards: [] });
    expect(listDueReviewCards).not.toHaveBeenCalled();
    h.unmount();
  });

  it('18/19. user switch clears the old queue and discards the previous user\'s response', async () => {
    let resolveU1!: (v: { cards: ReviewCard[] }) => void;
    listDueReviewCards.mockReturnValueOnce(
      new Promise<{ cards: ReviewCard[] }>((r) => {
        resolveU1 = r;
      })
    );
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();

    listDueReviewCards.mockResolvedValueOnce(queue(['b2']));
    await h.set({ uid: 'u2' });
    await h.flush();
    expect(h.s().currentCard?.id).toBe('card-b2');

    await act(async () => {
      resolveU1(queue(['a1']));
    });
    expect(h.s().currentCard?.id).toBe('card-b2');
    h.unmount();
  });

  it('20/21/23. reveal then rate Good calls applyReviewRating and advances', async () => {
    listDueReviewCards.mockResolvedValue(queue(['a', 'b']));
    applyReviewRating.mockResolvedValue(undefined);
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();

    // rating is a no-op before reveal
    await act(async () => h.s().rate(RATING.GOOD));
    expect(applyReviewRating).not.toHaveBeenCalled();

    await act(async () => h.s().reveal());
    expect(h.s().state.revealed).toBe(true);

    await act(async () => {
      h.s().rate(RATING.GOOD);
    });
    await h.flush();

    expect(applyReviewRating).toHaveBeenCalledWith('card-a', RATING.GOOD);
    expect(h.s().currentCard?.id).toBe('card-b');
    expect(h.s().state.revealed).toBe(false);
    h.unmount();
  });

  it('22. a second rate() while one is pending is ignored', async () => {
    listDueReviewCards.mockResolvedValue(queue(['a', 'b']));
    let resolveRate!: () => void;
    applyReviewRating.mockReturnValueOnce(
      new Promise<void>((r) => {
        resolveRate = r;
      })
    );
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    await act(async () => h.s().reveal());

    await act(async () => {
      h.s().rate(RATING.GOOD);
    });
    expect(h.s().state.rating).toBe(true);

    await act(async () => {
      h.s().rate(RATING.EASY); // ignored
    });
    expect(applyReviewRating).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRate();
    });
    expect(h.s().currentCard?.id).toBe('card-b');
    h.unmount();
  });

  it('24. a failed rating keeps the current card and its revealed state', async () => {
    listDueReviewCards.mockResolvedValue(queue(['a', 'b']));
    applyReviewRating.mockRejectedValueOnce(new Error('network'));
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    await act(async () => h.s().reveal());

    await act(async () => {
      h.s().rate(RATING.GOOD);
    });
    await h.flush();

    expect(h.s().currentCard?.id).toBe('card-a');
    expect(h.s().state.revealed).toBe(true);
    expect(h.s().state.mutationError).toBe(true);
    expect(h.s().state.rating).toBe(false);
    h.unmount();
  });

  it('allows retry after a failed rating', async () => {
    listDueReviewCards.mockResolvedValue(queue(['a', 'b']));
    applyReviewRating.mockRejectedValueOnce(new Error('network'));
    applyReviewRating.mockResolvedValueOnce(undefined);
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    await act(async () => h.s().reveal());
    await act(async () => h.s().rate(RATING.GOOD));
    await h.flush();
    await act(async () => h.s().rate(RATING.GOOD));
    await h.flush();
    expect(applyReviewRating).toHaveBeenCalledTimes(2);
    expect(h.s().currentCard?.id).toBe('card-b');
    h.unmount();
  });

  it('25. exhausting the batch triggers exactly one re-fetch', async () => {
    listDueReviewCards.mockResolvedValueOnce(queue(['a']));
    applyReviewRating.mockResolvedValue(undefined);
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();

    listDueReviewCards.mockResolvedValueOnce(queue([])); // nothing left
    await act(async () => h.s().reveal());
    await act(async () => {
      h.s().rate(RATING.GOOD);
    });
    await h.flush();

    expect(listDueReviewCards).toHaveBeenCalledTimes(2);
    expect(h.s().state.phase).toBe('ready');
    expect(h.s().currentCard).toBeNull();
    expect(h.s().remaining).toBe(0);
    h.unmount();
  });

  it('26. a stale rating completion after a user switch does not advance the new session', async () => {
    listDueReviewCards.mockResolvedValueOnce(queue(['a', 'b']));
    let resolveRate!: () => void;
    applyReviewRating.mockReturnValueOnce(
      new Promise<void>((r) => {
        resolveRate = r;
      })
    );
    const h = mount({ uid: 'u1', authResolved: true });
    await h.mount();
    await h.flush();
    await act(async () => h.s().reveal());
    await act(async () => {
      h.s().rate(RATING.GOOD);
    });

    // switch users before the rating resolves
    listDueReviewCards.mockResolvedValueOnce(queue(['x']));
    await h.set({ uid: 'u2' });
    await h.flush();
    expect(h.s().currentCard?.id).toBe('card-x');

    await act(async () => {
      resolveRate();
    });
    // still on u2's first card — the stale RATE_OK was discarded
    expect(h.s().currentCard?.id).toBe('card-x');
    expect(h.s().state.currentIndex).toBe(0);
    h.unmount();
  });
});
