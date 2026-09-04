import { describe, it, expect } from "@jest/globals";
import { SYSTEM_PROMPT_V2 } from "../../src/models/systemPromptV2";

describe("SYSTEM_PROMPT_V2", () => {
  it("is non-empty and includes the grammar analysis section", () => {
    expect(SYSTEM_PROMPT_V2.trim().length).toBeGreaterThan(0);
    expect(SYSTEM_PROMPT_V2).toContain("### 文法分析");
  });

  it("does not hardcode a fixed cap of two grammar points", () => {
    expect(SYSTEM_PROMPT_V2).not.toContain("只能列出二則分析");
  });

  it("instructs a 0-5 grammar point range", () => {
    expect(SYSTEM_PROMPT_V2).toMatch(/0\s*[〜~-]\s*5/);
  });

  it("keeps the shared output section structure", () => {
    expect(SYSTEM_PROMPT_V2).toContain("### 原句");
    expect(SYSTEM_PROMPT_V2).toContain("### 單字分析");
    expect(SYSTEM_PROMPT_V2).toContain("### 文法分析");
    expect(SYSTEM_PROMPT_V2).toContain("動詞分類");
  });

  describe("usage-oriented vocabulary contract", () => {
    it("limits V2 to at most four high-value vocabulary items, selected by value not JLPT band", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/最多\s*4\s*個高價值詞/);
      // Phase 2B-2: JLPT-band chasing/prioritization removed — see the
      // vocabulary-selection tests in the Phase 2B-2 describe block below.
      expect(SYSTEM_PROMPT_V2).not.toContain("JLPT N1,N2,N3");
      expect(SYSTEM_PROMPT_V2).not.toContain("不列 N4/N5 基礎詞");
    });

    it("allows high-value non-verb vocabulary categories", () => {
      expect(SYSTEM_PROMPT_V2).toContain("サ變名詞");
      expect(SYSTEM_PROMPT_V2).toContain("形容詞");
      expect(SYSTEM_PROMPT_V2).toContain("副詞");
      expect(SYSTEM_PROMPT_V2).toContain("重要複合名詞");
      expect(SYSTEM_PROMPT_V2).toContain("片假名外來語");
    });

    it("requires sentence-production fields in V2 vocabulary entries", () => {
      expect(SYSTEM_PROMPT_V2).toContain("原句中的意思");
      expect(SYSTEM_PROMPT_V2).toContain("常見搭配／句型框架");
      expect(SYSTEM_PROMPT_V2).toContain("自然例句");
      expect(SYSTEM_PROMPT_V2).toContain("繁體中文翻譯");
      expect(SYSTEM_PROMPT_V2).toContain("語感／語域");
      expect(SYSTEM_PROMPT_V2).toContain("造句模板");
      expect(SYSTEM_PROMPT_V2).toContain("回想題");
      expect(SYSTEM_PROMPT_V2).toContain("易混淆比較");
    });
  });

  it("instructs grounding in the user's input sentence first", () => {
    expect(SYSTEM_PROMPT_V2).toMatch(/使用者輸入的文句|輸入の文句/);
  });

  // V2-only comprehensive fields (R8-R11)
  it("includes the native-speaker intuition field (母語者語感)", () => {
    expect(SYSTEM_PROMPT_V2).toContain("母語者語感");
  });

  it("includes the literal decomposition field (元素分解)", () => {
    expect(SYSTEM_PROMPT_V2).toContain("元素分解");
  });

  it("includes the similar-pattern comparison instruction", () => {
    expect(SYSTEM_PROMPT_V2).toContain("相似文法比較");
  });

  it("includes the three register labels in the example", () => {
    expect(SYSTEM_PROMPT_V2).toContain("カジュアル");
    expect(SYSTEM_PROMPT_V2).toContain("丁寧");
    expect(SYSTEM_PROMPT_V2).toContain("ビジネス");
  });

  describe("surrounding-context disambiguation instruction", () => {
    it("documents the optional before/after context blocks and the target block", () => {
      expect(SYSTEM_PROMPT_V2).toContain("【前文】");
      expect(SYSTEM_PROMPT_V2).toContain("【分析対象】");
      expect(SYSTEM_PROMPT_V2).toContain("【後文】");
    });

    it("states context is for disambiguation only and must not enter the output", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/消歧/);
      expect(SYSTEM_PROMPT_V2).toMatch(/不可出現在/);
    });
  });

  describe("grammar example heading/content alignment (R3)", () => {
    const grammarSection =
      SYSTEM_PROMPT_V2.split("### 文法分析")[1] ?? "";
    const entries = grammarSection
      .split(/^####\s+/m)
      .slice(1)
      .map((e) => e.trim())
      .filter(Boolean);

    it("has at least one grammar example heading", () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it("does not carry over the old mismatched 〜かいがある heading", () => {
      expect(entries.join("\n")).not.toContain("かいがある");
    });

    it("every grammar heading is reflected in its own body", () => {
      for (const entry of entries) {
        const headMatch = entry.match(/<文法>\s*([^\n（(]+)/);
        expect(headMatch).not.toBeNull();
        const patternCore = headMatch![1].trim().replace(/^〜+/, "");
        const body = entry
          .split("\n")
          .slice(1)
          .join("\n")
          .replace(/\{([^|}|]+)\|[^}]*\}/g, "$1");
        expect(body).toContain(patternCore);
      }
    });
  });

  describe("verb conjugation removed from prompt (U3)", () => {
    // Item 2 is the verb instruction line within the numbered 脚本 list.
    const verbInstruction =
      SYSTEM_PROMPT_V2.split("\n").find((l) => /^2\.\s/.test(l)) ?? "";
    // The worked examples live between the vocabulary and grammar headers.
    const vocabSection = (SYSTEM_PROMPT_V2.split("### 單字分析")[1] ?? "").split(
      "### 文法分析"
    )[0];

    it("verb instruction no longer demands conjugation forms", () => {
      // The old comma-chained demand enumeration is gone from item 2.
      expect(verbInstruction).not.toContain(
        "ます形,た形,ない形,て形,意向形,命令形,使役形,受身形"
      );
      // 受身形(被動形) only ever appeared in the old demand list.
      expect(verbInstruction).not.toContain("受身形(被動形)");
      // The instruction now explicitly delegates forms to the system.
      expect(verbInstruction).toMatch(/由系統自動產生/);
      expect(verbInstruction).toMatch(/請勿輸出/);
    });

    it("the numbered vocabulary rules no longer request old conjugation fields", () => {
      const scriptSection = (SYSTEM_PROMPT_V2.split("# 脚本")[1] ?? "").split(
        "# 内容"
      )[0];
      expect(scriptSection).not.toContain("て形");
      expect(scriptSection).not.toContain("否定形");
    });

    it("verb instruction still requires the engine-needed verb fields", () => {
      // 讀音 is conveyed via the worked examples; item 2 enumerates the rest.
      // 重音 (pitch accent) was removed in Phase 2B-1 — see the pitch-accent tests below.
      expect(verbInstruction).toContain("動詞分類");
      expect(verbInstruction).toContain("解釋");
      expect(verbInstruction).toContain("辭書形");
    });

    it("worked verb examples no longer list conjugation forms", () => {
      expect(vocabSection).not.toContain("使役受身形");
      expect(vocabSection).not.toContain("ます形");
      expect(vocabSection).not.toContain("否定形");
      expect(vocabSection).not.toContain("意向形");
    });

    it("worked verb examples still emit 讀音 and 辭書形", () => {
      expect(vocabSection).toContain("讀音：");
      expect(vocabSection).toContain("辭書形：");
    });

    it("辭書形 still appears in the prompt", () => {
      expect(SYSTEM_PROMPT_V2).toContain("辭書形");
    });

    it("grammar section remains intact (V2 structure)", () => {
      expect(SYSTEM_PROMPT_V2).toContain("### 文法分析");
      expect(SYSTEM_PROMPT_V2).toContain("相似文法比較");
      // Phase 2B-2: the worked heading no longer carries a JLPT label.
      expect(SYSTEM_PROMPT_V2).toContain("#### <文法>〜として");
    });
  });

  describe("Phase 2B-1: managed prompt convergence", () => {
    it("adds the collocation section, instructed and worked", () => {
      expect(SYSTEM_PROMPT_V2).toContain("### 搭配分析");
      // Collocations must not be promoted into grammar analysis.
      expect(SYSTEM_PROMPT_V2).toMatch(/搭配.{0,20}不得被拉入.{0,10}文法分析/);
    });

    it("adds the register/news-style section, instructed and worked", () => {
      expect(SYSTEM_PROMPT_V2).toContain("### 語體／新聞表現");
    });

    it("carves basic case particles out of grammar promotion", () => {
      expect(SYSTEM_PROMPT_V2).toContain("基本格助詞不得升格為文法點");
      expect(SYSTEM_PROMPT_V2).toMatch(/に／を／が／で／へ/);
    });

    it("states the grounding principle across all analysis categories", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/落地（grounding）原則/);
      expect(SYSTEM_PROMPT_V2).toMatch(/只能描述實際出現在【分析対象】中的形式/);
    });

    it("explains 連用中止 as continuative-form clause linkage, not て-omission", () => {
      expect(SYSTEM_PROMPT_V2).toContain("連用中止");
      expect(SYSTEM_PROMPT_V2).toContain("不可簡化為「省略了て」");
      expect(SYSTEM_PROMPT_V2).toMatch(/連用形.{0,10}接續後續子句/);
    });

    it("does not request pitch accent / 重音 output anywhere, and forbids it explicitly", () => {
      // No worked-example data field asking for a pitch-accent number.
      expect(SYSTEM_PROMPT_V2).not.toMatch(/[-•]\s*重音[:：]/);
      // The old instruction enumerating 讀音、重音、動詞分類 is gone.
      expect(SYSTEM_PROMPT_V2).not.toContain("列出讀音、重音");
      expect(SYSTEM_PROMPT_V2).not.toContain("片假名外來語另列重音");
      // Replaced with an explicit prohibition (mirrors the personal-provider contract).
      expect(SYSTEM_PROMPT_V2).toMatch(/不要輸出重音／音調（pitch accent）數字/);
    });

    it("does not add the reading contract", () => {
      expect(SYSTEM_PROMPT_V2).not.toContain("reading_contract_version");
      expect(SYSTEM_PROMPT_V2).not.toContain("讀音契約");
    });
  });

  describe("Phase 2B-2: grammar quota + JLPT contract migration", () => {
    it("instructs a 0〜5 grammar point range", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/0\s*[〜~-]\s*5/);
    });

    it("explicitly states that 0 grammar points is a valid answer", () => {
      expect(SYSTEM_PROMPT_V2).toContain("0 個也是有效的答案");
      expect(SYSTEM_PROMPT_V2).toMatch(/如果原句沒有值得教的文法結構，就輸出\s*0\s*個文法點/);
    });

    it("explicitly forbids quota-filling with collocations/particles/phrases", () => {
      expect(SYSTEM_PROMPT_V2).toContain("不要為了湊數把搭配、基本助詞用法或詞組硬塞進文法分析");
      expect(SYSTEM_PROMPT_V2).toContain("只納入實際出現在【分析対象】中、真正具有學習價值的文法");
    });

    it("no longer requires JLPT levels in grammar headings", () => {
      expect(SYSTEM_PROMPT_V2).not.toContain("「文法點 + JLPT 等級」");
      expect(SYSTEM_PROMPT_V2).toContain("「文法點」");
      expect(SYSTEM_PROMPT_V2).toMatch(/標題不需要、也不應該標注\s*JLPT\s*等級/);
    });

    it("worked example grammar heading carries no （N3） label", () => {
      expect(SYSTEM_PROMPT_V2).not.toContain("〜として（N3）");
      expect(SYSTEM_PROMPT_V2).toContain("#### <文法>〜として");
    });

    it("vocabulary instruction no longer prioritizes N1/N2/N3", () => {
      expect(SYSTEM_PROMPT_V2).not.toContain("JLPT N1,N2,N3 優先");
      expect(SYSTEM_PROMPT_V2).not.toContain("N1,N2,N3 優先");
      expect(SYSTEM_PROMPT_V2).not.toContain("不列 N4/N5 基礎詞");
    });

    it("replaces band-based exclusion with value-based vocabulary selection wording", () => {
      expect(SYSTEM_PROMPT_V2).toContain("不列對理解原句沒有幫助的基礎詞");
      expect(SYSTEM_PROMPT_V2).toMatch(/用法非直觀、具有特定語域，或帶有值得學的搭配/);
      // The 4-item cap itself is unchanged by this phase.
      expect(SYSTEM_PROMPT_V2).toMatch(/最多\s*4\s*個高價值詞/);
    });

    it("still does not add the reading contract", () => {
      expect(SYSTEM_PROMPT_V2).not.toContain("reading_contract_version");
      expect(SYSTEM_PROMPT_V2).not.toContain("讀音契約");
      expect(SYSTEM_PROMPT_V2).not.toMatch(/```json/);
    });
  });
});
