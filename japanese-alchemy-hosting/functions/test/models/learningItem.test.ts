import { describe, it, expect } from "@jest/globals";
import {
  computeLexicalKey,
  deriveLearningItems,
  extractLabeledValue,
  stripRubyMarkup,
  NewLearningItem,
  StructuredAnalysisInput,
} from "../../src/models/learningItem";

const PAGE_META = {
  sourceText: "生ビールを注文した学生は、屋上に上がる前に生け花を教わった。",
  sourceUrl: "https://example.com/article",
};
const CTX = { userId: "user-123", now: 1_700_000_000_000 };
const ANALYSIS_ID = "analysis-abc";

function derive(
  structuredJson: StructuredAnalysisInput | null | undefined,
  pageMeta = PAGE_META
): NewLearningItem[] {
  return deriveLearningItems(structuredJson, pageMeta, ANALYSIS_ID, CTX);
}

// A representative slice of the CURRENT managed-provider structured_json:
// vocab `detail` blobs use `讀音：` and `解釋：` (plus contextual labels that
// must NOT be mistaken for `意思`), grammar `explanation` uses a bold
// `**用法說明**` heading rather than an inline label.
const MANAGED_STRUCTURED_JSON: StructuredAnalysisInput = {
  words: [
    {
      term: "{生|なま}ビール",
      detail: [
        "讀音：なまビール",
        "重音：3",
        "解釋：生啤酒，指未經加熱殺菌的啤酒。",
        "原句中的意思：在本句中是學生點的飲料。",
        "核心意思：「生」讀作「なま」時，表示新鮮或未加工。",
      ].join("\n"),
    },
    {
      term: "{上|あ}がる",
      detail: [
        "  - 讀音：あがる",
        "  - 重音：0",
        "  - 動詞分類：五段動詞",
        "  - 解釋：上去、登上；也可表示數值或程度上升。",
        "  - 辭書形：{上|あ}がる",
      ].join("\n"),
    },
  ],
  grammars: [
    {
      point: "〜{前|まえ}に",
      explanation: [
        "- **接續形式**",
        "  - 動詞辭書形／名詞＋の ＋ {前|まえ}に",
        "- **用法說明**",
        "  - 在本句中表示「在上屋頂之前」，描述兩個動作的先後順序。",
        "- **例句**",
        "  - {出|で}かける{前|まえ}に{連絡|れんらく}してね。",
      ].join("\n"),
    },
  ],
};

// The older saved-analysis shape still supported by formatAnalysisResult:
// bare `意思：` on vocab detail lines.
const LEGACY_STRUCTURED_JSON: StructuredAnalysisInput = {
  words: [
    {
      term: "{結婚|けっこん}する",
      detail: ["讀音：けっこんする", "重音：0", "動詞分類：サ變動詞", "意思：結婚"].join("\n"),
    },
  ],
  grammars: [
    { point: "〜を{機|き}に（して）", explanation: "- **JLPT** : N2\n- 名詞 + を{機|き}に" },
  ],
};

describe("stripRubyMarkup", () => {
  it("reduces a single ruby token to its base", () => {
    expect(stripRubyMarkup("{改善点|かいぜんてん}")).toBe("改善点");
  });

  it("reduces interleaved ruby tokens and bare okurigana", () => {
    expect(stripRubyMarkup("{向|む}き{合|あ}う")).toBe("向き合う");
  });

  it("leaves malformed / pipe-less braces untouched", () => {
    expect(stripRubyMarkup("{改善点}")).toBe("{改善点}");
    expect(stripRubyMarkup("{|かな}")).toBe("{|かな}");
  });

  it("keeps plain text unchanged", () => {
    expect(stripRubyMarkup("オンライン")).toBe("オンライン");
  });
});

describe("computeLexicalKey", () => {
  it("formats as type|surface|reading", () => {
    expect(computeLexicalKey("vocab", "改善点", "かいぜんてん")).toBe("vocab|改善点|かいぜんてん");
  });

  it("leaves the reading segment empty when reading is null / undefined / empty", () => {
    expect(computeLexicalKey("grammar", "ても", null)).toBe("grammar|ても|");
    expect(computeLexicalKey("grammar", "ても", undefined)).toBe("grammar|ても|");
    expect(computeLexicalKey("grammar", "ても", "   ")).toBe("grammar|ても|");
  });

  it("strips ruby markup from the surface before keying", () => {
    expect(computeLexicalKey("vocab", "{改善点|かいぜんてん}", null)).toBe("vocab|改善点|");
    expect(computeLexicalKey("vocab", "{向|む}き{合|あ}う", "むきあう")).toBe(
      "vocab|向き合う|むきあう"
    );
  });

  it("applies Unicode NFKC folding to surface and reading", () => {
    // Full-width latin/parens/space + half-width katakana all NFKC-fold.
    expect(computeLexicalKey("grammar", "〜における （Ｎ１）", null)).toBe(
      "grammar|〜における (N1)|"
    );
    expect(computeLexicalKey("vocab", "ｱﾝﾃﾅ", "ｱﾝﾃﾅ")).toBe("vocab|アンテナ|アンテナ");
  });

  it("trims surrounding whitespace but preserves internal lexical characters", () => {
    expect(computeLexicalKey("vocab", "  改善点  ", "  かいぜんてん  ")).toBe(
      "vocab|改善点|かいぜんてん"
    );
  });

  it("does NOT lowercase, lemmatise, or fold okurigana", () => {
    expect(computeLexicalKey("vocab", "ABCあがる", null)).toBe("vocab|ABCあがる|");
    expect(computeLexicalKey("vocab", "上がる", "あがる")).toBe("vocab|上がる|あがる");
    expect(computeLexicalKey("vocab", "上げる", "あげる")).toBe("vocab|上げる|あげる");
  });

  it("same normalised surface + reading ⇒ identical key (ruby vs plain)", () => {
    expect(computeLexicalKey("vocab", "{改善点|かいぜんてん}", "かいぜんてん")).toBe(
      computeLexicalKey("vocab", "改善点", "かいぜんてん")
    );
  });

  it("same surface, different reading ⇒ different key (homograph senses stay apart)", () => {
    expect(computeLexicalKey("vocab", "生", "なま")).not.toBe(
      computeLexicalKey("vocab", "生", "き")
    );
  });

  it("same surface + reading, different type ⇒ different key", () => {
    expect(computeLexicalKey("vocab", "ても", null)).not.toBe(
      computeLexicalKey("grammar", "ても", null)
    );
  });
});

describe("extractLabeledValue", () => {
  it("extracts an explicit 讀音 line", () => {
    expect(extractLabeledValue("讀音：あがる\n重音：0", ["讀音"])).toBe("あがる");
  });

  it("extracts an explicit 意思 line", () => {
    expect(extractLabeledValue("讀音：けっこんする\n意思：結婚", ["意思"])).toBe("結婚");
  });

  it("tolerates a leading markdown bullet and full-width colon", () => {
    expect(extractLabeledValue("  - 讀音：はえる", ["讀音"])).toBe("はえる");
    expect(extractLabeledValue("* 意思:結婚", ["意思"])).toBe("結婚");
  });

  it("honours label priority order, not line order", () => {
    const blob = "解釋：定義句\n意思：主要意思";
    expect(extractLabeledValue(blob, ["意思", "解釋"])).toBe("主要意思");
  });

  it("does NOT match a label that is only a substring of the leading token", () => {
    const blob = "原句中的意思：在本句中的意思\n核心意思：核心語意";
    expect(extractLabeledValue(blob, ["意思"])).toBeNull();
  });

  it("returns null for a label with no value, missing label, or non-string input", () => {
    expect(extractLabeledValue("讀音：", ["讀音"])).toBeNull();
    expect(extractLabeledValue("重音：0", ["讀音"])).toBeNull();
    expect(extractLabeledValue("", ["讀音"])).toBeNull();
    expect(extractLabeledValue(undefined, ["讀音"])).toBeNull();
    expect(extractLabeledValue(42 as unknown, ["讀音"])).toBeNull();
  });

  it("keeps ruby markup verbatim in the extracted value", () => {
    expect(extractLabeledValue("意思：{改善|かいぜん}すること", ["意思"])).toBe(
      "{改善|かいぜん}すること"
    );
  });
});

describe("deriveLearningItems — vocab extraction", () => {
  it("derives one NEW vocab draft per word, words before grammars", () => {
    const items = derive(MANAGED_STRUCTURED_JSON);
    expect(items.map((i) => i.type)).toEqual(["vocab", "vocab", "grammar"]);
    expect(items.every((i) => i.status === "NEW")).toBe(true);
  });

  it("populates the full MUST field set deterministically", () => {
    const [first] = derive(MANAGED_STRUCTURED_JSON);
    expect(first).toEqual({
      userId: "user-123",
      sourceAnalysisId: "analysis-abc",
      type: "vocab",
      surface: "{生|なま}ビール",
      status: "NEW",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      lexicalKey: "vocab|生ビール|なまビール",
      reading: "なまビール",
      meaning: "生啤酒，指未經加熱殺菌的啤酒。",
      sourceSentence: PAGE_META.sourceText,
      sourceUrl: "https://example.com/article",
    });
  });

  it("extracts 讀音 as reading and 解釋 as meaning from the current managed shape", () => {
    const agaru = derive(MANAGED_STRUCTURED_JSON).find((i) => i.surface.includes("がる"));
    expect(agaru?.reading).toBe("あがる");
    expect(agaru?.meaning).toBe("上去、登上；也可表示數值或程度上升。");
  });

  it("extracts bare 意思 meaning from the legacy saved shape", () => {
    const [item] = derive(LEGACY_STRUCTURED_JSON);
    expect(item.reading).toBe("けっこんする");
    expect(item.meaning).toBe("結婚");
    expect(item.lexicalKey).toBe("vocab|結婚する|けっこんする");
  });

  it("sets reading / meaning to null when no supported label is present", () => {
    const items = derive({
      words: [{ term: "オンライン", detail: "重音：3\n英文：online\n原句中的意思：透過網路。" }],
    });
    expect(items[0].reading).toBeNull();
    expect(items[0].meaning).toBeNull();
    expect(items[0].lexicalKey).toBe("vocab|オンライン|");
  });

  it("does not throw on malformed / missing detail and yields null snapshot fields", () => {
    const items = derive({
      words: [
        { term: "語A", detail: 123 },
        { term: "語B" },
        { term: "語C", detail: null },
        { term: "語D", detail: "" },
      ],
    } as unknown as StructuredAnalysisInput);
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.reading === null && i.meaning === null)).toBe(true);
  });

  it("skips word entries with a missing / empty / non-string term", () => {
    const items = derive({
      words: [
        { term: "有效", detail: "讀音：ゆうこう" },
        { term: "" },
        { term: "   " } as unknown as Record<string, unknown>,
        { detail: "讀音：なし" },
        { term: 7 },
        null,
        "not-an-object",
      ],
    } as unknown as StructuredAnalysisInput);
    expect(items.map((i) => i.surface)).toEqual(["有效", "   "]);
    // NB: "   " is a non-empty string surface (whitespace is lexical here); it is
    // NOT skipped, but it normalises to an empty key segment.
    expect(items[1].lexicalKey).toBe("vocab||");
  });
});

describe("deriveLearningItems — grammar extraction", () => {
  it("derives one NEW grammar draft per point with reading always null", () => {
    const g = derive(MANAGED_STRUCTURED_JSON).filter((i) => i.type === "grammar");
    expect(g).toHaveLength(1);
    expect(g[0].reading).toBeNull();
    expect(g[0].surface).toBe("〜{前|まえ}に");
    expect(g[0].lexicalKey).toBe("grammar|〜前に|");
    expect(g[0].status).toBe("NEW");
  });

  it("leaves grammar meaning null when 用法說明 is a heading, not an inline label", () => {
    const g = derive(MANAGED_STRUCTURED_JSON).find((i) => i.type === "grammar");
    expect(g?.meaning).toBeNull();
  });

  it("extracts an inline 用法說明：/ 用法： grammar meaning when present", () => {
    const items = derive({
      grammars: [
        { point: "〜として", explanation: "接續：名詞 + として\n用法說明：以某身分／立場。\n例句：…" },
      ],
    });
    expect(items[0].meaning).toBe("以某身分／立場。");
  });

  it("carries source sentence / url onto grammar drafts too", () => {
    const g = derive(LEGACY_STRUCTURED_JSON).find((i) => i.type === "grammar");
    expect(g?.sourceSentence).toBe(PAGE_META.sourceText);
    expect(g?.sourceUrl).toBe("https://example.com/article");
    expect(g?.lexicalKey).toBe("grammar|〜を機に(して)|");
  });
});

describe("deriveLearningItems — mixed, empty, and malformed input", () => {
  it("handles a mixed words + grammars payload end to end", () => {
    const items = derive(MANAGED_STRUCTURED_JSON);
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.type === "vocab")).toHaveLength(2);
    expect(items.filter((i) => i.type === "grammar")).toHaveLength(1);
  });

  it("returns [] for empty arrays", () => {
    expect(derive({ words: [], grammars: [] })).toEqual([]);
  });

  it("returns [] for missing structured_json fields / null / undefined / non-object", () => {
    expect(derive({})).toEqual([]);
    expect(derive(null)).toEqual([]);
    expect(derive(undefined)).toEqual([]);
    expect(derive("nope" as unknown as StructuredAnalysisInput)).toEqual([]);
    expect(derive({ words: "x", grammars: 3 } as unknown as StructuredAnalysisInput)).toEqual([]);
  });

  it("tolerates a （無）-style empty grammar section (no entries ⇒ no drafts)", () => {
    // formatAnalysisResult emits `grammars: []` for a （無） 文法分析 section.
    const items = derive({
      words: [{ term: "{最接近|さいせっきん}する", detail: "解釋：最靠近" }],
      grammars: [],
    });
    expect(items.map((i) => i.type)).toEqual(["vocab"]);
  });

  it("ignores unknown structured_json keys (collocations / registers / reading)", () => {
    const items = derive({
      words: [{ term: "語", detail: "讀音：ご" }],
      grammars: [],
      collocations: [{ text: "〜する" }],
      registers: [{ text: "書面語" }],
      reading: { version: 1, source_text: "語", tokens: [{ text: "語", reading: "ご" }] },
    } as unknown as StructuredAnalysisInput);
    expect(items).toHaveLength(1);
    expect(items[0].reading).toBe("ご");
  });
});

describe("deriveLearningItems — de-duplication policy (P0: none)", () => {
  it("emits a separate draft for every occurrence, even with an identical lexicalKey", () => {
    const items = derive({
      words: [
        { term: "改善点", detail: "讀音：かいぜんてん\n意思：需要改善的地方" },
        { term: "{改善点|かいぜんてん}", detail: "讀音：かいぜんてん\n意思：可改善之處" },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0].lexicalKey).toBe("vocab|改善点|かいぜんてん");
    expect(items[1].lexicalKey).toBe("vocab|改善点|かいぜんてん");
    expect(items[0].meaning).not.toBe(items[1].meaning);
  });

  it("keeps homograph surfaces with different readings as distinct items/keys", () => {
    const items = derive({
      words: [
        { term: "{生|なま}", detail: "讀音：なま\n意思：生的" },
        { term: "{生|き}", detail: "讀音：き\n意思：純粹的" },
      ],
    });
    expect(items[0].lexicalKey).not.toBe(items[1].lexicalKey);
  });
});

describe("deriveLearningItems — source metadata & purity", () => {
  it("copies sourceSentence byte-for-byte (incl. ruby markup and whitespace)", () => {
    const meta = { sourceText: "  {雨|あめ}が 降る。\n続く  ", sourceUrl: null };
    const items = deriveLearningItems(
      { words: [{ term: "雨", detail: "讀音：あめ" }] },
      meta,
      ANALYSIS_ID,
      CTX
    );
    expect(items[0].sourceSentence).toBe("  {雨|あめ}が 降る。\n続く  ");
  });

  it("never invents sourceUrl: non-string / empty ⇒ null, non-empty string passes through", () => {
    const base = { words: [{ term: "語", detail: "讀音：ご" }] };
    expect(deriveLearningItems(base, { sourceText: "x" }, ANALYSIS_ID, CTX)[0].sourceUrl).toBeNull();
    expect(
      deriveLearningItems(base, { sourceText: "x", sourceUrl: "" }, ANALYSIS_ID, CTX)[0].sourceUrl
    ).toBeNull();
    expect(
      deriveLearningItems(
        base,
        { sourceText: "x", sourceUrl: 123 as unknown as string },
        ANALYSIS_ID,
        CTX
      )[0].sourceUrl
    ).toBeNull();
    expect(
      deriveLearningItems(base, { sourceText: "x", sourceUrl: "http://a.test" }, ANALYSIS_ID, CTX)[0]
        .sourceUrl
    ).toBe("http://a.test");
  });

  it("stamps createdAt and updatedAt from the injected now, status NEW", () => {
    const items = deriveLearningItems(
      { words: [{ term: "語", detail: "讀音：ご" }] },
      PAGE_META,
      ANALYSIS_ID,
      { userId: "u", now: 42 }
    );
    expect(items[0].createdAt).toBe(42);
    expect(items[0].updatedAt).toBe(42);
    expect(items[0].status).toBe("NEW");
  });

  it("does not mutate the input structuredJson or its nested objects", () => {
    const input: StructuredAnalysisInput = {
      words: [{ term: "{生|なま}ビール", detail: "讀音：なまビール\n解釋：生啤酒。" }],
      grammars: [{ point: "〜ても", explanation: "用法說明：即使…也…" }],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const result = deriveLearningItems(input, PAGE_META, ANALYSIS_ID, CTX);
    expect(result).toHaveLength(2);
    expect(input).toEqual(snapshot);
    expect(Object.isFrozen(input)).toBe(false); // untouched, not frozen
  });

  it("produces byte-identical output for identical inputs (determinism)", () => {
    const a = derive(MANAGED_STRUCTURED_JSON);
    const b = derive(MANAGED_STRUCTURED_JSON);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
