/* @vitest-environment jsdom */

import { act, useState } from 'react';
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

// P3.4 / P4.4 — per-card "加入複習" action, driven by a shared reviewedKeys set.
describe('LearningItemsPanel — 加入複習 / 已加入複習', () => {
  const KEY = 'vocab|改善|かいぜん';

  // A stateful wrapper that mimics app/page.tsx: it holds `reviewedKeys` and,
  // on a successful add, records the item's lexicalKey (mirroring
  // `handleAddToReview`).
  function mount(
    state: LearningItemsFeedState,
    opts: {
      onAddToReview?: (item: LearningItem) => Promise<unknown>;
      initialReviewedKeys?: string[];
      reviewKeysLoading?: boolean;
      reviewKeysError?: boolean;
    } = {}
  ) {
    const container = document.createElement('div');
    const root = createRoot(container);
    const onAdd =
      opts.onAddToReview ?? ((it: LearningItem) => Promise.resolve(it));

    function Harness() {
      const [reviewedKeys, setReviewedKeys] = useState<ReadonlySet<string>>(
        () => new Set(opts.initialReviewedKeys ?? [])
      );
      const handleAdd = async (it: LearningItem) => {
        const r = await onAdd(it);
        setReviewedKeys((prev) => new Set(prev).add(it.lexicalKey));
        return r;
      };
      return (
        <LearningItemsPanel
          state={state}
          onLoadMore={() => {}}
          onAddToReview={handleAdd}
          reviewedKeys={reviewedKeys}
          reviewKeysLoading={opts.reviewKeysLoading}
          reviewKeysError={opts.reviewKeysError}
        />
      );
    }

    const addButtons = () =>
      [...container.querySelectorAll('button')].filter(
        (b) => b.textContent === '加入複習'
      );
    return {
      container,
      addButtons,
      async render() {
        await act(async () => {
          root.render(<Harness />);
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
      doneCount() {
        return (container.textContent?.match(/已加入複習/g) ?? []).length;
      },
      unmount() {
        act(() => root.unmount());
      },
    };
  }

  const twoDup = ready(
    [item({ id: 'a', lexicalKey: KEY }), item({ id: 'b', lexicalKey: KEY })],
    { cursor: null }
  );

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('1/2. a reviewed key renders 已加入複習 and no 加入複習 button', async () => {
    const m = mount(ready([item({ id: 'a', lexicalKey: KEY })]), {
      initialReviewedKeys: [KEY],
    });
    await m.render();
    expect(m.text()).toContain('已加入複習');
    expect(m.addButtons()).toHaveLength(0);
    m.unmount();
  });

  it('3. an unreviewed key shows the 加入複習 button', async () => {
    const m = mount(ready([item({ id: 'a', lexicalKey: KEY })]), {
      initialReviewedKeys: [],
    });
    await m.render();
    expect(m.addButtons()).toHaveLength(1);
    expect(m.text()).not.toContain('已加入複習');
    m.unmount();
  });

  it('4. duplicate lexicalKey + reviewed → both cards show 已加入複習', async () => {
    const m = mount(twoDup, { initialReviewedKeys: [KEY] });
    await m.render();
    expect(m.doneCount()).toBe(2);
    expect(m.addButtons()).toHaveLength(0);
    m.unmount();
  });

  it('5. duplicate lexicalKey + unreviewed → both cards show the button', async () => {
    const m = mount(twoDup, { initialReviewedKeys: [] });
    await m.render();
    expect(m.addButtons()).toHaveLength(2);
    m.unmount();
  });

  it('6. a successful add invokes the callback with that exact item', async () => {
    const onAdd = vi.fn((it: LearningItem) => Promise.resolve(it));
    const m = mount(twoDup, { onAddToReview: onAdd });
    await m.render();
    await m.clickAdd(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].id).toBe('b');
    m.unmount();
  });

  it('7/8. clicking ONE duplicate flips BOTH occurrences to 已加入複習 (no reload)', async () => {
    const m = mount(twoDup, {});
    await m.render();
    expect(m.addButtons()).toHaveLength(2);

    await m.clickAdd(0);

    expect(m.addButtons()).toHaveLength(0);
    expect(m.doneCount()).toBe(2);
    m.unmount();
  });

  it('11. an add in flight disables EVERY button for that lexicalKey', async () => {
    let resolve!: () => void;
    const onAdd = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const m = mount(twoDup, { onAddToReview: onAdd });
    await m.render();

    await m.clickAdd(0);
    expect(m.addButtons().every((b) => b.disabled)).toBe(true);

    await act(async () => {
      resolve();
    });
    m.unmount();
  });

  it('a pending add for a DIFFERENT key does not disable this key\'s button', async () => {
    let resolve!: () => void;
    const onAdd = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const m = mount(
      ready(
        [
          item({ id: 'a', lexicalKey: 'vocab|改善|' }),
          item({ id: 'b', lexicalKey: 'vocab|問題|' }),
        ],
        { cursor: null }
      ),
      { onAddToReview: onAdd }
    );
    await m.render();
    await m.clickAdd(0);
    const btns = m.addButtons();
    expect(btns[0].disabled).toBe(true);
    expect(btns[1].disabled).toBe(false);
    await act(async () => {
      resolve();
    });
    m.unmount();
  });

  it('9/10. a failed add does not mark reviewed and can be retried', async () => {
    const onAdd = vi
      .fn()
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValueOnce(undefined);
    const m = mount(twoDup, { onAddToReview: onAdd });
    await m.render();

    await m.clickAdd(0);
    expect(m.text()).toContain('加入失敗，請再試一次');
    expect(m.text()).not.toMatch(/permission-denied/);
    expect(m.text()).not.toContain('已加入複習');
    expect(m.addButtons()).toHaveLength(2);

    await m.clickAdd(0); // retry
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(m.doneCount()).toBe(2);
    m.unmount();
  });

  it('§7: hides add controls while reviewedKeys is loading (content still renders)', async () => {
    const m = mount(ready([item({ id: 'a', lexicalKey: KEY })]), {
      reviewKeysLoading: true,
    });
    await m.render();
    expect(m.addButtons()).toHaveLength(0);
    expect(m.text()).not.toContain('已加入複習');
    expect(m.text()).toContain('使變得更好'); // the item content is still shown
    m.unmount();
  });

  it('§7: on reviewedKeys load failure, shows the button + a generic warning', async () => {
    const m = mount(ready([item({ id: 'a', lexicalKey: KEY })]), {
      reviewKeysError: true,
    });
    await m.render();
    expect(m.text()).toContain('無法載入複習狀態');
    expect(m.addButtons()).toHaveLength(1);
    m.unmount();
  });

  it('13. introduces no edit / delete / bulk-add controls', async () => {
    const m = mount(twoDup, {});
    await m.render();
    expect(m.text()).not.toContain('刪除');
    expect(m.text()).not.toContain('編輯');
    expect(m.text()).not.toContain('全部加入');
    m.unmount();
  });
});
