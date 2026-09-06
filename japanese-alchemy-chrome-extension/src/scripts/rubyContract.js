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

// --- reading contract (v0.2 Phase 2A; P0-C1 marker-based relocation) ---------
//
// v0.3 P0-C1: SYSTEM_PROMPT_V2 now emits the reading contract FIRST — before any
// prose — wrapped in two literal sentinel lines so it can be found and removed
// regardless of where it lands, instead of relying on "the final fenced block":
//
//   <!-- READING_CONTRACT_START -->
//   ```json
//   { ...contract... }
//   ```
//   <!-- READING_CONTRACT_END -->
//
// Rationale: the managed completion budget (max_tokens) is shared between the
// contract and all prose sections. When the contract was emitted LAST, output
// truncation on long/dense input silently lost it. Emitting it FIRST, behind an
// unambiguous marker, means it is fully written (and extractable) before any
// prose generation even starts — truncation later in the response can no longer
// take the contract down with it.
//
// Extraction order (both `parseReadingContract` and `separateReadingContract`):
//   1. Marked format: if `<!-- READING_CONTRACT_START -->` appears anywhere in
//      the text, that occurrence — and ONLY that occurrence — is treated as the
//      contract. This makes an unrelated ```json block elsewhere in the prose
//      (teaching content, an earlier draft, anything) impossible to confuse
//      with the contract: nothing without the literal marker is ever considered.
//   2. Legacy fallback: if no marker is present at all, fall back to the v0.3
//      Phase 2A/2B rule unchanged — the contract is the final fenced ```json
//      block. This keeps every already-saved response and every existing test
//      built on that shape parsing exactly as before.
//
// A marker that begins but never resolves to a complete, closed fence (model
// output cut off mid-contract) is reported as READING_CONTRACT_TRUNCATED —
// never silently treated as "no contract" — and everything from the start
// marker onward is stripped from `humanMarkdown` (it cannot be valid prose: by
// markdown fence semantics, an unclosed ``` swallows everything after it
// anyway), so no partial JSON metadata can leak into rendered/copied/saved
// output.
//
// P0-C1.1: a real-model sample can emit the marked block MORE THAN ONCE —
// e.g. an invalid first attempt, a narrated self-correction, then a second
// attempt. `locateAllMarkedContractBlocks` finds every occurrence in document
// order; the LAST occurrence is always treated as the model's final intent
// and is the ONLY one ever validated — there is no fallback to an earlier
// valid attempt under any circumstance (a later attempt may deliberately
// supersede/correct an earlier one, so trusting anything but the last would
// risk using data the model itself was in the middle of retracting). Stripping
// always removes the single continuous span from the FIRST occurrence's start
// through the SELECTED (last) occurrence's end, which removes every earlier
// attempt, the selected attempt, and any narration in between as one
// structural unit — no content-based sniffing of what counts as "narration"
// is needed or performed. Exactly one occurrence reproduces the original
// P0-C1 behavior byte-for-byte, since the first and selected occurrence are
// then the same object.

export const READING_CONTRACT_MARKER = Object.freeze({
  START: '<!-- READING_CONTRACT_START -->',
  END: '<!-- READING_CONTRACT_END -->',
});

export const READING_CONTRACT_ISSUE_CODES = Object.freeze({
  READING_CONTRACT_NOT_FOUND: 'READING_CONTRACT_NOT_FOUND',
  READING_CONTRACT_INVALID_JSON: 'READING_CONTRACT_INVALID_JSON',
  READING_CONTRACT_INVALID_SHAPE: 'READING_CONTRACT_INVALID_SHAPE',
  READING_CONTRACT_UNSUPPORTED_VERSION: 'READING_CONTRACT_UNSUPPORTED_VERSION',
  READING_CONTRACT_EMPTY_TOKEN: 'READING_CONTRACT_EMPTY_TOKEN',
  READING_CONTRACT_INVALID_READING: 'READING_CONTRACT_INVALID_READING',
  READING_CONTRACT_SOURCE_MISMATCH: 'READING_CONTRACT_SOURCE_MISMATCH',
  // P0-C1: a marked contract attempt was detected (the start marker is
  // present) but never resolved into a complete, closed json fence — distinct
  // from READING_CONTRACT_NOT_FOUND, which means no attempt was ever made.
  READING_CONTRACT_TRUNCATED: 'READING_CONTRACT_TRUNCATED',
  // P0-C1.1: more than one marked contract attempt was found. This is purely
  // informational alongside a real validation failure on the selected (last)
  // attempt — it never appears by itself, and never causes an otherwise-valid
  // final attempt to fail.
  READING_CONTRACT_MULTIPLE_ATTEMPTS: 'READING_CONTRACT_MULTIPLE_ATTEMPTS',
});

const RC = READING_CONTRACT_ISSUE_CODES;
const READING_CONTRACT_VERSION = 1;

/**
 * @typedef {Object} ReadingContractToken
 * @property {string}      text     a contiguous substring of the source text
 * @property {string|null} reading  kana reading, or null for text needing none
 */
/**
 * @typedef {Object} ReadingContract
 * @property {1}                      version
 * @property {string}                 sourceText
 * @property {ReadingContractToken[]} tokens
 */
/**
 * @typedef {Object} ReadingContractIssue
 * @property {string}  code      one of READING_CONTRACT_ISSUE_CODES
 * @property {string}  message   human-readable detail (developer-facing)
 * @property {number} [index]    token index / first mismatch offset, when known
 */

function firstDiffIndex(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return n;
}

/**
 * Locate the fenced code block that is the final non-whitespace content of
 * `src`, when and only when it is a block-level fence tagged `json`. Shared by
 * `parseReadingContract` and `separateReadingContract` so both agree exactly on
 * what "the final json block" is.
 *
 * @param {string} src
 * @returns {{ jsonText: string, openIdx: number, closeEnd: number }|null}
 *   `openIdx` is the source index of the opening ``` ; `closeEnd` is the source
 *   index just past the closing ``` (trailing whitespace excluded). Returns null
 *   when there is no such block (no fence, not final, not block-level, not json).
 */
function locateFinalJsonFence(src) {
  const trimmedEnd = src.replace(/\s+$/, '');
  if (!trimmedEnd || !/```$/.test(trimmedEnd)) return null;

  const closeIdx = trimmedEnd.lastIndexOf('```');
  const beforeClose = trimmedEnd.slice(0, closeIdx);
  const openIdx = beforeClose.lastIndexOf('```');
  if (openIdx === -1) return null;
  if (openIdx !== 0 && beforeClose[openIdx - 1] !== '\n') return null;

  const openLineEnd = beforeClose.indexOf('\n', openIdx);
  if (openLineEnd === -1) return null;
  const infoString = beforeClose.slice(openIdx + 3, openLineEnd).trim();
  if (infoString.toLowerCase() !== 'json') return null;

  return {
    jsonText: beforeClose.slice(openLineEnd + 1),
    openIdx,
    closeEnd: closeIdx + 3,
  };
}

/**
 * STRUCTURALLY validate one candidate contract JSON text (the raw text between
 * a fence's opening and closing ```), regardless of where that fence was found.
 * Shared by the marked-format and legacy-format extraction paths so both apply
 * byte-for-byte identical validation rules.
 *
 * Structural validation only (Phase 2A): a contextually wrong reading such as
 * `{ "text": "日", "reading": "にち" }` for `3日` still returns `ok: true`. No
 * NFKC / whitespace / width normalization is performed anywhere.
 *
 * @param {string} jsonText
 * @returns {{ ok: boolean, contract: ReadingContract|null, issues: ReadingContractIssue[] }}
 */
function validateContractJsonText(jsonText) {
  const fail = (code, message, index) => ({
    ok: false,
    contract: null,
    issues: [index === undefined ? { code, message } : { code, message, index }],
  });

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (_err) {
    return fail(RC.READING_CONTRACT_INVALID_JSON, 'The json block is not valid JSON.');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(RC.READING_CONTRACT_NOT_FOUND,
      'The json block is not a reading-contract object.');
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'reading_contract_version')) {
    return fail(RC.READING_CONTRACT_NOT_FOUND,
      'The json block has no reading_contract_version; treated as unrelated JSON.');
  }

  const version = parsed.reading_contract_version;
  if (!Number.isInteger(version) || version !== READING_CONTRACT_VERSION) {
    return fail(RC.READING_CONTRACT_UNSUPPORTED_VERSION,
      `Unsupported reading_contract_version: ${JSON.stringify(version)} (expected integer 1).`);
  }

  if (typeof parsed.source_text !== 'string') {
    return fail(RC.READING_CONTRACT_INVALID_SHAPE, 'source_text must be a string.');
  }
  if (!Array.isArray(parsed.tokens)) {
    return fail(RC.READING_CONTRACT_INVALID_SHAPE, 'tokens must be an array.');
  }

  const sourceText = parsed.source_text;
  const tokens = [];
  for (let i = 0; i < parsed.tokens.length; i += 1) {
    const rawToken = parsed.tokens[i];
    if (rawToken === null || typeof rawToken !== 'object' || Array.isArray(rawToken)) {
      return fail(RC.READING_CONTRACT_INVALID_SHAPE, `tokens[${i}] must be an object.`, i);
    }
    const { text, reading } = rawToken;
    if (typeof text !== 'string' || text.length === 0) {
      return fail(RC.READING_CONTRACT_EMPTY_TOKEN,
        `tokens[${i}].text must be a non-empty string.`, i);
    }
    const readingOk = reading === null || (typeof reading === 'string' && reading.length > 0);
    if (!readingOk) {
      return fail(RC.READING_CONTRACT_INVALID_READING,
        `tokens[${i}].reading must be a non-empty kana string or null.`, i);
    }
    tokens.push({ text, reading: reading === null ? null : reading });
  }

  // Concatenation must reproduce source_text byte-for-byte (no normalization).
  const concatenated = tokens.map((t) => t.text).join('');
  if (concatenated !== sourceText) {
    return fail(RC.READING_CONTRACT_SOURCE_MISMATCH,
      'Concatenating token.text in order does not equal source_text.',
      firstDiffIndex(concatenated, sourceText));
  }

  return {
    ok: true,
    contract: { version: READING_CONTRACT_VERSION, sourceText, tokens },
    issues: [],
  };
}

/** Legacy (pre-P0-C1) extraction: the contract is the final fenced ```json block. */
function parseLegacyFinalFenceContract(src) {
  const fence = locateFinalJsonFence(src);
  if (!fence) {
    return {
      ok: false,
      contract: null,
      issues: [{
        code: RC.READING_CONTRACT_NOT_FOUND,
        message: 'No block-level json code fence is the final content of the response.',
      }],
    };
  }
  return validateContractJsonText(fence.jsonText);
}

/** Legacy (pre-P0-C1) split: strip the final fence only when it validates. */
function separateLegacyFinalFenceContract(src) {
  const parsed = parseLegacyFinalFenceContract(src);

  if (parsed.ok) {
    const fence = locateFinalJsonFence(src);
    if (!fence) {
      return { markdown: src, readingContract: null, contractIssues: [], hadContract: false };
    }
    const humanMarkdown = src.slice(0, fence.openIdx).replace(/[ \t\r\n]+$/, '');
    return {
      markdown: humanMarkdown,
      readingContract: parsed.contract,
      contractIssues: [],
      hadContract: true,
    };
  }

  // Not a valid contract. Only treat it as a (broken) reading-contract attempt —
  // and only then surface issues / a warning — when a final json fence exists
  // whose raw text clearly intends to be one. Never strip anything here.
  const fence = locateFinalJsonFence(src);
  const intendsContract = Boolean(fence && /"reading_contract_version"\s*:/.test(fence.jsonText));

  if (!intendsContract) {
    return { markdown: src, readingContract: null, contractIssues: [], hadContract: false };
  }
  return {
    markdown: src,
    readingContract: null,
    contractIssues: parsed.issues,
    hadContract: true,
  };
}

/**
 * Match a block-level ```json fence OPEN whose ``` starts at exactly index `i`
 * (callers guarantee `i` is a line start). Returns `{ bodyStart }` — the index
 * just past the opening line's own newline — or `null` when `src` at `i` is not
 * such a fence.
 */
function matchJsonFenceOpenAt(src, i) {
  if (src.slice(i, i + 3) !== '```') return null;
  const lineEnd = src.indexOf('\n', i);
  if (lineEnd === -1) return null;
  const infoString = src.slice(i + 3, lineEnd).trim();
  if (infoString.toLowerCase() !== 'json') return null;
  return { bodyStart: lineEnd + 1 };
}

/**
 * Scan forward line-by-line from `from` (a line-start index) for the next
 * block-level closing fence line (up to 3 leading spaces, exactly ```, only
 * trailing whitespace after). Returns `{ openIdx, closeEnd }` (the index of
 * that line's ``` and the index just past it) or `null` if none is found
 * before the end of `src` (i.e. the fence never closes).
 */
function findNextClosingFenceLine(src, from) {
  let pos = from;
  while (pos <= src.length) {
    const lineEnd = src.indexOf('\n', pos);
    const line = lineEnd === -1 ? src.slice(pos) : src.slice(pos, lineEnd);
    if (/^ {0,3}```[ \t]*$/.test(line)) {
      const openIdx = pos + line.indexOf('```');
      return { openIdx, closeEnd: openIdx + 3 };
    }
    if (lineEnd === -1) return null;
    pos = lineEnd + 1;
  }
  return null;
}

/**
 * Resolve ONE marked reading-contract attempt whose START marker is already
 * known to begin at `startIdx` — this function never searches for the marker
 * itself, so it can be called once per occurrence when scanning for multiple
 * attempts. This is the exact per-occurrence logic the original P0-C1
 * single-occurrence locator used, unchanged, just parameterized.
 *
 * Returns `{ attempted: true, state, startIdx, ... }`:
 *   - state 'NO_FENCE_STARTED': the start marker is present, but the first
 *     non-whitespace content after it is not a ```json fence open.
 *   - state 'FENCE_NOT_CLOSED': a fence opened right after the marker, but no
 *     closing ``` line was ever found before the end of `src` (truncation).
 *   - state 'COMPLETE': `jsonText`, plus `endMarkerFound` / `endMarkerEnd` —
 *     the end marker is read if present but is NOT required for validity (the
 *     closing fence alone unambiguously ends the block); it only widens the
 *     range removed from `humanMarkdown` when present.
 *
 * Deliberately narrow: the fence must follow the start marker with nothing but
 * whitespace in between, so a marker can never reach across unrelated prose to
 * grab some later, unrelated ```json block (teaching content, an example,
 * etc.) as if it were the contract.
 *
 * @param {string} src
 * @param {number} startIdx  index of a known `READING_CONTRACT_MARKER.START` occurrence
 */
function resolveMarkedBlockAt(src, startIdx) {
  const END = READING_CONTRACT_MARKER.END;

  let i = startIdx + READING_CONTRACT_MARKER.START.length;
  while (i < src.length && /\s/.test(src[i])) i += 1;

  const open = matchJsonFenceOpenAt(src, i);
  if (!open) {
    return { attempted: true, state: 'NO_FENCE_STARTED', startIdx };
  }

  const closed = findNextClosingFenceLine(src, open.bodyStart);
  if (!closed) {
    return { attempted: true, state: 'FENCE_NOT_CLOSED', startIdx };
  }

  const jsonText = src.slice(open.bodyStart, closed.openIdx);

  let k = closed.closeEnd;
  while (k < src.length && /\s/.test(src[k])) k += 1;
  const endMarkerFound = src.slice(k, k + END.length) === END;
  const endMarkerEnd = endMarkerFound ? k + END.length : closed.closeEnd;

  return {
    attempted: true,
    state: 'COMPLETE',
    startIdx,
    jsonText,
    endMarkerFound,
    endMarkerEnd,
  };
}

/**
 * Locate EVERY explicitly-marked reading-contract attempt in `src`, in
 * document order (P0-C1.1).
 *
 * Returns `null` when `READING_CONTRACT_MARKER.START` does not appear at all
 * (the caller should fall back to the legacy final-fence rule) — the same
 * null-signal contract the original single-occurrence locator used.
 *
 * Otherwise returns `{ occurrences, first, selected, occurrenceCount }`:
 *   - `occurrences`: every resolved attempt, in document order.
 *   - `first`: `occurrences[0]`. Stripping always begins at its `startIdx`,
 *     regardless of which occurrence is selected.
 *   - `selected`: the LAST occurrence — the model's final intent. Multiple
 *     attempts are never merged or compared; only the last is ever validated
 *     or used, with no fallback to an earlier valid attempt.
 *   - `occurrenceCount`: `occurrences.length`. Exactly 1 makes `first` and
 *     `selected` the same object, reproducing the original P0-C1
 *     single-occurrence behavior byte-for-byte.
 *
 * The scan advances monotonically (an O(n) single forward pass — never
 * revisits already-resolved text) and stops looking for further occurrences
 * as soon as one resolves to `FENCE_NOT_CLOSED`: an unclosed fence swallows
 * everything after it (the existing single-occurrence truncation semantics),
 * so anything a further `indexOf` might find past that point would actually
 * be text INSIDE the unclosed fence, not a genuine further attempt.
 *
 * @param {string} src
 * @returns {{ occurrences: object[], first: object, selected: object, occurrenceCount: number }|null}
 */
function locateAllMarkedContractBlocks(src) {
  const START = READING_CONTRACT_MARKER.START;
  const occurrences = [];
  let searchFrom = 0;

  // eslint-disable-next-line no-constant-condition -- terminates via break; searchFrom strictly advances each iteration
  while (true) {
    const startIdx = src.indexOf(START, searchFrom);
    if (startIdx === -1) break;

    const block = resolveMarkedBlockAt(src, startIdx);
    occurrences.push(block);

    if (block.state === 'COMPLETE') {
      searchFrom = block.endMarkerEnd;
    } else if (block.state === 'FENCE_NOT_CLOSED') {
      break;
    } else {
      // NO_FENCE_STARTED consumes nothing from src; resume just past this
      // marker so a later, genuine attempt can still be found.
      searchFrom = startIdx + START.length;
    }
  }

  if (occurrences.length === 0) return null;
  return {
    occurrences,
    first: occurrences[0],
    selected: occurrences[occurrences.length - 1],
    occurrenceCount: occurrences.length,
  };
}

function truncatedContractMessage(state) {
  return state === 'NO_FENCE_STARTED'
    ? 'A Reading Contract start marker was found but no json fence followed it.'
    : 'A Reading Contract start marker and fence were found but the fence never closed (truncated).';
}

function multipleAttemptsMessage(occurrenceCount) {
  return `${occurrenceCount} marked Reading Contract attempts were found; only the last was validated, `
    + 'with no fallback to any earlier attempt.';
}

/** Keep `before`'s content and `after`'s content, joined by exactly one blank line when both are non-empty. */
function joinAroundRemovedBlock(before, after) {
  const b = before.replace(/[ \t\r\n]+$/, '');
  const a = after.replace(/^[ \t\r\n]+/, '');
  if (b && a) return `${b}\n\n${a}`;
  return b || a;
}

/**
 * Locate and STRUCTURALLY validate the authoritative reading-contract JSON
 * block. Tries the P0-C1 explicitly-marked format first (wherever it appears
 * in the text); falls back to the legacy v0.3 rule (the final fenced ```json
 * block) only when no start marker is present at all. See the file-level
 * comment above `READING_CONTRACT_MARKER` for the full rationale.
 *
 * Pure and total: no DOM / storage / network / side effects; never throws on
 * any model output.
 *
 * @param {string} markdown  the full model response text
 * @returns {{ ok: boolean, contract: ReadingContract|null, issues: ReadingContractIssue[] }}
 */
export function parseReadingContract(markdown) {
  const src = typeof markdown === 'string' ? markdown : '';

  const located = locateAllMarkedContractBlocks(src);
  if (located) {
    const { selected, occurrenceCount } = located;
    const multipleAttemptsIssue = { code: RC.READING_CONTRACT_MULTIPLE_ATTEMPTS, message: multipleAttemptsMessage(occurrenceCount) };

    if (selected.state === 'COMPLETE') {
      const result = validateContractJsonText(selected.jsonText);
      if (result.ok || occurrenceCount === 1) return result;
      return { ok: false, contract: null, issues: [...result.issues, multipleAttemptsIssue] };
    }

    const issues = [{ code: RC.READING_CONTRACT_TRUNCATED, message: truncatedContractMessage(selected.state) }];
    if (occurrenceCount > 1) issues.push(multipleAttemptsIssue);
    return { ok: false, contract: null, issues };
  }

  return parseLegacyFinalFenceContract(src);
}

/**
 * Split a completed model response into its human-readable Markdown and the
 * authoritative reading-contract JSON block.
 *
 * The reading contract is METADATA: it must never reach `repairRuby`,
 * `enrichMarkdownWithConjugation`, `formatAnalysisResult`, the rendered panel,
 * Copy / Save-As, or `page.rendered_markdown`.
 *
 * Two different stripping policies apply, deliberately:
 *   - MARKED format: the literal `READING_CONTRACT_MARKER.START` is proof the
 *     model was attempting to emit a reading contract at that exact spot —
 *     nothing else in the prompt ever asks for that string. Once the block's
 *     boundaries are known (a closed fence, or a truncated one that runs to
 *     end-of-string), the whole block is ALWAYS stripped, whether or not its
 *     JSON validates — it can never be legitimate human-readable prose either
 *     way. Validity only decides whether `readingContract` is populated or
 *     `contractIssues` reports why it wasn't.
 *   - LEGACY format (no marker at all): unchanged v0.3 behavior. There is no
 *     equivalent proof-of-intent, only a heuristic ("the final fence mentions
 *     reading_contract_version"), so this path stays conservative — it
 *     removes the block ONLY when it can be proven valid, and otherwise
 *     leaves the response untouched (never delete model/user-visible content
 *     we cannot prove is a reading contract).
 *
 * P0-C1 extraction order (see the file-level comment above
 * `READING_CONTRACT_MARKER`):
 *   1. Marked format, wherever it appears: the block from the start marker
 *      through the end marker (or through the closing fence, if the end
 *      marker is absent) is removed; everything before AND after it is kept
 *      verbatim (position-independent — the contract no longer has to be
 *      last).
 *   2. A marked attempt that never resolves into a complete, closed fence
 *      (READING_CONTRACT_TRUNCATED) is debris by construction — a markdown
 *      fence that never closes swallows everything after it — so everything
 *      from the start marker to the end of the response is stripped, and
 *      `hadContract`/`contractIssues` make the failure explicit rather than
 *      silently reporting "no contract".
 *   3. Legacy fallback (no marker present at all): unchanged v0.3 behavior —
 *      the contract must be the final fenced ```json block to be recognized
 *      or stripped at all.
 *
 * Pure and total: no DOM / storage / network / side effects; never throws.
 *
 * @param {string} markdown  the full completed model response
 * @returns {{
 *   markdown: string,
 *   readingContract: ReadingContract|null,
 *   contractIssues: ReadingContractIssue[],
 *   hadContract: boolean,
 * }}
 *   `hadContract` is true whenever a reading-contract attempt was clearly
 *   intended (a start marker, or a legacy final fence referencing
 *   `reading_contract_version`), whether or not it validated. `contractIssues`
 *   is non-empty only in that "intended but invalid/truncated" case — plain
 *   absence and unrelated JSON report nothing to warn about.
 */
export function separateReadingContract(markdown) {
  const src = typeof markdown === 'string' ? markdown : '';

  const located = locateAllMarkedContractBlocks(src);
  if (located) {
    const { first, selected, occurrenceCount } = located;
    // P0-C1.1: stripping always spans from the FIRST occurrence's start
    // through the SELECTED (last) occurrence's end — this removes every
    // earlier attempt, the selected attempt itself, and any narration in
    // between as one continuous structural unit. When occurrenceCount === 1,
    // `first` and `selected` are the same object, so this is byte-for-byte
    // the original P0-C1 single-occurrence computation.
    const attemptCountField = occurrenceCount > 1 ? { contractAttemptCount: occurrenceCount } : {};

    if (selected.state === 'COMPLETE') {
      const parsed = validateContractJsonText(selected.jsonText);
      const strippedMarkdown = joinAroundRemovedBlock(
        src.slice(0, first.startIdx),
        src.slice(selected.endMarkerEnd),
      );
      let contractIssues = [];
      if (!parsed.ok) {
        contractIssues = occurrenceCount > 1
          ? [...parsed.issues, { code: RC.READING_CONTRACT_MULTIPLE_ATTEMPTS, message: multipleAttemptsMessage(occurrenceCount) }]
          : parsed.issues;
      }
      return {
        markdown: strippedMarkdown,
        readingContract: parsed.ok ? parsed.contract : null,
        contractIssues,
        hadContract: true,
        ...attemptCountField,
      };
    }
    // Truncated/malformed final attempt: strip from the FIRST occurrence's
    // start onward (never valid prose — see the doc comment above) and report
    // it plainly. Any earlier, otherwise-valid attempt is discarded too: the
    // model's last visible intent was this truncated one, so falling back to
    // an earlier attempt would silently use data the model may have been in
    // the middle of retracting.
    const truncationIssues = [{ code: RC.READING_CONTRACT_TRUNCATED, message: truncatedContractMessage(selected.state) }];
    if (occurrenceCount > 1) {
      truncationIssues.push({ code: RC.READING_CONTRACT_MULTIPLE_ATTEMPTS, message: multipleAttemptsMessage(occurrenceCount) });
    }
    return {
      markdown: src.slice(0, first.startIdx).replace(/[ \t\r\n]+$/, ''),
      readingContract: null,
      contractIssues: truncationIssues,
      hadContract: true,
      ...attemptCountField,
    };
  }

  return separateLegacyFinalFenceContract(src);
}

// --- ruby reconciliation (v0.2 Phase 2B-2) ----------------------------------
//
// When a valid reading contract is present, its tokens are AUTHORITATIVE for the
// original selected source text. Phase 2B-2 uses them to rebuild the inline ruby
// of ONE line only — the Japanese source presentation under `### 原句`. It never
// touches 漢字提取 / 單字分析 / 文法分析 / 搭配分析 / 語體 sections, generated
// examples, templates, recall questions, conjugation forms, or the 翻譯 line:
// the contract describes 【分析対象】, not generated teaching content.

export const RUBY_RECONCILE_ISSUE_CODES = Object.freeze({
  // The contract's source_text is not exactly the browser-selected analysis
  // target — grounding failure. Distinct trust boundary: the model could repeat
  // the same fabricated sentence in both ### 原句 and the contract, and only
  // this check catches that.
  RECONCILE_SELECTED_TEXT_MISMATCH: 'RECONCILE_SELECTED_TEXT_MISMATCH',
  RECONCILE_SOURCE_LINE_NOT_FOUND: 'RECONCILE_SOURCE_LINE_NOT_FOUND',
  RECONCILE_SOURCE_LINE_AMBIGUOUS: 'RECONCILE_SOURCE_LINE_AMBIGUOUS',
  // The visible ### 原句 surface is not exactly the contract's source_text.
  RECONCILE_SOURCE_TEXT_MISMATCH: 'RECONCILE_SOURCE_TEXT_MISMATCH',
});
const RCN = RUBY_RECONCILE_ISSUE_CODES;

const RE_GENKU_HEADING = /^\s{0,3}#{1,6}\s+原句\s*[:：]?\s*$/;
const RE_ANY_H1_TO_H3 = /^\s{0,3}#{1,3}\s+\S/;
const RE_LINE_PREFIX = /^(\s*(?:[-*]\s+)?)([\s\S]*)$/;
const RE_TRANSLATION_LINE = /^(?:翻譯|翻译)\s*[:：]/;

/**
 * Remove well-formed `{base|reading}` ruby markup, returning the base surface.
 *
 * Conservative on purpose: only a strict single-pipe, brace-balanced token is
 * stripped. Malformed ruby (`{漢字かな}`, `{漢字|かん|じ}`, `{流|なが}れ込|こ}み`)
 * is left byte-for-byte, so a caller comparing the result to a known plain
 * surface will simply not match and can decline to act.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripRubyMarkup(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$1');
}

/** Rebuild one canonical inline-ruby string from authoritative contract tokens. */
function reconstructCanonicalRuby(tokens) {
  let out = '';
  for (const t of tokens) {
    out += t.reading === null ? t.text : `{${t.text}|${t.reading}}`;
  }
  return out;
}

/**
 * @typedef {Object} ReconcileRepair
 * @property {'RECONCILE_SOURCE_LINE'} code
 * @property {number} start   source index of the replaced content run (prefix excluded)
 * @property {number} end     source index just past the replaced content run
 * @property {string} before  the original source-line content
 * @property {string} after   the canonical content written in its place
 */
/**
 * @typedef {Object} ReconcileIssue
 * @property {string}  code     one of RUBY_RECONCILE_ISSUE_CODES
 * @property {string}  message  developer-facing detail
 * @property {number} [index]
 */

/**
 * Deterministically reconcile the inline ruby of the `### 原句` source line
 * against an authoritative reading contract.
 *
 * Pure, total, deterministic, idempotent, never throws.
 *
 * When `readingContract` is null / not a validated contract, this is a strict
 * no-op (the fallback path — V1 and managed-provider responses are unaffected).
 *
 * When a contract is present it:
 *   0. GROUNDING GUARD: `readingContract.sourceText` must exactly equal
 *      `expectedSourceText` (the request-captured browser selection — the real
 *      ground truth). Both `### 原句` and `sourceText` come from the same model
 *      turn, so without this a self-consistent hallucination would pass. Exact
 *      equality only — no trim / NFKC / width / whitespace normalization. On
 *      mismatch: no reconciliation, one `RECONCILE_SELECTED_TEXT_MISMATCH`.
 *   1. finds the `### 原句` heading and the first non-empty, non-`翻譯` content
 *      line beneath it (before the next `#`/`##`/`###` heading);
 *   2. SOURCE-FIDELITY GUARD: the source line's plain surface — after
 *      `stripRubyMarkup`, and also after the deterministic safe `repairRuby`
 *      pass (so an already-safe-repairable duplicate like `以降{以降|…}` still
 *      qualifies) — must equal `readingContract.sourceText` exactly. Otherwise
 *      it does NOT reconcile and returns a non-fatal issue;
 *   3. replaces ONLY that line's content (line prefix / indentation preserved)
 *      with the canonical ruby rebuilt from the contract tokens.
 *
 * Full authoritative trust chain:
 *   expectedSourceText (browser selection)
 *     === readingContract.sourceText
 *     === stripRubyMarkup(### 原句 surface)   → canonical reconstruction allowed
 *
 * @param {string} markdown         human-only Markdown (contract already removed)
 * @param {ReadingContract|null} readingContract
 * @param {string} expectedSourceText  the request-captured selected analysis
 *   target. Not a string → grounding fails (production must always pass it).
 * @returns {{ text: string, changed: boolean, repairs: ReconcileRepair[], issues: ReconcileIssue[] }}
 */
export function reconcileRuby(markdown, readingContract, expectedSourceText) {
  const src = typeof markdown === 'string' ? markdown : '';
  const noop = () => ({ text: src, changed: false, repairs: [], issues: [] });
  const skip = (code, message) => ({ text: src, changed: false, repairs: [], issues: [{ code, message }] });

  if (!readingContract
      || typeof readingContract !== 'object'
      || typeof readingContract.sourceText !== 'string'
      || !Array.isArray(readingContract.tokens)) {
    return noop();
  }

  // Grounding: the contract must describe the ACTUAL selected text, byte-for-byte.
  if (typeof expectedSourceText !== 'string'
      || readingContract.sourceText !== expectedSourceText) {
    return skip(RCN.RECONCILE_SELECTED_TEXT_MISMATCH,
      'The reading contract source_text is not exactly the selected analysis target.');
  }

  const lines = src.split('\n');

  let headingIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (RE_GENKU_HEADING.test(lines[i])) { headingIdx = i; break; }
  }
  if (headingIdx === -1) {
    return skip(RCN.RECONCILE_SOURCE_LINE_NOT_FOUND, 'No "### 原句" section in the analysis.');
  }

  const candidates = [];
  for (let i = headingIdx + 1; i < lines.length; i += 1) {
    if (RE_ANY_H1_TO_H3.test(lines[i])) break;
    const cr = lines[i].endsWith('\r') ? '\r' : '';
    const bare = cr ? lines[i].slice(0, -1) : lines[i];
    if (bare.trim() === '') continue;
    const m = bare.match(RE_LINE_PREFIX);
    const prefix = m[1];
    const content = m[2];
    if (RE_TRANSLATION_LINE.test(content)) continue;
    candidates.push({ lineIdx: i, cr, prefix, content });
  }
  if (candidates.length === 0) {
    return skip(RCN.RECONCILE_SOURCE_LINE_NOT_FOUND, 'No source line under "### 原句".');
  }

  const { sourceText } = readingContract;
  const surfacesMatch = (content) => {
    if (stripRubyMarkup(content) === sourceText) return true;
    const safe = repairRuby(content);
    return safe.changed && stripRubyMarkup(safe.text) === sourceText;
  };
  const matching = candidates.filter((c) => surfacesMatch(c.content));
  if (matching.length === 0) {
    return skip(RCN.RECONCILE_SOURCE_TEXT_MISMATCH,
      'The "### 原句" source line plain surface does not equal the contract source_text.');
  }
  if (matching.length > 1) {
    return skip(RCN.RECONCILE_SOURCE_LINE_AMBIGUOUS,
      'More than one "### 原句" line matches the contract source_text.');
  }

  const target = matching[0];
  const canonical = reconstructCanonicalRuby(readingContract.tokens);
  if (canonical === target.content) {
    return noop();
  }

  const newLines = lines.slice();
  newLines[target.lineIdx] = target.prefix + canonical + target.cr;
  const text = newLines.join('\n');

  const lineStart = lines.slice(0, target.lineIdx).reduce((n, l) => n + l.length + 1, 0);
  const start = lineStart + target.prefix.length;
  return {
    text,
    changed: true,
    repairs: [{
      code: 'RECONCILE_SOURCE_LINE',
      start,
      end: start + target.content.length,
      before: target.content,
      after: canonical,
    }],
    issues: [],
  };
}
