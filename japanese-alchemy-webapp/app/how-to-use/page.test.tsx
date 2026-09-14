import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HowToUsePage from './page';

describe('How to Use page', () => {
  it('renders the page-level header and intro copy', () => {
    const html = renderToStaticMarkup(<HowToUsePage />);
    expect(html).toContain('如何使用 J-Buddy');
    expect(html).toContain(
      '從看到日文，到建立自己的學習內容與複習，只需要以下 4 個步驟。'
    );
  });

  it('renders a ← 回到 J-Buddy link to / near the top', () => {
    const html = renderToStaticMarkup(<HowToUsePage />);
    expect(html).toContain('← 回到 J-Buddy');
    const anchor = html.match(/<a[^>]*>[^<]*← 回到 J-Buddy[^<]*<\/a>/)?.[0] ?? '';
    expect(anchor).toContain('href="/"');
  });

  it('renders all four steps in order', () => {
    const html = renderToStaticMarkup(<HowToUsePage />);
    const indices = [
      'Step 1｜登入',
      'Step 2｜取得日文學習內容',
      'Step 3｜整理學習項目',
      'Step 4｜開始複習',
    ].map((label) => html.indexOf(label));

    expect(indices.every((i) => i > -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('states Google sign-in for step 1', () => {
    const html = renderToStaticMarkup(<HowToUsePage />);
    expect(html).toContain('使用 Google 帳號登入 J-Buddy。');
  });

  // P7.5 — the Extension is fully available in production (analyze + save +
  // share, all shipped and verified across P7.3/P7.4); step 2 must say so.
  it("describes step 2's Extension usage as available now, including sign-in for save/share", () => {
    const html = renderToStaticMarkup(<HowToUsePage />);
    expect(html).toContain(
      '你可以使用 J-Buddy Chrome Extension，在日文網站選取文字並進行 AI 分析；登入後可儲存分析內容或與其他學習者分享。'
    );
  });

  it('does not claim the Extension is a future capability or temporarily unavailable', () => {
    const html = renderToStaticMarkup(<HowToUsePage />);
    expect(html).not.toContain('未來可使用');
    expect(html).not.toContain('整合中');
    expect(html).not.toContain('目前暫時無法建立新的學習內容');
  });

  it('points step 3 at the 學習項目 tab', () => {
    const html = renderToStaticMarkup(<HowToUsePage />);
    expect(html).toContain('儲存後的單字與文法會出現在「學習項目」。');
  });

  it('lists the three review ratings in step 4', () => {
    const html = renderToStaticMarkup(<HowToUsePage />);
    expect(html).toContain('重來');
    expect(html).toContain('良好');
    expect(html).toContain('簡單');
  });

  it('requires no authentication context to render', () => {
    expect(() => renderToStaticMarkup(<HowToUsePage />)).not.toThrow();
  });
});
