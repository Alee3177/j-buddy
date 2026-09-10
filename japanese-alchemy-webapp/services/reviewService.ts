/**
 * Japanese Reader v0.4 — P3.2, review-card mutation service.
 *
 * Direct Firestore client writes under `users/{auth.currentUser.uid}/review_cards`
 * — the same "authorised entirely by the isOwner rule" pattern as the P2.1 read
 * layer. Identity is ALWAYS `auth.currentUser.uid`; no uid is ever accepted from
 * a caller. Both operations run in a transaction so a concurrent write can never
 * cause a lost update or a duplicate card.
 *
 * P3.2 scope: the service only. No due-queue query, no UI. The schedule is
 * computed by the pure `computeNextSchedule` (lib/reviewCard.ts) — the exact
 * code the tests exercise — so there is nothing a server would compute better.
 */

import { doc, runTransaction } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
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
