/**
 * Ruby Contract — deterministic parser / validator / conservative repairer for
 * the canonical inline furigana format `{漢字|かな}`.
 *
 * Japanese Reader v0.2, Phase 1A.
 *
 * SCOPE: this is a PURE module. Nothing in the running extension imports it yet,
 * so runtime behaviour is unchanged by adding this file. `convertToRuby()` in
 * `src/sidepanel/sidepanel.js` remains the only code path that turns `{...}`
 * into <ruby>. Wiring happens in a later phase.
 *
 * DESIGN CONTRACT
 *   - Detection is broad: `validateRuby` may flag anything that looks wrong.
 *   - Repair is conservative: `repairRuby` (Phase 1A) auto-fixes ONLY
 *     structurally unambiguous cases. Currently that is exactly one class —
 *     a plain-text surface that exactly duplicates the base of the ruby token
 *     immediately after it, with a safe left boundary:
 *         3{日|みっか}以降{以降|いこう}  ->  3{日|みっか}{以降|いこう}
 *   - It NEVER guesses a semantic reading. `3{日|にち}` may be *flagged*
 *     (SUSPECT_COUNTER_READING) but the reading is never rewritten here;
 *     contextual reading correction belongs to the later structured-reading
 *     phase.
 *   - It NEVER normalizes malformed input into a valid token. A segment with an
 *     extra `|`, a missing side, empty base/reading, or nested braces is
 *     reported, not silently fixed.
 *
 * PUBLIC API
 *   tokenizeRuby(text)  -> Token[]                (see @typedef Token)
 *   validateRuby(text)  -> { ok, tokens, issues } (see @typedef Issue)
 *   repairRuby(text)    -> { text, changed, repairs, remainingIssues }
 *   ISSUE_CODES         -> frozen map of the issue-code strings
 */

// --- character classes ------------------------------------------------------

const RE_KANJI = /\p{Script=Han}/u;
const RE_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const RE_DIGIT = /[0-9０-９]/;
// Non-kana, non-Han glyphs that still legitimately appear inside a compound
// ruby base: iteration marks, small-ke counter forms, the nakaguro compound
// separator (existing `{漢字・仮名|…}` behaviour), chōonpu, and the
// equals/hyphen used in coined terms. `・` (U+30FB) and `ー` (U+30FC) are
// Script=Common, so they already fall outside RE_KANA — they are listed here
// only for clarity / future-proofing.
const RE_BASE_EXTRA = /[々〆〇ヶヵ・ー＝\-]/;

// Left-boundary characters before a duplicated surface that make removal of the
// duplicate unambiguous (it cannot be the tail of a longer real word).
const RE_SAFE_DUP_BOUNDARY = /[\s}0-9０-９、。，．・「」『』（）()[\]【】〔〕：:；;…—-]/;

// Day-counter reading heuristic. For these counts the 日 counter is normally
// read with an irregular native form in a calendar-date context
// (ついたち/ふつか/みっか/よっか…/はつか/にじゅうよっか); a plain `にち` there is
// the classic model hallucination. This is warning-only and never auto-repaired
// (`1日` can also be `いちにち` = "one day", so the flag is advisory, not a fix).
const IRREGULAR_DAY_COUNTS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 24]);

export const ISSUE_CODES = Object.freeze({
  UNBALANCED_BRACE: 'UNBALANCED_BRACE',
  MISSING_OPEN_BRACE: 'MISSING_OPEN_BRACE',
  MISSING_CLOSE_BRACE: 'MISSING_CLOSE_BRACE',
  NESTED_BRACE: 'NESTED_BRACE',
  MISSING_PIPE: 'MISSING_PIPE',
  MULTI_PIPE: 'MULTI_PIPE',
  EMPTY_BASE: 'EMPTY_BASE',
  EMPTY_READING: 'EMPTY_READING',
  KANA_ONLY_BASE: 'KANA_ONLY_BASE',
  NON_KANJI_BASE: 'NON_KANJI_BASE',
  DUPLICATE_ADJACENT_SURFACE: 'DUPLICATE_ADJACENT_SURFACE',
  SUSPECT_COUNTER_READING: 'SUSPECT_COUNTER_READING',
});

const SEVERITY = Object.freeze({
  UNBALANCED_BRACE: 'error',
  MISSING_OPEN_BRACE: 'error',
  MISSING_CLOSE_BRACE: 'error',
  NESTED_BRACE: 'error',
  MULTI_PIPE: 'error',
  EMPTY_BASE: 'error',
  EMPTY_READING: 'error',
  MISSING_PIPE: 'warning',
  KANA_ONLY_BASE: 'warning',
  NON_KANJI_BASE: 'warning',
  DUPLICATE_ADJACENT_SURFACE: 'warning',
  SUSPECT_COUNTER_READING: 'warning',
});

// Codes whose default `repairable` flag is true. DUPLICATE_ADJACENT_SURFACE is
// resolved per-occurrence (only when its left boundary is safe), so it is not
// listed here and is stamped explicitly during validation.
const DEFAULT_REPAIRABLE = new Set();

/**
 * @typedef {Object} Token
 * @property {string}      raw      exact source substring, `text.slice(start,end)`
 * @property {number}      start    inclusive source index of the opening `{`
 * @property {number}      end      exclusive source index just past the `}`
 * @property {boolean}     valid    true only for a strict `{base|reading}` shape
 * @property {string|null} base     the base (kanji) side, or null when invalid
 * @property {string|null} reading  the reading (kana) side, or null when invalid
 * @property {string}     [problem] issue code, present only when `valid` is false
 */

/**
 * @typedef {Object} Issue
 * @property {string}  code        one of ISSUE_CODES
 * @property {number}  index       source index the problem anchors to
 * @property {string}  raw         the offending source fragment
 * @property {'error'|'warning'} severity
 * @property {boolean} repairable  whether repairRuby (Phase 1A) will fix it
 */

// --- tokenization ----------------------------------------------------------

const SEGMENT_RE = /\{[^{}]*\}/g;

/**
 * Split `text` into ruby segments. Every `{...}` run that contains no inner
 * brace becomes a Token; well-formed ones are `valid:true` with `base`/`reading`
 * populated, malformed ones are `valid:false` with `base`/`reading` null and a
 * `problem` code. Plain text between segments is not returned.
 *
 * Note: a nested construct such as `{漢{字|じ}|かんじ}` yields the inner
 * `{字|じ}` here; `validateRuby` catches the surrounding NESTED_BRACE and marks
 * the whole input not-ok.
 *
 * @param {string} text
 * @returns {Token[]}
 */
export function tokenizeRuby(text) {
  const src = typeof text === 'string' ? text : '';
  const tokens = [];
  SEGMENT_RE.lastIndex = 0;
  let m;
  while ((m = SEGMENT_RE.exec(src)) !== null) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const inner = raw.slice(1, -1);
    const pipeCount = (inner.match(/\|/g) || []).length;

    if (pipeCount === 0) {
      tokens.push({ raw, start, end, valid: false, base: null, reading: null, problem: ISSUE_CODES.MISSING_PIPE });
      continue;
    }
    if (pipeCount >= 2) {
      tokens.push({ raw, start, end, valid: false, base: null, reading: null, problem: ISSUE_CODES.MULTI_PIPE });
      continue;
    }

    const pipeAt = inner.indexOf('|');
    const base = inner.slice(0, pipeAt);
    const reading = inner.slice(pipeAt + 1);

    if (base === '') {
      tokens.push({ raw, start, end, valid: false, base: null, reading: null, problem: ISSUE_CODES.EMPTY_BASE });
      continue;
    }
    if (reading === '') {
      tokens.push({ raw, start, end, valid: false, base: null, reading: null, problem: ISSUE_CODES.EMPTY_READING });
      continue;
    }

    tokens.push({ raw, start, end, valid: true, base, reading });
  }
  return tokens;
}

// --- base classification --------------------------------------------------

/**
 * Classify a token base as 'OK' | 'KANA_ONLY_BASE' | 'NON_KANJI_BASE'.
 *
 * 'OK'              — at least one Han char, and every other char is a digit or
 *                     an allowed compound glyph (・ ー 々 …). Covers 台風,
 *                     漢字・仮名, 2024年, 警報級.
 * 'KANA_ONLY_BASE'  — no Han char, base is entirely kana. Ruby over kana is
 *                     almost always a mistake.
 * 'NON_KANJI_BASE'  — everything else: kana mixed into a kanji span
 *                     (関東も週末), latin letters (ＡＩ), digits-only base, …
 *
 * Both non-OK results are advisory (severity 'warning'); they never block `ok`
 * and are never auto-repaired.
 *
 * @param {string} base
 * @returns {'OK'|'KANA_ONLY_BASE'|'NON_KANJI_BASE'}
 */
function classifyBase(base) {
  let sawKanji = false;
  let sawKana = false;
  let sawOther = false;
  for (const ch of base) {
    if (RE_KANJI.test(ch)) sawKanji = true;
    else if (RE_KANA.test(ch)) sawKana = true;
    else if (RE_DIGIT.test(ch) || RE_BASE_EXTRA.test(ch)) { /* allowed filler */ }
    else sawOther = true;
  }
  if (sawKanji && !sawKana && !sawOther) return 'OK';
  if (!sawKanji && sawKana && !sawOther) return 'KANA_ONLY_BASE';
  return 'NON_KANJI_BASE';
}

function isSafeDuplicateBoundary(src, dupStart) {
  if (dupStart <= 0) return true;
  return RE_SAFE_DUP_BOUNDARY.test(src[dupStart - 1]);
}

function toAsciiDigits(s) {
  return s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
}

// --- validation ----------------------------------------------------------

/**
 * Deterministically validate the inline ruby markup in `text`.
 *
 * @param {string} text
 * @returns {{ ok: boolean, tokens: Token[], issues: Issue[] }}
 *   `ok` is false iff at least one issue has severity 'error'. `tokens` is the
 *   full `tokenizeRuby` output (valid and invalid). `issues` is sorted by
 *   source index.
 */
export function validateRuby(text) {
  const src = typeof text === 'string' ? text : '';
  const issues = [];
  const add = (code, index, raw, repairable) => {
    issues.push({
      code,
      index,
      raw,
      severity: SEVERITY[code] || 'error',
      repairable: typeof repairable === 'boolean' ? repairable : DEFAULT_REPAIRABLE.has(code),
    });
  };

  // 1. Structural brace scan (stack-based, byte-accurate indices).
  const stack = [];
  let nestedFlagged = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') {
      if (stack.length > 0 && !nestedFlagged) {
        const outer = stack[stack.length - 1];
        add(ISSUE_CODES.NESTED_BRACE, outer, src.slice(outer, i + 1));
        nestedFlagged = true;
      }
      stack.push(i);
    } else if (ch === '}') {
      if (stack.length === 0) {
        // Orphan close brace. If a `|` precedes it with no brace in between,
        // this is a ruby token that lost its opening `{` (failure B shape).
        const head = src.slice(0, i);
        const pipeIdx = head.lastIndexOf('|');
        const braceIdx = Math.max(head.lastIndexOf('{'), head.lastIndexOf('}'));
        if (pipeIdx > braceIdx) {
          const segStart = braceIdx + 1;
          add(ISSUE_CODES.MISSING_OPEN_BRACE, segStart, src.slice(segStart, i + 1));
        } else {
          add(ISSUE_CODES.MISSING_OPEN_BRACE, i, '}');
        }
      } else {
        stack.pop();
      }
    }
  }
  for (const idx of stack) {
    add(ISSUE_CODES.MISSING_CLOSE_BRACE, idx, src.slice(idx));
  }
  const opens = (src.match(/\{/g) || []).length;
  const closes = (src.match(/\}/g) || []).length;
  if (opens !== closes) {
    add(ISSUE_CODES.UNBALANCED_BRACE, 0, `{ x${opens} } x${closes}`);
  }

  // 2. Token-level checks.
  const tokens = tokenizeRuby(src);
  for (const t of tokens) {
    if (!t.valid) {
      if (t.problem) add(t.problem, t.start, t.raw);
      continue;
    }

    const cls = classifyBase(t.base);
    if (cls === 'KANA_ONLY_BASE') add(ISSUE_CODES.KANA_ONLY_BASE, t.start, t.raw);
    else if (cls === 'NON_KANJI_BASE') add(ISSUE_CODES.NON_KANJI_BASE, t.start, t.raw);

    // Duplicated adjacent surface: the plain text immediately before the token
    // is byte-for-byte the token base. Detected broadly; only marked repairable
    // when the left boundary guarantees the removal is unambiguous.
    const dupStart = t.start - t.base.length;
    if (dupStart >= 0 && src.slice(dupStart, t.start) === t.base) {
      add(
        ISSUE_CODES.DUPLICATE_ADJACENT_SURFACE,
        dupStart,
        t.base + t.raw,
        isSafeDuplicateBoundary(src, dupStart),
      );
    }

    // Suspect day-counter reading (narrow, 日 only, never repaired here).
    if (t.base === '日' && t.reading === 'にち') {
      const numMatch = /([0-9０-９]+)$/.exec(src.slice(0, t.start));
      if (numMatch && IRREGULAR_DAY_COUNTS.has(Number(toAsciiDigits(numMatch[1])))) {
        add(ISSUE_CODES.SUSPECT_COUNTER_READING, t.start, numMatch[1] + t.raw, false);
      }
    }
  }

  issues.sort((a, b) => a.index - b.index || a.code.localeCompare(b.code));
  const ok = !issues.some((i) => i.severity === 'error');
  return { ok, tokens, issues };
}

// --- repair --------------------------------------------------------------

/**
 * Apply the Phase 1A conservative repairs to `text`.
 *
 * Currently repairs exactly one class: DUPLICATE_ADJACENT_SURFACE occurrences
 * whose left boundary is safe (`repairable: true`). The duplicated plain-text
 * copy of the following token's base is deleted. Everything else — missing
 * braces, extra pipes, empty sides, suspect readings, non-kanji bases — is
 * reported in `remainingIssues` and left untouched.
 *
 * Pure and total: never throws. Idempotent — running it on its own output makes
 * no further change.
 *
 * @param {string} text
 * @returns {{ text: string, changed: boolean, repairs: Array<{code:string,index:number,removed:string}>, remainingIssues: Issue[] }}
 */
export function repairRuby(text) {
  const src = typeof text === 'string' ? text : '';
  const { issues } = validateRuby(src);

  const repairableDups = issues
    .filter((i) => i.code === ISSUE_CODES.DUPLICATE_ADJACENT_SURFACE && i.repairable)
    .sort((a, b) => b.index - a.index); // right-to-left keeps earlier indices valid

  if (repairableDups.length === 0) {
    return { text: src, changed: false, repairs: [], remainingIssues: issues };
  }

  let out = src;
  const repairs = [];
  for (const issue of repairableDups) {
    const braceAt = issue.raw.indexOf('{');
    const surface = braceAt === -1 ? '' : issue.raw.slice(0, braceAt);
    if (!surface) continue;
    if (out.slice(issue.index, issue.index + surface.length) !== surface) continue;
    out = out.slice(0, issue.index) + out.slice(issue.index + surface.length);
    repairs.push({ code: issue.code, index: issue.index, removed: surface });
  }

  const changed = out !== src;
  return {
    text: out,
    changed,
    repairs,
    remainingIssues: validateRuby(out).issues,
  };
}
