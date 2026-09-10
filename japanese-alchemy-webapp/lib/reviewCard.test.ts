import { describe, expect, it } from 'vitest';

import {
  AGAIN_STEP_MS,
  DAY_MS,
  MAX_INTERVAL_DAYS,
  RATING,
  computeNextSchedule,
  decodeReviewCardId,
  newReviewCard,
  reviewCardIdFor,
  type ReviewCard,
} from './reviewCard';
import type { LearningItem } from '@/types';

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

function card(overrides: Partial<ReviewCard> = {}): ReviewCard {
  return {
    ...newReviewCard(learningItem(), 'alice', 0),
    ...overrides,
  };
}

const NOW = 1_700_000_000_000;

describe('reviewCardIdFor / decodeReviewCardId', () => {
  it('18. is deterministic', () => {
    expect(reviewCardIdFor('vocab|改善|かいぜん')).toBe(
      reviewCardIdFor('vocab|改善|かいぜん')
    );
  });

  it('19. produces a path-safe id (base64url charset only, no padding)', () => {
    for (const key of [
      'vocab|改善|かいぜん',
      'grammar|〜という／〜との|',
      'grammar|ても|',
      'vocab|ﾃｽﾄ  spaces / slashes|x',
    ]) {
      const id = reviewCardIdFor(key);
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(id).not.toContain('=');
    }
  });

  it('20. different readings / lexicalKeys → different ids', () => {
    expect(reviewCardIdFor('vocab|改善|かいぜん')).not.toBe(
      reviewCardIdFor('vocab|改善|')
    );
    expect(reviewCardIdFor('vocab|生|なま')).not.toBe(
      reviewCardIdFor('vocab|生|せい')
    );
    expect(reviewCardIdFor('vocab|そう|そう')).not.toBe(
      reviewCardIdFor('grammar|そう|')
    );
  });

  it('round-trips the exact lexicalKey bytes', () => {
    const key = 'grammar|〜ば〜ほど|';
    expect(decodeReviewCardId(reviewCardIdFor(key))).toBe(key);
  });

  it('21. rejects an empty / non-string lexicalKey', () => {
    expect(() => reviewCardIdFor('')).toThrow(/non-empty/);
    // @ts-expect-error runtime guard
    expect(() => reviewCardIdFor(null)).toThrow(/non-empty/);
  });
});

describe('newReviewCard', () => {
  it('1. builds a fresh learning card that is immediately due', () => {
    const c = newReviewCard(learningItem(), 'alice', NOW);
    expect(c).toMatchObject({
      id: reviewCardIdFor('vocab|改善|かいぜん'),
      userId: 'alice',
      lexicalKey: 'vocab|改善|かいぜん',
      type: 'vocab',
      state: 'learning',
      dueAt: NOW,
      intervalDays: 0,
      reps: 0,
      lapses: 0,
      lastRating: null,
      lastReviewedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('copies the face / provenance snapshot from the LearningItem', () => {
    const item = learningItem({
      id: 'li-42',
      surface: '面白い',
      reading: 'おもしろい',
      meaning: 'interesting',
      sourceSentence: 'とても面白い本。',
      sourceUrl: null,
      sourceAnalysisId: 'page-99',
    });
    const c = newReviewCard(item, 'bob', NOW);
    expect(c).toMatchObject({
      surface: '面白い',
      reading: 'おもしろい',
      meaning: 'interesting',
      sourceSentence: 'とても面白い本。',
      sourceUrl: null,
      sourceAnalysisId: 'page-99',
      sourceLearningItemId: 'li-42',
    });
  });

  it('22. never mutates the source LearningItem', () => {
    const item = learningItem();
    const frozen = JSON.parse(JSON.stringify(item));
    newReviewCard(item, 'alice', NOW);
    expect(item).toEqual(frozen);
  });

  it('rejects a non-finite now / empty userId', () => {
    expect(() => newReviewCard(learningItem(), 'alice', Number.NaN)).toThrow(/finite/);
    expect(() => newReviewCard(learningItem(), '', NOW)).toThrow(/userId/);
  });
});

describe('computeNextSchedule — learning state', () => {
  it('2. Again keeps learning, interval 0, +10min, no lapse', () => {
    const p = computeNextSchedule(card({ state: 'learning', intervalDays: 0 }), RATING.AGAIN, NOW);
    expect(p).toEqual({
      state: 'learning',
      intervalDays: 0,
      dueAt: NOW + AGAIN_STEP_MS,
      reps: 1,
      lapses: 0,
      lastRating: RATING.AGAIN,
      lastReviewedAt: NOW,
      updatedAt: NOW,
    });
  });

  it('3. Good graduates to review at 1 day', () => {
    const p = computeNextSchedule(card({ state: 'learning' }), RATING.GOOD, NOW);
    expect(p.state).toBe('review');
    expect(p.intervalDays).toBe(1);
    expect(p.dueAt).toBe(NOW + DAY_MS);
    expect(p.lapses).toBe(0);
  });

  it('4. Easy graduates to review at 4 days', () => {
    const p = computeNextSchedule(card({ state: 'learning' }), RATING.EASY, NOW);
    expect(p.state).toBe('review');
    expect(p.intervalDays).toBe(4);
    expect(p.dueAt).toBe(NOW + 4 * DAY_MS);
  });
});

describe('computeNextSchedule — review state', () => {
  it('5. Again drops to learning, +10min, lapse +1', () => {
    const p = computeNextSchedule(
      card({ state: 'review', intervalDays: 12, lapses: 2 }),
      RATING.AGAIN,
      NOW
    );
    expect(p.state).toBe('learning');
    expect(p.intervalDays).toBe(0);
    expect(p.dueAt).toBe(NOW + AGAIN_STEP_MS);
    expect(p.lapses).toBe(3);
  });

  it('6. Good multiplies the interval by 2', () => {
    const p = computeNextSchedule(card({ state: 'review', intervalDays: 5 }), RATING.GOOD, NOW);
    expect(p.intervalDays).toBe(10);
    expect(p.dueAt).toBe(NOW + 10 * DAY_MS);
    expect(p.lapses).toBe(0);
  });

  it('7. Easy multiplies the interval by 3', () => {
    const p = computeNextSchedule(card({ state: 'review', intervalDays: 5 }), RATING.EASY, NOW);
    expect(p.intervalDays).toBe(15);
    expect(p.dueAt).toBe(NOW + 15 * DAY_MS);
  });

  it('9. schedules from now, not from a stale dueAt (overdue card)', () => {
    const overdue = card({
      state: 'review',
      intervalDays: 4,
      dueAt: NOW - 100 * DAY_MS,
    });
    const p = computeNextSchedule(overdue, RATING.GOOD, NOW);
    expect(p.dueAt).toBe(NOW + 8 * DAY_MS);
  });

  it('10. clamps the interval up to the minimum (1 day)', () => {
    const p = computeNextSchedule(card({ state: 'review', intervalDays: 0 }), RATING.GOOD, NOW);
    expect(p.intervalDays).toBe(1);
  });

  it('11. clamps the interval down to the maximum (3650 days)', () => {
    const p = computeNextSchedule(
      card({ state: 'review', intervalDays: 2000 }),
      RATING.EASY,
      NOW
    );
    expect(p.intervalDays).toBe(MAX_INTERVAL_DAYS);
    expect(p.dueAt).toBe(NOW + MAX_INTERVAL_DAYS * DAY_MS);
  });
});

describe('computeNextSchedule — progression & counters', () => {
  it('8. repeated Again in learning: reps climb, interval stays 0, no lapses', () => {
    let c = card({ state: 'learning' });
    for (let i = 1; i <= 3; i += 1) {
      const p = computeNextSchedule(c, RATING.AGAIN, NOW + i);
      expect(p.state).toBe('learning');
      expect(p.intervalDays).toBe(0);
      expect(p.reps).toBe(i);
      expect(p.lapses).toBe(0);
      c = { ...c, ...p };
    }
  });

  it('12. all-Good progression from a fresh card: 0(learning) → 1 → 2 → 4 → 8', () => {
    let c = card({ state: 'learning', intervalDays: 0 });
    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const p = computeNextSchedule(c, RATING.GOOD, NOW);
      seen.push(p.intervalDays);
      c = { ...c, ...p };
    }
    expect(seen).toEqual([1, 2, 4, 8]);
    expect(c.state).toBe('review');
  });

  it('13. lapses only increment on Again-from-review, never Again-from-learning', () => {
    const fromLearning = computeNextSchedule(card({ state: 'learning', lapses: 1 }), RATING.AGAIN, NOW);
    expect(fromLearning.lapses).toBe(1);
    const fromReview = computeNextSchedule(card({ state: 'review', lapses: 1 }), RATING.AGAIN, NOW);
    expect(fromReview.lapses).toBe(2);
  });

  it('14. reps increments on every rating', () => {
    for (const rating of [RATING.AGAIN, RATING.GOOD, RATING.EASY] as const) {
      const p = computeNextSchedule(card({ reps: 7 }), rating, NOW);
      expect(p.reps).toBe(8);
    }
  });

  it('15. stamps lastRating / lastReviewedAt / updatedAt on every rating', () => {
    const p = computeNextSchedule(card(), RATING.GOOD, NOW);
    expect(p.lastRating).toBe(RATING.GOOD);
    expect(p.lastReviewedAt).toBe(NOW);
    expect(p.updatedAt).toBe(NOW);
  });

  it('keeps all interval output integer (no floating point)', () => {
    let c = card({ state: 'review', intervalDays: 3 });
    for (let i = 0; i < 6; i += 1) {
      const p = computeNextSchedule(c, RATING.EASY, NOW);
      expect(Number.isInteger(p.intervalDays)).toBe(true);
      expect(Number.isInteger(p.dueAt)).toBe(true);
      c = { ...c, ...p };
    }
  });
});

describe('computeNextSchedule — validation', () => {
  it('16. rejects an unsupported rating', () => {
    for (const bad of [0, 2, 5, -1, 3.5, 'good', null, undefined]) {
      // @ts-expect-error deliberately invalid
      expect(() => computeNextSchedule(card(), bad, NOW)).toThrow(/unsupported rating/);
    }
  });

  it('17. rejects a non-finite now', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(() => computeNextSchedule(card(), RATING.GOOD, bad)).toThrow(/finite/);
    }
  });

  it('rejects a structurally invalid card', () => {
    // @ts-expect-error invalid state
    expect(() => computeNextSchedule(card({ state: 'done' }), RATING.GOOD, NOW)).toThrow(/state/);
    expect(() => computeNextSchedule(card({ intervalDays: -1 }), RATING.GOOD, NOW)).toThrow(/intervalDays/);
    expect(() => computeNextSchedule(card({ intervalDays: 1.5 }), RATING.GOOD, NOW)).toThrow(/intervalDays/);
    expect(() => computeNextSchedule(card({ reps: -1 }), RATING.GOOD, NOW)).toThrow(/reps/);
  });
});
