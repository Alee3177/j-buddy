/* @vitest-environment jsdom */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { User } from 'firebase/auth';
import { AppHeader } from './AppHeader';
import { ThemeProvider } from '@/contexts/ThemeContext';

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
});
