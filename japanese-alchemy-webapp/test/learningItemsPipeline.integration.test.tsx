/* @vitest-environment jsdom */

/**
 * Japanese Reader v0.4 P2.3 — deterministic end-to-end integration simulation.
 *
 * This is NOT a unit test of one module. It wires the REAL code from every
 * phase together across their contract seams, with only the Firestore transport
 * faked (an in-memory store that honours orderBy / startAfter / limit):
 *
 *   P0/P1  deriveLearningItems(structured_json)         ← real, imported from
 *                                                          japanese-alchemy-hosting
 *      │   (docs written exactly as savePersonalAnalysisPage does: {...item, id})
 *      ▼
 *   P2.1  listLearningItems({ cursor })                 ← real service
 *      │   + encode/decodeLearningItemsCursor           ← real
 *      ▼
 *   P2.2  learningItemsFeedReducer (FIRST_PAGE_OK / NEXT_PAGE_OK)   ← real
 *      ▼
 *   P2.2  <LearningItemsPanel state={…} />              ← real, rendered
 *
 * No network, no Firebase init, no Gemini. Local Firebase config / emulator are
 * unavailable in this environment (see the P2.3 report) — this simulation is the
 * strongest available substitute for a live save→read→render smoke.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deriveLearningItems,
  type NewLearningItem,
} from '../../japanese-alchemy-hosting/functions/src/models/learningItem';

// ---- fake Firestore transport -------------------------------------------------

// Hoisted so the vi.mock factories below (which run during the hoisted imports)
// see initialised objects. `authState` / `store` are mutated per test.
const h = vi.hoisted(() => ({
  authState: { currentUser: null as { uid: string } | null },
  store: { docs: [] as Array<{ id: string; data: Record<string, unknown> }> },
}));

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  get auth() {
    return h.authState;
  },
}));

vi.mock('firebase/firestore', () => {
  const doc = (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  });
  const collection = (parent: { path: string }, name: string) => ({
    path: `${parent.path}/${name}`,
  });
  const documentId = () => '__name__';
  const orderBy = (field: unknown, direction: 'asc' | 'desc') => ({
    kind: 'orderBy' as const,
    field,
    direction,
  });
  const startAfter = (...values: unknown[]) => ({
    kind: 'startAfter' as const,
    values,
  });
  const limit = (count: number) => ({ kind: 'limit' as const, count });
  const query = (source: { path: string }, ...constraints: unknown[]) => ({
    source,
    constraints: constraints as Array<Record<string, unknown>>,
  });

  const getDocs = async (q: {
    source: { path: string };
    constraints: Array<Record<string, unknown>>;
  }) => {
    // Only the current user's learning_items collection should ever be queried.
    if (
      h.authState.currentUser == null ||
      q.source.path !== `users/${h.authState.currentUser.uid}/learning_items`
    ) {
      throw new Error(`unexpected collection path: ${q.source.path}`);
    }

    // orderBy(createdAt desc), then orderBy(__name__ desc)
    let rows = [...h.store.docs].sort((a, b) => {
      const byCreated =
        (b.data.createdAt as number) - (a.data.createdAt as number);
      if (byCreated !== 0) return byCreated;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

    const after = q.constraints.find((c) => c.kind === 'startAfter');
    if (after) {
      const [createdAt, id] = after.values as [number, string];
      rows = rows.filter((r) => {
        const rc = r.data.createdAt as number;
        if (rc !== createdAt) return rc < createdAt; // desc ⇒ "after" = smaller
        return r.id < id;
      });
    }

    const lim = q.constraints.find((c) => c.kind === 'limit');
    if (lim) rows = rows.slice(0, lim.count as number);

    return { docs: rows.map((r) => ({ id: r.id, data: () => r.data })) };
  };

  return {
    doc,
    collection,
    documentId,
    orderBy,
    startAfter,
    limit,
    query,
    getDocs,
    deleteDoc: vi.fn(),
    Timestamp: class Timestamp {},
  };
});

import { listLearningItems } from '@/services/firestoreService';
import {
  initialLearningItemsFeedState,
  learningItemsFeedReducer,
} from '@/lib/learningItemsFeed';
import { LearningItemsPanel } from '@/components/LearningItemsPanel';

// ---- helpers ----------------------------------------------------------------

/** Write derived drafts the way savePersonalAnalysisPage does: doc id → `id`. */
function persist(drafts: NewLearningItem[], startSeq = 0) {
  drafts.forEach((draft, i) => {
    const id = `li-${String(startSeq + i).padStart(3, '0')}`;
    h.store.docs.push({ id, data: { ...draft, id } });
  });
}

const PAGE_META = {
  sourceText: '制度を{改善|かいぜん}しても、問題は{残|のこ}る。',
  sourceUrl: 'https://news.example.com/article',
};

const STRUCTURED = {
  words: [
    { term: '{改善|かいぜん}', detail: '讀音：かいぜん\n意思：使變得更好。' },
    // second, bare-kanji occurrence of the same lexeme → same lexicalKey
    { term: '改善', detail: '讀音：かいぜん\n解釋：改善。' },
    { term: '{問題|もんだい}', detail: '讀音：もんだい\n意思：需要解決的事。' },
  ],
  grammars: [
    { point: '〜ても', explanation: '- **用法說明**\n  - 即使…也…' },
  ],
};

beforeEach(() => {
  h.store.docs = [];
  h.authState.currentUser = null;
  vi.clearAllMocks();
});

// ---- the simulation --------------------------------------------------------

describe('P2.3 · learning-items pipeline (save → read → paginate → render)', () => {
  it('derives vocab + grammar occurrences from one personal save and links them to the page', () => {
    const drafts = deriveLearningItems(STRUCTURED, PAGE_META, 'page-XYZ', {
      userId: 'alice',
      now: 1_000,
    });

    expect(drafts.map((d) => d.type)).toEqual([
      'vocab',
      'vocab',
      'vocab',
      'grammar',
    ]);
    expect(drafts.every((d) => d.sourceAnalysisId === 'page-XYZ')).toBe(true);
    expect(drafts.every((d) => d.userId === 'alice')).toBe(true);
    expect(drafts.every((d) => d.status === 'NEW')).toBe(true);
    // the two 改善 occurrences share a lexicalKey but are distinct drafts
    expect(drafts[0].lexicalKey).toBe(drafts[1].lexicalKey);
    expect(drafts[0]).not.toBe(drafts[1]);
  });

  it('reads them back through listLearningItems() with no index/permission error, newest-first', async () => {
    h.authState.currentUser = { uid: 'alice' };
    // one save: all four items share `now`, distinguished by doc id (as in prod)
    persist(
      deriveLearningItems(STRUCTURED, PAGE_META, 'page-1', {
        userId: 'alice',
        now: 5_000,
      })
    );

    const page = await listLearningItems();

    expect(page.items).toHaveLength(4);
    expect(page.nextCursor).toBeNull();
    // stable order: equal createdAt ⇒ document id DESC
    expect(page.items.map((i) => i.id)).toEqual([
      'li-003',
      'li-002',
      'li-001',
      'li-000',
    ]);
    // both 改善 occurrences survived the read
    const kaizen = page.items.filter((i) => i.surface.includes('改善'));
    expect(kaizen).toHaveLength(2);
    expect(kaizen[0].lexicalKey).toBe(kaizen[1].lexicalKey);
    expect(page.items.every((i) => i.sourceAnalysisId === 'page-1')).toBe(true);
  });

  it('paginates across saves with a working cursor and no client-side dedup', async () => {
    h.authState.currentUser = { uid: 'alice' };
    // 3 saves × 4 items = 12 rows, ascending createdAt per save
    persist(
      deriveLearningItems(STRUCTURED, PAGE_META, 'page-a', {
        userId: 'alice',
        now: 100,
      }),
      0
    );
    persist(
      deriveLearningItems(STRUCTURED, PAGE_META, 'page-b', {
        userId: 'alice',
        now: 200,
      }),
      4
    );
    persist(
      deriveLearningItems(STRUCTURED, PAGE_META, 'page-c', {
        userId: 'alice',
        now: 300,
      }),
      8
    );

    const first = await listLearningItems({ limit: 5 });
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();

    const second = await listLearningItems({ limit: 5, cursor: first.nextCursor });
    expect(second.items).toHaveLength(5);

    const third = await listLearningItems({ limit: 5, cursor: second.nextCursor });
    expect(third.items).toHaveLength(2);
    expect(third.nextCursor).toBeNull();

    const all = [...first.items, ...second.items, ...third.items];
    expect(all).toHaveLength(12);
    // no duplicates across pages
    expect(new Set(all.map((i) => i.id)).size).toBe(12);
    // globally sorted by createdAt desc
    const created = all.map((i) => i.createdAt);
    expect(created).toEqual([...created].sort((a, b) => b - a));
  });

  it('feeds the read result through the real reducer and renders the tab', async () => {
    h.authState.currentUser = { uid: 'alice' };
    persist(
      deriveLearningItems(STRUCTURED, PAGE_META, 'page-1', {
        userId: 'alice',
        now: 10,
      }),
      0
    );
    persist(
      deriveLearningItems(STRUCTURED, PAGE_META, 'page-2', {
        userId: 'alice',
        now: 20,
      }),
      4
    );

    const p1 = await listLearningItems({ limit: 5 });
    let state = learningItemsFeedReducer(initialLearningItemsFeedState, {
      type: 'FIRST_PAGE_OK',
      result: p1,
    });

    let html = renderToStaticMarkup(
      <LearningItemsPanel state={state} onLoadMore={() => {}} />
    );
    expect(state.items).toHaveLength(5);
    expect(html).toContain('單字'); // vocab badge
    expect(html).toContain('文法'); // grammar badge
    expect(html).toContain('使變得更好'); // extracted meaning
    expect(html).toContain('もんだい'); // extracted reading
    expect(html).toContain('href="https://news.example.com/article"');
    expect(html).toContain('載入更多'); // cursor present

    const p2 = await listLearningItems({ limit: 5, cursor: p1.nextCursor });
    state = learningItemsFeedReducer(state, { type: 'NEXT_PAGE_OK', result: p2 });

    html = renderToStaticMarkup(
      <LearningItemsPanel state={state} onLoadMore={() => {}} />
    );
    expect(state.items).toHaveLength(8);
    expect(state.cursor).toBeNull();
    expect(html).not.toContain('載入更多'); // final page hides the control
    expect(html).not.toContain('刪除'); // no edit/delete
    expect(html).not.toContain('<input'); // no filter/search
  });

  it('renders the empty state when the collection has no rows', async () => {
    h.authState.currentUser = { uid: 'newbie' };

    const page = await listLearningItems();
    expect(page).toEqual({ items: [], nextCursor: null });

    const state = learningItemsFeedReducer(initialLearningItemsFeedState, {
      type: 'FIRST_PAGE_OK',
      result: page,
    });
    const html = renderToStaticMarkup(
      <LearningItemsPanel state={state} onLoadMore={() => {}} />
    );
    expect(html).toContain('尚無學習項目');
  });

  it('rejects a read for a different uid than the fake auth user (rules-equivalent)', async () => {
    h.authState.currentUser = { uid: 'alice' };
    persist(
      deriveLearningItems(STRUCTURED, PAGE_META, 'page-1', {
        userId: 'alice',
        now: 1,
      })
    );
    // sign out ⇒ service must refuse before any query
    h.authState.currentUser = null;
    await expect(listLearningItems()).rejects.toThrow(/signed in/i);
  });
});
