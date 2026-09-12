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

  it('renders step 2\'s status notice with the 目前功能狀態 title and P6.5-C copy', () => {
    const html = renderToStaticMarkup(<HowToUsePage />);
    expect(html).toContain('目前功能狀態');
    expect(html).toContain(
      'Chrome Extension 與自動儲存功能正在升級整合中，目前暫時無法建立新的學習內容。'
    );
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
