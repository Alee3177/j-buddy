/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase', () => ({ db: {}, auth: { currentUser: null } }));

import { ReviewPanel } from './ReviewPanel';
import { RATING, newReviewCard } from '@/lib/reviewCard';
import {
  initialReviewSessionState,
  type ReviewSession,
  type ReviewSessionState,
} from '@/lib/reviewSession';
import type { LearningItem, ReviewCard } from '@/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** default card: PLAIN surface (no furigana) so the reading only appears when
 *  the panel deliberately renders the reading line. */
function reviewCard(overrides: Partial<ReviewCard> = {}): ReviewCard {
  const item: LearningItem = {
    id: 'li-1',
    userId: 'u',
    sourceAnalysisId: 'page-1',
    type: 'vocab',
    surface: '改善',
    status: 'NEW',
    createdAt: 0,
    updatedAt: 0,
    lexicalKey: 'vocab|改善|かいぜん',
    reading: 'かいぜん',
    meaning: '使變得更好',
    sourceSentence: '制度を改善する。',
    sourceUrl: 'https://example.com/a',
  };
  return { ...newReviewCard(item, 'u', 0), ...overrides };
}

function session(
  state: Partial<ReviewSessionState>,
  actions: Partial<Pick<ReviewSession, 'reveal' | 'rate'>> = {}
): ReviewSession {
  const full: ReviewSessionState = { ...initialReviewSessionState, ...state };
  const currentCard = full.cards[full.currentIndex] ?? null;
  return {
    state: full,
    currentCard,
    remaining: Math.max(0, full.cards.length - full.currentIndex),
    reveal: actions.reveal ?? (() => {}),
    rate: actions.rate ?? (() => {}),
  };
}

/** Render to real DOM so button state / text are inspected structurally, not by
 *  string-matching HTML (Tailwind class names contain "disabled:"). */
function render(s: ReviewSession) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<ReviewPanel session={s} />);
  const buttons = [...container.querySelectorAll('button')];
  return {
    text: container.textContent ?? '',
    html: container.innerHTML,
    button: (label: string) => buttons.find((b) => b.textContent === label) ?? null,
    ratingButtons: () =>
      buttons.filter((b) => ['重來', '良好', '簡單'].includes(b.textContent ?? '')),
  };
}

describe('ReviewPanel — states', () => {
  it('1. loading text', () => {
    expect(render(session({ phase: 'loading' })).text).toContain('載入中...');
  });

  it('2. empty text when there is no current card', () => {
    expect(render(session({ phase: 'ready', cards: [] })).text).toContain(
      '今天沒有要複習的項目'
    );
  });

  it('3. initial-load error without leaking Firebase details', () => {
    const r = render(session({ phase: 'error' }));
    expect(r.text).toContain('無法載入複習項目');
    expect(r.text).not.toMatch(/firebase|firestore|permission-denied/i);
  });
});

describe('ReviewPanel — card front (not revealed)', () => {
  const front = () => render(session({ phase: 'ready', cards: [reviewCard()], revealed: false }));

  it('4. renders the surface as furigana ruby', () => {
    const r = render(
      session({
        phase: 'ready',
        revealed: false,
        cards: [reviewCard({ surface: '{改善|かいぜん}' })],
      })
    );
    expect(r.html).toContain('<ruby>');
    expect(r.text).not.toContain('{改善|かいぜん}');
  });

  it('5. renders a type badge', () => {
    expect(front().text).toContain('單字');
  });

  it('6/7/8. hides the reading / meaning / source sentence / source link before reveal', () => {
    const r = front();
    expect(r.text).not.toContain('かいぜん');
    expect(r.text).not.toContain('使變得更好');
    expect(r.text).not.toContain('制度');
    expect(r.html).not.toContain('href="https://example.com/a"');
  });

  it('9. shows the 顯示答案 button', () => {
    expect(front().button('顯示答案')).not.toBeNull();
  });

  it('17. rating buttons are disabled before reveal', () => {
    const btns = front().ratingButtons();
    expect(btns).toHaveLength(3);
    expect(btns.every((b) => b.disabled)).toBe(true);
  });
});

describe('ReviewPanel — revealed', () => {
  const revealed = (overrides: Partial<ReviewCard> = {}) =>
    render(session({ phase: 'ready', cards: [reviewCard(overrides)], revealed: true }));

  it('10/11/12. shows reading, meaning and source sentence after reveal', () => {
    const r = revealed();
    expect(r.text).toContain('かいぜん');
    expect(r.text).toContain('使變得更好');
    expect(r.text).toContain('制度');
  });

  it('13/14. renders an http(s) source link with safe rel', () => {
    expect(revealed({ sourceUrl: 'https://example.com/x' }).html).toContain(
      'href="https://example.com/x"'
    );
    expect(revealed({ sourceUrl: 'http://example.com/x' }).html).toContain(
      'rel="noopener noreferrer"'
    );
  });

  it('15/16. rejects javascript: and malformed source URLs', () => {
    expect(revealed({ sourceUrl: 'javascript:alert(1)' }).text).not.toContain('來源');
    expect(revealed({ sourceUrl: 'not a url' }).text).not.toContain('來源');
  });

  it('18. rating buttons enabled after reveal', () => {
    expect(revealed().ratingButtons().every((b) => b.disabled)).toBe(false);
  });

  it('19. rating buttons disabled while a rating mutation is pending', () => {
    const r = render(
      session({ phase: 'ready', cards: [reviewCard()], revealed: true, rating: true })
    );
    expect(r.ratingButtons().every((b) => b.disabled)).toBe(true);
  });

  it('23. shows a generic mutation-error message', () => {
    const r = render(
      session({ phase: 'ready', cards: [reviewCard()], revealed: true, mutationError: true })
    );
    expect(r.text).toContain('更新複習狀態時發生錯誤');
    expect(r.text).not.toMatch(/firebase|firestore/i);
  });

  it('24. never prints null for absent fields', () => {
    const r = revealed({ reading: null, meaning: null, sourceSentence: '', sourceUrl: null });
    expect(r.text).not.toContain('null');
    expect(r.text).not.toContain('來源');
  });

  it('25. a grammar card with null reading / meaning still renders', () => {
    const r = render(
      session({
        phase: 'ready',
        revealed: true,
        cards: [
          reviewCard({
            type: 'grammar',
            surface: '〜ても',
            reading: null,
            meaning: null,
            lexicalKey: 'grammar|〜ても|',
          }),
        ],
      })
    );
    expect(r.text).toContain('文法');
    expect(r.text).toContain('〜ても');
    expect(r.text).not.toContain('null');
  });

  it('26. shows the remaining count', () => {
    const r = render(
      session({ phase: 'ready', cards: [reviewCard(), reviewCard({ id: 'c2' })] })
    );
    expect(r.text).toContain('剩餘 2');
  });
});

describe('ReviewPanel — interactions', () => {
  function mount(s: ReviewSession) {
    const container = document.createElement('div');
    const root = createRoot(container);
    return {
      async render() {
        await act(async () => {
          root.render(<ReviewPanel session={s} />);
        });
      },
      click(text: string) {
        const btn = [...container.querySelectorAll('button')].find(
          (b) => b.textContent === text
        );
        if (!btn) throw new Error(`button not found: ${text}`);
        act(() => {
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      },
      unmount() {
        act(() => root.unmount());
      },
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('顯示答案 calls reveal()', async () => {
    const reveal = vi.fn();
    const m = mount(session({ phase: 'ready', cards: [reviewCard()], revealed: false }, { reveal }));
    await m.render();
    m.click('顯示答案');
    expect(reveal).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('20/21/22. 重來 / 良好 / 簡單 invoke rate() with 1 / 3 / 4', async () => {
    const rate = vi.fn();
    const m = mount(session({ phase: 'ready', cards: [reviewCard()], revealed: true }, { rate }));
    await m.render();
    m.click('重來');
    m.click('良好');
    m.click('簡單');
    expect(rate.mock.calls.map((c) => c[0])).toEqual([RATING.AGAIN, RATING.GOOD, RATING.EASY]);
    m.unmount();
  });
});
