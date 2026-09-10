/**
 * Japanese Reader v0.4 — P3.2, review-card mutation service.
 *
 * Direct Firestore client writes under `users/{auth.currentUser.uid}/review_cards`
 * — the same "authorised entirely by the isOwner rule" pattern as the P2.1 read
 * layer. Identity is ALWAYS `auth.currentUser.uid`; no uid is ever accepted from
 * a caller. Both operations run in a transaction so a concurrent write can never
 * cause a lost update or a duplicate card.
 *
 * P3.2 added the mutation service (materialize + rate). P3.3 adds the read-only
 * due-review queue (`listDueReviewCards`). The schedule is computed by the pure
 * `computeNextSchedule` (lib/reviewCard.ts) — the exact code the tests exercise
 * — so there is nothing a server would compute better.
 */

import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
  REVIEW_QUEUE_CAP,
  computeNextSchedule,
  isReviewRating,
  newReviewCard,
  reviewCardIdFor,
  type ReviewCard,
  type ReviewRating,
} from '@/lib/reviewCard';
import type { LearningItem } from '@/types';

const REVIEW_CARDS_SUBCOLLECTION = 'review_cards';
const CARD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function requireUid(action: string): string {
  const user = auth.currentUser;
  if (!user) {
    throw new Error(`You must be signed in to ${action}.`);
  }
  return user.uid;
}

/**
 * Idempotently create the review card for a `LearningItem` occurrence.
 *
 * - card id is derived solely from `item.lexicalKey`
 * - if the card already exists it is returned unchanged (schedule + face /
 *   provenance snapshot are never reset)
 * - if it is absent, `newReviewCard(item, uid, now)` is written
 *
 * @throws if there is no authenticated user (no write is attempted) or if
 *         `item.lexicalKey` is empty.
 */
export async function materializeReviewCard(
  item: LearningItem,
  options: { now?: number } = {}
): Promise<ReviewCard> {
  const uid = requireUid('add a review card');
  const now = options.now ?? Date.now();
  const cardId = reviewCardIdFor(item.lexicalKey);
  const ref = doc(db, 'users', uid, REVIEW_CARDS_SUBCOLLECTION, cardId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      return snap.data() as ReviewCard;
    }
    const card = newReviewCard(item, uid, now);
    tx.set(ref, card);
    return card;
  });
}

/**
 * Apply a rating to an existing review card and persist the new schedule.
 *
 * Only the eight scheduling fields produced by `computeNextSchedule` are
 * written; `surface` / `reading` / `meaning` / `lexicalKey` / `source*` /
 * `createdAt` / `userId` / `id` are never touched. The card is read and written
 * inside one transaction to prevent a lost update.
 *
 * @throws if there is no authenticated user, `cardId` is malformed, `rating` is
 *         unsupported (all rejected before any Firestore call), or the card does
 *         not exist.
 */
export async function applyReviewRating(
  cardId: string,
  rating: ReviewRating,
  options: { now?: number } = {}
): Promise<ReviewCard> {
  const uid = requireUid('review');

  if (typeof cardId !== 'string' || !CARD_ID_PATTERN.test(cardId)) {
    throw new Error('Invalid review card id.');
  }
  if (!isReviewRating(rating)) {
    throw new Error('Unsupported review rating.');
  }
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) {
    throw new Error('Invalid review timestamp.');
  }

  const ref = doc(db, 'users', uid, REVIEW_CARDS_SUBCOLLECTION, cardId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error('Review card not found.');
    }
    const current = snap.data() as ReviewCard;
    const patch = computeNextSchedule(current, rating, now);
    tx.update(ref, patch);
    return { ...current, ...patch };
  });
}

/**
 * Resolve the per-fetch queue limit. Clamps, never rejects (a read should
 * degrade gracefully) — same shape as P2.1's `resolveLearningItemsLimit`:
 *   undefined / non-finite / < 1  → REVIEW_QUEUE_CAP (50)
 *   1..50                         → itself
 *   > 50                          → 50
 *   non-integer                   → floored, then the rules above
 */
function resolveQueueLimit(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return REVIEW_QUEUE_CAP;
  }
  const floored = Math.floor(requested);
  if (floored < 1) {
    return REVIEW_QUEUE_CAP;
  }
  return Math.min(floored, REVIEW_QUEUE_CAP);
}

/**
 * Map a persisted document to a `ReviewCard`, or `null` if the row is not usable
 * as a review card. We do NOT fabricate or synthesise missing scheduling state —
 * an unusable row is skipped, not repaired. Required fields: a non-empty `id`, a
 * finite numeric `dueAt`, `state ∈ {learning, review}`, a non-empty `lexicalKey`,
 * and `type ∈ {vocab, grammar}`. Everything else passes straight through.
 */
function toReviewCard(
  id: string,
  data: Record<string, unknown>
): ReviewCard | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof data.dueAt !== 'number' || !Number.isFinite(data.dueAt)) return null;
  if (data.state !== 'learning' && data.state !== 'review') return null;
  if (typeof data.lexicalKey !== 'string' || data.lexicalKey.length === 0) return null;
  if (data.type !== 'vocab' && data.type !== 'grammar') return null;
  return { ...(data as unknown as ReviewCard), id };
}

/**
 * The authenticated user's due-review queue: every card whose `dueAt <= now`,
 * most-overdue first, capped at `REVIEW_QUEUE_CAP`.
 *
 * Read-only. No cursor / pagination token, no `type` / `state` filter, no
 * search, no client-side sort or dedup (cards are already unique by their
 * deterministic id). Backend result order is preserved verbatim. Equal `dueAt`
 * values are ordered by Firestore's implicit ascending `__name__` — no explicit
 * `documentId()` orderBy is added (not required for determinism).
 *
 * @throws if there is no authenticated user or `now` is non-finite — both
 *         rejected before any Firestore query is issued.
 */
export async function listDueReviewCards(
  options: { now?: number; limit?: number } = {}
): Promise<{ cards: ReviewCard[] }> {
  const uid = requireUid('review');
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) {
    throw new Error('Invalid review timestamp.');
  }
  const resolvedLimit = resolveQueueLimit(options.limit);

  const q = query(
    collection(doc(db, 'users', uid), REVIEW_CARDS_SUBCOLLECTION),
    where('dueAt', '<=', now),
    orderBy('dueAt', 'asc'),
    limit(resolvedLimit)
  );

  const snapshot = await getDocs(q);

  const cards: ReviewCard[] = [];
  for (const d of snapshot.docs) {
    const card = toReviewCard(d.id, d.data() as Record<string, unknown>);
    if (card !== null) {
      cards.push(card);
    }
  }
  return { cards };
}
