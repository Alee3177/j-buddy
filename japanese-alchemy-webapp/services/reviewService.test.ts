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
const h = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string } | null },
  store: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{ op: 'set' | 'update'; path: string; data: Record<string, unknown> }>,
}));

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  get auth() {
    return h.auth;
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
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

import { applyReviewRating, materializeReviewCard } from './reviewService';

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
