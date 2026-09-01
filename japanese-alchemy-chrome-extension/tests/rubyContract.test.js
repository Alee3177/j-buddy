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
  parseReadingContract,
  separateReadingContract,
  reconcileRuby,
  stripRubyMarkup,
  READING_CONTRACT_ISSUE_CODES as RC,
  RUBY_RECONCILE_ISSUE_CODES as RCN,
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

// --- v0.2 Phase 2A: parseReadingContract ------------------------------------

/** Wrap a JS object as the final ```json fenced block of a model response. */
function asFinalJsonBlock(obj, { lang = 'json', trailing = '', prefix = '' } = {}) {
  return `${prefix}### 原句\n  - prose\n\n\`\`\`${lang}\n${JSON.stringify(obj, null, 2)}\n\`\`\`${trailing}`;
}
const tok = (text, reading = null) => ({ text, reading });
const contractOf = (sourceText, tokens, version = 1) => ({
  reading_contract_version: version,
  source_text: sourceText,
  tokens,
});
const rcCodes = (r) => r.issues.map((i) => i.code);

describe('rubyContract.parseReadingContract — extraction safety', () => {
  test('D: no final fenced json block → READING_CONTRACT_NOT_FOUND', () => {
    const r = parseReadingContract('### 原句\njust prose, no fenced block at all.');
    expect(r.ok).toBe(false);
    expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_NOT_FOUND]);
    expect(r.contract).toBeNull();
  });

  test('I: a valid contract that is NOT the final content → NOT_FOUND (trailing prose)', () => {
    const md = asFinalJsonBlock(contractOf('あ', [tok('あ', 'あ')]), {
      trailing: '\n\nAnything after the contract block is disallowed.',
    });
    // (the reading here is bogus but that is irrelevant — it is never reached)
    const r = parseReadingContract(md);
    expect(r.ok).toBe(false);
    expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_NOT_FOUND]);
  });

  test('M: a valid contract followed only by whitespace/newlines → valid', () => {
    const md = asFinalJsonBlock(contractOf('雨', [tok('雨', 'あめ')]), { trailing: '\n   \n\t\n' });
    const r = parseReadingContract(md);
    expect(r.ok).toBe(true);
    expect(r.contract.tokens).toEqual([{ text: '雨', reading: 'あめ' }]);
  });

  test('H/N: an earlier fenced block is ignored; only the final contract is parsed', () => {
    const earlier = '```json\n{"unrelated":true,"reading_contract_version":1}\n```';
    const finalContract = JSON.stringify(contractOf('台風', [tok('台風', 'たいふう')]));
    const md = `### 原句\n${earlier}\n\nmore prose\n\n\`\`\`json\n${finalContract}\n\`\`\`\n`;
    const r = parseReadingContract(md);
    expect(r.ok).toBe(true);
    expect(r.contract.sourceText).toBe('台風');
  });

  test('J: a final unrelated JSON object → conservative NOT_FOUND (locked behaviour)', () => {
    const r = parseReadingContract('### 原句\nprose\n\n```json\n{"foo":"bar"}\n```\n');
    expect(r.ok).toBe(false);
    expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_NOT_FOUND]);
  });

  test('a non-json language tag on the final fence → NOT_FOUND', () => {
    const md = '```javascript\n{"reading_contract_version":1,"source_text":"あ","tokens":[]}\n```';
    expect(rcCodes(parseReadingContract(md))).toEqual([RC.READING_CONTRACT_NOT_FOUND]);
  });

  test('non-string input is handled without throwing', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      const r = parseReadingContract(bad);
      expect(r).toMatchObject({ ok: false, contract: null });
      expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_NOT_FOUND]);
    }
  });
});

describe('rubyContract.parseReadingContract — structural validation', () => {
  test('A: a well-formed contract parses; version/sourceText/tokens/concatenation exact', () => {
    const source = '台風24号発生　3日以降';
    const tokens = [
      tok('台風', 'たいふう'),
      tok('24', null),
      tok('号', 'ごう'),
      tok('発生', 'はっせい'),
      tok('　', null),
      tok('3', null),
      tok('日', 'みっか'),
      tok('以降', 'いこう'),
    ];
    const r = parseReadingContract(asFinalJsonBlock(contractOf(source, tokens)));

    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.contract.version).toBe(1);
    expect(r.contract.sourceText).toBe(source);
    expect(r.contract.tokens).toEqual(tokens.map((t) => ({ text: t.text, reading: t.reading })));
    expect(r.contract.tokens.map((t) => t.text).join('')).toBe(source);
  });

  test('B: token concatenation ≠ source_text → READING_CONTRACT_SOURCE_MISMATCH', () => {
    const r = parseReadingContract(asFinalJsonBlock(
      contractOf('3日以降', [tok('3'), tok('日', 'みっか'), tok('以後', 'いご')]),
    ));
    expect(r.ok).toBe(false);
    expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_SOURCE_MISMATCH]);
    expect(r.issues[0].index).toBe('3日以'.length); // first差 at the 後/降 position
  });

  test('C: invalid JSON in the final fence → READING_CONTRACT_INVALID_JSON', () => {
    const r = parseReadingContract('### 原句\nprose\n\n```json\n{ "reading_contract_version": 1, }\n```\n');
    expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_INVALID_JSON]);
  });

  test('E: reading_contract_version = 2 → READING_CONTRACT_UNSUPPORTED_VERSION', () => {
    const r = parseReadingContract(asFinalJsonBlock(contractOf('あ', [tok('あ')], 2)));
    expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_UNSUPPORTED_VERSION]);
  });

  test('E2: non-integer version ("1" / 1.5) → READING_CONTRACT_UNSUPPORTED_VERSION', () => {
    expect(rcCodes(parseReadingContract(asFinalJsonBlock(contractOf('あ', [tok('あ')], '1')))))
      .toEqual([RC.READING_CONTRACT_UNSUPPORTED_VERSION]);
    expect(rcCodes(parseReadingContract(asFinalJsonBlock(contractOf('あ', [tok('あ')], 1.5)))))
      .toEqual([RC.READING_CONTRACT_UNSUPPORTED_VERSION]);
  });

  test('F: an empty-string token.text → READING_CONTRACT_EMPTY_TOKEN (index reported)', () => {
    const r = parseReadingContract(asFinalJsonBlock(
      contractOf('日', [{ text: '', reading: null }]),
    ));
    expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_EMPTY_TOKEN]);
    expect(r.issues[0].index).toBe(0);
  });

  test('G: a non-string reading (123) → READING_CONTRACT_INVALID_READING', () => {
    const r = parseReadingContract(asFinalJsonBlock(
      contractOf('日', [{ text: '日', reading: 123 }]),
    ));
    expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_INVALID_READING]);
    expect(r.issues[0].index).toBe(0);
  });

  test('an empty-string reading is rejected, not silently treated as null', () => {
    const r = parseReadingContract(asFinalJsonBlock(
      contractOf('日', [{ text: '日', reading: '' }]),
    ));
    expect(rcCodes(r)).toEqual([RC.READING_CONTRACT_INVALID_READING]);
  });

  test('shape errors: non-object top level, missing source_text, tokens not an array', () => {
    expect(rcCodes(parseReadingContract('```json\n[1,2,3]\n```')))
      .toEqual([RC.READING_CONTRACT_NOT_FOUND]); // array, no discriminator
    expect(rcCodes(parseReadingContract(asFinalJsonBlock({ reading_contract_version: 1, tokens: [] }))))
      .toEqual([RC.READING_CONTRACT_INVALID_SHAPE]); // missing source_text
    expect(rcCodes(parseReadingContract(asFinalJsonBlock({
      reading_contract_version: 1, source_text: 'あ', tokens: 'nope',
    })))).toEqual([RC.READING_CONTRACT_INVALID_SHAPE]);
    expect(rcCodes(parseReadingContract(asFinalJsonBlock(
      contractOf('あ', ['not-an-object']),
    )))).toEqual([RC.READING_CONTRACT_INVALID_SHAPE]);
  });

  test('K: ASCII space, full-width space (U+3000), Japanese punctuation and newline are preserved exactly', () => {
    const source = 'A B　あ、\nイ。';
    const tokens = [
      tok('A'), tok(' '), tok('B'), tok('　'),
      tok('あ'), tok('、'), tok('\n'), tok('イ'), tok('。'),
    ];
    const r = parseReadingContract(asFinalJsonBlock(contractOf(source, tokens)));
    expect(r.ok).toBe(true);
    expect(r.contract.sourceText).toBe(source);
    expect(r.contract.tokens.map((t) => t.text).join('')).toBe(source);
    // no normalization: the full-width space is still U+3000, not an ASCII space
    expect(r.contract.tokens[3].text).toBe('　');
  });

  test('O: full-width digits/latin, emoji and other Unicode survive byte-for-byte', () => {
    const source = '３号🌀とＡ';
    const tokens = [tok('３'), tok('号', 'ごう'), tok('🌀'), tok('と'), tok('Ａ')];
    const r = parseReadingContract(asFinalJsonBlock(contractOf(source, tokens)));
    expect(r.ok).toBe(true);
    expect(r.contract.sourceText).toBe(source);
    expect(r.contract.sourceText.normalize('NFKC')).not.toBe(r.contract.sourceText); // proves no NFKC
  });
});

describe('rubyContract.parseReadingContract — semantic scope is deferred (Phase 2A)', () => {
  test('L: a contextually wrong day reading (3日 → にち) is STRUCTURALLY valid → ok:true', () => {
    const r = parseReadingContract(asFinalJsonBlock(
      contractOf('3日以降', [tok('3'), tok('日', 'にち'), tok('以降', 'いこう')]),
    ));
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    // reading is returned verbatim — never rewritten to みっか here
    expect(r.contract.tokens[1]).toEqual({ text: '日', reading: 'にち' });
  });

  test('parseReadingContract never emits SUSPECT_COUNTER_READING (that heuristic stays in validateRuby)', () => {
    const r = parseReadingContract(asFinalJsonBlock(
      contractOf('3日', [tok('3'), tok('日', 'にち')]),
    ));
    expect(rcCodes(r)).not.toContain('SUSPECT_COUNTER_READING');
    expect(rcCodes(r)).not.toContain(ISSUE_CODES.SUSPECT_COUNTER_READING);
  });
});

// --- v0.2 Phase 2B-1: separateReadingContract ------------------------------

describe('rubyContract.separateReadingContract', () => {
  const HUMAN = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する\n\n### 文法分析\n（無）';
  const fence = (obj) => '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
  const validContract = contractOf('台風接近', [tok('台風', 'たいふう'), tok('接近', 'せっきん')]);

  test('A: a valid final reading contract is removed; human Markdown returned exactly', () => {
    const r = separateReadingContract(`${HUMAN}\n\n${fence(validContract)}`);
    expect(r.markdown).toBe(HUMAN);
    expect(r.hadContract).toBe(true);
    expect(r.contractIssues).toEqual([]);
    expect(r.readingContract).toEqual({
      version: 1,
      sourceText: '台風接近',
      tokens: [{ text: '台風', reading: 'たいふう' }, { text: '接近', reading: 'せっきん' }],
    });
    // no fragment of the JSON block survives
    expect(r.markdown).not.toContain('reading_contract_version');
    expect(r.markdown).not.toContain('```');
  });

  test('B: no contract → markdown byte-for-byte unchanged, hadContract false, no issues', () => {
    const r = separateReadingContract(HUMAN);
    expect(r.markdown).toBe(HUMAN);
    expect(r.hadContract).toBe(false);
    expect(r.contractIssues).toEqual([]);
    expect(r.readingContract).toBeNull();
  });

  test('C: malformed JSON in a block that intends to be a contract → not stripped, INVALID_JSON, hadContract true', () => {
    const input = `${HUMAN}\n\n\`\`\`json\n{ "reading_contract_version": 1, oops }\n\`\`\``;
    const r = separateReadingContract(input);
    expect(r.markdown).toBe(input); // never delete unparseable content
    expect(r.readingContract).toBeNull();
    expect(r.contractIssues.map((i) => i.code)).toEqual([RC.READING_CONTRACT_INVALID_JSON]);
    expect(r.hadContract).toBe(true);
  });

  test('D: unsupported version → not stripped, issue returned', () => {
    const input = `${HUMAN}\n\n${fence(contractOf('台風', [tok('台風', 'たいふう')], 2))}`;
    const r = separateReadingContract(input);
    expect(r.markdown).toBe(input);
    expect(r.contractIssues.map((i) => i.code)).toEqual([RC.READING_CONTRACT_UNSUPPORTED_VERSION]);
    expect(r.hadContract).toBe(true);
  });

  test('E: source mismatch → not stripped, issue returned', () => {
    const bad = contractOf('台風接近', [tok('台風', 'たいふう'), tok('接続', 'せつぞく')]);
    const input = `${HUMAN}\n\n${fence(bad)}`;
    const r = separateReadingContract(input);
    expect(r.markdown).toBe(input);
    expect(r.contractIssues.map((i) => i.code)).toEqual([RC.READING_CONTRACT_SOURCE_MISMATCH]);
    expect(r.hadContract).toBe(true);
  });

  test('F: an earlier unrelated JSON fence is kept; only the final valid contract is removed', () => {
    const earlier = '```json\n{"debug":true}\n```';
    const input = `### 原句\n${earlier}\n\nmore prose\n\n${fence(validContract)}`;
    const r = separateReadingContract(input);
    expect(r.markdown).toBe(`### 原句\n${earlier}\n\nmore prose`);
    expect(r.markdown).toContain('{"debug":true}');
    expect(r.markdown).not.toContain('reading_contract_version');
    expect(r.hadContract).toBe(true);
  });

  test('G: a valid contract followed by trailing prose → nothing stripped', () => {
    const input = `${HUMAN}\n\n${fence(validContract)}\n\nps: extra note`;
    const r = separateReadingContract(input);
    expect(r.markdown).toBe(input);
    expect(r.readingContract).toBeNull();
    expect(r.hadContract).toBe(false);
    expect(r.contractIssues).toEqual([]);
  });

  test('H: an unrelated final JSON object → nothing stripped, no issues', () => {
    const input = `${HUMAN}\n\n\`\`\`json\n{"foo":"bar"}\n\`\`\``;
    const r = separateReadingContract(input);
    expect(r.markdown).toBe(input);
    expect(r.hadContract).toBe(false);
    expect(r.contractIssues).toEqual([]);
  });

  describe('I: whitespace boundary — only the contract-side separator is removed', () => {
    test.each([
      ['single newline', 'human', 'human\n'],
      ['double newline', 'human', 'human\n\n'],
      ['trailing spaces then blank line', 'human line', 'human line   \n\n'],
      ['full-width space before the fence is preserved', 'human　', 'human　\n'],
      ['no human content at all', '', ''],
    ])('%s', (_name, expectedMarkdown, prefix) => {
      const r = separateReadingContract(`${prefix}${fence(validContract)}`);
      expect(r.markdown).toBe(expectedMarkdown);
      expect(r.hadContract).toBe(true);
    });
  });

  test('J: Unicode in the preserved Markdown and in the parsed contract is byte-for-byte', () => {
    const src = '３号🌀とＡ';
    const c = contractOf(src, [tok('３'), tok('号', 'ごう'), tok('🌀'), tok('と'), tok('Ａ')]);
    const r = separateReadingContract(`原文：${src}\n\n${fence(c)}`);
    expect(r.markdown).toBe(`原文：${src}`);
    expect(r.readingContract.sourceText).toBe(src);
  });

  test('K: idempotent — separating an already-separated response is a no-op with no contract', () => {
    const once = separateReadingContract(`${HUMAN}\n\n${fence(validContract)}`);
    const twice = separateReadingContract(once.markdown);
    expect(twice.markdown).toBe(once.markdown);
    expect(twice.hadContract).toBe(false);
    expect(twice.readingContract).toBeNull();
  });

  test('non-string input is handled without throwing', () => {
    for (const bad of [undefined, null, 42, {}]) {
      const r = separateReadingContract(bad);
      expect(r).toMatchObject({ markdown: '', readingContract: null, hadContract: false });
      expect(r.contractIssues).toEqual([]);
    }
  });

  test('ORDERING: the reading contract never reaches repairRuby / conjugation / parser', () => {
    // Human Markdown carries a duplicated-surface 辭書形 (Phase 1B repairs it).
    const human = '### 單字分析\n#### <單字>{動|うご}く\n  - 動詞分類：五段動詞\n  - 辭書形：動{動|うご}く\n\n### 文法分析\n（無）';
    const contract = contractOf('動く', [tok('動', 'うご'), tok('く')]);
    const full = `${human}\n\n${fence(contract)}`;

    // step 1: separate
    const sep = separateReadingContract(full);
    expect(sep.markdown).toBe(human);
    expect(sep.markdown).not.toContain('reading_contract_version');

    // step 2: repairRuby only ever sees the separated human Markdown
    const repaired = repairRuby(sep.markdown);
    expect(repaired.text).not.toContain('reading_contract_version');
    expect(repaired.text).toContain('辭書形：{動|うご}く');
    expect(repaired.text).not.toContain('動{動|うご}く');

    // If repair had run on `full` (wrong order), the contract JSON braces would
    // have produced spurious ruby issues — prove the separated input is clean.
    expect(validateRuby(sep.markdown).issues.map((i) => i.code)).not.toContain(ISSUE_CODES.MISSING_PIPE);
    expect(validateRuby(full).issues.map((i) => i.code)).toContain(ISSUE_CODES.MISSING_PIPE);
  });
});

// --- v0.2 Phase 2B-2: stripRubyMarkup + reconcileRuby ----------------------

describe('rubyContract.stripRubyMarkup', () => {
  test.each([
    ['3{日|にち}{以降|いこう}', '3日以降'],
    ['{関東も週末|かんとう}', '関東も週末'],
    ['{台風|たいふう}24{号|ごう}が{接近|せっきん}', '台風24号が接近'],
    ['plain text with no ruby', 'plain text with no ruby'],
  ])('%s → %s', (input, expected) => {
    expect(stripRubyMarkup(input)).toBe(expected);
  });

  test('malformed ruby is left byte-for-byte (conservative)', () => {
    expect(stripRubyMarkup('{流|なが}れ込|こ}み')).toBe('流れ込|こ}み');
    expect(stripRubyMarkup('{漢字|かん|じ}')).toBe('{漢字|かん|じ}');
    expect(stripRubyMarkup('{漢字}')).toBe('{漢字}');
    expect(stripRubyMarkup('{漢字|}')).toBe('{漢字|}');
  });

  test('non-string input → empty string, no throw', () => {
    expect(stripRubyMarkup(undefined)).toBe('');
    expect(stripRubyMarkup(null)).toBe('');
    expect(stripRubyMarkup(42)).toBe('');
  });
});

describe('rubyContract.reconcileRuby', () => {
  const contract = (sourceText, tokens) => ({ version: 1, sourceText, tokens });
  const tk = (text, reading = null) => ({ text, reading });
  const sourceLine = (md, n = 1) => md.split('\n')[n];
  // 3rd arg (the grounding source) defaults to the contract's own source_text —
  // i.e. "the model was analysing exactly what was selected". Grounding-failure
  // tests pass an explicit different value.
  const reconcile = (md, c, expected) =>
    reconcileRuby(md, c, expected === undefined ? (c && c.sourceText) : expected);

  test('A: canonical reconstruction — reading null → bare text, kana → {text|reading}', () => {
    const c = contract('3日以降に沖縄に最接近か', [
      tk('3'), tk('日', 'みっか'), tk('以降', 'いこう'), tk('に'),
      tk('沖縄', 'おきなわ'), tk('に'), tk('最接近', 'さいせっきん'), tk('か'),
    ]);
    const md = '### 原句\n  - 3日以降に沖縄に最接近か\n\n### 漢字提取';
    const r = reconcile(md, c);
    expect(r.changed).toBe(true);
    expect(sourceLine(r.text)).toBe('  - 3{日|みっか}{以降|いこう}に{沖縄|おきなわ}に{最接近|さいせっきん}か');
  });

  test('B: a wrong contextual date reading in ### 原句 is corrected', () => {
    const c = contract('3日以降', [tk('3'), tk('日', 'みっか'), tk('以降', 'いこう')]);
    const md = '### 原句\n  - 3{日|にち}{以降|いこう}\n  - 翻譯：from the 3rd onward\n\n### 漢字提取';
    const r = reconcile(md, c);
    expect(sourceLine(r.text)).toBe('  - 3{日|みっか}{以降|いこう}');
    expect(r.text).toContain('  - 翻譯：from the 3rd onward'); // translation line untouched
    expect(r.repairs).toEqual([{
      code: 'RECONCILE_SOURCE_LINE',
      start: md.indexOf('3{日|にち}'),
      end: md.indexOf('3{日|にち}') + '3{日|にち}{以降|いこう}'.length,
      before: '3{日|にち}{以降|いこう}',
      after: '3{日|みっか}{以降|いこう}',
    }]);
  });

  test('C: a wrong ruby span is corrected from the authoritative token boundaries', () => {
    const c = contract('関東も週末警戒', [
      tk('関東', 'かんとう'), tk('も'), tk('週末', 'しゅうまつ'), tk('警戒', 'けいかい'),
    ]);
    const md = '### 原句\n- {関東も週末|かんとう}{警戒|けいかい}\n- 翻譯：x\n\n### 單字分析';
    const r = reconcile(md, c);
    expect(sourceLine(r.text)).toBe('- {関東|かんとう}も{週末|しゅうまつ}{警戒|けいかい}');
    expect(r.changed).toBe(true);
  });

  test('D: a duplicate adjacent surface in ### 原句 is fixed by authoritative reconstruction', () => {
    const c = contract('3日以降', [tk('3'), tk('日', 'みっか'), tk('以降', 'いこう')]);
    const md = '### 原句\n  - 3{日|みっか}以降{以降|いこう}\n\n### 漢字提取';
    const r = reconcile(md, c);
    expect(sourceLine(r.text)).toBe('  - 3{日|みっか}{以降|いこう}');
    // repairRuby is then a no-op for that reconstructed line
    expect(repairRuby(sourceLine(r.text)).changed).toBe(false);
  });

  test('E: an already-canonical source line is not changed (changed:false)', () => {
    const c = contract('3日以降', [tk('3'), tk('日', 'みっか'), tk('以降', 'いこう')]);
    const md = '### 原句\n  - 3{日|みっか}{以降|いこう}\n\n### x';
    const r = reconcile(md, c);
    expect(r).toEqual({ text: md, changed: false, repairs: [], issues: [] });
  });

  test('F: the 翻譯 line is never modified', () => {
    const c = contract('雨', [tk('雨', 'あめ')]);
    const md = '### 原句\n  - {雨|あめ}\n  - 翻譯：{雨|あやまり}\n\n### x';
    const r = reconcile(md, c);
    expect(r.changed).toBe(false); // source line already canonical
    expect(r.text).toContain('  - 翻譯：{雨|あやまり}'); // untouched, even though its ruby is "wrong"
  });

  test('G/H: occurrences in ### 單字分析 and in generated examples are byte-for-byte unchanged', () => {
    const c = contract('最接近する', [tk('最接近', 'さいせっきん'), tk('する')]);
    const md = [
      '### 原句',
      '  - {最接近|さいっせきん}する', // wrong reading in the source line
      '',
      '### 單字分析',
      '#### <單字>{最接近|さいせっきん}する',
      '  - 自然例句：{台風|たいふう}が{最接近|さいせっきん}する。',
      '  - 造句模板：A が B に{最接近|さいせっきん}する。',
    ].join('\n');
    const r = reconcile(md, c);
    expect(sourceLine(r.text)).toBe('  - {最接近|さいせっきん}する'); // source line fixed
    // everything from ### 單字分析 onward is identical
    const from = (s) => s.slice(s.indexOf('### 單字分析'));
    expect(from(r.text)).toBe(from(md));
    expect(r.text).toContain('自然例句：{台風|たいふう}が{最接近|さいせっきん}する。');
    expect(r.text).toContain('造句模板：A が B に{最接近|さいせっきん}する。');
  });

  test('I: no contract → strict no-op (grounding not even reached)', () => {
    const md = '### 原句\n  - 3{日|にち}{以降|いこう}\n\n### x';
    expect(reconcileRuby(md, null, '3日以降')).toEqual({ text: md, changed: false, repairs: [], issues: [] });
    expect(reconcileRuby(md, undefined, '3日以降').changed).toBe(false);
    expect(reconcileRuby(md, { nope: true }, '3日以降').issues).toEqual([]);
  });

  test('J: ### 原句 surface ≠ contract source_text (but grounded) → RECONCILE_SOURCE_TEXT_MISMATCH', () => {
    const c = contract('まったく別のテキスト', [tk('まったく'), tk('別', 'べつ'), tk('のテキスト')]);
    const md = '### 原句\n  - {台風|たいふう}が{接近|せっきん}\n\n### x';
    const r = reconcile(md, c); // expected === c.sourceText, so grounding passes
    expect(r.text).toBe(md);
    expect(r.changed).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SOURCE_TEXT_MISMATCH]);
  });

  test('K: no ### 原句 heading → unchanged + RECONCILE_SOURCE_LINE_NOT_FOUND', () => {
    const c = contract('あ', [tk('あ')]);
    const r = reconcile('### 漢字提取\n  - x\n\n### 文法分析', c);
    expect(r.changed).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SOURCE_LINE_NOT_FOUND]);
  });

  test('K2: ### 原句 present but no content line → RECONCILE_SOURCE_LINE_NOT_FOUND', () => {
    const c = contract('あ', [tk('あ')]);
    const r = reconcile('### 原句\n\n### 漢字提取', c);
    expect(r.issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SOURCE_LINE_NOT_FOUND]);
  });

  test('L: two non-translation lines both matching source_text → RECONCILE_SOURCE_LINE_AMBIGUOUS', () => {
    const c = contract('台風', [tk('台風', 'たいふう')]);
    const md = '### 原句\n  - {台風|たいふう}\n  - {台風|たいぷう}\n\n### x';
    const r = reconcile(md, c);
    expect(r.changed).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SOURCE_LINE_AMBIGUOUS]);
  });

  test('M: Unicode, full-width space and line prefix are preserved through a real change', () => {
    const c = contract('３号　🌀', [tk('３'), tk('号', 'ごう'), tk('　'), tk('🌀')]);
    const md = '### 原句\n\t- ３{号|ごお}　🌀\n\n### x'; // wrong reading ごお, tab-indented bullet
    const r = reconcile(md, c);
    expect(r.changed).toBe(true);
    expect(sourceLine(r.text)).toBe('\t- ３{号|ごう}　🌀'); // tab + "- " prefix + U+3000 kept
  });

  test('N: malformed existing ruby whose plain surface cannot be proven → conservative no-op + issue', () => {
    const c = contract('流れ込み', [tk('流', 'なが'), tk('れ'), tk('込', 'こ'), tk('み')]);
    const md = '### 原句\n  - {流|なが}れ込|こ}み\n\n### x';
    const r = reconcile(md, c);
    expect(r.text).toBe(md);
    expect(r.changed).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SOURCE_TEXT_MISMATCH]);
  });

  test('O: a structurally-valid empty source_text is handled safely (no throw, no-op)', () => {
    const r = reconcileRuby('### 原句\n  - something\n\n### x', { version: 1, sourceText: '', tokens: [] }, '');
    expect(r.changed).toBe(false);
    expect(() => reconcileRuby('### 原句\n\n### x', { version: 1, sourceText: '', tokens: [] }, '')).not.toThrow();
  });

  test('P: reconciliation is idempotent', () => {
    const c = contract('3日以降', [tk('3'), tk('日', 'みっか'), tk('以降', 'いこう')]);
    const md = '### 原句\n  - 3{日|にち}以降{以降|いこう}\n  - 翻譯：x\n\n### 漢字提取';
    const once = reconcile(md, c);
    expect(once.changed).toBe(true);
    const twice = reconcile(once.text, c);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
  });

  test('non-string markdown input → no throw', () => {
    const c = contract('あ', [tk('あ')]);
    expect(reconcileRuby(undefined, c, 'あ')).toMatchObject({ text: '', changed: false });
    expect(reconcileRuby(null, c, 'あ').issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SOURCE_LINE_NOT_FOUND]);
  });

  test('ORDERING: reconcile makes repairRuby a no-op for the source line (wrong reading + duplicate)', () => {
    const c = contract('3日以降', [tk('3'), tk('日', 'みっか'), tk('以降', 'いこう')]);
    // both defects at once: wrong reading (にち) AND a duplicate adjacent surface
    const md = '### 原句\n  - 3{日|にち}以降{以降|いこう}\n\n### 漢字提取';
    const reconciled = reconcile(md, c);
    expect(sourceLine(reconciled.text)).toBe('  - 3{日|みっか}{以降|いこう}');

    // repairRuby, running next in the pipeline, finds nothing to repair here
    const repaired = repairRuby(reconciled.text);
    expect(repaired.repairs).toEqual([]);
    expect(repaired.text).toBe(reconciled.text);
  });
});

describe('rubyContract.reconcileRuby — grounding against the actual selected text', () => {
  const contract = (sourceText, tokens) => ({ version: 1, sourceText, tokens });
  const tk = (text, reading = null) => ({ text, reading });
  const sourceLine = (md, n = 1) => md.split('\n')[n];

  test('1: markdown, contract.sourceText and expectedSourceText all consistent → reconcile succeeds', () => {
    const c = contract('3日以降', [tk('3'), tk('日', 'みっか'), tk('以降', 'いこう')]);
    const md = '### 原句\n- 3{日|にち}{以降|いこう}';
    const r = reconcileRuby(md, c, '3日以降');
    expect(r.changed).toBe(true);
    expect(sourceLine(r.text)).toBe('- 3{日|みっか}{以降|いこう}');
    expect(r.issues).toEqual([]);
  });

  test('2 (CRITICAL): contract matches ### 原句 surface but NOT the selected text → RECONCILE_SELECTED_TEXT_MISMATCH, no rebuild', () => {
    const c = contract('3日以降', [tk('3'), tk('日', 'みっか'), tk('以降', 'いこう')]);
    const md = '### 原句\n- 3{日|にち}{以降|いこう}\n\n### 漢字提取';
    const r = reconcileRuby(md, c, '4日以降'); // user actually selected 4日以降

    expect(r.changed).toBe(false);
    expect(r.text).toBe(md); // original Markdown byte-for-byte
    expect(r.repairs).toEqual([]);
    expect(r.issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SELECTED_TEXT_MISMATCH]);
    expect(r.text).not.toContain('みっか'); // the source line was NOT rebuilt
  });

  test('3: self-consistent hallucination — model ### 原句 and contract both say 台風25号発生, selection is 台風24号発生', () => {
    const c = contract('台風25号発生', [
      tk('台風', 'たいふう'), tk('25'), tk('号', 'ごう'), tk('発生', 'はっせい'),
    ]);
    const md = '### 原句\n  - {台風|たいふう}25{号|ごう}{発生|はっせい}\n\n### 漢字提取';
    // both model-side values agree with each other — only the ground truth differs
    const r = reconcileRuby(md, c, '台風24号発生');

    expect(r.changed).toBe(false);
    expect(r.text).toBe(md);
    expect(r.issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SELECTED_TEXT_MISMATCH]);
  });

  test('4: whitespace-exact grounding — a single U+3000 / ASCII / newline difference fails grounding', () => {
    const tokens = [tk('台風', 'たいふう'), tk('　'), tk('接近', 'せっきん')];
    const c = contract('台風　接近', tokens); // full-width space
    const md = '### 原句\n- {台風|たいぷう}　{接近|せっきん}'; // wrong reading たいぷう

    // exact match → succeeds (source line rebuilt to たいふう, U+3000 kept)
    const okr = reconcileRuby(md, c, '台風　接近');
    expect(okr.changed).toBe(true);
    expect(okr.text.split('\n')[1]).toBe('- {台風|たいふう}　{接近|せっきん}');
    // ASCII space instead of U+3000 → grounding fails (no normalization)
    expect(reconcileRuby(md, c, '台風 接近').issues.map((i) => i.code))
      .toEqual([RCN.RECONCILE_SELECTED_TEXT_MISMATCH]);
    // trailing newline → grounding fails (no trim)
    expect(reconcileRuby(md, c, '台風　接近\n').issues.map((i) => i.code))
      .toEqual([RCN.RECONCILE_SELECTED_TEXT_MISMATCH]);
    // leading space → grounding fails (no trim)
    expect(reconcileRuby(md, c, ' 台風　接近').issues.map((i) => i.code))
      .toEqual([RCN.RECONCILE_SELECTED_TEXT_MISMATCH]);
  });

  test('expectedSourceText missing / not a string → grounding fails (production must pass it)', () => {
    const c = contract('あ', [tk('あ')]);
    const md = '### 原句\n- {あ|あ}';
    expect(reconcileRuby(md, c).issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SELECTED_TEXT_MISMATCH]);
    expect(reconcileRuby(md, c, 123).issues.map((i) => i.code)).toEqual([RCN.RECONCILE_SELECTED_TEXT_MISMATCH]);
  });

  test('trust chain: selection === contract.sourceText === stripped ### 原句 surface enables reconstruction', () => {
    const c = contract('3日以降', [tk('3'), tk('日', 'みっか'), tk('以降', 'いこう')]);
    const md = '### 原句\n- 3{日|にち}{以降|いこう}';
    const selected = '3日以降';

    // link 1: selection === contract.sourceText
    expect(c.sourceText).toBe(selected);
    // link 2: contract.sourceText === stripRubyMarkup(surface)
    expect(stripRubyMarkup('3{日|にち}{以降|いこう}')).toBe(c.sourceText);
    // → authoritative reconstruction applied
    const r = reconcileRuby(md, c, selected);
    expect(sourceLine(r.text)).toBe('- 3{日|みっか}{以降|いこう}');

    // break link 1 only → refuse
    expect(reconcileRuby(md, c, '別のテキスト').issues.map((i) => i.code))
      .toEqual([RCN.RECONCILE_SELECTED_TEXT_MISMATCH]);
  });
});
