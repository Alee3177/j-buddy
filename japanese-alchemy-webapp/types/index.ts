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
