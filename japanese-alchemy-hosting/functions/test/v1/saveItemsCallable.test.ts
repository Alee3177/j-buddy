import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { computeLexicalKey, NewLearningItem } from "../../src/models/learningItem";

// Mock only the Firestore boundary. `deriveLearningItems` (pure, P0-tested) runs
// for real through the handler so the wiring is genuinely exercised.
const mockSaveVocabulary = jest.fn() as any;
const mockSaveGrammar = jest.fn() as any;
const mockSaveAnalysisPage = jest.fn() as any;
const mockSavePersonalAnalysisPage = jest.fn() as any;

jest.mock("../../src/services/firestoreService", () => ({
  FirestoreService: jest.fn().mockImplementation(() => ({
    saveVocabulary: mockSaveVocabulary,
    saveGrammar: mockSaveGrammar,
    saveAnalysisPage: mockSaveAnalysisPage,
    savePersonalAnalysisPage: mockSavePersonalAnalysisPage,
  })),
}));

import { saveItemsHandler } from "../../src/v1/saveItemsCallable";

const PAGE_ID = "page-fixed-id";

const STRUCTURED = {
  words: [
    // Two occurrences of the same lexeme (ruby vs plain) → identical lexicalKey,
    // must NOT be merged.
    { term: "{改善|かいぜん}", detail: "讀音：かいぜん\n解釋：使變得更好。" },
    { term: "改善", detail: "讀音：かいぜん\n意思：改善" },
  ],
  grammars: [{ point: "〜ても", explanation: "- **用法說明**\n  - 即使…也…" }],
};
const META = {
  source_text: "制度を改善しても問題が残る。",
  source_url: "https://example.com/a",
  saved_at: "2026-09-09T00:00:00.000Z",
};
const PAGE = { rendered_markdown: "# 分析", structured_json: STRUCTURED };

let capturedItems: NewLearningItem[];

function callHandler(data: unknown, authUid?: string) {
  const request: any = { data };
  if (authUid) request.auth = { uid: authUid };
  return saveItemsHandler(request);
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedItems = [];
  mockSaveVocabulary.mockResolvedValue(0);
  mockSaveGrammar.mockResolvedValue(0);
  mockSaveAnalysisPage.mockResolvedValue(true);
  mockSavePersonalAnalysisPage.mockImplementation(
    async (
      _uid: string,
      _page: unknown,
      _meta: unknown,
      deriveItems: (id: string) => NewLearningItem[]
    ) => {
      capturedItems = deriveItems(PAGE_ID);
      return { pageId: PAGE_ID, learningItemsCount: capturedItems.length };
    }
  );
});

function noWrites() {
  expect(mockSaveVocabulary).not.toHaveBeenCalled();
  expect(mockSaveGrammar).not.toHaveBeenCalled();
  expect(mockSaveAnalysisPage).not.toHaveBeenCalled();
  expect(mockSavePersonalAnalysisPage).not.toHaveBeenCalled();
}

describe("saveItemsHandler — auth hardening (personal saves)", () => {
  it("1. allows a personal save when request.auth.uid matches data.userId", async () => {
    const res = await callHandler(
      { userId: "alice", analysis: { words: [], grammars: [], page: PAGE, metadata: META } },
      "alice"
    );
    expect(res.success).toBe(true);
    expect(mockSaveVocabulary).toHaveBeenCalledWith("alice", [], false, META);
    expect(mockSaveGrammar).toHaveBeenCalledWith("alice", [], false, META);
    expect(mockSavePersonalAnalysisPage).toHaveBeenCalledTimes(1);
    expect(mockSavePersonalAnalysisPage.mock.calls[0][0]).toBe("alice");
    expect(mockSaveAnalysisPage).not.toHaveBeenCalled();
  });

  it("1b. allows a personal save when data.userId is omitted (uses the authenticated uid)", async () => {
    const res = await callHandler({ analysis: { page: PAGE, metadata: META } }, "bob");
    expect(res.success).toBe(true);
    expect(mockSavePersonalAnalysisPage.mock.calls[0][0]).toBe("bob");
    expect(capturedItems.every((i) => i.userId === "bob")).toBe(true);
  });

  it("2. rejects an unauthenticated personal save and writes nothing", async () => {
    await expect(
      callHandler({ userId: "alice", analysis: { page: PAGE, metadata: META } })
    ).rejects.toMatchObject({ code: "unauthenticated" });
    noWrites();
  });

  it("3. rejects a personal save whose data.userId != request.auth.uid", async () => {
    await expect(
      callHandler({ userId: "alice", analysis: { page: PAGE, metadata: META } }, "mallory")
    ).rejects.toMatchObject({ code: "permission-denied" });
    noWrites();
  });

  it("4. a spoofed data.userId cannot cause any write under that user's subtree", async () => {
    await expect(
      callHandler(
        { userId: "victimUid", analysis: { words: [{ term: "x" }], grammars: [], page: PAGE, metadata: META } },
        "attackerUid"
      )
    ).rejects.toMatchObject({ code: "permission-denied" });
    // No Admin-SDK write path was reached at all — nothing under users/victimUid.
    noWrites();
  });

  // P7.4: shared saves used to be unauthenticated (anyone could repeatedly
  // call saveItems(is_shared=true) with no rate limit, spamming the public
  // shared_* collections / generating Firestore write cost). Publication now
  // requires the same Firebase Auth context as a personal save.
  it("5. rejects an unauthenticated shared save and writes nothing (P7.4)", async () => {
    await expect(
      callHandler({
        userId: null,
        analysis: {
          is_shared: true,
          words: [{ term: "x" }],
          grammars: [{ point: "〜ば" }],
          page: PAGE,
          metadata: META,
        },
      })
    ).rejects.toMatchObject({ code: "unauthenticated" });
    noWrites();
  });

  it("5b. allows an authenticated shared save, still writes anonymously, and derives no learning items (P7.4)", async () => {
    const res = await callHandler(
      {
        userId: null,
        analysis: {
          is_shared: true,
          words: [{ term: "x" }],
          grammars: [{ point: "〜ば" }],
          page: PAGE,
          metadata: META,
        },
      },
      "alice"
    );
    expect(res.success).toBe(true);
    // Shared writes remain anonymous even though the caller is authenticated
    // — no uid is passed to the Firestore layer or stored on the document.
    expect(mockSaveVocabulary).toHaveBeenCalledWith(null, [{ term: "x" }], true, META);
    expect(mockSaveGrammar).toHaveBeenCalledWith(null, [{ point: "〜ば" }], true, META);
    expect(mockSaveAnalysisPage).toHaveBeenCalledWith(null, PAGE, true, META);
    expect(mockSavePersonalAnalysisPage).not.toHaveBeenCalled();
    expect(res.saved.learning_items_count).toBe(0);
    expect(capturedItems).toEqual([]);
  });

  it("5c. a spoofed data.userId cannot bypass auth on a shared save either (P7.4)", async () => {
    await expect(
      callHandler(
        {
          userId: "victimUid",
          analysis: { is_shared: true, words: [{ term: "x" }], grammars: [], page: PAGE, metadata: META },
        },
        "attackerUid"
      )
    ).rejects.toMatchObject({ code: "permission-denied" });
    noWrites();
  });

  it("treats is_shared values other than boolean true as a personal (auth-gated) save", async () => {
    await expect(
      callHandler({ analysis: { is_shared: "true", page: PAGE, metadata: META } })
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("still rejects a request with no analysis", async () => {
    await expect(callHandler({ userId: "alice" }, "alice")).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });
});

// P7.4 — saveItems is auth-gated but had no ceiling on item counts, unlike
// explain's strict input validation. An oversized array would previously hit
// Firestore's 500-write batch limit as an unhandled internal error instead of
// a clean rejection. See requestValidation.ts (MAX_SAVE_ITEMS_COUNT).
describe("saveItemsHandler — P7.4 item-count guard", () => {
  it("rejects an oversized words array (personal save) and writes nothing", async () => {
    const words = Array.from({ length: 201 }, (_, i) => ({ term: `word-${i}` }));
    await expect(
      callHandler(
        { analysis: { words, grammars: [], page: PAGE, metadata: META } },
        "alice"
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
    noWrites();
  });

  it("rejects an oversized grammars array (personal save) and writes nothing", async () => {
    const grammars = Array.from({ length: 201 }, (_, i) => ({ point: `g-${i}` }));
    await expect(
      callHandler(
        { analysis: { words: [], grammars, page: PAGE, metadata: META } },
        "alice"
      )
    ).rejects.toMatchObject({ code: "invalid-argument" });
    noWrites();
  });

  it("rejects an oversized array on a shared save too (guard runs before the shared/personal branch)", async () => {
    const words = Array.from({ length: 201 }, (_, i) => ({ term: `word-${i}` }));
    await expect(
      callHandler({ analysis: { is_shared: true, words, grammars: [], page: PAGE, metadata: META } })
    ).rejects.toMatchObject({ code: "invalid-argument" });
    noWrites();
  });

  it("accepts exactly the maximum allowed count", async () => {
    const words = Array.from({ length: 200 }, (_, i) => ({ term: `word-${i}` }));
    const res = await callHandler(
      { analysis: { words, grammars: [], page: PAGE, metadata: META } },
      "alice"
    );
    expect(res.success).toBe(true);
  });
});

describe("saveItemsHandler — learning item derivation wiring", () => {
  it("6/7. calls savePersonalAnalysisPage exactly once and reports page_saved from its result", async () => {
    const res = await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    expect(mockSavePersonalAnalysisPage).toHaveBeenCalledTimes(1);
    expect(res.saved.page_saved).toBe(true);

    mockSavePersonalAnalysisPage.mockResolvedValueOnce({ pageId: null, learningItemsCount: 0 });
    const res2 = await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    expect(res2.saved.page_saved).toBe(false);
  });

  it("8. every derived item's sourceAnalysisId is the page id from the same save", async () => {
    await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    expect(capturedItems).toHaveLength(3);
    expect(capturedItems.every((i) => i.sourceAnalysisId === PAGE_ID)).toBe(true);
  });

  it("9. derives one item per word then per grammar", async () => {
    await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    expect(capturedItems.map((i) => i.type)).toEqual(["vocab", "vocab", "grammar"]);
    expect(capturedItems.map((i) => i.surface)).toEqual(["{改善|かいぜん}", "改善", "〜ても"]);
  });

  it("10. all derived items default to NEW", async () => {
    await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    expect(capturedItems.every((i) => i.status === "NEW")).toBe(true);
  });

  it("11. all derived items in one save share a single timestamp", async () => {
    await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    const stamps = new Set(capturedItems.flatMap((i) => [i.createdAt, i.updatedAt]));
    expect(stamps.size).toBe(1);
    expect(typeof capturedItems[0].createdAt).toBe("number");
  });

  it("13. lexicalKey matches the P0 helper (and is stable across the pipeline)", async () => {
    await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    expect(capturedItems[0].lexicalKey).toBe(
      computeLexicalKey("vocab", "{改善|かいぜん}", "かいぜん")
    );
    expect(capturedItems[0].lexicalKey).toBe("vocab|改善|かいぜん");
    expect(capturedItems[2].lexicalKey).toBe("grammar|〜ても|");
  });

  it("14. nullable reading/meaning are preserved (grammar heading form ⇒ null)", async () => {
    await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    const grammar = capturedItems[2];
    expect(grammar.reading).toBeNull();
    expect(grammar.meaning).toBeNull();
    expect(capturedItems[0].reading).toBe("かいぜん");
    expect(capturedItems[0].meaning).toBe("使變得更好。");
  });

  it("15. sourceSentence is copied verbatim onto every item", async () => {
    await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    expect(capturedItems.every((i) => i.sourceSentence === META.source_text)).toBe(true);
  });

  it("16. sourceUrl passes through when present and is null when absent/empty", async () => {
    await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    expect(capturedItems.every((i) => i.sourceUrl === "https://example.com/a")).toBe(true);

    await callHandler(
      { userId: "u", analysis: { page: PAGE, metadata: { source_text: "S" } } },
      "u"
    );
    expect(capturedItems.every((i) => i.sourceUrl === null)).toBe(true);
  });

  it("17. repeated occurrences of one lexeme are not merged", async () => {
    await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    const vocab = capturedItems.filter((i) => i.type === "vocab");
    expect(vocab).toHaveLength(2);
    expect(vocab[0].lexicalKey).toBe(vocab[1].lexicalKey);
    expect(vocab[0]).not.toBe(vocab[1]);
    expect(vocab[0].meaning).not.toBe(vocab[1].meaning);
  });

  it("19. empty words/grammars ⇒ zero learning items, still succeeds", async () => {
    const res = await callHandler(
      {
        userId: "u",
        analysis: {
          page: { rendered_markdown: "# x", structured_json: { words: [], grammars: [] } },
          metadata: META,
        },
      },
      "u"
    );
    expect(res.success).toBe(true);
    expect(res.saved.learning_items_count).toBe(0);
    expect(capturedItems).toEqual([]);
  });

  it("20. malformed structured_json does not crash the save path", async () => {
    const res = await callHandler(
      {
        userId: "u",
        analysis: {
          page: {
            rendered_markdown: "# x",
            structured_json: {
              words: [{ term: "A", detail: 123 }, { term: "" }, null],
              grammars: "nope",
            },
          },
          metadata: META,
        },
      },
      "u"
    );
    expect(res.success).toBe(true);
    expect(capturedItems.map((i) => i.surface)).toEqual(["A"]);
    expect(capturedItems[0].reading).toBeNull();
  });

  it("derives no learning items for a personal save that has no page", async () => {
    const res = await callHandler(
      { userId: "u", analysis: { words: [{ term: "x" }], grammars: [], metadata: META } },
      "u"
    );
    expect(res.success).toBe(true);
    expect(mockSaveVocabulary).toHaveBeenCalledWith("u", [{ term: "x" }], false, META);
    expect(mockSavePersonalAnalysisPage).not.toHaveBeenCalled();
    expect(res.saved.learning_items_count).toBe(0);
  });
});

describe("saveItemsHandler — regression / response compatibility", () => {
  it("21/22. still saves vocabulary and grammar on a personal save", async () => {
    mockSaveVocabulary.mockResolvedValueOnce(2);
    mockSaveGrammar.mockResolvedValueOnce(1);
    const res = await callHandler(
      {
        userId: "u",
        analysis: {
          words: [{ term: "a" }, { term: "b" }],
          grammars: [{ point: "g" }],
          page: PAGE,
          metadata: META,
        },
      },
      "u"
    );
    expect(mockSaveVocabulary).toHaveBeenCalledWith("u", [{ term: "a" }, { term: "b" }], false, META);
    expect(mockSaveGrammar).toHaveBeenCalledWith("u", [{ point: "g" }], false, META);
    expect(res.saved.words_count).toBe(2);
    expect(res.saved.grammars_count).toBe(1);
  });

  it("24. response keeps its existing shape and adds learning_items_count", async () => {
    const res = await callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u");
    expect(res).toEqual({
      success: true,
      message: "Items saved successfully",
      saved: {
        words_count: 0,
        grammars_count: 0,
        page_saved: true,
        learning_items_count: 3,
      },
    });
  });

  it("surfaces a Firestore failure as an internal callable error (page write not retried here)", async () => {
    mockSavePersonalAnalysisPage.mockRejectedValueOnce(new Error("batch commit failed"));
    await expect(
      callHandler({ userId: "u", analysis: { page: PAGE, metadata: META } }, "u")
    ).rejects.toMatchObject({ code: "internal" });
  });
});
