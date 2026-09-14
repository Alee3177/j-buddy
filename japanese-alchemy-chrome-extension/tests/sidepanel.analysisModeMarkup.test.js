import fs from 'fs';
import path from 'path';

describe('sidepanel analysis-mode markup', () => {
  const html = fs.readFileSync(
    path.join(process.cwd(), 'src/sidepanel/sidepanel.html'),
    'utf8'
  );

  test('renders learner-facing analysis mode labels in the top controls', () => {
    expect(html).toContain('class="analysis-mode-toggle"');
    expect(html).toContain('role="group"');
    expect(html).toContain('精簡分析');
    expect(html).toContain('造句分析');
  });

  test('does not expose raw prompt versions as visible button labels', () => {
    expect(html).not.toContain('>v1<');
    expect(html).not.toContain('>v2<');
  });

  test('defaults the visible selected state to sentence-production analysis', () => {
    expect(html).toContain(
      '<button class="analysis-mode-option selected" type="button" data-prompt-variant="v2"'
    );
    expect(html).toContain('aria-pressed="true">造句分析</button>');
  });

  test('does not expose custom provider settings', () => {
    expect(html).not.toContain('personalProvider');
    expect(html).not.toContain('LLM API 提供者');
    expect(html).not.toContain('data-provider-mode');
    expect(html).not.toContain('API 金鑰');
    expect(html).not.toContain('data-ai-preference');
    expect(html).not.toContain('aiPreference');
  });

  // P7.4 follow-up: saveItems now requires sign-in for BOTH personal and
  // shared saves (previously shared saves were unauthenticated), so the
  // signed-out explanatory copy must no longer claim an unauthenticated user
  // can save to the shared collection.
  test('signed-out copy accurately reflects that saving/sharing both require sign-in', () => {
    expect(html).toContain('登入後即可儲存分析項目或與他人分享；未登入仍可使用分析功能。');
    expect(html).not.toContain('登入即可私密儲存項目；不登入也可儲存至共享收藏。');
    expect(html).not.toContain('不登入也可儲存至共享收藏');
  });

  test('keeps the top controls in one horizontal row', () => {
    expect(html).toMatch(/\.controls\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
    expect(html).toMatch(/\.controls-left\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
  });

  test('provides an initially hidden Stop analysis control in the loading state', () => {
    expect(html).toContain('id="cancelAnalysisButton"');
    expect(html).toContain('hidden>停止分析</button>');
    expect(html).toContain('aria-label="停止目前分析"');
  });

  test('separates the manual analysis action from the analysis result', () => {
    expect(html).toMatch(/#analyzeButton\s*\{[\s\S]*?margin-bottom:\s*8px;/);
  });
});
