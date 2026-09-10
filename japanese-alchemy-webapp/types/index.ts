export interface SharedItemMetadata {
  source_text?: string;
  source_url?: string;
  saved_at?: string;
}

export interface Vocabulary {
  id: string;
  term: string;
  detail: string;
  createdAt: Date;
  userId: string;
  isShared?: boolean;
  metadata?: SharedItemMetadata;
}

export interface Grammar {
  id: string;
  point: string;
  explanation: string;
  createdAt: Date;
  userId: string;
  isShared?: boolean;
  metadata?: SharedItemMetadata;
}

export interface ReadingTokenContract {
  version: 1;
  source_text: string;
  tokens: Array<{ text: string; reading: string | null }>;
}

export interface StructuredAnalysis {
  words?: Array<{ term: string; detail: string }>;
  grammars?: Array<{ point: string; explanation: string }>;
  // Japanese Reader v0.3 Phase 2A: additive collocation / register taxonomy,
  // parsed from the personal-provider "### 搭配分析" / "### 語體／新聞表現"
  // sections (one entry per top-level bullet, no sub-fields). Optional — absent
  // on managed-provider results and pre-Phase-2A pages; [] when the section is
  // present but （無）. Not currently rendered by the webapp.
  collocations?: Array<{ text: string }>;
  registers?: Array<{ text: string }>;
  // Japanese Reader v0.3 Phase 1: authoritative reading tokens for the analysed
  // source text (grounded to the browser selection at save time). Optional and
  // absent on every pre-v0.3 page; not currently rendered by the webapp.
  reading?: ReadingTokenContract;
}

export interface AnalysisPage {
  id: string;
  rendered_markdown: string;
  source_text: string;
  source_url: string;
  saved_at: string;
  createdAt: Date;
  structured_json?: StructuredAnalysis;
}

// Japanese Reader v0.4 P2.1 — personal learning-items read model.
//
// Mirrors the shape persisted by the Functions layer
// (japanese-alchemy-hosting/functions/src/models/learningItem.ts). Every
// occurrence is stored and returned raw — no dedup, no grouping by
// `lexicalKey`, no review/SRS fields. `createdAt` / `updatedAt` are epoch
// milliseconds and are kept as numbers here (NOT converted to `Date` like the
// other read models) because the pagination cursor is derived from the exact
// stored value.
export type LearningItemType = 'vocab' | 'grammar';

export type LearningItemStatus = 'NEW' | 'LEARNING' | 'REVIEWED';

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
  reading: string | null;
  meaning: string | null;
  sourceSentence: string;
  sourceUrl: string | null;
}

// Decoded pagination cursor: the ordering position of the last returned item.
// Encoded on the wire as base64url(JSON.stringify({ createdAt, id })).
export interface LearningItemsCursor {
  createdAt: number;
  id: string;
}

export interface ListLearningItemsOptions {
  limit?: number;
  cursor?: string | null;
}

export interface ListLearningItemsResult {
  items: LearningItem[];
  nextCursor: string | null;
}
