import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  documentId: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  startAfter: vi.fn(),
  Timestamp: class Timestamp {},
}));

const firebaseMock = vi.hoisted(() => ({
  db: { name: 'db' },
  auth: { currentUser: null as { uid: string } | null },
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('@/lib/firebase', () => firebaseMock);

import {
  deleteAnalysisPage,
  getSharedAnalysisPages,
  getSharedVocabularies,
  getSharedGrammars,
  listLearningItems,
  subscribeToLearningItems,
  encodeLearningItemsCursor,
  decodeLearningItemsCursor,
} from './firestoreService';
import type { ListLearningItemsOptions } from '@/types';

describe('analysis page Firestore operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.doc.mockImplementation((...segments: unknown[]) => ({
      path: segments.slice(1).join('/'),
    }));
    firestore.collection.mockImplementation((...segments: unknown[]) => ({ segments }));
    firestore.query.mockImplementation((...parts: unknown[]) => ({ parts }));
    firestore.orderBy.mockReturnValue({ order: 'createdAt' });
  });

  it('deletes only the selected page document from its owner collection', async () => {
    await deleteAnalysisPage('viewer', 'page-1');

    expect(firestore.deleteDoc).toHaveBeenCalledWith({
      path: 'users/viewer/analysis_pages/page-1',
    });
  });

  it('loads shared pages in newest-first order', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [{ id: 'shared-1', data: () => ({
      rendered_markdown: '# Shared',
      source_text: '共有',
      source_url: '',
      saved_at: '2026-08-20T00:00:00.000Z',
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
    }) }] });

    await expect(getSharedAnalysisPages()).resolves.toEqual([
      expect.objectContaining({ id: 'shared-1', rendered_markdown: '# Shared' }),
    ]);
    expect(firestore.collection).toHaveBeenCalledWith({ name: 'db' }, 'shared_analysis_pages');
    expect(firestore.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('converts numeric Firestore timestamps to dates', async () => {
    const createdAt = Date.parse('2026-08-20T00:00:00.000Z');
    firestore.getDocs.mockResolvedValue({ docs: [{ id: 'shared-1', data: () => ({
      rendered_markdown: '# Shared',
      source_text: '共有',
      source_url: '',
      saved_at: '2026-08-20T00:00:00.000Z',
      createdAt,
    }) }] });

    await expect(getSharedAnalysisPages()).resolves.toEqual([
      expect.objectContaining({ createdAt: new Date(createdAt) }),
    ]);
  });
});

describe('shared vocabulary operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.collection.mockImplementation((...segments: unknown[]) => ({ segments }));
    firestore.query.mockImplementation((...parts: unknown[]) => ({ parts }));
    firestore.orderBy.mockReturnValue({ order: 'createdAt' });
  });

  it('loads shared vocabularies in newest-first order', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [{ id: 'sv-1', data: () => ({
      term: '日本語',
      detail: '{"term":"日本語","reading":"にほんご"}',
      createdAt: Date.parse('2026-08-20T00:00:00.000Z'),
      metadata: { source_text: '日本語を学ぶ', source_url: 'https://example.com' },
    }) }] });

    const result = await getSharedVocabularies();

    expect(firestore.collection).toHaveBeenCalledWith({ name: 'db' }, 'shared_vocabularies');
    expect(firestore.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'sv-1',
        term: '日本語',
        isShared: true,
        metadata: { source_text: '日本語を学ぶ', source_url: 'https://example.com' },
      }),
    ]);
  });

  it('handles shared vocabulary items without metadata', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [{ id: 'sv-2', data: () => ({
      term: '勉強',
      detail: '{"term":"勉強"}',
      createdAt: Date.parse('2026-08-20T00:00:00.000Z'),
    }) }] });

    const result = await getSharedVocabularies();

    expect(result).toEqual([
      expect.objectContaining({ id: 'sv-2', term: '勉強', isShared: true }),
    ]);
    expect(result[0].metadata).toBeUndefined();
  });
});

describe('shared grammar operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.collection.mockImplementation((...segments: unknown[]) => ({ segments }));
    firestore.query.mockImplementation((...parts: unknown[]) => ({ parts }));
    firestore.orderBy.mockReturnValue({ order: 'createdAt' });
  });

  it('loads shared grammars in newest-first order', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [{ id: 'sg-1', data: () => ({
      point: '〜です',
      explanation: '{"point":"〜です","meaning":"copula"}',
      createdAt: Date.parse('2026-08-20T00:00:00.000Z'),
      metadata: { source_text: '私は学生です' },
    }) }] });

    const result = await getSharedGrammars();

    expect(firestore.collection).toHaveBeenCalledWith({ name: 'db' }, 'shared_grammars');
    expect(firestore.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'sg-1',
        point: '〜です',
        isShared: true,
        metadata: { source_text: '私は学生です' },
      }),
    ]);
  });
});

// Japanese Reader v0.4 P2.1 — personal learning-items read / query layer.
describe('listLearningItems', () => {
  const DOCUMENT_ID = { __sentinel: 'documentId' };

  const b64url = (s: string) =>
    btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function itemDoc(overrides: Record<string, unknown> = {}) {
    const full = {
      id: 'auto-a',
      userId: 'me',
      sourceAnalysisId: 'page-1',
      type: 'vocab',
      surface: '{改善|かいぜん}',
      status: 'NEW',
      createdAt: 300,
      updatedAt: 300,
      lexicalKey: 'vocab|改善|かいぜん',
      reading: 'かいぜん',
      meaning: '改善',
      sourceSentence: 'S',
      sourceUrl: null,
      ...overrides,
    };
    const { id, ...data } = full;
    return { id: id as string, data: () => data };
  }

  // N docs, newest first: createdAt 1000, 999, …; ids d0, d1, ….
  function descendingDocs(n: number) {
    return Array.from({ length: n }, (_, i) =>
      itemDoc({ id: `d${i}`, createdAt: 1000 - i })
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    firebaseMock.auth.currentUser = { uid: 'me' };

    firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({
      __ref: 'doc',
      path: segments.join('/'),
    }));
    firestore.collection.mockImplementation(
      (parent: { path: string }, name: string) => ({
        __ref: 'collection',
        path: `${parent.path}/${name}`,
      })
    );
    firestore.orderBy.mockImplementation((field: unknown, direction: unknown) => ({
      __c: 'orderBy',
      field,
      direction,
    }));
    firestore.documentId.mockImplementation(() => DOCUMENT_ID);
    firestore.startAfter.mockImplementation((...values: unknown[]) => ({
      __c: 'startAfter',
      values,
    }));
    firestore.limit.mockImplementation((count: number) => ({ __c: 'limit', count }));
    firestore.query.mockImplementation(
      (source: unknown, ...constraints: unknown[]) => ({ source, constraints })
    );
    firestore.getDocs.mockResolvedValue({ docs: [] });
  });

  // 1
  it('rejects an unauthenticated caller and issues no Firestore query', async () => {
    firebaseMock.auth.currentUser = null;

    await expect(listLearningItems()).rejects.toThrow(/signed in/i);
    expect(firestore.doc).not.toHaveBeenCalled();
    expect(firestore.collection).not.toHaveBeenCalled();
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  // 2
  it('queries users/{auth.uid}/learning_items', async () => {
    firebaseMock.auth.currentUser = { uid: 'me' };

    await listLearningItems();

    expect(firestore.doc).toHaveBeenCalledWith(firebaseMock.db, 'users', 'me');
    expect(firestore.collection).toHaveBeenCalledWith(
      { __ref: 'doc', path: 'users/me' },
      'learning_items'
    );
  });

  // 3
  it('ignores any userId passed through options (identity is auth.currentUser only)', async () => {
    firebaseMock.auth.currentUser = { uid: 'me' };

    await listLearningItems({ userId: 'victim' } as unknown as ListLearningItemsOptions);

    expect(firestore.doc).toHaveBeenCalledWith(firebaseMock.db, 'users', 'me');
    expect(firestore.doc).not.toHaveBeenCalledWith(firebaseMock.db, 'users', 'victim');
  });

  // 4
  it('defaults to a page size of 20 (fetches 21 to detect a next page)', async () => {
    await listLearningItems();
    expect(firestore.limit).toHaveBeenCalledWith(21);

    await listLearningItems({ limit: 10 });
    expect(firestore.limit).toHaveBeenLastCalledWith(11);
  });

  // 4 (cont.) — non-positive / non-finite falls back to the default
  it('falls back to the default page size for non-positive or non-finite limits', async () => {
    await listLearningItems({ limit: 0 });
    expect(firestore.limit).toHaveBeenLastCalledWith(21);

    await listLearningItems({ limit: -5 });
    expect(firestore.limit).toHaveBeenLastCalledWith(21);

    await listLearningItems({ limit: Number.NaN });
    expect(firestore.limit).toHaveBeenLastCalledWith(21);
  });

  // 5
  it('clamps an over-maximum limit to 100 rather than rejecting', async () => {
    await listLearningItems({ limit: 100_000 });
    expect(firestore.limit).toHaveBeenCalledWith(101);
  });

  // 6
  it('orders by createdAt DESC then document id DESC', async () => {
    await listLearningItems();

    expect(firestore.orderBy).toHaveBeenNthCalledWith(1, 'createdAt', 'desc');
    expect(firestore.orderBy).toHaveBeenNthCalledWith(2, DOCUMENT_ID, 'desc');
    // No cursor ⇒ constraints are [orderBy, orderBy, limit] in that order.
    const constraints = firestore.query.mock.calls[0].slice(1) as Array<{ __c: string }>;
    expect(constraints.map((c) => c.__c)).toEqual(['orderBy', 'orderBy', 'limit']);
  });

  // 7
  it('returns exactly the page size when more rows exist', async () => {
    firestore.getDocs.mockResolvedValue({ docs: descendingDocs(21) });

    const result = await listLearningItems();

    expect(result.items).toHaveLength(20);
    expect(result.items[0].id).toBe('d0');
    expect(result.items[19].id).toBe('d19');
  });

  // 8
  it('encodes nextCursor from the last returned item when more rows exist', async () => {
    firestore.getDocs.mockResolvedValue({ docs: descendingDocs(21) });

    const result = await listLearningItems();

    expect(result.nextCursor).toBe(
      encodeLearningItemsCursor({ createdAt: 1000 - 19, id: 'd19' })
    );
  });

  // 9
  it('round-trips a cursor and never embeds a uid or path', () => {
    const token = encodeLearningItemsCursor({ createdAt: 1_710_000_000_000, id: 'abcDEF123' });

    expect(token).not.toMatch(/[+/=]/);
    expect(decodeLearningItemsCursor(token)).toEqual({
      createdAt: 1_710_000_000_000,
      id: 'abcDEF123',
    });
    const decoded = JSON.parse(
      atob(token.replace(/-/g, '+').replace(/_/g, '/'))
    );
    expect(Object.keys(decoded).sort()).toEqual(['createdAt', 'id']);
  });

  // 10
  it('continues from a cursor with startAfter(createdAt, id)', async () => {
    const cursor = encodeLearningItemsCursor({ createdAt: 500, id: 'x9' });

    await listLearningItems({ cursor });

    expect(firestore.startAfter).toHaveBeenCalledWith(500, 'x9');
    const constraints = firestore.query.mock.calls[0].slice(1) as Array<{ __c: string }>;
    expect(constraints.map((c) => c.__c)).toEqual([
      'orderBy',
      'orderBy',
      'startAfter',
      'limit',
    ]);
  });

  // 11
  it('returns a null nextCursor on the final page', async () => {
    firestore.getDocs.mockResolvedValue({ docs: descendingDocs(20) });

    const result = await listLearningItems();

    expect(result.items).toHaveLength(20);
    expect(result.nextCursor).toBeNull();
  });

  // 12
  it('returns an empty result for an empty collection', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [] });

    await expect(listLearningItems()).resolves.toEqual({ items: [], nextCursor: null });
  });

  // 13
  it('fails closed on a malformed base64 cursor and issues no query', async () => {
    await expect(listLearningItems({ cursor: '!!!not base64!!!' })).rejects.toThrow(
      /invalid learning-items cursor/i
    );
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  // 14
  it('fails closed on a cursor that does not decode to JSON', async () => {
    await expect(
      listLearningItems({ cursor: b64url('#-definitely-not-json') })
    ).rejects.toThrow(/invalid learning-items cursor/i);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  // 15
  it('rejects a cursor whose createdAt is not a finite number', () => {
    expect(() =>
      decodeLearningItemsCursor(b64url(JSON.stringify({ createdAt: 'nope', id: 'x' })))
    ).toThrow(/invalid learning-items cursor/i);
    expect(() =>
      decodeLearningItemsCursor(b64url(JSON.stringify({ id: 'x' })))
    ).toThrow(/invalid learning-items cursor/i);
  });

  // 16
  it('rejects a cursor whose id is an empty string', () => {
    expect(() =>
      decodeLearningItemsCursor(b64url(JSON.stringify({ createdAt: 1, id: '' })))
    ).toThrow(/invalid learning-items cursor/i);
  });

  // 17
  it('preserves duplicate-lexicalKey occurrences as distinct items', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [
        itemDoc({ id: 'occ-1', createdAt: 20, lexicalKey: 'vocab|改善|かいぜん', meaning: 'A' }),
        itemDoc({ id: 'occ-2', createdAt: 10, lexicalKey: 'vocab|改善|かいぜん', meaning: 'B' }),
      ],
    });

    const result = await listLearningItems();

    expect(result.items.map((i) => i.id)).toEqual(['occ-1', 'occ-2']);
    expect(result.items[0].lexicalKey).toBe(result.items[1].lexicalKey);
    expect(result.items[0].meaning).toBe('A');
    expect(result.items[1].meaning).toBe('B');
  });

  // 18
  it('preserves sourceAnalysisId verbatim', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [itemDoc({ id: 'x', sourceAnalysisId: 'page-XYZ' })],
    });

    const result = await listLearningItems();

    expect(result.items[0].sourceAnalysisId).toBe('page-XYZ');
  });

  // 19
  it('never reads a shared_* collection', async () => {
    firestore.getDocs.mockResolvedValue({ docs: descendingDocs(3) });

    await listLearningItems();

    for (const call of firestore.collection.mock.calls) {
      expect(call[1]).toBe('learning_items');
    }
    for (const call of firestore.doc.mock.calls) {
      expect(call).toEqual([firebaseMock.db, 'users', 'me']);
    }
  });

  // 20
  it('propagates a Firestore query failure to the caller', async () => {
    firestore.getDocs.mockRejectedValue(new Error('firestore unavailable'));

    await expect(listLearningItems()).rejects.toThrow('firestore unavailable');
  });

  // Malformed-row policy: skip (documented choice), never fabricate fields.
  it('skips a persisted row with no usable createdAt and keeps the valid ones', async () => {
    firestore.getDocs.mockResolvedValue({
      docs: [
        itemDoc({ id: 'ok-1', createdAt: 30 }),
        { id: 'broken-no-createdAt', data: () => ({ type: 'vocab', surface: 'x' }) },
        { id: 'broken-string-createdAt', data: () => ({ createdAt: 'oops', surface: 'y' }) },
        itemDoc({ id: 'ok-2', createdAt: 10 }),
      ],
    });

    const result = await listLearningItems();

    expect(result.items.map((i) => i.id)).toEqual(['ok-1', 'ok-2']);
  });
});

// P7.3-I — live first-page listener backing the realtime dashboard refresh.
describe('subscribeToLearningItems', () => {
  const DOCUMENT_ID = { __sentinel: 'documentId' };

  function itemDoc(overrides: Record<string, unknown> = {}) {
    const full = {
      id: 'auto-a',
      userId: 'me',
      sourceAnalysisId: 'page-1',
      type: 'vocab',
      surface: '{改善|かいぜん}',
      status: 'NEW',
      createdAt: 300,
      updatedAt: 300,
      lexicalKey: 'vocab|改善|かいぜん',
      reading: 'かいぜん',
      meaning: '改善',
      sourceSentence: 'S',
      sourceUrl: null,
      ...overrides,
    };
    const { id, ...data } = full;
    return { id: id as string, data: () => data };
  }

  function descendingDocs(n: number) {
    return Array.from({ length: n }, (_, i) =>
      itemDoc({ id: `d${i}`, createdAt: 1000 - i })
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    firebaseMock.auth.currentUser = { uid: 'me' };

    firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({
      __ref: 'doc',
      path: segments.join('/'),
    }));
    firestore.collection.mockImplementation(
      (parent: { path: string }, name: string) => ({
        __ref: 'collection',
        path: `${parent.path}/${name}`,
      })
    );
    firestore.orderBy.mockImplementation((field: unknown, direction: unknown) => ({
      __c: 'orderBy',
      field,
      direction,
    }));
    firestore.documentId.mockImplementation(() => DOCUMENT_ID);
    firestore.limit.mockImplementation((count: number) => ({ __c: 'limit', count }));
    firestore.query.mockImplementation(
      (source: unknown, ...constraints: unknown[]) => ({ source, constraints })
    );
    firestore.onSnapshot.mockReturnValue(vi.fn());
  });

  it('throws synchronously and attaches no listener when signed out', () => {
    firebaseMock.auth.currentUser = null;

    expect(() => subscribeToLearningItems(undefined, vi.fn(), vi.fn())).toThrow(
      /signed in/i
    );
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
  });

  it('subscribes to users/{auth.uid}/learning_items ordered createdAt desc, id desc, limit 21', () => {
    subscribeToLearningItems(undefined, vi.fn(), vi.fn());

    expect(firestore.doc).toHaveBeenCalledWith(firebaseMock.db, 'users', 'me');
    expect(firestore.collection).toHaveBeenCalledWith(
      { __ref: 'doc', path: 'users/me' },
      'learning_items'
    );
    expect(firestore.orderBy).toHaveBeenNthCalledWith(1, 'createdAt', 'desc');
    expect(firestore.orderBy).toHaveBeenNthCalledWith(2, DOCUMENT_ID, 'desc');
    expect(firestore.limit).toHaveBeenCalledWith(21);
    expect(firestore.onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('respects a custom page size', () => {
    subscribeToLearningItems(5, vi.fn(), vi.fn());
    expect(firestore.limit).toHaveBeenCalledWith(6);
  });

  it('maps each snapshot to items + nextCursor, live (not just once)', () => {
    const onData = vi.fn();
    let handler: (snapshot: { docs: unknown[] }) => void = () => {};
    firestore.onSnapshot.mockImplementation((_q: unknown, cb: typeof handler) => {
      handler = cb;
      return vi.fn();
    });

    subscribeToLearningItems(undefined, onData, vi.fn());

    // Initial snapshot: 2 items.
    handler({ docs: descendingDocs(2) });
    expect(onData).toHaveBeenLastCalledWith({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'd0' }),
        expect.objectContaining({ id: 'd1' }),
      ]),
      nextCursor: null,
    });
    expect(onData.mock.calls[0][0].items).toHaveLength(2);

    // External write lands — the same listener fires again with 4 items.
    handler({ docs: descendingDocs(4) });
    expect(onData).toHaveBeenCalledTimes(2);
    expect(onData.mock.calls[1][0].items).toHaveLength(4);
  });

  it('reports hasMore via nextCursor when more than pageSize rows exist', () => {
    const onData = vi.fn();
    let handler: (snapshot: { docs: unknown[] }) => void = () => {};
    firestore.onSnapshot.mockImplementation((_q: unknown, cb: typeof handler) => {
      handler = cb;
      return vi.fn();
    });

    subscribeToLearningItems(2, onData, vi.fn());
    handler({ docs: descendingDocs(3) });

    expect(onData.mock.calls[0][0].items).toHaveLength(2);
    expect(onData.mock.calls[0][0].nextCursor).toBe(
      encodeLearningItemsCursor({ createdAt: 1000 - 1, id: 'd1' })
    );
  });

  it('forwards listener errors to onError', () => {
    const onError = vi.fn();
    let errorHandler: (error: unknown) => void = () => {};
    firestore.onSnapshot.mockImplementation(
      (_q: unknown, _cb: unknown, errCb: typeof errorHandler) => {
        errorHandler = errCb;
        return vi.fn();
      }
    );

    subscribeToLearningItems(undefined, vi.fn(), onError);
    const boom = new Error('permission-denied');
    errorHandler(boom);

    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('returns the underlying unsubscribe function', () => {
    const unsubscribe = vi.fn();
    firestore.onSnapshot.mockReturnValue(unsubscribe);

    const result = subscribeToLearningItems(undefined, vi.fn(), vi.fn());
    result();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
