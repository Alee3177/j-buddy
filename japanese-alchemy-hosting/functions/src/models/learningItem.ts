/**
 * Japanese Reader v0.4 — Learning DB, P0 (pure model / extraction layer).
 *
 * This module is the deterministic, side-effect-free core of the Learning DB
 * feature. It defines the LearningItem entity and turns a saved analysis's
 * `structured_json` into review-ready `NewLearningItem` drafts.
 *
 * P0 scope boundary (see docs/session-close/Japanese_Reader_v0.4 planning):
 *   - NO Firestore access, NO callable wiring, NO webapp / extension code.
 *   - NO Gemini prompt changes, NO LLM calls.
 *   - vocab + grammar item types only.
 *   - status is always NEW; there is NO review scheduling (no reviewCount,
 *     lastReviewedAt, favorite, tags, dueAt, box/ease/interval).
 *   - `reading` / `meaning` are SHOULD fields: extracted ONLY from explicit,
 *     already-present labelled lines. Anything uncertain resolves to null.
 *     Readings and meanings are never invented, inferred, or lemmatised.
 *
 * The analysis page (`analysis_pages/{id}`) remains the immutable source
 * artifact; a LearningItem links back to it by `sourceAnalysisId` and carries
 * only a thin denormalised snapshot for list rendering.
 */

/** The two review-unit kinds v0.4 supports. Reserved for later: sentence,
 * collocation, register. */
export type LearningItemType = "vocab" | "grammar";

/** The v0.4 review loop. Transitions are user-driven; there is no scheduler. */
export type LearningItemStatus = "NEW" | "LEARNING" | "REVIEWED";

/**
 * A persisted Learning DB record. `id` is the Firestore document id and is
 * assigned by the persistence layer (NOT by this module — P0 never fabricates
 * ids). Use `NewLearningItem` for anything not yet written.
 */
export interface LearningItem {
  id: string;
  userId: string;
  sourceAnalysisId: string;
  type: LearningItemType;
  surface: string;
  status: LearningItemStatus;
  createdAt: number;
  updatedAt: number;
  lexicalKey: string;
  // SHOULD / nullable snapshot fields.
  reading: string | null;
  meaning: string | null;
  sourceSentence: string;
  sourceUrl: string | null;
}

/** A LearningItem draft as produced by {@link deriveLearningItems}: everything
 * except the persistence-assigned `id`. */
export type NewLearningItem = Omit<LearningItem, "id">;

/**
 * Loose shape of the `structured_json` blob this module consumes. Every field is
 * optional and every value is treated as untrusted — the extractor tolerates
 * malformed data without throwing (see {@link deriveLearningItems}).
 */
export interface StructuredAnalysisInput {
  words?: unknown;
  grammars?: unknown;
  reading?: unknown;
  [key: string]: unknown;
}

/** Source-artifact metadata copied (verbatim) onto each derived item. */
export interface LearningItemPageMeta {
  sourceText: string;
  sourceUrl?: string | null;
}

/** Ambient inputs the extractor cannot derive from the analysis itself.
 * `now` is injected so derivation is deterministic under test. */
export interface DeriveLearningItemsContext {
  userId: string;
  now: number;
}

/**
 * Explicit vocabulary-detail labels this P0 accepts, in priority order.
 *
 * These match the labels the current managed provider (and the legacy saved
 * shape) actually emit as `讀音：…` / `意思：…` / `解釋：…` lines. A label matches
 * ONLY when it is the whole leading token of a detail line (after an optional
 * markdown bullet) immediately followed by a colon — so `原句中的意思：…` and
 * `核心意思：…` deliberately do NOT match `意思`. Deferred to a later phase:
 * contextual-meaning labels, English gloss, reading-contract token alignment.
 */
export const VOCAB_READING_LABELS: readonly string[] = ["讀音"];
export const VOCAB_MEANING_LABELS: readonly string[] = ["意思", "解釋"];

/**
 * Explicit grammar-explanation meaning labels. The current provider renders its
 * usage note as a bold markdown heading (`- **用法說明**`) followed by prose, not
 * as an inline `用法說明：…` label, so in practice grammar `meaning` is usually
 * null — that is intended for P0 (the full explanation stays reachable via
 * `sourceAnalysisId`). Over-parsing grammar prose is explicitly out of scope.
 */
export const GRAMMAR_MEANING_LABELS: readonly string[] = ["用法說明", "用法"];

/** `{漢字|かんじ}` ruby markup → base text. Mirrors the extension's ruby regex
 * (`src/scripts/rubyContract.js` family): non-nested, first `|` splits. */
const RUBY_TOKEN_PATTERN = /\{([^|{}]+)\|([^{}]+)\}/g;

/** Leading markdown bullet marker on a detail line. */
const LEADING_BULLET_PATTERN = /^[-*・]\s*/;

/**
 * Strip `{base|reading}` ruby markup down to the base text. Pure. A malformed
 * fragment that does not match the token pattern is left untouched (identical to
 * the extension's renderer behaviour).
 */
export function stripRubyMarkup(text: string): string {
  return text.replace(RUBY_TOKEN_PATTERN, "$1");
}

/**
 * Deterministic lexical identity key for a learning item.
 *
 * Format: `type|normalizedSurface|normalizedReading`
 *
 * Normalisation (and nothing more — see the P0 policy):
 *   surface  → strip ruby markup → Unicode NFKC → trim
 *   reading  → Unicode NFKC → trim ; null / undefined / "" → empty segment
 *
 * This intentionally does NOT lemmatise, infer a dictionary form, fold
 * okurigana, lowercase kana/kanji, or touch meaning. It is a grouping key for
 * display-time de-duplication only; `deriveLearningItems` never merges on it.
 *
 * @example computeLexicalKey("vocab", "{改善点|かいぜんてん}", "かいぜんてん") === "vocab|改善点|かいぜんてん"
 * @example computeLexicalKey("grammar", "ても", null) === "grammar|ても|"
 */
export function computeLexicalKey(
  type: LearningItemType,
  surface: string,
  reading: string | null | undefined
): string {
  const normalizedSurface = stripRubyMarkup(typeof surface === "string" ? surface : "")
    .normalize("NFKC")
    .trim();
  const normalizedReading = (typeof reading === "string" ? reading : "")
    .normalize("NFKC")
    .trim();
  return `${type}|${normalizedSurface}|${normalizedReading}`;
}

/**
 * Return the value of the first explicit `<label>：<value>` line found in a
 * detail / explanation blob, scanning labels in priority order and, for each
 * label, lines top-to-bottom. Pure and total.
 *
 * A line matches only when, after trimming and removing one optional leading
 * markdown bullet, it begins with the exact label token followed (after optional
 * spaces) by an ASCII or full-width colon and a non-empty value. Non-string or
 * empty input, and any blob without a supported label, yield null.
 */
export function extractLabeledValue(
  blob: unknown,
  labels: readonly string[]
): string | null {
  if (typeof blob !== "string" || blob.length === 0) return null;
  const lines = blob.split(/\r?\n/);
  for (const label of labels) {
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(LEADING_BULLET_PATTERN, "").trim();
      if (!line.startsWith(label)) continue;
      const rest = line.slice(label.length);
      const match = /^\s*[:：]\s*(.+)$/.exec(rest);
      if (!match) continue;
      const value = match[1].trim();
      if (value.length === 0) continue;
      return value;
    }
  }
  return null;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Array.isArray(entry)
  );
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Derive review-ready LearningItem drafts from a saved analysis's structured
 * JSON. Pure and side-effect-free: the input `structuredJson` (and every nested
 * value) is never mutated.
 *
 * Guarantees (P0 invariants):
 *  1. No mutation of any input.
 *  2. Deterministic output order: input `words` order, then input `grammars`
 *     order.
 *  3. Missing / non-array `words` or `grammars` are tolerated (treated as []).
 *  4. Malformed entries and malformed optional detail text never throw.
 *  5. `sourceSentence` is copied byte-for-byte from `pageMeta.sourceText`.
 *  6. `sourceUrl` is never invented: a non-empty string passes through, anything
 *     else becomes null.
 *  7. `status` is always `"NEW"`; `createdAt` and `updatedAt` are both the
 *     injected `context.now`.
 *  8. `lexicalKey` is fully deterministic (see {@link computeLexicalKey}).
 *  9. NO de-duplication: every occurrence yields its own draft, even when two
 *     entries produce an identical `lexicalKey`.
 * 10. Entries whose required `surface` (`word.term` / `grammar.point`) is
 *     missing, non-string, or empty are skipped — they are not reviewable and
 *     cannot form a key. This is not de-duplication.
 *
 * `reading` and `meaning` are best-effort: extracted only from explicit
 * labelled lines already present in the detail text, else null. Grammar
 * `reading` is always null in P0 (no deterministic source supplies one).
 */
export function deriveLearningItems(
  structuredJson: StructuredAnalysisInput | null | undefined,
  pageMeta: LearningItemPageMeta,
  sourceAnalysisId: string,
  context: DeriveLearningItemsContext
): NewLearningItem[] {
  const items: NewLearningItem[] = [];

  const sourceSentence = asString(pageMeta?.sourceText);
  const rawSourceUrl = pageMeta?.sourceUrl;
  const sourceUrl =
    typeof rawSourceUrl === "string" && rawSourceUrl.length > 0 ? rawSourceUrl : null;
  const { userId, now } = context;

  const source: StructuredAnalysisInput =
    structuredJson && typeof structuredJson === "object" ? structuredJson : {};

  for (const word of asRecordArray(source.words)) {
    const surface = asString(word.term);
    if (surface.length === 0) continue;
    const detail = asString(word.detail);
    const reading = extractLabeledValue(detail, VOCAB_READING_LABELS);
    const meaning = extractLabeledValue(detail, VOCAB_MEANING_LABELS);
    items.push({
      userId,
      sourceAnalysisId,
      type: "vocab",
      surface,
      status: "NEW",
      createdAt: now,
      updatedAt: now,
      lexicalKey: computeLexicalKey("vocab", surface, reading),
      reading,
      meaning,
      sourceSentence,
      sourceUrl,
    });
  }

  for (const grammar of asRecordArray(source.grammars)) {
    const surface = asString(grammar.point);
    if (surface.length === 0) continue;
    const explanation = asString(grammar.explanation);
    const meaning = extractLabeledValue(explanation, GRAMMAR_MEANING_LABELS);
    items.push({
      userId,
      sourceAnalysisId,
      type: "grammar",
      surface,
      status: "NEW",
      createdAt: now,
      updatedAt: now,
      lexicalKey: computeLexicalKey("grammar", surface, null),
      reading: null,
      meaning,
      sourceSentence,
      sourceUrl,
    });
  }

  return items;
}
