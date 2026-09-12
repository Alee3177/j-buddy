import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import NextLink from 'next/link';
import { EmptyState } from './EmptyState';

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

describe('EmptyState', () => {
  it('renders the title only when no description or action is given', () => {
    const html = renderToStaticMarkup(<EmptyState title="找不到單字。" />);
    expect(html).toContain('找不到單字。');
    expect(html).not.toContain('<a');
  });

  it('renders a description node', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="還沒有學習項目"
        description={<p>儲存日文分析內容後，單字與文法會出現在這裡。</p>}
      />
    );
    expect(html).toContain('儲存日文分析內容後，單字與文法會出現在這裡。');
  });

  it('renders an action as a primary-styled link to the given href', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="還沒有學習項目"
        action={{ label: '查看如何使用', href: '/how-to-use' }}
      />
    );
    expect(html).toContain('href="/how-to-use"');
    expect(html).toContain('查看如何使用');
    const anchor = html.match(/<a[^>]*href="\/how-to-use"[^>]*>/)?.[0] ?? '';
    expect(anchor).toContain('data-variant="default"');
  });

  it('renders a distinct status notice with title and body', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="還沒有學習項目"
        notice={{
          title: '目前功能狀態',
          body: 'Chrome Extension 整合功能目前正在準備中。',
        }}
      />
    );
    expect(html).toContain('目前功能狀態');
    expect(html).toContain('Chrome Extension 整合功能目前正在準備中。');
  });

  it('renders a title-less status notice', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="還沒有學習項目"
        notice={{ body: 'Chrome Extension 整合功能目前正在準備中。' }}
      />
    );
    expect(html).toContain('Chrome Extension 整合功能目前正在準備中。');
  });

  it('renders no action link when none is given', () => {
    const html = renderToStaticMarkup(<EmptyState title="今天沒有要複習的項目" />);
    expect(html).not.toContain('<a');
  });

  it('applies a passed className to the wrapping card', () => {
    const html = renderToStaticMarkup(<EmptyState title="x" className="col-span-full" />);
    expect(html).toMatch(/class="[^"]*col-span-full[^"]*"/);
  });

  it('disables prefetch on the action link (static-export segment-cache 404 workaround)', () => {
    const tree = EmptyState({
      title: '還沒有學習項目',
      action: { label: '查看如何使用', href: '/how-to-use' },
    });
    const link = findLink(tree, '/how-to-use');
    expect(link).not.toBeNull();
    expect(link?.props.prefetch).toBe(false);
  });
});
