/* @vitest-environment jsdom */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { User } from 'firebase/auth';
import NextLink from 'next/link';
import { AppHeader } from './AppHeader';
import { ThemeProvider } from '@/contexts/ThemeContext';

// P6.5-E — next/link strips its `prefetch` prop before it ever reaches the
// DOM, so it can't be asserted from rendered HTML. Walk the raw element tree
// instead to confirm the /how-to-use Link is built with prefetch disabled
// (a Next.js static-export bug makes its auto-prefetch request 404 in
// production; see components/EmptyState.tsx and lib/welcomeCard.ts siblings
// for the same fix).
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

function renderHeader(user: User | null) {
  return renderToStaticMarkup(
    <ThemeProvider>
      <AppHeader user={user} onSignIn={() => {}} onSignOut={() => {}} />
    </ThemeProvider>
  );
}

describe('AppHeader', () => {
  it('shows a 如何使用 link routing to /how-to-use when signed out', () => {
    const html = renderHeader(null);
    expect(html).toContain('href="/how-to-use"');
    expect(html).toContain('如何使用');
    expect(html).toContain('登入');
  });

  it('shows the 如何使用 link and sign-out control when signed in', () => {
    const html = renderHeader({ email: 'user@example.com' } as User);
    expect(html).toContain('href="/how-to-use"');
    expect(html).toContain('如何使用');
    expect(html).toContain('登出');
    expect(html).toContain('user@example.com');
  });

  it('does not render a FAQ link in this phase', () => {
    const html = renderHeader(null);
    expect(html).not.toContain('href="/faq"');
  });

  it('disables prefetch on the 如何使用 link (static-export segment-cache 404 workaround)', () => {
    const tree = AppHeader({ user: null, onSignIn: () => {}, onSignOut: () => {} });
    const link = findLink(tree, '/how-to-use');
    expect(link).not.toBeNull();
    expect(link?.props.prefetch).toBe(false);
  });
});
