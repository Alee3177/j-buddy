import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import NextLink from 'next/link';
import { WelcomeCard } from './WelcomeCard';

// P6.5-E — see components/AppHeader.test.tsx for why this walks the raw
// element tree instead of asserting on rendered HTML.
function findLink(
  node: ReactNode,
  href: string
): ReactElement<{ prefetch?: boolean }> | null {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findLink(child, href);
      if (found) return found;
    }
    return null;
  }
  const el = node as ReactElement<{ href?: string; children?: ReactNode }>;
  if (el.type === NextLink && el.props.href === href) {
    return el as ReactElement<{ prefetch?: boolean }>;
  }
  if (el.props?.children) return findLink(el.props.children, href);
  return null;
}

describe('WelcomeCard', () => {
  it('renders the heading and intro copy', () => {
    const html = renderToStaticMarkup(<WelcomeCard />);
    expect(html).toContain('歡迎使用 J-Buddy');
    expect(html).toContain(
      'J-Buddy 幫你把平常看到的日文，整理成自己的學習內容並安排複習。'
    );
  });

  it('renders all four usage steps in order, with step 2 marked as 整合中', () => {
    const html = renderToStaticMarkup(<WelcomeCard />);
    const steps = [
      '在網頁看到想學的日文',
      '使用 J-Buddy Extension 分析並儲存（整合中）',
      '回到 J-Buddy 查看「學習項目」',
      '將內容加入「複習」',
    ];
    const indices = steps.map((step) => html.indexOf(step));
    expect(indices.every((i) => i > -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('renders the 目前功能狀態 status notice with the P6.5-C copy', () => {
    const html = renderToStaticMarkup(<WelcomeCard />);
    expect(html).toContain('目前功能狀態');
    expect(html).toContain(
      'Chrome Extension 與自動儲存功能正在升級整合中，目前暫時無法建立新的學習內容。'
    );
  });

  it('renders a primary-styled CTA linking to /how-to-use', () => {
    const html = renderToStaticMarkup(<WelcomeCard />);
    const anchor = html.match(/<a[^>]*href="\/how-to-use"[^>]*>/)?.[0] ?? '';
    expect(anchor).toContain('data-variant="default"');
    expect(html).toContain('查看如何使用');
  });

  it('disables prefetch on the CTA link (static-export segment-cache 404 workaround)', () => {
    const tree = WelcomeCard();
    const link = findLink(tree, '/how-to-use');
    expect(link).not.toBeNull();
    expect(link?.props.prefetch).toBe(false);
  });
});
