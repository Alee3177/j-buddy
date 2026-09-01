/**
 * Ruby Contract — Phase 1A pure validator/repairer.
 *
 * These tests pin the deterministic behaviour of tokenizeRuby / validateRuby /
 * repairRuby. The module is NOT wired into the app yet, so nothing here touches
 * runtime rendering, storage, provider routing, or conjugation.
 *
 * Guiding principle under test: detect aggressively, repair conservatively.
 */
import {
  tokenizeRuby,
  validateRuby,
  repairRuby,
  ISSUE_CODES,
} from '../src/scripts/rubyContract.js';

const codes = (result) => result.issues.map((i) => i.code);
const codeSet = (result) => new Set(codes(result));

describe('rubyContract.tokenizeRuby', () => {
  test('a valid token exposes raw/base/reading and exact source indices', () => {
    const text = 'あの{漢字|かんじ}を';
    const tokens = tokenizeRuby(text);
    expect(tokens).toHaveLength(1);
    const [t] = tokens;
    expect(t).toMatchObject({
      raw: '{漢字|かんじ}',
      base: '漢字',
      reading: 'かんじ',
      valid: true,
    });
    expect(text.slice(t.start, t.end)).toBe('{漢字|かんじ}');
  });

  test('multiple valid tokens are returned in source order with correct spans', () => {
    const text = '{台風|たいふう}24{号|ごう}が{沖縄|おきなわ}に';
    const tokens = tokenizeRuby(text);
    expect(tokens.map((t) => t.base)).toEqual(['台風', '号', '沖縄']);
    for (const t of tokens) {
      expect(text.slice(t.start, t.end)).toBe(t.raw);
      expect(t.valid).toBe(true);
    }
  });

  test('malformed segments are flagged, never normalized into a valid token', () => {
    expect(tokenizeRuby('{漢字|かん|じ}')[0]).toMatchObject({
      valid: false, base: null, reading: null, problem: ISSUE_CODES.MULTI_PIPE,
    });
    expect(tokenizeRuby('{|かんじ}')[0]).toMatchObject({
      valid: false, base: null, reading: null, problem: ISSUE_CODES.EMPTY_BASE,
    });
    expect(tokenizeRuby('{漢字|}')[0]).toMatchObject({
      valid: false, base: null, reading: null, problem: ISSUE_CODES.EMPTY_READING,
    });
    expect(tokenizeRuby('{漢字}')[0]).toMatchObject({
      valid: false, problem: ISSUE_CODES.MISSING_PIPE,
    });
  });

  test('non-string / empty input is handled without throwing', () => {
    expect(tokenizeRuby(undefined)).toEqual([]);
    expect(tokenizeRuby(null)).toEqual([]);
    expect(tokenizeRuby(42)).toEqual([]);
    expect(tokenizeRuby('')).toEqual([]);
  });
});

describe('rubyContract.validateRuby — currently-accepted ruby stays valid & warning-free', () => {
  // Forms that the existing convertToRuby pipeline and prompt contract treat as
  // legitimate. None of these may become an error, and none may be auto-changed.
  const VALID_CORPUS = [
    ['basic kanji compound', '{台風|たいふう}'],
    ['digit before ruby + contextual day reading', '3{日|みっか}{以降|いこう}'],
    ['ruby directly followed by する', '{刺激|しげき}する'],
    ['two compound ruby tokens adjacent', '{警報級|けいほうきゅう}{大雨|おおあめ}'],
    ['counter kanji with the number outside the ruby', '24{号|ごう}'],
    ['jukujikun reading', '{今日|きょう}'],
    ['nakaguro inside a compound base (existing convertToRuby test)', '{漢字・仮名|かんじ・かな}'],
    ['digits inside the base (existing convertToRuby test)', '{2024年|にせんにじゅうよんねん}'],
    ['ruby amid punctuation', '「{台風|たいふう}」、{接近|せっきん}。'],
    ['plain numbers and latin outside ruby', 'AI が 24 時間 {稼働|かどう}する'],
  ];

  test.each(VALID_CORPUS)('%s → ok, no issues, repair is a no-op', (_name, text) => {
    const result = validateRuby(text);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    const repaired = repairRuby(text);
    expect(repaired.changed).toBe(false);
    expect(repaired.text).toBe(text);
  });
});

describe('rubyContract.validateRuby — known production failures', () => {
  test('A: duplicated adjacent surface is detected and safely repairable', () => {
    const text = '3{日|みっか}以降{以降|いこう}';
    const result = validateRuby(text);

    expect(codes(result)).toContain(ISSUE_CODES.DUPLICATE_ADJACENT_SURFACE);
    const dup = result.issues.find((i) => i.code === ISSUE_CODES.DUPLICATE_ADJACENT_SURFACE);
    expect(dup.severity).toBe('warning');
    expect(dup.repairable).toBe(true);
    expect(dup.index).toBe(text.indexOf('以降{'));
    // No structural error — the markup is well-formed, just redundant.
    expect(result.ok).toBe(true);

    const repaired = repairRuby(text);
    expect(repaired.changed).toBe(true);
    expect(repaired.text).toBe('3{日|みっか}{以降|いこう}');
    expect(repaired.repairs).toEqual([
      { code: ISSUE_CODES.DUPLICATE_ADJACENT_SURFACE, index: text.indexOf('以降{'), removed: '以降' },
    ]);
    expect(repaired.remainingIssues).toEqual([]);
  });

  test('B: missing opening brace is detected but never auto-repaired', () => {
    const text = '{流|なが}れ込|こ}み';
    const result = validateRuby(text);

    expect(codeSet(result)).toEqual(
      new Set([ISSUE_CODES.MISSING_OPEN_BRACE, ISSUE_CODES.UNBALANCED_BRACE]),
    );
    expect(result.ok).toBe(false);
    for (const issue of result.issues) {
      expect(issue.repairable).toBe(false);
    }

    const repaired = repairRuby(text);
    expect(repaired.changed).toBe(false);
    expect(repaired.text).toBe(text); // source is left byte-for-byte unchanged
  });

  test('C: kana mixed into a kanji base is flagged, no corrected span invented', () => {
    const text = '{関東も週末|かんとう}';
    const result = validateRuby(text);

    expect(codes(result)).toContain(ISSUE_CODES.NON_KANJI_BASE);
    const issue = result.issues.find((i) => i.code === ISSUE_CODES.NON_KANJI_BASE);
    expect(issue.severity).toBe('warning');
    expect(issue.repairable).toBe(false);
    // The token still tokenizes (one pipe, both sides present) but the base is
    // suspicious; we do not guess what the real span should be.
    expect(result.tokens[0]).toMatchObject({ valid: true, base: '関東も週末', reading: 'かんとう' });

    expect(repairRuby(text).changed).toBe(false);
  });

  test('D: suspect day-counter reading may warn, but the reading is never rewritten', () => {
    const text = '3{日|にち}{以降|いこう}';
    const result = validateRuby(text);

    // Tokens are syntactically valid.
    expect(result.tokens.every((t) => t.valid)).toBe(true);
    expect(result.ok).toBe(true);

    const suspect = result.issues.find((i) => i.code === ISSUE_CODES.SUSPECT_COUNTER_READING);
    expect(suspect).toBeDefined();
    expect(suspect.severity).toBe('warning');
    expect(suspect.repairable).toBe(false);

    const repaired = repairRuby(text);
    expect(repaired.changed).toBe(false);
    expect(repaired.text).toBe(text);
    expect(repaired.text).toContain('{日|にち}'); // にち NOT changed to みっか
  });

  test.each([
    ['1日 → ついたち in a date context', '1{日|にち}に'],
    ['2日', '2{日|にち}に'],
    ['3日', '3{日|にち}{以降|いこう}'],
    ['4日', '4{日|にち}'],
    ['5日', '5{日|にち}'],
    ['6日', '6{日|にち}'],
    ['7日', '7{日|にち}'],
    ['8日', '8{日|にち}'],
    ['9日', '9{日|にち}'],
    ['10日', '10{日|にち}'],
    ['14日', '14{日|にち}'],
    ['20日', '20{日|にち}'],
    ['24日', '24{日|にち}'],
    ['fullwidth 3日', '３{日|にち}'],
  ])('SUSPECT_COUNTER_READING: %s warns, is not an error, and is never repaired', (_name, text) => {
    const result = validateRuby(text);
    const suspect = result.issues.find((i) => i.code === ISSUE_CODES.SUSPECT_COUNTER_READING);
    expect(suspect).toBeDefined();
    expect(suspect.severity).toBe('warning');
    expect(suspect.repairable).toBe(false);
    expect(result.ok).toBe(true);
    expect(repairRuby(text).changed).toBe(false);
    expect(repairRuby(text).text).toBe(text);
  });

  test('SUSPECT_COUNTER_READING: only fires for 日 + にち after a suspect count', () => {
    // contextual native reading present → no warning
    expect(validateRuby('1{日|ついたち}に').issues).toEqual([]);
    // count outside the suspect set → no warning
    expect(codes(validateRuby('11{日|にち}'))).not.toContain(ISSUE_CODES.SUSPECT_COUNTER_READING);
    expect(codes(validateRuby('30{日|にち}'))).not.toContain(ISSUE_CODES.SUSPECT_COUNTER_READING);
    // different counter kanji → no warning
    expect(codes(validateRuby('24{号|ごう}'))).not.toContain(ISSUE_CODES.SUSPECT_COUNTER_READING);
    // no preceding digit → no warning
    expect(codes(validateRuby('{日|にち}'))).not.toContain(ISSUE_CODES.SUSPECT_COUNTER_READING);
  });
});

describe('rubyContract.validateRuby — structural issue codes', () => {
  test('unbalanced: unmatched opening brace', () => {
    const result = validateRuby('{漢字|かんじ');
    expect(codeSet(result)).toEqual(
      new Set([ISSUE_CODES.MISSING_CLOSE_BRACE, ISSUE_CODES.UNBALANCED_BRACE]),
    );
    expect(result.ok).toBe(false);
  });

  test('unbalanced: orphan closing brace after a pipe', () => {
    const result = validateRuby('漢字|かんじ}');
    expect(codeSet(result)).toEqual(
      new Set([ISSUE_CODES.MISSING_OPEN_BRACE, ISSUE_CODES.UNBALANCED_BRACE]),
    );
    expect(result.ok).toBe(false);
  });

  test('extra pipe → MULTI_PIPE error, base/reading not fabricated', () => {
    const result = validateRuby('{漢字|かん|じ}');
    expect(codes(result)).toEqual([ISSUE_CODES.MULTI_PIPE]);
    expect(result.ok).toBe(false);
    expect(result.tokens[0]).toMatchObject({ valid: false, base: null, reading: null });
  });

  test('empty base and empty reading', () => {
    expect(codes(validateRuby('{|かんじ}'))).toEqual([ISSUE_CODES.EMPTY_BASE]);
    expect(codes(validateRuby('{漢字|}'))).toEqual([ISSUE_CODES.EMPTY_READING]);
    expect(validateRuby('{|かんじ}').ok).toBe(false);
    expect(validateRuby('{漢字|}').ok).toBe(false);
  });

  test('nested braces → NESTED_BRACE error (documented Phase 1A limitation: inner segment still tokenizes)', () => {
    const result = validateRuby('{漢{字|じ}|かんじ}');
    expect(codes(result)).toContain(ISSUE_CODES.NESTED_BRACE);
    expect(result.ok).toBe(false);
    expect(repairRuby('{漢{字|じ}|かんじ}').changed).toBe(false);
  });

  test('bare {word} with no pipe → MISSING_PIPE warning, current literal-render behaviour is preserved', () => {
    const result = validateRuby('これは{漢字}です');
    expect(codes(result)).toEqual([ISSUE_CODES.MISSING_PIPE]);
    expect(result.ok).toBe(true); // warning only — matches today's harmless literal render
    expect(repairRuby('これは{漢字}です').changed).toBe(false);
  });
});

describe('rubyContract.validateRuby — base classification rules', () => {
  test('all-kana base → KANA_ONLY_BASE (warning, non-blocking, not repaired)', () => {
    const result = validateRuby('{という|という}');
    expect(codes(result)).toEqual([ISSUE_CODES.KANA_ONLY_BASE]);
    expect(result.ok).toBe(true);
    expect(repairRuby('{という|という}').changed).toBe(false);
  });

  test('fullwidth-latin base → NON_KANJI_BASE (warning, non-blocking, not repaired)', () => {
    // Rationale: convertToRuby currently renders this, and the v2 contract lists
    // loanwords separately (英文/解釈) rather than as ruby, so a latin/katakana
    // ruby base is unusual but not a hard error. Documented, not guessed.
    const result = validateRuby('{ＡＩ|エーアイ}');
    expect(codes(result)).toEqual([ISSUE_CODES.NON_KANJI_BASE]);
    expect(result.ok).toBe(true);
    expect(repairRuby('{ＡＩ|エーアイ}').changed).toBe(false);
  });

  test('kanji + digits + nakaguro bases are OK (no classification warning)', () => {
    expect(validateRuby('{2024年|にせんにじゅうよんねん}').issues).toEqual([]);
    expect(validateRuby('{漢字・仮名|かんじ・かな}').issues).toEqual([]);
  });
});

describe('rubyContract.validateRuby — duplicate-surface boundary safety', () => {
  test('duplicate with a safe left boundary (after "}") is repairable', () => {
    const result = validateRuby('{以降|いこう}以降{以降|いこう}');
    const dups = result.issues.filter((i) => i.code === ISSUE_CODES.DUPLICATE_ADJACENT_SURFACE);
    expect(dups).toHaveLength(1);
    expect(dups[0].repairable).toBe(true);
  });

  test('duplicate that could be the tail of a longer word is detected but NOT repairable', () => {
    // "本日" then a 日 ruby: deleting "日" would silently rewrite "本日日" → "本{日|ひ}".
    const text = '本日{日|ひ}';
    const result = validateRuby(text);
    const dup = result.issues.find((i) => i.code === ISSUE_CODES.DUPLICATE_ADJACENT_SURFACE);
    expect(dup).toBeDefined();
    expect(dup.repairable).toBe(false);
    expect(repairRuby(text).changed).toBe(false);
    expect(repairRuby(text).text).toBe(text);
  });
});

describe('rubyContract.repairRuby — safety & idempotency', () => {
  test('no-op on already-good input across the valid corpus', () => {
    for (const text of ['{台風|たいふう}', '3{日|みっか}{以降|いこう}', '{刺激|しげき}する']) {
      const r = repairRuby(text);
      expect(r).toMatchObject({ text, changed: false, repairs: [] });
    }
  });

  test('idempotent: repairing the repaired output changes nothing further', () => {
    const once = repairRuby('3{日|みっか}以降{以降|いこう}');
    expect(once.changed).toBe(true);
    const twice = repairRuby(once.text);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
  });

  test('multiple independent duplicates in one string are all repaired, right-to-left', () => {
    const text = '3{日|みっか}以降{以降|いこう}、大雨{大雨|おおあめ}に{警戒|けいかい}';
    const repaired = repairRuby(text);
    expect(repaired.text).toBe('3{日|みっか}{以降|いこう}、{大雨|おおあめ}に{警戒|けいかい}');
    expect(repaired.repairs.map((r) => r.removed)).toEqual(['大雨', '以降']);
    expect(repaired.changed).toBe(true);
    expect(repaired.remainingIssues).toEqual([]);
  });

  test('does not touch a string whose only issues are non-repairable', () => {
    const text = '{流|なが}れ込|こ}み / {関東も週末|かんとう} / 3{日|にち}{以降|いこう}';
    const repaired = repairRuby(text);
    expect(repaired.changed).toBe(false);
    expect(repaired.text).toBe(text);
    expect(repaired.repairs).toEqual([]);
    expect(repaired.remainingIssues.length).toBeGreaterThan(0);
  });

  test('non-string / empty input is handled without throwing', () => {
    expect(repairRuby(undefined)).toMatchObject({ text: '', changed: false });
    expect(repairRuby('')).toMatchObject({ text: '', changed: false });
    expect(validateRuby(undefined)).toMatchObject({ ok: true, issues: [] });
  });
});

describe('rubyContract — Unicode & mixed real-world text', () => {
  test('a full news sentence with several valid tokens validates clean', () => {
    const text = '{台風|たいふう}24{号|ごう}が{沖縄|おきなわ}に{最接近|さいせっきん}し、'
      + '{前線|ぜんせん}を{刺激|しげき}するため{関東|かんとう}でも{週末|しゅうまつ}は'
      + '{警戒|けいかい}が{必要|ひつよう}です。';
    const result = validateRuby(text);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.tokens.filter((t) => t.valid)).toHaveLength(10);
    expect(repairRuby(text).changed).toBe(false);
  });

  test('issue indices point into the original source string', () => {
    const text = 'あああ{関東も週末|かんとう}いいい';
    const result = validateRuby(text);
    const issue = result.issues.find((i) => i.code === ISSUE_CODES.NON_KANJI_BASE);
    expect(text.slice(issue.index, issue.index + issue.raw.length)).toBe('{関東も週末|かんとう}');
  });
});
