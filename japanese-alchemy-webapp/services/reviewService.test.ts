import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RATING,
  newReviewCard,
  reviewCardIdFor,
  type ReviewCard,
} from '@/lib/reviewCard';
import type { LearningItem } from '@/types';

// Hoisted shared state so the vi.mock factories (evaluated during the hoisted
// imports) see initialised objects. Mutated per test.
type Constraint =
  | { kind: 'where'; field: string; op: string; value: unknown }
  | { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { kind: 'limit'; n: number };

const h = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string } | null },
  store: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{ op: 'set' | 'update'; path: string; data: Record<string, unknown> }>,
  // last query() call's collection path + constraints, for assertions
  lastQuery: null as { path: string; constraints: Constraint[] } | null,
  getDocsCalls: 0,
  lastGetDocsPath: null as string | null,
}));

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  get auth() {
    return h.auth;
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (parent: { path: string }, name: string) => ({
    path: `${parent.path}/${name}`,
  }),
  where: (field: string, op: string, value: unknown): Constraint => ({
    kind: 'where',
    field,
    op,
    value,
  }),
  orderBy: (field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({
    kind: 'orderBy',
    field,
    dir,
  }),
  limit: (n: number): Constraint => ({ kind: 'limit', n }),
  query: (source: { path: string }, ...constraints: Constraint[]) => {
    h.lastQuery = { path: source.path, constraints };
    return { path: source.path, constraints };
  },
  // `getDocs` accepts a Query (from `query()`, has `constraints`) OR a bare
  // CollectionReference (from `collection()`, no `constraints`).
  getDocs: async (q: { path: string; constraints?: Constraint[] }) => {
    h.getDocsCalls += 1;
    h.lastGetDocsPath = q.path;
    const prefix = `${q.path}/`;
    let rows = [...h.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, data]) => ({ id: key.slice(prefix.length), data }));

    for (const c of q.constraints ?? []) {
      if (c.kind === 'where' && c.field === 'dueAt' && c.op === '<=') {
        rows = rows.filter((r) => (r.data.dueAt as number) <= (c.value as number));
      } else if (c.kind === 'orderBy' && c.field === 'dueAt') {
        const sign = c.dir === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const byDue = ((a.data.dueAt as number) - (b.data.dueAt as number)) * sign;
          if (byDue !== 0) return byDue;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // implicit __name__ asc
        });
      } else if (c.kind === 'limit') {
        rows = rows.slice(0, c.n);
      }
    }

    return { docs: rows.map((r) => ({ id: r.id, data: () => ({ ...r.data }) })) };
  },
  runTransaction: async (
    _db: unknown,
    updateFn: (tx: {
      get: (ref: { path: string }) => Promise<{
        exists: () => boolean;
        data: () => Record<string, unknown> | undefined;
      }>;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<unknown>
  ) => {
    // Buffer writes; apply only if the transaction body resolves (models
    // Firestore's atomic commit).
    const buffered: Array<() => void> = [];
    const tx = {
      get: async (ref: { path: string }) => {
        const data = h.store.get(ref.path);
        return {
          exists: () => data !== undefined,
          data: () => (data === undefined ? undefined : { ...data }),
        };
      },
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        h.writes.push({ op: 'set', path: ref.path, data });
        buffered.push(() => h.store.set(ref.path, { ...data }));
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        h.writes.push({ op: 'update', path: ref.path, data });
        buffered.push(() =>
          h.store.set(ref.path, { ...(h.store.get(ref.path) ?? {}), ...data })
        );
      },
    };
    const result = await updateFn(tx);
    buffered.forEach((w) => w());
    return result;
  },
}));

import {
  applyReviewRating,
  listDueReviewCards,
  listReviewCardKeys,
  materializeReviewCard,
} from './reviewService';
import { REVIEW_QUEUE_CAP } from '@/lib/reviewCard';

function learningItem(overrides: Partial<LearningItem> = {}): LearningItem {
  return {
    id: 'li-1',
    userId: 'alice',
    sourceAnalysisId: 'page-1',
    type: 'vocab',
    surface: '{改善|かいぜん}',
    status: 'NEW',
    createdAt: 1_000,
    updatedAt: 1_000,
    lexicalKey: 'vocab|改善|かいぜん',
    reading: 'かいぜん',
    meaning: '使變得更好',
    sourceSentence: '制度を改善する。',
    sourceUrl: 'https://example.com/a',
    ...overrides,
  };
}

const LEXICAL_KEY = 'vocab|改善|かいぜん';
const CARD_ID = reviewCardIdFor(LEXICAL_KEY);
const PATH = (uid: string) => `users/${uid}/review_cards/${CARD_ID}`;
const NOW = 1_700_000_000_000;

function seedCard(uid: string, overrides: Partial<ReviewCard> = {}) {
  const base = newReviewCard(learningItem(), uid, 0);
  h.store.set(PATH(uid), { ...base, ...overrides });
}

beforeEach(() => {
  h.auth.currentUser = null;
  h.store.clear();
  h.writes.length = 0;
  h.lastQuery = null;
  h.getDocsCalls = 0;
  h.lastGetDocsPath = null;
});

describe('materializeReviewCard', () => {
  it('rejects an unauthenticated caller before any write', async () => {
    await expect(materializeReviewCard(learningItem())).rejects.toThrow(/signed in/i);
    expect(h.writes).toHaveLength(0);
  });

  it('writes exactly one card under users/{auth.uid}/review_cards/{cardId}', async () => {
    h.auth.currentUser = { uid: 'alice' };

    const card = await materializeReviewCard(learningItem(), { now: NOW });

    expect(h.writes).toEqual([
      { op: 'set', path: PATH('alice'), data: expect.objectContaining({ id: CARD_ID }) },
    ]);
    expect(card).toMatchObject({
      id: CARD_ID,
      userId: 'alice',
      state: 'learning',
      dueAt: NOW,
      intervalDays: 0,
      reps: 0,
      lapses: 0,
    });
  });

  it('derives the path from the authenticated uid, never a field on the item', async () => {
    h.auth.currentUser = { uid: 'alice' };
    // item.userId is a different user — must be ignored for the path
    await materializeReviewCard(learningItem({ userId: 'victim' }), { now: NOW });
    expect(h.writes[0].path).toBe(PATH('alice'));
    expect(h.writes[0].path).not.toContain('victim');
  });

  it('copies the face / provenance snapshot from the LearningItem', async () => {
    h.auth.currentUser = { uid: 'alice' };
    const item = learningItem({
      id: 'li-77',
      surface: '面白い',
      reading: 'おもしろい',
      meaning: 'interesting',
      sourceSentence: 'とても面白い。',
      sourceUrl: null,
      sourceAnalysisId: 'page-x',
      lexicalKey: 'vocab|面白い|おもしろい',
    });
    const card = await materializeReviewCard(item, { now: NOW });
    expect(card).toMatchObject({
      surface: '面白い',
      reading: 'おもしろい',
      meaning: 'interesting',
      sourceSentence: 'とても面白い。',
      sourceUrl: null,
      sourceAnalysisId: 'page-x',
      sourceLearningItemId: 'li-77',
    });
  });

  it('is idempotent — a second call returns the existing card and writes nothing', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedCard('alice', {
      state: 'review',
      intervalDays: 30,
      reps: 9,
      lapses: 2,
      lastRating: RATING.GOOD,
      lastReviewedAt: 123,
      updatedAt: 123,
    });

    const card = await materializeReviewCard(learningItem(), { now: NOW });

    expect(h.writes).toHaveLength(0);
    expect(card).toMatchObject({ state: 'review', intervalDays: 30, reps: 9, lapses: 2 });
  });

  it('never addresses a shared or root review_cards collection', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await materializeReviewCard(learningItem(), { now: NOW });
    for (const w of h.writes) {
      expect(w.path.startsWith('users/alice/review_cards/')).toBe(true);
      expect(w.path).not.toMatch(/shared_/);
    }
  });

  it('rejects an item with an empty lexicalKey', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await expect(
      materializeReviewCard(learningItem({ lexicalKey: '' }), { now: NOW })
    ).rejects.toThrow(/non-empty/);
    expect(h.writes).toHaveLength(0);
  });
});

describe('applyReviewRating', () => {
  it('rejects an unauthenticated caller before any read/write', async () => {
    await expect(applyReviewRating(CARD_ID, RATING.GOOD)).rejects.toThrow(/signed in/i);
    expect(h.writes).toHaveLength(0);
  });

  it('rejects an unsupported rating before any Firestore call', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedCard('alice');
    // @ts-expect-error deliberately invalid
    await expect(applyReviewRating(CARD_ID, 2)).rejects.toThrow(/rating/i);
    expect(h.writes).toHaveLength(0);
  });

  it('rejects a malformed / empty cardId before any Firestore call', async () => {
    h.auth.currentUser = { uid: 'alice' };
    for (const bad of ['', 'has/slash', 'has space', 'a.b', '..']) {
      await expect(applyReviewRating(bad, RATING.GOOD)).rejects.toThrow(/card id/i);
    }
    expect(h.writes).toHaveLength(0);
  });

  it('rejects a non-finite now', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedCard('alice');
    await expect(
      applyReviewRating(CARD_ID, RATING.GOOD, { now: Number.NaN })
    ).rejects.toThrow(/timestamp/i);
  });

  it('errors deterministically when the card is missing', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await expect(applyReviewRating(CARD_ID, RATING.GOOD, { now: NOW })).rejects.toThrow(
      /not found/i
    );
  });

  it('reads and writes only under the authenticated uid path', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedCard('alice');
    await applyReviewRating(CARD_ID, RATING.GOOD, { now: NOW });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].path).toBe(PATH('alice'));
  });

  it('writes ONLY the eight scheduling fields', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedCard('alice', { state: 'review', intervalDays: 5, reps: 3 });

    await applyReviewRating(CARD_ID, RATING.GOOD, { now: NOW });

    expect(h.writes[0].op).toBe('update');
    expect(Object.keys(h.writes[0].data).sort()).toEqual(
      [
        'dueAt',
        'intervalDays',
        'lapses',
        'lastRating',
        'lastReviewedAt',
        'reps',
        'state',
        'updatedAt',
      ].sort()
    );
  });

  it('never rewrites face / provenance / identity fields', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedCard('alice', { state: 'review', intervalDays: 5 });

    await applyReviewRating(CARD_ID, RATING.GOOD, { now: NOW });

    const persisted = h.store.get(PATH('alice'))!;
    expect(persisted).toMatchObject({
      id: CARD_ID,
      userId: 'alice',
      lexicalKey: LEXICAL_KEY,
      surface: '{改善|かいぜん}',
      reading: 'かいぜん',
      meaning: '使變得更好',
      sourceAnalysisId: 'page-1',
      sourceLearningItemId: 'li-1',
      createdAt: 0,
    });
    // scheduling fields did change
    expect(persisted.intervalDays).toBe(10);
    expect(persisted.reps).toBe(1);
  });

  it('applies the deterministic schedule and returns the merged card', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedCard('alice', { state: 'learning', intervalDays: 0, reps: 0 });

    const updated = await applyReviewRating(CARD_ID, RATING.EASY, { now: NOW });

    expect(updated).toMatchObject({
      state: 'review',
      intervalDays: 4,
      dueAt: NOW + 4 * 86_400_000,
      reps: 1,
      lastRating: RATING.EASY,
      lastReviewedAt: NOW,
    });
  });

  it('a rejected transaction body commits nothing (lost-update safe)', async () => {
    h.auth.currentUser = { uid: 'alice' };
    // no seed ⇒ the body throws "not found" before staging any write
    await expect(applyReviewRating(CARD_ID, RATING.GOOD, { now: NOW })).rejects.toThrow();
    expect(h.store.has(PATH('alice'))).toBe(false);
    expect(h.writes).toHaveLength(0);
  });
});

describe('listDueReviewCards (P3.3 due-review queue)', () => {
  // Seed a review card at an explicit path + dueAt.
  function seedAt(uid: string, key: string, dueAt: number, overrides: Partial<ReviewCard> = {}) {
    const cardId = reviewCardIdFor(key);
    const base = newReviewCard(learningItem({ lexicalKey: key }), uid, 0);
    h.store.set(`users/${uid}/review_cards/${cardId}`, {
      ...base,
      dueAt,
      state: 'review',
      ...overrides,
    });
    return cardId;
  }

  it('1/2. rejects an unauthenticated caller before any Firestore query', async () => {
    await expect(listDueReviewCards()).rejects.toThrow(/signed in/i);
    expect(h.getDocsCalls).toBe(0);
    expect(h.lastQuery).toBeNull();
  });

  it('20. rejects a non-finite now before any query', async () => {
    h.auth.currentUser = { uid: 'alice' };
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      await expect(listDueReviewCards({ now: bad })).rejects.toThrow(/timestamp/i);
    }
    expect(h.getDocsCalls).toBe(0);
  });

  it('3/5/6. queries exactly users/{auth.uid}/review_cards — not root, not shared', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await listDueReviewCards({ now: NOW });
    expect(h.lastQuery?.path).toBe('users/alice/review_cards');
    expect(h.lastQuery?.path).not.toMatch(/^review_cards/);
    expect(h.lastQuery?.path).not.toMatch(/shared_/);
  });

  it('4. has no userId option and cannot be pointed at another uid', async () => {
    h.auth.currentUser = { uid: 'alice' };
    // @ts-expect-error userId is not part of the options contract
    await listDueReviewCards({ now: NOW, userId: 'victim' });
    expect(h.lastQuery?.path).toBe('users/alice/review_cards');
  });

  it('7/8/19. builds where(dueAt <= injected now) + orderBy(dueAt asc)', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await listDueReviewCards({ now: 424242 });
    const cs = h.lastQuery!.constraints;
    expect(cs).toContainEqual({ kind: 'where', field: 'dueAt', op: '<=', value: 424242 });
    expect(cs).toContainEqual({ kind: 'orderBy', field: 'dueAt', dir: 'asc' });
    expect(cs.filter((c) => c.kind === 'where')).toHaveLength(1);
    expect(cs.filter((c) => c.kind === 'orderBy')).toHaveLength(1);
  });

  it('does not filter by type or state, and does not orderBy createdAt / documentId', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await listDueReviewCards({ now: NOW });
    for (const c of h.lastQuery!.constraints) {
      if (c.kind === 'where') expect(c.field).toBe('dueAt');
      if (c.kind === 'orderBy') expect(c.field).toBe('dueAt');
    }
  });

  it('9. default limit is REVIEW_QUEUE_CAP (50)', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await listDueReviewCards({ now: NOW });
    expect(h.lastQuery!.constraints).toContainEqual({ kind: 'limit', n: 50 });
    expect(REVIEW_QUEUE_CAP).toBe(50);
  });

  it('10. a limit at or below the cap is respected', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await listDueReviewCards({ now: NOW, limit: 12 });
    expect(h.lastQuery!.constraints).toContainEqual({ kind: 'limit', n: 12 });
  });

  it('11. a limit above the cap clamps to 50', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await listDueReviewCards({ now: NOW, limit: 999 });
    expect(h.lastQuery!.constraints).toContainEqual({ kind: 'limit', n: 50 });
  });

  it('12. invalid limits fall back to the default (clamp policy, never reject)', async () => {
    h.auth.currentUser = { uid: 'alice' };
    for (const bad of [0, -3, Number.NaN, Infinity, 0.4]) {
      h.lastQuery = null;
      await listDueReviewCards({ now: NOW, limit: bad });
      expect(h.lastQuery!.constraints).toContainEqual({ kind: 'limit', n: 50 });
    }
    // a positive non-integer floors
    h.lastQuery = null;
    await listDueReviewCards({ now: NOW, limit: 7.8 });
    expect(h.lastQuery!.constraints).toContainEqual({ kind: 'limit', n: 7 });
  });

  it('13. an empty collection returns { cards: [] }', async () => {
    h.auth.currentUser = { uid: 'alice' };
    await expect(listDueReviewCards({ now: NOW })).resolves.toEqual({ cards: [] });
  });

  it('14/15. returns only due cards, in backend (dueAt asc) order — future card excluded', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedAt('alice', 'vocab|c|', NOW - 10);
    seedAt('alice', 'vocab|a|', NOW - 1000);
    seedAt('alice', 'vocab|b|', NOW); // exactly due
    seedAt('alice', 'vocab|future|', NOW + 86_400_000); // not due

    const { cards } = await listDueReviewCards({ now: NOW });

    expect(cards.map((c) => c.lexicalKey)).toEqual(['vocab|a|', 'vocab|c|', 'vocab|b|']);
    expect(cards.every((c) => c.dueAt <= NOW)).toBe(true);
  });

  it('does not client-side sort or dedup — backend order is preserved verbatim', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedAt('alice', 'vocab|x|', NOW - 5);
    seedAt('alice', 'vocab|y|', NOW - 50);
    const { cards } = await listDueReviewCards({ now: NOW });
    // mock returns dueAt asc; the service must not re-order it
    expect(cards.map((c) => c.dueAt)).toEqual([NOW - 50, NOW - 5]);
  });

  it('16. skips a malformed persisted row and keeps the valid ones', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedAt('alice', 'vocab|ok1|', NOW - 100);
    // malformed rows written directly (dueAt null coerces past the mock's
    // numeric filter, so toReviewCard's own finite-number guard is exercised)
    h.store.set('users/alice/review_cards/bad-duedate', {
      id: 'bad-duedate',
      dueAt: null,
      state: 'review',
      lexicalKey: 'vocab|x|',
      type: 'vocab',
    });
    h.store.set('users/alice/review_cards/bad-state', {
      id: 'bad-state',
      dueAt: NOW - 1,
      state: 'archived',
      lexicalKey: 'vocab|y|',
      type: 'vocab',
    });
    h.store.set('users/alice/review_cards/bad-type', {
      id: 'bad-type',
      dueAt: NOW - 1,
      state: 'review',
      lexicalKey: 'vocab|z|',
      type: 'sentence',
    });
    h.store.set('users/alice/review_cards/bad-lexkey', {
      id: 'bad-lexkey',
      dueAt: NOW - 1,
      state: 'review',
      lexicalKey: '',
      type: 'vocab',
    });
    seedAt('alice', 'vocab|ok2|', NOW - 50);

    const { cards } = await listDueReviewCards({ now: NOW });
    expect(cards.map((c) => c.lexicalKey)).toEqual(['vocab|ok1|', 'vocab|ok2|']);
  });

  it('17/18. returns both learning-state and review-state due cards', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedAt('alice', 'vocab|lrn|', NOW - 20, { state: 'learning' });
    seedAt('alice', 'grammar|rev|', NOW - 10, { state: 'review', type: 'grammar' });

    const { cards } = await listDueReviewCards({ now: NOW });
    expect(cards.map((c) => c.state)).toEqual(['learning', 'review']);
    expect(cards.map((c) => c.type)).toEqual(['vocab', 'grammar']);
  });

  it('21. issues no write / transaction', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedAt('alice', 'vocab|a|', NOW - 1);
    await listDueReviewCards({ now: NOW });
    expect(h.writes).toHaveLength(0);
  });

  it('overwrites the persisted doc id with the Firestore document id', async () => {
    h.auth.currentUser = { uid: 'alice' };
    const cardId = seedAt('alice', 'vocab|idcheck|', NOW - 1);
    h.store.set(`users/alice/review_cards/${cardId}`, {
      ...h.store.get(`users/alice/review_cards/${cardId}`)!,
      id: 'STALE-ID-IN-BODY',
    });
    const { cards } = await listDueReviewCards({ now: NOW });
    expect(cards[0].id).toBe(cardId);
  });
});

describe('listReviewCardKeys (P4.4 已加入複習 state)', () => {
  function seedKey(uid: string, docId: string, data: Record<string, unknown>) {
    h.store.set(`users/${uid}/review_cards/${docId}`, data);
  }

  it('1. rejects an unauthenticated caller before any Firestore call', async () => {
    await expect(listReviewCardKeys()).rejects.toThrow(/signed in/i);
    expect(h.getDocsCalls).toBe(0);
  });

  it('2/3/4/5/6. reads exactly users/{auth.uid}/review_cards — no root, no shared, no filter', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedKey('alice', 'c1', { lexicalKey: 'vocab|改善|かいぜん' });
    // @ts-expect-error no userId option exists
    await listReviewCardKeys({ userId: 'victim' });
    expect(h.lastGetDocsPath).toBe('users/alice/review_cards');
    expect(h.lastGetDocsPath).not.toMatch(/^review_cards/);
    expect(h.lastGetDocsPath).not.toMatch(/shared_/);
    // no where / orderBy / limit was built
    expect(h.lastQuery).toBeNull();
  });

  it('7. returns every valid non-empty lexicalKey', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedKey('alice', 'c1', { lexicalKey: 'vocab|改善|かいぜん' });
    seedKey('alice', 'c2', { lexicalKey: 'grammar|〜ても|' });
    seedKey('alice', 'c3', { lexicalKey: 'vocab|問題|もんだい' });

    const keys = await listReviewCardKeys();
    expect(keys).toBeInstanceOf(Set);
    expect([...keys].sort()).toEqual(
      ['grammar|〜ても|', 'vocab|問題|もんだい', 'vocab|改善|かいぜん'].sort()
    );
  });

  it('8. skips docs with a missing / non-string / empty lexicalKey', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedKey('alice', 'ok', { lexicalKey: 'vocab|良い|よい' });
    seedKey('alice', 'missing', { surface: 'x' });
    seedKey('alice', 'empty', { lexicalKey: '' });
    seedKey('alice', 'number', { lexicalKey: 123 });
    seedKey('alice', 'null', { lexicalKey: null });

    const keys = await listReviewCardKeys();
    expect([...keys]).toEqual(['vocab|良い|よい']);
  });

  it('9. duplicate lexicalKey values collapse in the Set', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedKey('alice', 'c1', { lexicalKey: 'vocab|改善|かいぜん' });
    seedKey('alice', 'c2', { lexicalKey: 'vocab|改善|かいぜん' }); // impossible in prod, defensive
    const keys = await listReviewCardKeys();
    expect(keys.size).toBe(1);
  });

  it('10. an empty collection returns an empty Set', async () => {
    h.auth.currentUser = { uid: 'alice' };
    const keys = await listReviewCardKeys();
    expect(keys.size).toBe(0);
  });

  it('11. issues no write / transaction', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedKey('alice', 'c1', { lexicalKey: 'vocab|x|' });
    await listReviewCardKeys();
    expect(h.writes).toHaveLength(0);
  });

  it('12/13. returns the COMPLETE key set even with far more than 50 cards (no cap)', async () => {
    h.auth.currentUser = { uid: 'alice' };
    for (let i = 0; i < 137; i += 1) {
      seedKey('alice', `c${i}`, { lexicalKey: `vocab|w${i}|` });
    }
    const keys = await listReviewCardKeys();
    expect(keys.size).toBe(137);
    // no limit constraint was applied
    expect(h.lastQuery).toBeNull();
  });

  it('does not read another user\'s review_cards', async () => {
    h.auth.currentUser = { uid: 'alice' };
    seedKey('alice', 'a1', { lexicalKey: 'vocab|alice|' });
    seedKey('mallory', 'm1', { lexicalKey: 'vocab|mallory|' });
    const keys = await listReviewCardKeys();
    expect([...keys]).toEqual(['vocab|alice|']);
  });
});
