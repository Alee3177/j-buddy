import * as admin from "firebase-admin";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { FirestoreService } from "../../src/services/firestoreService";
import { sharedPageContentHash } from "../../src/utils/sharedContentFingerprint";

// Mock firebase-admin. `firestore` is a stable jest.fn whose return value is
// configured in beforeEach so the service's constructor (this.db = admin.firestore())
// and the test see the same db instance. The current source writes via
// db.batch().set().commit(), not collection.add().
jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(),
}));

describe("FirestoreService", () => {
  let service: FirestoreService;
  let mockDb: any;
  let mockBatch: any;
  let mockCollection: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // commit() returns undefined by default; `await undefined` resolves fine,
    // so no mockResolvedValue is needed (and jest.fn() here infers `never`).
    mockBatch = {
      set: jest.fn(),
      commit: jest.fn(),
    };
    mockCollection = { doc: jest.fn() };
    mockDb = {
      batch: jest.fn(() => mockBatch),
      collection: jest.fn(() => mockCollection),
    };

    (admin as any).firestore.mockReturnValue(mockDb);

    service = new FirestoreService();
  });

  describe("saveVocabulary", () => {
    it("should save vocabulary items to Firestore", async () => {
      const words = [
        { term: "日本語", detail: "Japanese language" },
        { term: "勉強", detail: "Study" },
      ];
      const userId = "test-user";

      const saved = await service.saveVocabulary(userId, words);

      expect(saved).toBe(2);
      expect(mockBatch.set).toHaveBeenCalledTimes(2);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it("should handle empty words array without writing", async () => {
      const userId = "test-user";

      const saved = await service.saveVocabulary(userId, []);

      expect(saved).toBe(0);
      expect(mockBatch.commit).not.toHaveBeenCalled();
    });

    it("should use the per-user vocabularies collection path", async () => {
      const words = [{ term: "test", detail: "test detail" }];
      const userId = "test-user";

      await service.saveVocabulary(userId, words);

      expect(mockDb.collection).toHaveBeenCalledWith(
        `users/${userId}/vocabularies`
      );
    });

    it("should include a createdAt timestamp on each item", async () => {
      const words = [{ term: "test", detail: "test detail" }];
      const userId = "test-user";

      await service.saveVocabulary(userId, words);

      const addedData = mockBatch.set.mock.calls[0][1];
      expect(addedData).toHaveProperty("createdAt");
      expect(typeof addedData.createdAt).toBe("number");
    });
  });

  describe("saveGrammar", () => {
    it("should save grammar items to Firestore", async () => {
      const grammars = [
        { point: "〜てください", explanation: "Request form" },
        { point: "〜たいと思います", explanation: "Intention form" },
      ];
      const userId = "test-user";

      const saved = await service.saveGrammar(userId, grammars);

      expect(saved).toBe(2);
      expect(mockBatch.set).toHaveBeenCalledTimes(2);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it("should handle empty grammars array without writing", async () => {
      const userId = "test-user";

      const saved = await service.saveGrammar(userId, []);

      expect(saved).toBe(0);
      expect(mockBatch.commit).not.toHaveBeenCalled();
    });

    it("should use the per-user grammars collection path", async () => {
      const grammars = [{ point: "test", explanation: "test explanation" }];
      const userId = "test-user";

      await service.saveGrammar(userId, grammars);

      expect(mockDb.collection).toHaveBeenCalledWith(
        `users/${userId}/grammars`
      );
    });

    it("should include a createdAt timestamp on each item", async () => {
      const grammars = [{ point: "test", explanation: "test explanation" }];
      const userId = "test-user";

      await service.saveGrammar(userId, grammars);

      const addedData = mockBatch.set.mock.calls[0][1];
      expect(addedData).toHaveProperty("createdAt");
      expect(typeof addedData.createdAt).toBe("number");
    });
  });

  describe("saveAnalysisPage", () => {
    it("stores structured JSON when saving a page", async () => {
      const add = jest.fn();
      mockDb.collection.mockReturnValue({ add });
      const structuredJson = {
        words: [{ term: "日本語", detail: "Japanese language" }],
        grammars: [{ point: "〜です", explanation: "Copula" }],
      };

      await service.saveAnalysisPage("test-user", {
        rendered_markdown: "# Analysis",
        structured_json: structuredJson,
      });

      expect(add).toHaveBeenCalledWith(expect.objectContaining({
        structured_json: structuredJson,
      }));
    });

    it("keeps structured JSON optional for legacy page saves", async () => {
      const add = jest.fn();
      mockDb.collection.mockReturnValue({ add });

      await service.saveAnalysisPage("test-user", {
        rendered_markdown: "# Analysis",
      });

      expect(add).toHaveBeenCalledWith(expect.not.objectContaining({
        structured_json: expect.anything(),
      }));
    });

    it("persists a nested structured_json.reading contract unchanged", async () => {
      const add = jest.fn();
      mockDb.collection.mockReturnValue({ add });
      const structuredJson = {
        words: [],
        grammars: [],
        reading: {
          version: 1 as const,
          source_text: "台風が接近する",
          tokens: [
            { text: "台風", reading: "たいふう" },
            { text: "が", reading: null },
            { text: "接近", reading: "せっきん" },
            { text: "する", reading: null },
          ],
        },
      };

      await service.saveAnalysisPage("test-user", {
        rendered_markdown: "# Analysis",
        structured_json: structuredJson,
      });

      const stored = (add.mock.calls[0] as any[])[0];
      expect(stored.structured_json).toEqual(structuredJson);
      expect(stored.structured_json.reading).toBe(structuredJson.reading);
    });

    it("persists nested structured_json.collocations / registers unchanged", async () => {
      const add = jest.fn();
      mockDb.collection.mockReturnValue({ add });
      const structuredJson = {
        words: [],
        grammars: [],
        collocations: [
          { text: "〜に{最接近|さいせっきん}する：固定搭配。" },
          { text: "{前線|ぜんせん}を{刺激|しげき}する：活化鋒面。" },
        ],
        registers: [{ text: "句尾「〜か」：標題式的不確定。" }],
      };

      await service.saveAnalysisPage("test-user", {
        rendered_markdown: "# Analysis",
        structured_json: structuredJson,
      });

      const stored = (add.mock.calls[0] as any[])[0];
      expect(stored.structured_json).toEqual(structuredJson);
      expect(stored.structured_json.collocations).toBe(structuredJson.collocations);
      expect(stored.structured_json.registers).toBe(structuredJson.registers);
    });

    // P8-D3 — reproducibility metadata for translated (zh/en) analyses.
    // structured_json persistence is wholesale (proven above for reading /
    // collocations / registers); these tests lock the same guarantee for the
    // new `translation` sub-object, plus the dedup-interaction finding.
    describe("P8-D3 structured_json.translation", () => {
      it("persists a zh + natural-style translation block unchanged, with no profile fields", async () => {
        const add = jest.fn();
        mockDb.collection.mockReturnValue({ add });
        const structuredJson = {
          words: [],
          grammars: [],
          translation: {
            sourceLanguage: "zh" as const,
            translationStyle: "natural",
            translatedJapanese: "台風が接近しています。",
          },
        };

        await service.saveAnalysisPage("test-user", {
          rendered_markdown: "# Analysis",
          structured_json: structuredJson,
        });

        const stored = (add.mock.calls[0] as any[])[0];
        expect(stored.structured_json).toEqual(structuredJson);
        expect(stored.structured_json.translation).toBe(structuredJson.translation);
        expect(stored.structured_json.translation).not.toHaveProperty("translationProfileId");
        expect(stored.structured_json.translation).not.toHaveProperty("translationProfileVersion");
      });

      it("persists a zh + business-style translation block with profile id/version unchanged", async () => {
        const add = jest.fn();
        mockDb.collection.mockReturnValue({ add });
        const structuredJson = {
          words: [],
          grammars: [],
          translation: {
            sourceLanguage: "zh" as const,
            translationStyle: "business",
            translationProfileId: "oriwish-ja-business-v1",
            translationProfileVersion: "1",
            translatedJapanese: "弊社の製品をご案内申し上げます。",
          },
        };

        await service.saveAnalysisPage("test-user", {
          rendered_markdown: "# Analysis",
          structured_json: structuredJson,
        });

        const stored = (add.mock.calls[0] as any[])[0];
        expect(stored.structured_json.translation).toEqual(structuredJson.translation);
      });

      it("persists an en-source translation block", async () => {
        const add = jest.fn();
        mockDb.collection.mockReturnValue({ add });
        const structuredJson = {
          words: [],
          grammars: [],
          translation: {
            sourceLanguage: "en" as const,
            translationStyle: "news",
            translatedJapanese: "台風が接近している。",
          },
        };

        await service.saveAnalysisPage("test-user", {
          rendered_markdown: "# Analysis",
          structured_json: structuredJson,
        });

        const stored = (add.mock.calls[0] as any[])[0];
        expect(stored.structured_json.translation.sourceLanguage).toBe("en");
      });

      it("never persists glossary, protectedTerms, brandVoice, or prompt content, even if present on the input object", async () => {
        const add = jest.fn();
        mockDb.collection.mockReturnValue({ add });
        // Simulates a hypothetical malformed/attacker-supplied payload — the
        // service must still pass structured_json through wholesale (it does
        // no field-level filtering), but this locks in that NOTHING upstream
        // of it ever legitimately constructs a translation block containing
        // these keys (see PreStageResult in multilingualPreStage.ts, which
        // never carries them either).
        const structuredJson = {
          words: [],
          grammars: [],
          translation: {
            sourceLanguage: "zh" as const,
            translationStyle: "business",
            translatedJapanese: "テスト。",
          },
        };

        await service.saveAnalysisPage("test-user", {
          rendered_markdown: "# Analysis",
          structured_json: structuredJson,
        });

        const stored = (add.mock.calls[0] as any[])[0];
        expect(Object.keys(stored.structured_json.translation).sort()).toEqual(
          ["sourceLanguage", "translatedJapanese", "translationStyle"].sort()
        );
      });

      it("keeps structured_json.translation optional — an old item without it still saves/reads normally", async () => {
        const add = jest.fn();
        mockDb.collection.mockReturnValue({ add });
        const structuredJson = { words: [{ term: "test", detail: "test" }], grammars: [] };

        await service.saveAnalysisPage("test-user", {
          rendered_markdown: "# Analysis",
          structured_json: structuredJson,
        });

        const stored = (add.mock.calls[0] as any[])[0];
        expect(stored.structured_json).not.toHaveProperty("translation");
      });

      it("persists structured_json.translation on shared pages too", async () => {
        const add = jest.fn();
        mockDb.collection.mockReturnValue({ add });
        const structuredJson = {
          words: [],
          grammars: [],
          translation: {
            sourceLanguage: "zh" as const,
            translationStyle: "natural",
            translatedJapanese: "テスト。",
          },
        };

        await service.saveAnalysisPage(null, {
          rendered_markdown: "# Shared analysis",
          structured_json: structuredJson,
        }, true);

        expect(mockDb.collection).toHaveBeenCalledWith("shared_analysis_pages");
        expect(add).toHaveBeenCalledWith(expect.objectContaining({
          structured_json: structuredJson,
        }));
      });

      it("dedup interaction: shared saves of the same source_text collapse to one doc even with different translation metadata (dedup is source_text-only)", async () => {
        const create = jest.fn() as any;
        const doc = jest.fn((_id: string) => ({ create }));
        mockDb.collection.mockReturnValue({ doc });

        await service.saveAnalysisPage(
          null,
          {
            rendered_markdown: "# md",
            structured_json: {
              translation: { sourceLanguage: "zh" as const, translationStyle: "natural", translatedJapanese: "A" },
            },
          },
          true,
          { source_text: "美國Prismacolor Premier色鉛筆" }
        );
        await service.saveAnalysisPage(
          null,
          {
            rendered_markdown: "# md",
            structured_json: {
              translation: { sourceLanguage: "zh" as const, translationStyle: "business", translatedJapanese: "B" },
            },
          },
          true,
          { source_text: "美國Prismacolor Premier色鉛筆" }
        );

        // Same source_text -> same content-hash doc id regardless of the
        // differing translation style/output — current dedup behavior is
        // unchanged by P8-D3 (documented, not silently altered).
        expect(doc.mock.calls[0][0]).toBe(doc.mock.calls[1][0]);
      });
    });

    it("stores structured JSON on shared pages", async () => {
      const add = jest.fn();
      mockDb.collection.mockReturnValue({ add });
      const structuredJson = { words: [], grammars: [] };

      await service.saveAnalysisPage(null, {
        rendered_markdown: "# Shared analysis",
        structured_json: structuredJson,
      }, true);

      expect(mockDb.collection).toHaveBeenCalledWith("shared_analysis_pages");
      expect(add).toHaveBeenCalledWith(expect.objectContaining({
        structured_json: structuredJson,
      }));
    });

    // P7.4 — shared-collection deduplication. Personal saves are untouched
    // (still `.add()`, tested above); a shared save with usable source_text
    // is written under a deterministic content-hash document id via the
    // atomic `create()` instead.
    describe("P7.4 shared-page deduplication", () => {
      function wireDocCreate() {
        const create = jest.fn() as any;
        const doc = jest.fn((_id: string) => ({ create }));
        mockDb.collection.mockReturnValue({ doc });
        return { create, doc };
      }

      it("writes a new shared page via create() under its content-hash id", async () => {
        const { create, doc } = wireDocCreate();

        const result = await service.saveAnalysisPage(
          null,
          { rendered_markdown: "# md" },
          true,
          { source_text: "美國Prismacolor Premier色鉛筆" }
        );

        const expectedHash = sharedPageContentHash("美國Prismacolor Premier色鉛筆");
        expect(mockDb.collection).toHaveBeenCalledWith("shared_analysis_pages");
        expect(doc).toHaveBeenCalledWith(expectedHash);
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({ source_text: "美國Prismacolor Premier色鉛筆" })
        );
        expect(result).toEqual({ saved: true, alreadyExists: false });
      });

      it("returns alreadyExists:true without throwing when create() rejects ALREADY_EXISTS", async () => {
        const { create } = wireDocCreate();
        create.mockImplementation(async () => {
          throw Object.assign(new Error("6 ALREADY_EXISTS"), { code: 6 });
        });

        const result = await service.saveAnalysisPage(
          null,
          { rendered_markdown: "# md" },
          true,
          { source_text: "hello" }
        );

        expect(result).toEqual({ saved: false, alreadyExists: true });
      });

      it("propagates a non-ALREADY_EXISTS create() failure", async () => {
        const { create } = wireDocCreate();
        create.mockImplementation(async () => {
          throw new Error("some other Firestore failure");
        });

        await expect(
          service.saveAnalysisPage(null, { rendered_markdown: "# md" }, true, {
            source_text: "hello",
          })
        ).rejects.toThrow("some other Firestore failure");
      });

      it("uses the same content-hash id for whitespace-only differences in source_text", async () => {
        const { doc } = wireDocCreate();

        await service.saveAnalysisPage(null, { rendered_markdown: "# md" }, true, {
          source_text: "hello   world",
        });
        await service.saveAnalysisPage(null, { rendered_markdown: "# md" }, true, {
          source_text: "  hello world  ",
        });

        expect(doc.mock.calls[0][0]).toBe(doc.mock.calls[1][0]);
      });

      it("uses a different content-hash id for genuinely different source_text", async () => {
        const { doc } = wireDocCreate();

        await service.saveAnalysisPage(null, { rendered_markdown: "# md" }, true, {
          source_text: "hello",
        });
        await service.saveAnalysisPage(null, { rendered_markdown: "# md" }, true, {
          source_text: "goodbye",
        });

        expect(doc.mock.calls[0][0]).not.toBe(doc.mock.calls[1][0]);
      });

      it("falls back to add() (no dedup) when source_text is absent — never collapses source-text-less saves together", async () => {
        const add = jest.fn();
        mockDb.collection.mockReturnValue({ add });

        const result = await service.saveAnalysisPage(
          null,
          { rendered_markdown: "# md" },
          true,
          {}
        );

        expect(add).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ saved: true, alreadyExists: false });
      });

      it("does not deduplicate personal (non-shared) page saves", async () => {
        const add = jest.fn();
        mockDb.collection.mockReturnValue({ add });

        await service.saveAnalysisPage(
          "test-user",
          { rendered_markdown: "# md" },
          false,
          { source_text: "hello" }
        );
        await service.saveAnalysisPage(
          "test-user",
          { rendered_markdown: "# md" },
          false,
          { source_text: "hello" }
        );

        // Personal path always uses add(); dedup logic is shared-only.
        expect(add).toHaveBeenCalledTimes(2);
      });
    });
  });

  // Japanese Reader v0.4 P1 — personal page + learning items, one atomic batch.
  describe("savePersonalAnalysisPage", () => {
    const structuredJson = { words: [], grammars: [] };

    function wireCollections(pageId = "page-abc") {
      let itemSeq = 0;
      const pagesCol = { doc: jest.fn(() => ({ id: pageId })) };
      const itemsCol = { doc: jest.fn(() => ({ id: `item-${++itemSeq}` })) };
      mockDb.collection.mockImplementation((path: string) =>
        path.endsWith("/analysis_pages") ? pagesCol : itemsCol
      );
      return { pagesCol, itemsCol };
    }

    const twoItems = (sourceAnalysisId: string) =>
      [
        {
          userId: "u1",
          sourceAnalysisId,
          type: "vocab",
          surface: "改善",
          status: "NEW",
          createdAt: 5,
          updatedAt: 5,
          lexicalKey: "vocab|改善|かいぜん",
          reading: "かいぜん",
          meaning: "改善",
          sourceSentence: "S",
          sourceUrl: null,
        },
        {
          userId: "u1",
          sourceAnalysisId,
          type: "grammar",
          surface: "ても",
          status: "NEW",
          createdAt: 5,
          updatedAt: 5,
          lexicalKey: "grammar|ても|",
          reading: null,
          meaning: null,
          sourceSentence: "S",
          sourceUrl: null,
        },
      ] as any;

    it("writes the page and every learning item in a single batch commit", async () => {
      wireCollections("page-abc");
      const deriveItems = jest.fn(twoItems);

      const result = await service.savePersonalAnalysisPage(
        "u1",
        { rendered_markdown: "# md", structured_json: structuredJson },
        { source_text: "S", source_url: "https://ex.test/a", saved_at: "2026-09-09T00:00:00.000Z" },
        deriveItems
      );

      expect(result).toEqual({ pageId: "page-abc", learningItemsCount: 2 });
      expect(deriveItems).toHaveBeenCalledWith("page-abc");
      // 1 page + 2 items, exactly one commit.
      expect(mockBatch.set).toHaveBeenCalledTimes(3);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
      expect(mockDb.collection).toHaveBeenCalledWith("users/u1/analysis_pages");
      expect(mockDb.collection).toHaveBeenCalledWith("users/u1/learning_items");
    });

    it("carries structured_json.translation through the personal (private-save) batch path unchanged", async () => {
      wireCollections("page-abc");
      const translation = {
        sourceLanguage: "zh" as const,
        translationStyle: "natural",
        translatedJapanese: "台風が接近しています。",
      };
      await service.savePersonalAnalysisPage(
        "u1",
        { rendered_markdown: "# md", structured_json: { ...structuredJson, translation } },
        { source_text: "S" },
        twoItems
      );
      const pageWrites = mockBatch.set.mock.calls.filter((c: any[]) => c[0].id === "page-abc");
      expect(pageWrites[0][1].structured_json.translation).toEqual(translation);
    });

    it("writes exactly one analysis_pages document carrying rendered_markdown + structured_json", async () => {
      wireCollections("page-abc");
      await service.savePersonalAnalysisPage(
        "u1",
        { rendered_markdown: "# md", structured_json: structuredJson },
        { source_text: "S", source_url: "" },
        twoItems
      );
      const pageWrites = mockBatch.set.mock.calls.filter(
        (c: any[]) => c[0].id === "page-abc"
      );
      expect(pageWrites).toHaveLength(1);
      expect(pageWrites[0][1]).toEqual(
        expect.objectContaining({
          rendered_markdown: "# md",
          structured_json: structuredJson,
          source_text: "S",
          source_url: "",
        })
      );
      expect(typeof pageWrites[0][1].createdAt).toBe("number");
      expect(typeof pageWrites[0][1].saved_at).toBe("string");
    });

    it("stores each learning item with its Firestore doc id as the `id` field", async () => {
      wireCollections("page-abc");
      await service.savePersonalAnalysisPage(
        "u1",
        { rendered_markdown: "# md" },
        {},
        twoItems
      );
      const itemWrites = mockBatch.set.mock.calls.filter((c: any[]) => c[0].id !== "page-abc");
      expect(itemWrites).toHaveLength(2);
      for (const [ref, doc] of itemWrites) {
        expect(doc.id).toBe(ref.id);
        expect(doc.id).toMatch(/^item-\d+$/);
        expect(doc.sourceAnalysisId).toBe("page-abc");
        expect(doc.status).toBe("NEW");
      }
    });

    it("never addresses a shared root collection", async () => {
      wireCollections();
      await service.savePersonalAnalysisPage("u1", { rendered_markdown: "# md" }, {}, twoItems);
      for (const [path] of mockDb.collection.mock.calls) {
        expect(path).toMatch(/^users\/u1\//);
      }
    });

    it("returns {pageId:null} and never derives or commits when there is no page", async () => {
      wireCollections();
      const deriveItems = jest.fn(() => {
        throw new Error("must not derive without a page");
      });
      const result = await service.savePersonalAnalysisPage(
        "u1",
        { rendered_markdown: "" } as any,
        {},
        deriveItems
      );
      expect(result).toEqual({ pageId: null, learningItemsCount: 0 });
      expect(deriveItems).not.toHaveBeenCalled();
      expect(mockBatch.commit).not.toHaveBeenCalled();
    });

    it("commits a page-only save (zero derived items) without error", async () => {
      wireCollections("p1");
      const result = await service.savePersonalAnalysisPage(
        "u1",
        { rendered_markdown: "# md" },
        {},
        () => []
      );
      expect(result).toEqual({ pageId: "p1", learningItemsCount: 0 });
      expect(mockBatch.set).toHaveBeenCalledTimes(1);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it("propagates a batch-commit failure and routes every write through the one batch (nothing persisted on failure)", async () => {
      wireCollections("page-abc");
      mockBatch.commit.mockRejectedValueOnce(new Error("batch commit failed"));

      await expect(
        service.savePersonalAnalysisPage("u1", { rendered_markdown: "# md" }, {}, twoItems)
      ).rejects.toThrow("batch commit failed");

      // Page + both items were staged on the SAME batch and no write bypassed it,
      // so the rejected commit means Firestore applied none of them.
      expect(mockBatch.set).toHaveBeenCalledTimes(3);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
      expect(mockDb.batch).toHaveBeenCalledTimes(1);
    });
  });
});
