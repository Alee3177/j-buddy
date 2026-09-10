import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  documentId,
  limit,
  query,
  orderBy,
  startAfter,
  Timestamp,
} from 'firebase/firestore';
import type { QueryConstraint } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
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

export async function getUserVocabularies(userId: string): Promise<Vocabulary[]> {
  const userDocRef = doc(db, 'users', userId);
  const q = query(
    collection(userDocRef, VOCABULARIES_SUBCOLLECTION),
    orderBy('createdAt', 'desc')
  );
  
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: timestampToDate(d.data().createdAt as Timestamp),
  })) as Vocabulary[];
}

export async function getUserGrammars(userId: string): Promise<Grammar[]> {
  const userDocRef = doc(db, 'users', userId);
  const q = query(
    collection(userDocRef, GRAMMARS_SUBCOLLECTION),
    orderBy('createdAt', 'desc')
  );
 
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: timestampToDate(d.data().createdAt as Timestamp),
  })) as Grammar[];
}

export async function getUserAnalysisPages(userId: string): Promise<AnalysisPage[]> {
  const userDocRef = doc(db, 'users', userId);
  const q = query(
    collection(userDocRef, ANALYSIS_PAGES_SUBCOLLECTION),
    orderBy('createdAt', 'desc')
  );

  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: timestampToDate(d.data().createdAt as Timestamp),
  })) as AnalysisPage[];
}

export async function deleteAnalysisPage(userId: string, pageId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', userId, ANALYSIS_PAGES_SUBCOLLECTION, pageId));
}

export async function getSharedAnalysisPages(): Promise<AnalysisPage[]> {
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
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to view learning items.');
  }

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
