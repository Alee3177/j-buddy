/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The panel is pure/presentational, but importing the feed module transitively
// pulls in the Firestore service and its Firebase init. Stub that boundary the
// same way services/firestoreService.test.ts does.
vi.mock('@/lib/firebase', () => ({ db: {}, auth: { currentUser: null } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { LearningItemsPanel } from './LearningItemsPanel';
import { initialLearningItemsFeedState, type LearningItemsFeedState } from '@/lib/learningItemsFeed';
import type { LearningItem } from '@/types';

function item(overrides: Partial<LearningItem> = {}): LearningItem {
  return {
    id: 'id-1',
    userId: 'me',
    sourceAnalysisId: 'page-1',
    type: 'vocab',
    surface: '{改善|かいぜん}',
    status: 'NEW',
    createdAt: Date.parse('2026-09-01T00:00:00.000Z'),
    updatedAt: Date.parse('2026-09-01T00:00:00.000Z'),
    lexicalKey: 'vocab|改善|かいぜん',
    reading: 'かいぜん',
    meaning: '使變得更好',
    sourceSentence: '制度を{改善|かいぜん}する。',
    sourceUrl: null,
    ...overrides,
  };
}

function ready(
  items: LearningItem[],
  extra: Partial<LearningItemsFeedState> = {}
): LearningItemsFeedState {
  return {
    phase: 'ready',
    items,
    cursor: null,
    loadingMore: false,
    loadMoreFailed: false,
    ...extra,
  };
}

const render = (state: LearningItemsFeedState) =>
  renderToStaticMarkup(
    <LearningItemsPanel state={state} onLoadMore={() => {}} />
  );

describe('LearningItemsPanel', () => {
  it('renders the loading state', () => {
    const html = render(initialLearningItemsFeedState);
    expect(html).toContain('載入中...');
  });

  it('renders the error state without leaking Firestore details', () => {
    const html = render({ ...initialLearningItemsFeedState, phase: 'error' });
    expect(html).toContain('無法載入學習項目');
    expect(html).not.toMatch(/firestore|firebase|permission-denied/i);
  });

  it('renders the empty state', () => {
    const html = render(ready([]));
    expect(html).toContain('尚無學習項目');
  });

  it('renders a vocabulary occurrence with type badge, reading and meaning', () => {
    const html = render(ready([item({ id: 'v1', type: 'vocab' })]));
    expect(html).toContain('單字');
    expect(html).toContain('かいぜん');
    expect(html).toContain('使變得更好');
    // ruby markup is rendered, not shown literally
    expect(html).toContain('<ruby>');
    expect(html).not.toContain('{改善|かいぜん}');
  });

  it('renders a grammar occurrence', () => {
    const html = render(
      ready([
        item({
          id: 'g1',
          type: 'grammar',
          surface: '〜ても',
          reading: null,
          meaning: null,
        }),
      ])
    );
    expect(html).toContain('文法');
    expect(html).toContain('〜ても');
  });

  it('handles a null reading (nothing rendered for it)', () => {
    const html = render(
      ready([item({ id: 'x', reading: null, meaning: '意味', sourceSentence: '' })])
    );
    expect(html).toContain('意味');
    expect(html).not.toContain('null');
  });

  it('handles a null meaning (nothing rendered for it)', () => {
    const html = render(
      ready([item({ id: 'x', reading: 'よみ', meaning: null, sourceSentence: '' })])
    );
    expect(html).toContain('よみ');
    expect(html).not.toContain('null');
  });

  it('keeps both occurrences of a duplicated lexicalKey visible', () => {
    const html = render(
      ready([
        item({ id: 'occ-1', lexicalKey: 'vocab|改善|かいぜん', meaning: '解釋 A' }),
        item({ id: 'occ-2', lexicalKey: 'vocab|改善|かいぜん', meaning: '解釋 B' }),
      ])
    );
    expect(html).toContain('解釋 A');
    expect(html).toContain('解釋 B');
  });

  it('shows 載入更多 when a cursor exists and hides it when null', () => {
    expect(render(ready([item()], { cursor: 'more' }))).toContain('載入更多');
    expect(render(ready([item()], { cursor: null }))).not.toContain('載入更多');
  });

  it('disables 載入更多 while a page request is pending', () => {
    const html = render(ready([item()], { cursor: 'more', loadingMore: true }));
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('surfaces a load-more failure hint while keeping items', () => {
    const html = render(
      ready([item({ id: 'kept' })], { cursor: 'more', loadMoreFailed: true })
    );
    expect(html).toContain('載入更多時發生錯誤');
    expect(html).toContain('<ruby>'); // the kept item is still rendered
  });

  it('renders no edit / delete controls', () => {
    const html = render(ready([item(), item({ id: 'id-2' })], { cursor: null }));
    expect(html).not.toContain('刪除');
    expect(html).not.toContain('編輯');
    expect(html).not.toContain('<button'); // no cursor ⇒ not even Load More
  });

  it('renders no kind filter or search UI', () => {
    const html = render(ready([item()], { cursor: 'more' }));
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('搜尋');
    expect(html).not.toContain('篩選');
  });

  it('does not crash when sourceUrl is absent and never renders sourceAnalysisId', () => {
    const html = render(
      ready([item({ id: 'x', sourceUrl: null, sourceAnalysisId: 'page-SECRET' })])
    );
    expect(html).not.toContain('page-SECRET');
    expect(html).not.toContain('來源');
  });

  it('renders a safe external source link and rejects a non-http(s) URL', () => {
    const ok = render(ready([item({ id: 'a', sourceUrl: 'https://example.com/x' })]));
    expect(ok).toContain('href="https://example.com/x"');
    expect(ok).toContain('rel="noopener noreferrer"');

    const bad = render(
      ready([item({ id: 'b', sourceUrl: 'javascript:alert(1)' })])
    );
    expect(bad).not.toContain('來源');
    expect(bad).not.toContain('javascript:alert');
  });

  it('renders no 加入複習 button when onAddToReview is not provided (unchanged P2.2 behavior)', () => {
    const html = render(ready([item(), item({ id: 'id-2' })], { cursor: null }));
    expect(html).not.toContain('加入複習');
    expect(html).not.toContain('<button');
  });
});

// P3.4 — per-card "加入複習" action.
describe('LearningItemsPanel — 加入複習', () => {
  function mount(
    state: LearningItemsFeedState,
    onAddToReview: (item: LearningItem) => Promise<unknown>
  ) {
    const container = document.createElement('div');
    const root = createRoot(container);
    const addButtons = () =>
      [...container.querySelectorAll('button')].filter((b) =>
        b.textContent?.startsWith('加入複習')
      );
    return {
      container,
      addButtons,
      async render() {
        await act(async () => {
          root.render(
            <LearningItemsPanel
              state={state}
              onLoadMore={() => {}}
              onAddToReview={onAddToReview}
            />
          );
        });
      },
      async clickAdd(index: number) {
        const btn = addButtons()[index];
        await act(async () => {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      },
      text() {
        return container.textContent ?? '';
      },
      unmount() {
        act(() => root.unmount());
      },
    };
  }

  const twoItems = ready([item({ id: 'a' }), item({ id: 'b' })], { cursor: null });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one 加入複習 button per card', async () => {
    const m = mount(twoItems, async () => {});
    await m.render();
    expect(m.addButtons()).toHaveLength(2);
    m.unmount();
  });

  it('clicking calls materializeReviewCard with that exact item', async () => {
    const onAdd = vi.fn((item: LearningItem) => Promise.resolve(item));
    const m = mount(twoItems, onAdd);
    await m.render();
    await m.clickAdd(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].id).toBe('b');
    m.unmount();
  });

  it('disables only the clicked card\'s button while its request is pending', async () => {
    let resolve!: () => void;
    const onAdd = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const m = mount(twoItems, onAdd);
    await m.render();
    await m.clickAdd(0);

    const [b0, b1] = m.addButtons();
    expect(b0.disabled).toBe(true);
    expect(b1.disabled).toBe(false);

    await act(async () => {
      resolve();
    });
    m.unmount();
  });

  it('shows 已加入複習 after a successful add', async () => {
    const m = mount(twoItems, async () => {});
    await m.render();
    await m.clickAdd(0);
    expect(m.text()).toContain('已加入複習');
    m.unmount();
  });

  it('shows a generic failure hint and allows retry after a failed add', async () => {
    const onAdd = vi
      .fn()
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValueOnce(undefined);
    const m = mount(twoItems, onAdd);
    await m.render();

    await m.clickAdd(0);
    expect(m.text()).toContain('加入失敗，請再試一次');
    expect(m.text()).not.toMatch(/permission-denied/);

    await m.clickAdd(0); // retry
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(m.text()).toContain('已加入複習');
    m.unmount();
  });

  it('does not introduce edit / delete / bulk-add controls', async () => {
    const m = mount(twoItems, async () => {});
    await m.render();
    expect(m.text()).not.toContain('刪除');
    expect(m.text()).not.toContain('編輯');
    expect(m.text()).not.toContain('全部加入');
  });
});
