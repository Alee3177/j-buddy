/**
 * Japanese Reader v0.4 — P3.2, review-card model + deterministic scheduler.
 *
 * Pure and side-effect-free (mirrors the P0 `learningItem.ts` style). Defines
 * the `ReviewCard` entity, its stable identity, the materialisation draft, and
 * the whole scheduling policy. No Firestore, no auth, no clock — `now` is always
 * injected so every result is deterministic under test.
 *
 * P3.1 decisions this module encodes (fixed):
 *   - one card per lexical identity: cardId = base64url(utf8(lexicalKey))
 *   - lifecycle: state = "learning" | "review"   (LearningItem.status is ignored)
 *   - ratings: AGAIN = 1, GOOD = 3, EASY = 4   (2 reserved for a future "Hard")
 *   - simple integer-day step schedule, no floating point, no easeFactor
 *   - epoch-ms numbers everywhere
 */

import type { LearningItem } from '@/types';

export type ReviewCardState = 'learning' | 'review';

/** FSRS-compatible grade integers. `2` ("Hard") is intentionally reserved. */
export type ReviewRating = 1 | 3 | 4;

export const RATING = {
  AGAIN: 1,
  GOOD: 3,
  EASY: 4,
} as const satisfies Record<string, ReviewRating>;

// --- scheduling constants (P3.1) --------------------------------------------

export const DAY_MS = 86_400_000;
export const AGAIN_STEP_MS = 600_000; // 10 minutes
export const GRADUATING_INTERVAL_DAYS = 1;
export const EASY_GRADUATING_INTERVAL_DAYS = 4;
export const GOOD_FACTOR = 2;
export const EASY_FACTOR = 3;
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 3650; // 10 years

/**
 * A persisted review-scheduling record. Lives at
 * `users/{uid}/review_cards/{id}` where `id === reviewCardIdFor(lexicalKey)`.
 * The face / provenance fields are a snapshot taken from the `LearningItem`
 * occurrence that materialised the card; they are never rewritten afterwards.
 */
export interface ReviewCard {
  id: string;
  userId: string;
  lexicalKey: string;
  type: 'vocab' | 'grammar';
  // scheduling state
  state: ReviewCardState;
  dueAt: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  lastRating: ReviewRating | null;
  lastReviewedAt: number | null;
  createdAt: number;
  updatedAt: number;
  // face / provenance snapshot (immutable after materialisation)
  surface: string;
  reading: string | null;
  meaning: string | null;
  sourceSentence: string;
  sourceUrl: string | null;
  sourceAnalysisId: string;
  sourceLearningItemId: string;
}

/** The exact set of fields the scheduler produces / the rating write touches. */
export type ReviewSchedulePatch = Pick<
  ReviewCard,
  | 'state'
  | 'dueAt'
  | 'intervalDays'
  | 'reps'
  | 'lapses'
  | 'lastRating'
  | 'lastReviewedAt'
  | 'updatedAt'
>;

// --- helpers ----------------------------------------------------------------

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** `true` iff `value` is a supported rating (1 / 3 / 4). */
export function isReviewRating(value: unknown): value is ReviewRating {
  return value === RATING.AGAIN || value === RATING.GOOD || value === RATING.EASY;
}

/**
 * Stable, path-safe review-card id for a lexical identity.
 *
 * `base64url(utf8(lexicalKey))` — deterministic, no padding, charset
 * `[A-Za-z0-9_-]` only, bijective (see {@link decodeReviewCardId}). The
 * `lexicalKey` is used exactly as supplied; no extra normalisation (the P0
 * `computeLexicalKey` policy already owns normalisation).
 *
 * @throws if `lexicalKey` is not a non-empty string.
 */
export function reviewCardIdFor(lexicalKey: string): string {
  if (typeof lexicalKey !== 'string' || lexicalKey.length === 0) {
    throw new Error('reviewCardIdFor: lexicalKey must be a non-empty string');
  }
  return toBase64Url(lexicalKey);
}

/** Inverse of {@link reviewCardIdFor}. */
export function decodeReviewCardId(cardId: string): string {
  const binary = atob(cardId.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function assertFiniteNow(now: number, where: string): void {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new Error(`${where}: now must be a finite number`);
  }
}

function clampInterval(days: number): number {
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, days));
}

// --- materialisation --------------------------------------------------------

/**
 * Build the initial `ReviewCard` for a `LearningItem` occurrence. Pure — never
 * mutates `item`. The card starts in `learning`, `intervalDays 0`, and is
 * immediately due (`dueAt === now`) so it enters the queue on the next fetch.
 */
export function newReviewCard(
  item: LearningItem,
  userId: string,
  now: number
): ReviewCard {
  assertFiniteNow(now, 'newReviewCard');
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('newReviewCard: userId must be a non-empty string');
  }

  return {
    id: reviewCardIdFor(item.lexicalKey),
    userId,
    lexicalKey: item.lexicalKey,
    type: item.type,
    state: 'learning',
    dueAt: now,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    lastRating: null,
    lastReviewedAt: null,
    createdAt: now,
    updatedAt: now,
    surface: item.surface,
    reading: item.reading,
    meaning: item.meaning,
    sourceSentence: item.sourceSentence,
    sourceUrl: item.sourceUrl,
    sourceAnalysisId: item.sourceAnalysisId,
    sourceLearningItemId: item.id,
  };
}

// --- scheduler -------------------------------------------------------------

/**
 * Deterministic next-review schedule for a rating. Pure and total (throws only
 * on invalid input). All arithmetic is integer; `dueAt` is always computed from
 * the injected `now`, so an overdue card is scheduled from now — never from its
 * stale `dueAt`.
 *
 * @throws on an unsupported `rating`, a non-finite `now`, or a card whose
 *         `state` / `intervalDays` / `reps` / `lapses` are structurally invalid.
 */
export function computeNextSchedule(
  card: ReviewCard,
  rating: ReviewRating,
  now: number
): ReviewSchedulePatch {
  if (!isReviewRating(rating)) {
    throw new Error('computeNextSchedule: unsupported rating');
  }
  assertFiniteNow(now, 'computeNextSchedule');
  if (card.state !== 'learning' && card.state !== 'review') {
    throw new Error('computeNextSchedule: invalid card.state');
  }
  if (!Number.isInteger(card.intervalDays) || card.intervalDays < 0) {
    throw new Error('computeNextSchedule: invalid card.intervalDays');
  }
  if (!Number.isInteger(card.reps) || card.reps < 0) {
    throw new Error('computeNextSchedule: invalid card.reps');
  }
  if (!Number.isInteger(card.lapses) || card.lapses < 0) {
    throw new Error('computeNextSchedule: invalid card.lapses');
  }

  const common = {
    reps: card.reps + 1,
    lastRating: rating,
    lastReviewedAt: now,
    updatedAt: now,
  };

  if (card.state === 'learning') {
    if (rating === RATING.AGAIN) {
      return {
        ...common,
        state: 'learning',
        intervalDays: 0,
        dueAt: now + AGAIN_STEP_MS,
        lapses: card.lapses,
      };
    }
    if (rating === RATING.GOOD) {
      return {
        ...common,
        state: 'review',
        intervalDays: GRADUATING_INTERVAL_DAYS,
        dueAt: now + GRADUATING_INTERVAL_DAYS * DAY_MS,
        lapses: card.lapses,
      };
    }
    // EASY
    return {
      ...common,
      state: 'review',
      intervalDays: EASY_GRADUATING_INTERVAL_DAYS,
      dueAt: now + EASY_GRADUATING_INTERVAL_DAYS * DAY_MS,
      lapses: card.lapses,
    };
  }

  // card.state === 'review'
  if (rating === RATING.AGAIN) {
    return {
      ...common,
      state: 'learning',
      intervalDays: 0,
      dueAt: now + AGAIN_STEP_MS,
      lapses: card.lapses + 1,
    };
  }

  const factor = rating === RATING.GOOD ? GOOD_FACTOR : EASY_FACTOR;
  const intervalDays = clampInterval(card.intervalDays * factor);
  return {
    ...common,
    state: 'review',
    intervalDays,
    dueAt: now + intervalDays * DAY_MS,
    lapses: card.lapses,
  };
}
