/* @vitest-environment jsdom */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The panel is pure/presentational, but importing the feed module transitively
// pulls in the Firestore service and its Firebase init. Stub that boundary the
// same way services/firestoreService.test.ts does.
vi.mock('@/lib/firebase', () => ({ db: {}, auth: { currentUser: null } }));

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
});
