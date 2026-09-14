import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  documentId,
  limit,
  onSnapshot,
  query,
  orderBy,
  startAfter,
  Timestamp,
} from 'firebase/firestore';
import type { Firestore, QueryConstraint, Unsubscribe } from 'firebase/firestore';
import { db as firestoreDb, auth as firebaseAuth } from '@/lib/firebase';

/**
 * The Firestore client, or a generic (Firebase-detail-free) error when the
 * webapp was built/served without Firebase config. Signed-in UI never reaches
 * this in degraded mode — it is defence-in-depth so a stray call fails
 * deterministically before any network attempt.
 */
function requireDb(): Firestore {
  if (!firestoreDb) {
    throw new Error('This feature is unavailable because Firebase is not configured.');
  }
  return firestoreDb;
}
import {
  Vocabulary,
  Grammar,
  AnalysisPage,
  LearningItem,
  LearningItemsCursor,
  ListLearningItemsOptions,
  ListLearningItemsResult,
} from '@/types';

// Subcollection names
const VOCABULARIES_SUBCOLLECTION = 'vocabularies';
const GRAMMARS_SUBCOLLECTION = 'grammars';
const ANALYSIS_PAGES_SUBCOLLECTION = 'analysis_pages';

// Convert Firestore timestamp to Date
const timestampToDate = (timestamp: Timestamp | Date | number): Date => {
  if (timestamp instanceof Timestamp) return timestamp.toDate();
  return new Date(timestamp);
};

/**
 * P7.3-I — live variant of the (now-removed) one-shot `getUserVocabularies` /
 * `getUserGrammars` / `getUserAnalysisPages`. All three personal subcollections
 * share the same shape (owner-scoped, ordered by createdAt desc, no
 * pagination), so the subscription plumbing is shared here and each caller
 * below only supplies the subcollection name and the doc→entity mapping.
 *
 * `onData` fires with the full current list on the initial snapshot AND again
 * on every subsequent Firestore change (e.g. a Chrome-extension save), so an
 * open webapp reflects external writes without a reload.
 */
function subscribeToUserSubcollection<T>(
  userId: string,
  subcollectionName: string,
  mapDoc: (id: string, data: Record<string, unknown>) => T,
  onData: (items: T[]) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  const db = requireDb();
  const userDocRef = doc(db, 'users', userId);
  const q = query(
    collection(userDocRef, subcollectionName),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>)));
    },
    onError
  );
}

export function subscribeToUserVocabularies(
  userId: string,
  onData: (items: Vocabulary[]) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  return subscribeToUserSubcollection<Vocabulary>(
    userId,
    VOCABULARIES_SUBCOLLECTION,
    (id, data) =>
      ({
        id,
        ...data,
        createdAt: timestampToDate(data.createdAt as Timestamp),
      }) as Vocabulary,
    onData,
    onError
  );
}

export function subscribeToUserGrammars(
  userId: string,
  onData: (items: Grammar[]) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  return subscribeToUserSubcollection<Grammar>(
    userId,
    GRAMMARS_SUBCOLLECTION,
    (id, data) =>
      ({
        id,
        ...data,
        createdAt: timestampToDate(data.createdAt as Timestamp),
      }) as Grammar,
    onData,
    onError
  );
}

export function subscribeToUserAnalysisPages(
  userId: string,
  onData: (items: AnalysisPage[]) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  return subscribeToUserSubcollection<AnalysisPage>(
    userId,
    ANALYSIS_PAGES_SUBCOLLECTION,
    (id, data) =>
      ({
        id,
        ...data,
        createdAt: timestampToDate(data.createdAt as Timestamp),
      }) as AnalysisPage,
    onData,
    onError
  );
}

export async function deleteAnalysisPage(userId: string, pageId: string): Promise<void> {
  const db = requireDb();
  await deleteDoc(doc(db, 'users', userId, ANALYSIS_PAGES_SUBCOLLECTION, pageId));
}

export async function getSharedAnalysisPages(): Promise<AnalysisPage[]> {
  const db = requireDb();
  const q = query(
    collection(db, 'shared_analysis_pages'),
    orderBy('createdAt', 'desc')
  );

  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((pageDoc) => {
    const data = pageDoc.data();
    return {
      id: pageDoc.id,
      ...data,
      createdAt: timestampToDate(data.createdAt as Timestamp),
    };
  }) as AnalysisPage[];
}

export async function getSharedVocabularies(): Promise<Vocabulary[]> {
  const db = requireDb();
  const q = query(
    collection(db, 'shared_vocabularies'),
    orderBy('createdAt', 'desc')
  );

  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((vocabDoc) => {
    const data = vocabDoc.data();
    return {
      id: vocabDoc.id,
      ...data,
      isShared: true,
      createdAt: timestampToDate(data.createdAt as Timestamp),
    };
  }) as Vocabulary[];
}

export async function getSharedGrammars(): Promise<Grammar[]> {
  const db = requireDb();
  const q = query(
    collection(db, 'shared_grammars'),
    orderBy('createdAt', 'desc')
  );

  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((grammarDoc) => {
    const data = grammarDoc.data();
    return {
      id: grammarDoc.id,
      ...data,
      isShared: true,
      createdAt: timestampToDate(data.createdAt as Timestamp),
    };
  }) as Grammar[];
}

// ---------------------------------------------------------------------------
// Japanese Reader v0.4 P2.1 — personal learning-items read / query layer.
//
// Read-only and additive. Reads `users/{uid}/learning_items` directly with the
// Firestore client SDK — the same pattern as the vocab / grammar / analysis-page
// reads above — authorised entirely by the existing `isOwner` security rule
// (no rules change). The caller NEVER supplies a uid: identity is always
// `auth.currentUser`.
//
// The result is a merged, reverse-chronological list of RAW occurrences: no
// kind filter, no dedup / grouping by `lexicalKey`, no review / SRS state.
// Ordering is (createdAt DESC, __name__ DESC); the document-id key is
// load-bearing because every item derived from one save shares an identical
// `createdAt`, so `createdAt` alone is not a stable page boundary. That
// ordering relies only on Firestore's built-in indexes — no
// `firestore.indexes.json` entry is required.
// ---------------------------------------------------------------------------

const LEARNING_ITEMS_SUBCOLLECTION = 'learning_items';
const DEFAULT_LEARNING_ITEMS_LIMIT = 20;
const MAX_LEARNING_ITEMS_LIMIT = 100;

function encodeBase64Url(input: string): string {
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

function decodeBase64Url(input: string): string {
  const binary = atob(input.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode the ordering position of the last returned item into an opaque token.
 * Contains only `createdAt` + `id` — never a uid or a Firestore path. */
export function encodeLearningItemsCursor(cursor: LearningItemsCursor): string {
  return encodeBase64Url(
    JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id })
  );
}

/** Decode + validate a cursor token. Fails closed: any malformed input (bad
 * base64url, bad JSON, non-finite `createdAt`, empty `id`) throws and no query
 * is attempted. */
export function decodeLearningItemsCursor(raw: string): LearningItemsCursor {
  let json: string;
  try {
    json = decodeBase64Url(raw);
  } catch {
    throw new Error('Invalid learning-items cursor');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid learning-items cursor');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid learning-items cursor');
  }
  const { createdAt, id } = parsed as Record<string, unknown>;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    throw new Error('Invalid learning-items cursor');
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Invalid learning-items cursor');
  }
  return { createdAt, id };
}

function resolveLearningItemsLimit(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return DEFAULT_LEARNING_ITEMS_LIMIT;
  }
  const floored = Math.floor(requested);
  if (floored < 1) {
    return DEFAULT_LEARNING_ITEMS_LIMIT;
  }
  // Over-max input is clamped (not rejected): a read should degrade gracefully.
  return Math.min(floored, MAX_LEARNING_ITEMS_LIMIT);
}

/**
 * Map a persisted document to a `LearningItem`, or `null` if the row is not
 * usable by this layer. We deliberately do NOT fabricate missing fields. The
 * only hard requirements are the two fields this layer depends on: a finite
 * numeric `createdAt` (ordering + cursor) and a non-empty `id` (always the
 * Firestore doc id). Everything else — including a `null` reading/meaning — is
 * passed straight through. Unusable rows are skipped, not thrown on.
 */
function toLearningItem(
  id: string,
  data: Record<string, unknown>
): LearningItem | null {
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  if (typeof data.createdAt !== 'number' || !Number.isFinite(data.createdAt)) {
    return null;
  }
  return { ...(data as unknown as LearningItem), id };
}

/**
 * List the signed-in user's personal learning items, newest first.
 *
 * @throws if there is no authenticated user (no Firestore query is issued).
 * @throws if `options.cursor` is a non-empty string that fails to decode.
 */
export async function listLearningItems(
  options: ListLearningItemsOptions = {}
): Promise<ListLearningItemsResult> {
  const currentUser = firebaseAuth?.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to view learning items.');
  }
  const db = requireDb();

  const cursor =
    options.cursor != null && options.cursor !== ''
      ? decodeLearningItemsCursor(options.cursor)
      : null;

  const pageSize = resolveLearningItemsLimit(options.limit);

  const userDocRef = doc(db, 'users', currentUser.uid);
  const constraints: QueryConstraint[] = [
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
  ];
  if (cursor) {
    constraints.push(startAfter(cursor.createdAt, cursor.id));
  }
  // Fetch one extra row so "is there a next page?" needs no second query.
  constraints.push(limit(pageSize + 1));

  const q = query(
    collection(userDocRef, LEARNING_ITEMS_SUBCOLLECTION),
    ...constraints
  );

  const snapshot = await getDocs(q);

  const hasMore = snapshot.docs.length > pageSize;
  const items = snapshot.docs
    .slice(0, pageSize)
    .map((d) => toLearningItem(d.id, d.data() as Record<string, unknown>))
    .filter((item): item is LearningItem => item !== null);

  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeLearningItemsCursor({ createdAt: last.createdAt, id: last.id })
      : null;

  return { items, nextCursor };
}

/**
 * P7.3-I — live variant of the first page of `listLearningItems()`.
 *
 * Same query (createdAt DESC, __name__ DESC, page size + 1) and the same
 * mapping to `ListLearningItemsResult`, but via `onSnapshot` instead of a
 * one-shot `getDocs`: `onData` fires with the current first page immediately
 * and again on every subsequent Firestore change (e.g. a Chrome-extension
 * save), so an open webapp reflects external writes without a reload.
 * `loadMore` beyond this first page still goes through `listLearningItems`
 * unchanged.
 *
 * @throws synchronously if there is no authenticated user — no listener is
 * attached, matching `listLearningItems`'s fail-closed behaviour.
 */
export function subscribeToLearningItems(
  pageSize: number | undefined,
  onData: (result: ListLearningItemsResult) => void,
  onError: (error: unknown) => void
): Unsubscribe {
  const currentUser = firebaseAuth?.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to view learning items.');
  }
  const db = requireDb();

  const size = resolveLearningItemsLimit(pageSize);
  const userDocRef = doc(db, 'users', currentUser.uid);
  const q = query(
    collection(userDocRef, LEARNING_ITEMS_SUBCOLLECTION),
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
    // Fetch one extra row so "is there a next page?" needs no second query.
    limit(size + 1)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const hasMore = snapshot.docs.length > size;
      const items = snapshot.docs
        .slice(0, size)
        .map((d) => toLearningItem(d.id, d.data() as Record<string, unknown>))
        .filter((item): item is LearningItem => item !== null);

      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeLearningItemsCursor({ createdAt: last.createdAt, id: last.id })
          : null;

      onData({ items, nextCursor });
    },
    onError
  );
}
