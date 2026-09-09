// Response types
export interface SuccessResponse {
  success: boolean;
  data?: any;
  timestamp?: number;
}

export interface FailureResponse {
  success: boolean;
  code: number;
  message: string;
}

// Firestore types
export interface VocabularyItem {
  id?: string;
  term: string;
  detail: string;
  createdAt: number;
}

export interface GrammarItem {
  id?: string;
  point: string;
  explanation: string;
  createdAt: number;
}

// API request types
export type AiProvider = "gemini" | "zai";

export interface ExplainRequest {
  content: string;
  prompt?: "v1" | "v2";
  context_before?: string;
  context_after?: string;
  ai?: AiProvider;
}

export interface SaveItemsRequest {
  userId?: string | null;
  analysis: {
    is_shared?: boolean;
    words?: Array<{ term: string; [key: string]: any }>;
    grammars?: Array<{ point: string; [key: string]: any }>;
    page?: {
      rendered_markdown: string;
      structured_json?: StructuredAnalysis;
    };
    metadata?: {
      source_text?: string;
      source_url?: string;
      saved_at?: string;
    };
  };
}

export interface SaveItemsResponse {
  success: boolean;
  message: string;
  saved: {
    words_count: number;
    grammars_count: number;
    page_saved: boolean;
    // Japanese Reader v0.4 P1: count of LearningItem docs derived from
    // structured_json and written under users/{uid}/learning_items. Always 0 for
    // shared saves and for personal saves without a page. Additive field —
    // pre-v0.4 clients ignore it.
    learning_items_count: number;
  };
}

export interface AnalysisPageItem {
  id?: string;
  rendered_markdown: string;
  source_text: string;
  source_url: string;
  saved_at: string;
  createdAt: number;
  structured_json?: StructuredAnalysis;
}

export interface StructuredAnalysis {
  words?: Array<{ term: string; detail: string }>;
  grammars?: Array<{ point: string; explanation: string }>;
  // Japanese Reader v0.3 Phase 2A: additive collocation / register taxonomy,
  // parsed from the personal-provider "### 搭配分析" / "### 語體／新聞表現"
  // sections. One entry per top-level markdown bullet; no sub-fields. Optional —
  // absent on managed-provider results and every pre-Phase-2A saved page;
  // present as [] when the section exists but is （無）. Persistence is wholesale.
  collocations?: Array<{ text: string }>;
  registers?: Array<{ text: string }>;
  // Japanese Reader v0.3 Phase 1: authoritative reading-segmentation tokens for
  // the analysed source text, persisted only when the extension proved them
  // grounded byte-for-byte to the browser selection. Optional; absent on every
  // pre-v0.3 saved page. Persistence is wholesale (firestoreService copies
  // structured_json as-is) — do not add server-side handling for this field.
  reading?: ReadingTokenContract;
}

export interface ReadingTokenContract {
  version: 1;
  source_text: string;
  tokens: Array<{ text: string; reading: string | null }>;
}

// LLM API types (OpenAI-compatible, used by Gemini and ZAI)
export interface LlmMessage {
  role: string;
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  model: string;
  temperature: number;
  max_tokens: number;
  stream?: boolean;
  stream_options?: {
    include_usage: boolean;
  };
  extra_body?: {
    google?: {
      thinking_config?: {
        thinking_budget: number;
        include_thoughts: boolean;
      };
    };
  };
}

export interface LlmResponse {
  model?: string;
  usage?: LlmUsage;
  choices: Array<{
    finish_reason?: string | null;
    message: {
      role: string;
      content: string;
    };
  }>;
}

export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}
