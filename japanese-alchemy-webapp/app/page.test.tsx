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

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'user@example.com' },
    loading: false,
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
  vocabSub.subs.length = 0;
  grammarSub.subs.length = 0;
  pagesSub.subs.length = 0;
  learningItemsSubs.length = 0;
  getSharedAnalysisPages.mockResolvedValue([]);
  getSharedVocabularies.mockResolvedValue([]);
  getSharedGrammars.mockResolvedValue([]);
  listDueReviewCards.mockResolvedValue({ cards: [] });
  listReviewCardKeys.mockResolvedValue(new Set<string>());
});

describe('Dashboard external-write live refresh (P7.3-I)', () => {
  it('updates 單字/文法/頁面/學習項目 counts live (1/1/1/2 -> 2/2/2/4) with no reload, remount, or auth change', async () => {
    const dashboard = mountDashboard();
    await dashboard.render();

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

    // Simulate the Chrome extension's saveItems writing to all four
    // collections in one call — the SAME listeners fire again, unprompted.
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

    // No fetch-based re-query was needed for any of the four collections.
    expect(listLearningItems).not.toHaveBeenCalled();
    expect(vocabSub.subscribe).toHaveBeenCalledTimes(1);
    expect(grammarSub.subscribe).toHaveBeenCalledTimes(1);
    expect(pagesSub.subscribe).toHaveBeenCalledTimes(1);
    expect(subscribeToLearningItems).toHaveBeenCalledTimes(1);

    dashboard.unmount();
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
