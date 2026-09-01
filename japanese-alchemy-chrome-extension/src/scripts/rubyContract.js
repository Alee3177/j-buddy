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

// --- reading contract (v0.2 Phase 2A) -----------------------------------------
//
// SYSTEM_PROMPT_V2 appends, as the FINAL fenced ```json block of the model
// response, an authoritative reading-segmentation contract for the original
// analysis target. Phase 2A only *parses and structurally validates* that block
// — it is NOT wired into the runtime, NOT reconciled against the inline
// `{漢字|かな}` ruby, and NOT persisted. Making it authoritative is Phase 2B.

export const READING_CONTRACT_ISSUE_CODES = Object.freeze({
  READING_CONTRACT_NOT_FOUND: 'READING_CONTRACT_NOT_FOUND',
  READING_CONTRACT_INVALID_JSON: 'READING_CONTRACT_INVALID_JSON',
  READING_CONTRACT_INVALID_SHAPE: 'READING_CONTRACT_INVALID_SHAPE',
  READING_CONTRACT_UNSUPPORTED_VERSION: 'READING_CONTRACT_UNSUPPORTED_VERSION',
  READING_CONTRACT_EMPTY_TOKEN: 'READING_CONTRACT_EMPTY_TOKEN',
  READING_CONTRACT_INVALID_READING: 'READING_CONTRACT_INVALID_READING',
  READING_CONTRACT_SOURCE_MISMATCH: 'READING_CONTRACT_SOURCE_MISMATCH',
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
 * Locate and STRUCTURALLY validate the authoritative reading-contract JSON block
 * that SYSTEM_PROMPT_V2 appends as the final fenced ```json block of a response.
 *
 * Pure and total: no DOM / storage / network / side effects; never throws on any
 * model output.
 *
 * Extraction safety:
 *   - Only the block that is the final non-whitespace content is considered.
 *   - It must be a block-level fence tagged `json`.
 *   - Earlier fenced blocks are ignored.
 *   - The parsed value must be an object carrying `reading_contract_version`;
 *     arbitrary final JSON (e.g. `{"foo":"bar"}`) is rejected as NOT_FOUND.
 *
 * Structural validation only (Phase 2A): a contextually wrong reading such as
 * `{ "text": "日", "reading": "にち" }` for `3日` still returns `ok: true`. No
 * NFKC / whitespace / width normalization is performed anywhere. Semantic
 * reconciliation (and any にち→みっか correction) is deferred to Phase 2B and is
 * unrelated to the `SUSPECT_COUNTER_READING` heuristic in `validateRuby`.
 *
 * @param {string} markdown  the full model response text
 * @returns {{ ok: boolean, contract: ReadingContract|null, issues: ReadingContractIssue[] }}
 */
export function parseReadingContract(markdown) {
  const src = typeof markdown === 'string' ? markdown : '';
  const fail = (code, message, index) => ({
    ok: false,
    contract: null,
    issues: [index === undefined ? { code, message } : { code, message, index }],
  });

  // 1. The contract must be the final non-whitespace content and close with ```.
  const fence = locateFinalJsonFence(src);
  if (!fence) {
    return fail(RC.READING_CONTRACT_NOT_FOUND,
      'No block-level json code fence is the final content of the response.');
  }
  const { jsonText } = fence;

  // 2. Parse JSON. Never repair.
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (_err) {
    return fail(RC.READING_CONTRACT_INVALID_JSON, 'The final json block is not valid JSON.');
  }

  // 3. Must be a plain object carrying the discriminator key.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(RC.READING_CONTRACT_NOT_FOUND,
      'The final json block is not a reading-contract object.');
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'reading_contract_version')) {
    return fail(RC.READING_CONTRACT_NOT_FOUND,
      'The final json block has no reading_contract_version; treated as unrelated JSON.');
  }

  // 4. Version must be integer 1.
  const version = parsed.reading_contract_version;
  if (!Number.isInteger(version) || version !== READING_CONTRACT_VERSION) {
    return fail(RC.READING_CONTRACT_UNSUPPORTED_VERSION,
      `Unsupported reading_contract_version: ${JSON.stringify(version)} (expected integer 1).`);
  }

  // 5. Structural shape.
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

  // 6. Concatenation must reproduce source_text byte-for-byte (no normalization).
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

/**
 * Split a completed model response into its human-readable Markdown and the
 * authoritative reading-contract JSON block, for the v0.2 Phase 2B-1 finalize
 * path.
 *
 * The reading contract is METADATA: it must never reach `repairRuby`,
 * `enrichMarkdownWithConjugation`, `formatAnalysisResult`, the rendered panel,
 * Copy / Save-As, or `page.rendered_markdown`. This helper removes it — and
 * ONLY it — when it can be proven valid; otherwise the response is returned
 * untouched (never delete model/user-visible content we cannot prove is a
 * reading contract).
 *
 * Phase 2B-1 does NOT reconcile inline `{漢字|かな}` ruby against the tokens.
 *
 * Stripping rule (deterministic): everything strictly before the opening ``` of
 * the final json fence is kept verbatim, then trailing ASCII spaces, tabs, CR
 * and LF (the Markdown block separator) are removed from that slice. Other
 * whitespace (e.g. U+3000) is preserved.
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
 *   `hadContract` is true when a final json fence clearly intended to be a
 *   reading contract (its raw text references `reading_contract_version`),
 *   whether or not it validated. `contractIssues` is non-empty only in that
 *   "intended but invalid" case — plain absence and unrelated final JSON report
 *   nothing to warn about.
 */
export function separateReadingContract(markdown) {
  const src = typeof markdown === 'string' ? markdown : '';
  const parsed = parseReadingContract(src);

  if (parsed.ok) {
    const fence = locateFinalJsonFence(src);
    // parseReadingContract only returns ok when a fence was found; guard anyway.
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
