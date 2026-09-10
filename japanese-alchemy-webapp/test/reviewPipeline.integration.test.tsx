/* @vitest-environment jsdom */

/**
 * Japanese Reader v0.4 P3.4 — deterministic end-to-end review integration.
 *
 * Wires the REAL code across every P3 seam, faking only the Firestore transport
 * (an in-memory store honouring transactions + where/orderBy/limit):
 *
 *   deriveLearningItems (hosting, real)
 *     → materializeReviewCard   (P3.2, real — idempotent by cardId)
 *     → listDueReviewCards      (P3.3, real — dueAt <= now, asc)
 *     → useReviewSession        (P3.4, real — reveal / rate / advance / refetch)
 *     → applyReviewRating       (P3.2, real — deterministic schedule)
 *
 * No network, no Firebase init, no Gemini.
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveLearningItems,
  type NewLearningItem,
} from '../../japanese-alchemy-hosting/functions/src/models/learningItem';
import { DAY_MS, RATING, reviewCardIdFor } from '@/lib/reviewCard';
import type { ReviewCard } from '@/types';

type Constraint =
  | { kind: 'where'; field: string; op: string; value: unknown }
  | { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { kind: 'limit'; n: number };

const h = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string } | null },
  store: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  get auth() {
    return h.auth;
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  collection: (parent: { path: string }, name: string) => ({ path: `${parent.path}/${name}` }),
  where: (field: string, op: string, value: unknown): Constraint => ({ kind: 'where', field, op, value }),
  orderBy: (field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ kind: 'orderBy', field, dir }),
  limit: (n: number): Constraint => ({ kind: 'limit', n }),
  query: (source: { path: string }, ...constraints: Constraint[]) => ({ path: source.path, constraints }),
  getDocs: async (q: { path: string; constraints: Constraint[] }) => {
    const prefix = `${q.path}/`;
    let rows = [...h.store.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, data]) => ({ id: k.slice(prefix.length), data }));
    for (const c of q.constraints) {
      if (c.kind === 'where' && c.field === 'dueAt' && c.op === '<=') {
        rows = rows.filter((r) => (r.data.dueAt as number) <= (c.value as number));
      } else if (c.kind === 'orderBy' && c.field === 'dueAt') {
        const sign = c.dir === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const byDue = ((a.data.dueAt as number) - (b.data.dueAt as number)) * sign;
          return byDue !== 0 ? byDue : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
      } else if (c.kind === 'limit') {
        rows = rows.slice(0, c.n);
      }
    }
    return { docs: rows.map((r) => ({ id: r.id, data: () => ({ ...r.data }) })) };
  },
  runTransaction: async (
    _db: unknown,
    fn: (tx: {
      get: (r: { path: string }) => Promise<{ exists: () => boolean; data: () => Record<string, unknown> | undefined }>;
      set: (r: { path: string }, d: Record<string, unknown>) => void;
      update: (r: { path: string }, d: Record<string, unknown>) => void;
    }) => Promise<unknown>
  ) => {
    const buffered: Array<() => void> = [];
    const tx = {
      get: async (r: { path: string }) => {
        const data = h.store.get(r.path);
        return { exists: () => data !== undefined, data: () => (data === undefined ? undefined : { ...data }) };
      },
      set: (r: { path: string }, d: Record<string, unknown>) => buffered.push(() => h.store.set(r.path, { ...d })),
      update: (r: { path: string }, d: Record<string, unknown>) =>
        buffered.push(() => h.store.set(r.path, { ...(h.store.get(r.path) ?? {}), ...d })),
    };
    const result = await fn(tx);
    buffered.forEach((w) => w());
    return result;
  },
}));

import {
  applyReviewRating,
  listDueReviewCards,
  materializeReviewCard,
} from '@/services/reviewService';
import { useReviewSession, type ReviewSession } from '@/lib/reviewSession';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STRUCTURED = {
  words: [
    { term: '{改善|かいぜん}', detail: '讀音：かいぜん\n意思：使變得更好。' },
    { term: '改善', detail: '讀音：かいぜん\n解釋：改善。' }, // 2nd occurrence, same lexicalKey
    { term: '{問題|もんだい}', detail: '讀音：もんだい\n意思：待解決的事。' },
  ],
  grammars: [{ point: '〜ても', explanation: '- **用法說明**\n  - 即使…也…' }],
};
const META = { sourceText: '制度を改善しても問題は残る。', sourceUrl: 'https://news.example/x' };

function derive(now: number): NewLearningItem[] {
  return deriveLearningItems(STRUCTURED, META, 'page-1', { userId: 'alice', now });
}
const withIds = (drafts: NewLearningItem[]) => drafts.map((d, i) => ({ ...d, id: `li-${i}` }));

function reviewPath(lexicalKey: string) {
  return `users/alice/review_cards/${reviewCardIdFor(lexicalKey)}`;
}
function storedCards(): ReviewCard[] {
  return [...h.store.entries()]
    .filter(([k]) => k.startsWith('users/alice/review_cards/'))
    .map(([, v]) => v as unknown as ReviewCard);
}

function mountSession() {
  const sink = { current: null as ReviewSession | null };
  function Probe() {
    sink.current = useReviewSession('alice', true);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  return {
    async mount() {
      await act(async () => {
        root.render(<Probe />);
      });
      await act(async () => {});
    },
    s: () => sink.current!,
    async act(fn: () => void) {
      await act(async () => fn());
      await act(async () => {});
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

beforeEach(() => {
  h.store.clear();
  h.auth.currentUser = { uid: 'alice' };
});

describe('P3.4 · review pipeline', () => {
  it('materialises one review card per lexical identity from derived occurrences', async () => {
    const items = withIds(derive(1_000));
    for (const item of items) {
      await materializeReviewCard(item, { now: 1_000 });
    }
    // 4 derived occurrences (改善 ×2, 問題, 〜ても) → 3 distinct review cards
    expect(storedCards()).toHaveLength(3);

    // the two 改善 occurrences collapsed onto the same card path
    const kaizenPath = reviewPath('vocab|改善|かいぜん');
    expect(h.store.has(kaizenPath)).toBe(true);
    const kaizen = h.store.get(kaizenPath) as unknown as ReviewCard;
    expect(kaizen.state).toBe('learning');
    expect(kaizen.sourceLearningItemId).toBe('li-0'); // first occurrence won; not reset
  });

  it('a fresh card is due now and appears in the queue; rate Good removes it from the same-now queue', async () => {
    const now = 5_000_000;
    for (const item of withIds(derive(now))) {
      await materializeReviewCard(item, { now });
    }

    const first = await listDueReviewCards({ now });
    expect(first.cards).toHaveLength(3);
    expect(first.cards.every((c) => c.dueAt <= now)).toBe(true);

    const target = first.cards[0];
    const updated = await applyReviewRating(target.id, RATING.GOOD, { now });
    expect(updated.state).toBe('review');
    expect(updated.dueAt).toBe(now + DAY_MS);

    const afterGood = await listDueReviewCards({ now });
    expect(afterGood.cards.map((c) => c.id)).not.toContain(target.id);
    expect(afterGood.cards).toHaveLength(2);
  });

  it('rate Again schedules +10min and is not returned again at the same now', async () => {
    const now = 9_000_000;
    for (const item of withIds(derive(now))) {
      await materializeReviewCard(item, { now });
    }
    const q = await listDueReviewCards({ now });
    const target = q.cards[0];

    const updated = await applyReviewRating(target.id, RATING.AGAIN, { now });
    expect(updated.state).toBe('learning');
    expect(updated.dueAt).toBe(now + 600_000);

    const again = await listDueReviewCards({ now });
    expect(again.cards.map((c) => c.id)).not.toContain(target.id);
  });

  it('the review session loads the batch, reveals, rates, advances, and ends empty', async () => {
    const now = 12_000_000;
    for (const item of withIds(derive(now))) {
      await materializeReviewCard(item, { now });
    }

    const h2 = mountSession();
    await h2.mount();
    expect(h2.s().state.phase).toBe('ready');
    expect(h2.s().remaining).toBe(3);

    // walk the whole batch with Good; each advance is automatic
    for (let i = 0; i < 3; i += 1) {
      expect(h2.s().currentCard).not.toBeNull();
      await h2.act(() => h2.s().reveal());
      expect(h2.s().state.revealed).toBe(true);
      await h2.act(() => h2.s().rate(RATING.GOOD));
    }

    // batch exhausted → auto re-fetch → everything now future-due → empty
    expect(h2.s().state.phase).toBe('ready');
    expect(h2.s().currentCard).toBeNull();
    expect(h2.s().remaining).toBe(0);

    // all three cards graduated to `review` and were rescheduled into the
    // future (the session rates via the real clock, so exact dueAt is asserted
    // in reviewCard.test.ts; here we only need "moved past `now`, hence excluded")
    expect(storedCards().every((c) => c.state === 'review' && c.dueAt > now)).toBe(true);
    h2.unmount();
  });
});
