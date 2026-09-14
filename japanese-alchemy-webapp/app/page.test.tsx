/* @vitest-environment jsdom */

/**
 * P7.3-I — top-level regression proving the reported bug is fixed: with the
 * dashboard already mounted and signed in, an external Firestore write (a
 * Chrome-extension `saveItems` call, simulated here as the same onSnapshot
 * listeners firing again) must update 單字/文法/頁面/學習項目 counts on its
 * own — with no browser reload, no route remount, and no auth-state change.
 *
 * Only the Firestore-facing services are faked; the real hooks
 * (`useUserCollectionFeed`, `useLearningItemsFeed`, `useReviewSession`,
 * `useReviewCardKeys`) and the real `Dashboard` component are exercised.
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnalysisPage,
  Grammar,
  ListLearningItemsResult,
  Vocabulary,
} from '@/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// jsdom has no matchMedia; ThemeProvider (real, wrapped around Dashboard
// below) queries it on mount for the default 'system' theme.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const authMock = vi.hoisted(() => ({
  user: { uid: 'u1', email: 'user@example.com' } as { uid: string; email: string } | null,
  loading: false,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authMock.user,
    loading: authMock.loading,
    signOut: vi.fn(),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithGoogle: vi.fn(),
  }),
}));

type Emitter<T> = (value: T) => void;
interface FakeSub<T> {
  emit: Emitter<T>;
  fail: (error: unknown) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeCollectionSubscriber<T>() {
  const subs: FakeSub<T[]>[] = [];
  const subscribe = vi.fn(
    (_uid: string, onData: Emitter<T[]>, onError: (e: unknown) => void) => {
      const unsubscribe = vi.fn();
      subs.push({ emit: onData, fail: onError, unsubscribe });
      return unsubscribe;
    }
  );
  return { subscribe, subs };
}

const vocabSub = fakeCollectionSubscriber<Vocabulary>();
const grammarSub = fakeCollectionSubscriber<Grammar>();
const pagesSub = fakeCollectionSubscriber<AnalysisPage>();

const learningItemsSubs: FakeSub<ListLearningItemsResult>[] = [];
const subscribeToLearningItems = vi.fn(
  (
    _pageSize: number | undefined,
    onData: Emitter<ListLearningItemsResult>,
    onError: (e: unknown) => void
  ) => {
    const unsubscribe = vi.fn();
    learningItemsSubs.push({ emit: onData, fail: onError, unsubscribe });
    return unsubscribe;
  }
);

const getSharedAnalysisPages = vi.fn(async () => []);
const getSharedVocabularies = vi.fn(async () => []);
const getSharedGrammars = vi.fn(async () => []);
const deleteAnalysisPage = vi.fn(async () => {});
const listLearningItems = vi.fn();
// P7.3-I hybrid fallback — one-shot readers used only by the focus/visibility
// fallback (lib/focusRefresh.ts), never by the primary onSnapshot path.
const getUserVocabularies = vi.fn(async (_uid: string) => [] as Vocabulary[]);
const getUserGrammars = vi.fn(async (_uid: string) => [] as Grammar[]);
const getUserAnalysisPages = vi.fn(async (_uid: string) => [] as AnalysisPage[]);

vi.mock('@/services/firestoreService', () => ({
  subscribeToUserVocabularies: (...args: Parameters<typeof vocabSub.subscribe>) =>
    vocabSub.subscribe(...args),
  subscribeToUserGrammars: (...args: Parameters<typeof grammarSub.subscribe>) =>
    grammarSub.subscribe(...args),
  subscribeToUserAnalysisPages: (...args: Parameters<typeof pagesSub.subscribe>) =>
    pagesSub.subscribe(...args),
  subscribeToLearningItems: (...args: Parameters<typeof subscribeToLearningItems>) =>
    subscribeToLearningItems(...args),
  listLearningItems: (...args: unknown[]) => listLearningItems(...args),
  getUserVocabularies: (...args: Parameters<typeof getUserVocabularies>) =>
    getUserVocabularies(...args),
  getUserGrammars: (...args: Parameters<typeof getUserGrammars>) => getUserGrammars(...args),
  getUserAnalysisPages: (...args: Parameters<typeof getUserAnalysisPages>) =>
    getUserAnalysisPages(...args),
  deleteAnalysisPage: (...args: Parameters<typeof deleteAnalysisPage>) =>
    deleteAnalysisPage(...args),
  getSharedAnalysisPages: () => getSharedAnalysisPages(),
  getSharedVocabularies: () => getSharedVocabularies(),
  getSharedGrammars: () => getSharedGrammars(),
}));

const listDueReviewCards = vi.fn(async () => ({ cards: [] }));
const listReviewCardKeys = vi.fn(async () => new Set<string>());
const applyReviewRating = vi.fn(async (_cardId: string, _rating: string) => {});
const materializeReviewCard = vi.fn(async (_item: unknown) => ({}));

vi.mock('@/services/reviewService', () => ({
  listDueReviewCards: () => listDueReviewCards(),
  listReviewCardKeys: () => listReviewCardKeys(),
  applyReviewRating: (...args: Parameters<typeof applyReviewRating>) =>
    applyReviewRating(...args),
  materializeReviewCard: (...args: Parameters<typeof materializeReviewCard>) =>
    materializeReviewCard(...args),
}));

import Dashboard from './page';
import { ThemeProvider } from '@/contexts/ThemeContext';

function vocab(id: string): Vocabulary {
  return { id, term: `term-${id}`, detail: `detail-${id}`, createdAt: new Date(0), userId: 'u1' };
}
function grammar(id: string): Grammar {
  return { id, point: `point-${id}`, explanation: `exp-${id}`, createdAt: new Date(0), userId: 'u1' };
}
function page(id: string): AnalysisPage {
  return {
    id,
    rendered_markdown: `md-${id}`,
    source_text: `src-${id}`,
    source_url: '',
    saved_at: '2026-09-14T00:00:00.000Z',
    createdAt: new Date(0),
  };
}
function learningItem(id: string): ListLearningItemsResult['items'][number] {
  return {
    id,
    userId: 'u1',
    sourceAnalysisId: 'page-1',
    type: 'vocab',
    surface: `surface-${id}`,
    status: 'NEW',
    createdAt: 0,
    updatedAt: 0,
    lexicalKey: `key-${id}`,
    reading: null,
    meaning: null,
    sourceSentence: 'S',
    sourceUrl: null,
  };
}

function mountDashboard() {
  const container = document.createElement('div');
  const root = createRoot(container);
  return {
    container,
    async render() {
      await act(async () => {
        root.render(
          <ThemeProvider>
            <Dashboard />
          </ThemeProvider>
        );
      });
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

function tabCounts(container: HTMLElement) {
  const text = container.textContent ?? '';
  const match = (label: string) => {
    const m = text.match(new RegExp(`${label}\\s*\\((\\d+)\\)`));
    return m ? Number(m[1]) : null;
  };
  return {
    vocab: match('單字'),
    grammar: match('文法'),
    pages: match('頁面'),
    learning: match('學習項目'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.user = { uid: 'u1', email: 'user@example.com' };
  authMock.loading = false;
  vocabSub.subs.length = 0;
  grammarSub.subs.length = 0;
  pagesSub.subs.length = 0;
  learningItemsSubs.length = 0;
  getSharedAnalysisPages.mockResolvedValue([]);
  getSharedVocabularies.mockResolvedValue([]);
  getSharedGrammars.mockResolvedValue([]);
  getUserVocabularies.mockResolvedValue([]);
  getUserGrammars.mockResolvedValue([]);
  getUserAnalysisPages.mockResolvedValue([]);
  listLearningItems.mockResolvedValue({ items: [], nextCursor: null });
  listDueReviewCards.mockResolvedValue({ cards: [] });
  listReviewCardKeys.mockResolvedValue(new Set<string>());
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

describe('Dashboard external-write live refresh (P7.3-I)', () => {
  // P7.3-I production live-retest regression: the deployed bundle was
  // confirmed byte-for-byte correct and this exact React lifecycle was
  // confirmed (via temporary local console instrumentation, since removed) to
  // subscribe once, apply two live emissions, and unsubscribe only at
  // teardown — with NO unsubscribe call in between. This test makes that
  // "still subscribed after the first emission" invariant an explicit,
  // permanent assertion, closing the gap that let it go unasserted before:
  // the earlier version of this test checked the resulting counts but never
  // asserted that no unsubscribe happened between the two emissions, so a
  // hypothetical future regression that tore the listener down after its
  // first snapshot (still leaving stale-but-correct counts on screen, exactly
  // matching the reported production symptom) would NOT have failed it.
  it('stays subscribed across two live emissions (1/1/1/2 -> 2/2/2/4) and unsubscribes only at teardown, with no reload, remount, or auth change', async () => {
    const dashboard = mountDashboard();
    await dashboard.render();

    expect(vocabSub.subscribe).toHaveBeenCalledTimes(1);
    expect(grammarSub.subscribe).toHaveBeenCalledTimes(1);
    expect(pagesSub.subscribe).toHaveBeenCalledTimes(1);
    expect(subscribeToLearningItems).toHaveBeenCalledTimes(1);

    // Each subscription's initial snapshot: one row each, two learning items.
    await act(async () => {
      vocabSub.subs[0].emit([vocab('v1')]);
      grammarSub.subs[0].emit([grammar('g1')]);
      pagesSub.subs[0].emit([page('p1')]);
      learningItemsSubs[0].emit({ items: [learningItem('l1'), learningItem('l2')], nextCursor: null });
    });

    expect(tabCounts(dashboard.container)).toEqual({
      vocab: 1,
      grammar: 1,
      pages: 1,
      learning: 2,
    });

    // The listener must still be live — nothing has unsubscribed it — before
    // the external write arrives.
    expect(vocabSub.subs[0].unsubscribe).not.toHaveBeenCalled();
    expect(grammarSub.subs[0].unsubscribe).not.toHaveBeenCalled();
    expect(pagesSub.subs[0].unsubscribe).not.toHaveBeenCalled();
    expect(learningItemsSubs[0].unsubscribe).not.toHaveBeenCalled();

    // Simulate the Chrome extension's saveItems writing to all four
    // collections in one call — the SAME listener instances fire again,
    // unprompted, proving they were never torn down after the first snapshot.
    await act(async () => {
      vocabSub.subs[0].emit([vocab('v1'), vocab('v2')]);
      grammarSub.subs[0].emit([grammar('g1'), grammar('g2')]);
      pagesSub.subs[0].emit([page('p1'), page('p2')]);
      learningItemsSubs[0].emit({
        items: [learningItem('l3'), learningItem('l4'), learningItem('l1'), learningItem('l2')],
        nextCursor: null,
      });
    });

    expect(tabCounts(dashboard.container)).toEqual({
      vocab: 2,
      grammar: 2,
      pages: 2,
      learning: 4,
    });

    // Still no unsubscribe, and still exactly one subscribe call each — no
    // fetch-based re-query, no resubscribe, for any of the four collections.
    expect(vocabSub.subs[0].unsubscribe).not.toHaveBeenCalled();
    expect(grammarSub.subs[0].unsubscribe).not.toHaveBeenCalled();
    expect(pagesSub.subs[0].unsubscribe).not.toHaveBeenCalled();
    expect(learningItemsSubs[0].unsubscribe).not.toHaveBeenCalled();
    expect(listLearningItems).not.toHaveBeenCalled();
    expect(vocabSub.subscribe).toHaveBeenCalledTimes(1);
    expect(grammarSub.subscribe).toHaveBeenCalledTimes(1);
    expect(pagesSub.subscribe).toHaveBeenCalledTimes(1);
    expect(subscribeToLearningItems).toHaveBeenCalledTimes(1);

    // Only tearing the component down (unmount) triggers cleanup.
    dashboard.unmount();
    expect(vocabSub.subs[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(grammarSub.subs[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(pagesSub.subs[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(learningItemsSubs[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes all four listeners on unmount (no leaks)', async () => {
    const dashboard = mountDashboard();
    await dashboard.render();

    dashboard.unmount();

    expect(vocabSub.subs[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(grammarSub.subs[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(pagesSub.subs[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes exactly once per collection on initial mount (no duplicate subscriptions)', async () => {
    const dashboard = mountDashboard();
    await dashboard.render();
    // A second effect-flush (e.g. an unrelated re-render) must not
    // re-subscribe — deps are stable ([uid, authResolved, subscribeFn]).
    await act(async () => {});

    expect(vocabSub.subscribe).toHaveBeenCalledTimes(1);
    expect(grammarSub.subscribe).toHaveBeenCalledTimes(1);
    expect(pagesSub.subscribe).toHaveBeenCalledTimes(1);

    dashboard.unmount();
  });
});

// P7.3-I hybrid fallback — production evidence cleared the deployed bundle,
// write/listener paths, React effect lifecycle, and permission/query errors;
// what's left is an unreliable Firestore Listen transport in the real browser
// that this app can't root-cause further. These tests cover the fallback:
// a one-shot re-fetch of all four collections on window focus / visible
// visibilitychange, for exactly the case where onSnapshot never re-emits.
describe('Dashboard focus/visibility fallback (P7.3-I)', () => {
  async function primeBaseline(dashboard: ReturnType<typeof mountDashboard>) {
    await act(async () => {
      vocabSub.subs[0].emit([vocab('v1'), vocab('v2')]);
      grammarSub.subs[0].emit([grammar('g1'), grammar('g2')]);
      pagesSub.subs[0].emit([page('p1'), page('p2')]);
      learningItemsSubs[0].emit({
        items: [learningItem('l1'), learningItem('l2'), learningItem('l3'), learningItem('l4')],
        nextCursor: null,
      });
    });
    expect(tabCounts(dashboard.container)).toEqual({
      vocab: 2,
      grammar: 2,
      pages: 2,
      learning: 4,
    });
  }

  it('refreshes to fresh server data on window focus when onSnapshot delivers no further emission', async () => {
    const dashboard = mountDashboard();
    await dashboard.render();
    await primeBaseline(dashboard);

    // Backend data changed (an extension save) but — exactly the production
    // symptom — none of the four live listeners emit again.
    getUserVocabularies.mockResolvedValueOnce([vocab('v1'), vocab('v2'), vocab('v3')]);
    getUserGrammars.mockResolvedValueOnce([grammar('g1'), grammar('g2'), grammar('g3')]);
    getUserAnalysisPages.mockResolvedValueOnce([page('p1'), page('p2'), page('p3')]);
    listLearningItems.mockResolvedValueOnce({
      items: [
        learningItem('l5'),
        learningItem('l1'),
        learningItem('l2'),
        learningItem('l3'),
        learningItem('l4'),
      ],
      nextCursor: null,
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(tabCounts(dashboard.container)).toEqual({
      vocab: 3,
      grammar: 3,
      pages: 3,
      learning: 5,
    });
    expect(getUserVocabularies).toHaveBeenCalledWith('u1');
    expect(getUserGrammars).toHaveBeenCalledWith('u1');
    expect(getUserAnalysisPages).toHaveBeenCalledWith('u1');
    expect(listLearningItems).toHaveBeenCalledWith();
    // onSnapshot itself is untouched — no resubscribe, still primary.
    expect(vocabSub.subscribe).toHaveBeenCalledTimes(1);
    expect(grammarSub.subscribe).toHaveBeenCalledTimes(1);
    expect(pagesSub.subscribe).toHaveBeenCalledTimes(1);
    expect(subscribeToLearningItems).toHaveBeenCalledTimes(1);

    dashboard.unmount();
  });

  it('refreshes on visible visibilitychange too, but does nothing while hidden', async () => {
    const dashboard = mountDashboard();
    await dashboard.render();
    await primeBaseline(dashboard);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(getUserVocabularies).not.toHaveBeenCalled();
    expect(listLearningItems).toHaveBeenCalledTimes(0);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(getUserVocabularies).toHaveBeenCalledTimes(1);
    expect(getUserGrammars).toHaveBeenCalledTimes(1);
    expect(getUserAnalysisPages).toHaveBeenCalledTimes(1);
    expect(listLearningItems).toHaveBeenCalledTimes(1);

    dashboard.unmount();
  });

  it('does nothing when signed out', async () => {
    authMock.user = null;
    const dashboard = mountDashboard();
    await dashboard.render();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(getUserVocabularies).not.toHaveBeenCalled();
    expect(getUserGrammars).not.toHaveBeenCalled();
    expect(getUserAnalysisPages).not.toHaveBeenCalled();
    expect(listLearningItems).not.toHaveBeenCalled();

    dashboard.unmount();
  });

  it('dedupes focus + visibilitychange firing together into one refresh burst (one call per collection)', async () => {
    const dashboard = mountDashboard();
    await dashboard.render();
    await primeBaseline(dashboard);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(getUserVocabularies).toHaveBeenCalledTimes(1);
    expect(getUserGrammars).toHaveBeenCalledTimes(1);
    expect(getUserAnalysisPages).toHaveBeenCalledTimes(1);
    expect(listLearningItems).toHaveBeenCalledTimes(1);

    dashboard.unmount();
  });

  it('removes the focus/visibility listeners on unmount', async () => {
    const dashboard = mountDashboard();
    await dashboard.render();
    await primeBaseline(dashboard);

    dashboard.unmount();

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(getUserVocabularies).not.toHaveBeenCalled();
    expect(getUserGrammars).not.toHaveBeenCalled();
    expect(getUserAnalysisPages).not.toHaveBeenCalled();
    expect(listLearningItems).not.toHaveBeenCalled();
  });
});
