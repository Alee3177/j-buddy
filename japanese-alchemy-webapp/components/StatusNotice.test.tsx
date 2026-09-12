import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusNotice } from './StatusNotice';

describe('StatusNotice', () => {
  it('renders a title and body when a title is given', () => {
    const html = renderToStaticMarkup(
      <StatusNotice title="目前功能狀態">正在升級整合中。</StatusNotice>
    );
    expect(html).toContain('目前功能狀態');
    expect(html).toContain('正在升級整合中。');
  });

  it('renders body-only content when no title is given', () => {
    const html = renderToStaticMarkup(
      <StatusNotice>Chrome Extension 整合功能目前正在準備中。</StatusNotice>
    );
    expect(html).toContain('Chrome Extension 整合功能目前正在準備中。');
  });

  it('uses only theme-token color classes, no hardcoded light-only colors', () => {
    const html = renderToStaticMarkup(<StatusNotice>x</StatusNotice>);
    expect(html).not.toMatch(/bg-(red|amber|yellow|orange)-\d/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(html).toContain('bg-secondary');
  });
});
