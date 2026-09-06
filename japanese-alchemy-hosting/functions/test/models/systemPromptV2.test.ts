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

    // "does not add the reading contract" was removed in Phase 2C-1: the
    // reading contract is now added (see the Phase 2C-1 describe block below).
    // Keeping a negative assertion here would directly contradict it.
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

    // "still does not add the reading contract" was removed in Phase 2C-1:
    // the reading contract is now added (see the Phase 2C-1 describe block
    // below). Keeping a negative assertion here would directly contradict it.
  });

  describe("Phase 2C-1: managed reading contract", () => {
    it("A: requires a final machine-readable reading-contract JSON block", () => {
      expect(SYSTEM_PROMPT_V2).toContain("讀音契約");
      expect(SYSTEM_PROMPT_V2).toContain("reading_contract_version");
      expect(SYSTEM_PROMPT_V2).toContain('"reading_contract_version": 1');
    });

    it("B: requires source_text to reproduce 【分析対象】 exactly, with no normalization", () => {
      expect(SYSTEM_PROMPT_V2).toContain("source_text 必須逐字重現【分析対象】");
      expect(SYSTEM_PROMPT_V2).toContain("不得修剪、正規化、轉換全形／半形、改寫或重複");
    });

    it("C: requires token.text concatenation to equal source_text exactly", () => {
      expect(SYSTEM_PROMPT_V2).toContain("把每個 token.text 依序連接起來，必須完全等於 source_text");
      expect(SYSTEM_PROMPT_V2).toContain("不可插入 source_text 沒有的文字");
      expect(SYSTEM_PROMPT_V2).toContain("不可重複表面文字");
    });

    it("D: requires kana-or-null readings and forbids an empty-string reading", () => {
      expect(SYSTEM_PROMPT_V2).toContain("給假名字串");
      expect(SYSTEM_PROMPT_V2).toContain("不需標音者，給 null");
      expect(SYSTEM_PROMPT_V2).toContain("空字串不是有效的 reading");
    });

    it("E: requires contextual calendar-date readings including 1日→ついたち and 3日→みっか", () => {
      expect(SYSTEM_PROMPT_V2).toContain("讀音必須符合語境");
      expect(SYSTEM_PROMPT_V2).toContain("1日→ついたち");
      expect(SYSTEM_PROMPT_V2).toContain("3日→みっか");
      expect(SYSTEM_PROMPT_V2).toContain("24日→にじゅうよっか");
      // The worked example ties the rule to a concrete token: 日 reads みっか
      // here, not the generic にち.
      expect(SYSTEM_PROMPT_V2).toContain('{"text":"日","reading":"みっか"}');
    });

    it("F: excludes romanization, pitch accent, JLPT level and translation/semantic notes from the contract", () => {
      expect(SYSTEM_PROMPT_V2).toContain("不得放羅馬拼音、重音（pitch accent）、JLPT 等級、翻譯或語意說明");
    });

    it("G (superseded by P0-C1 below): still documents the contract's kana/reading rules", () => {
      // The "must be final, nothing after it" requirement was replaced by the
      // P0-C1 marker-based, first-position contract (see the P0-C1 describe
      // block below) — kept here only to confirm the surrounding rule text
      // (unrelated to position) is untouched.
      expect(SYSTEM_PROMPT_V2).toContain("語言標籤為 json 的 fenced code block");
      expect(SYSTEM_PROMPT_V2).toContain("reading_contract_version");
    });

    it("keeps inline {漢字|かな} ruby and does not remove it", () => {
      expect(SYSTEM_PROMPT_V2).toContain("本階段人類可讀 Markdown 仍須照常使用 {漢字|かな}");
      expect(SYSTEM_PROMPT_V2).toContain("不要移除既有的行內 ruby");
    });

    it("preserves Phase 2B grammar/vocabulary/collocation/register behavior unchanged", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/0\s*[〜~-]\s*5/);
      expect(SYSTEM_PROMPT_V2).toContain("0 個也是有效的答案");
      expect(SYSTEM_PROMPT_V2).not.toContain("「文法點 + JLPT 等級」");
      expect(SYSTEM_PROMPT_V2).not.toContain("JLPT N1,N2,N3 優先");
      expect(SYSTEM_PROMPT_V2).toContain("基本格助詞不得升格為文法點");
      expect(SYSTEM_PROMPT_V2).toContain("### 搭配分析");
      expect(SYSTEM_PROMPT_V2).toContain("### 語體／新聞表現");
      expect(SYSTEM_PROMPT_V2).toContain("不可簡化為「省略了て」");
      expect(SYSTEM_PROMPT_V2).not.toMatch(/[-•]\s*重音[:：]/);
    });
  });

  describe("Phase P0-C1: reading contract moved first, behind an explicit marker", () => {
    it("A: documents the contract as the FIRST block, not the last", () => {
      expect(SYSTEM_PROMPT_V2).toContain("必須是整個回應的第一個區塊");
      expect(SYSTEM_PROMPT_V2).not.toContain("必須是整個回應的最後內容");
      expect(SYSTEM_PROMPT_V2).not.toContain("必須是整個回應的最後非空白內容");
      expect(SYSTEM_PROMPT_V2).not.toContain("讀音契約之後不得再有任何內容");
    });

    it("B: requires the explicit start/end marker sentinels around the fence", () => {
      expect(SYSTEM_PROMPT_V2).toContain("<!-- READING_CONTRACT_START -->");
      expect(SYSTEM_PROMPT_V2).toContain("<!-- READING_CONTRACT_END -->");
    });

    it("C: instructs emitting the contract (through its end marker) before ### 原句 and any prose", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/先完整輸出這整個區塊.*再開始撰寫「### 原句」/s);
      expect(SYSTEM_PROMPT_V2).toContain("即使後續分析因長度限制被截斷，讀音契約仍然完整存活");
    });

    it("D: output-order section lists the contract as step 1, before 原句", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/1\.\s*（最先）讀音契約/);
      const orderSection = SYSTEM_PROMPT_V2.split("## 輸出順序")[1].split("# 内容")[0];
      const contractAt = orderSection.indexOf("讀音契約");
      const genkuAt = orderSection.indexOf("原句");
      expect(contractAt).toBeGreaterThan(-1);
      expect(genkuAt).toBeGreaterThan(contractAt);
    });

    it("E: the worked example's marked fence physically precedes every prose section, with no 漢字提取", () => {
      const startMarkerAt = SYSTEM_PROMPT_V2.indexOf("<!-- READING_CONTRACT_START -->", SYSTEM_PROMPT_V2.indexOf("# 以下為示例與格式"));
      expect(startMarkerAt).toBeGreaterThan(-1);
      const order = ["### 原句", "### 單字分析", "### 文法分析", "### 搭配分析", "### 語體／新聞表現"];
      let cursor = startMarkerAt;
      for (const heading of order) {
        const at = SYSTEM_PROMPT_V2.indexOf(heading, cursor + 1);
        expect(at).toBeGreaterThan(cursor);
        cursor = at;
      }
      expect(SYSTEM_PROMPT_V2).not.toContain("### 漢字提取");
      // exactly one marked block inside the worked-example section itself (not
      // a duplicate left behind after the reordering — earlier prose mentions
      // of the marker text, e.g. in the rule description and output-order
      // list, are expected and irrelevant here).
      const exampleSection = SYSTEM_PROMPT_V2.slice(SYSTEM_PROMPT_V2.indexOf("# 以下為示例與格式"));
      const startCountInExample = exampleSection.split("<!-- READING_CONTRACT_START -->").length - 1;
      expect(startCountInExample).toBe(1);
    });

    it("F: the response now ends with human prose (### 語體／新聞表現), not a trailing fence", () => {
      const trimmed = SYSTEM_PROMPT_V2.replace(/\s+$/, "");
      expect(trimmed.endsWith("```")).toBe(false);
      expect(trimmed).toContain("### 語體／新聞表現");
      const lastHeadingAt = trimmed.lastIndexOf("### 語體／新聞表現");
      expect(trimmed.indexOf("```", lastHeadingAt)).toBe(-1);
    });

    // This suite deliberately does NOT import parseReadingContract from
    // japanese-alchemy-chrome-extension/src/scripts/rubyContract.js — see the
    // rationale kept from Phase 2C-1 above (separate, independently
    // built/deployed packages; no existing cross-project import precedent).
    it("G: the worked example's FIRST marked fence is itself a self-consistent reading contract", () => {
      const startMarker = "<!-- READING_CONTRACT_START -->";
      const exampleSectionStart = SYSTEM_PROMPT_V2.indexOf("# 以下為示例與格式");
      const startMarkerAt = SYSTEM_PROMPT_V2.indexOf(startMarker, exampleSectionStart);
      expect(startMarkerAt).toBeGreaterThan(-1);

      const fenceStart = "```json\n";
      const openIdx = SYSTEM_PROMPT_V2.indexOf(fenceStart, startMarkerAt);
      expect(openIdx).toBeGreaterThan(startMarkerAt);
      const closeIdx = SYSTEM_PROMPT_V2.indexOf("\n```", openIdx);
      expect(closeIdx).toBeGreaterThan(openIdx);

      const jsonText = SYSTEM_PROMPT_V2.slice(openIdx + fenceStart.length, closeIdx);
      const parsed = JSON.parse(jsonText);

      expect(parsed.reading_contract_version).toBe(1);
      expect(typeof parsed.source_text).toBe("string");
      expect(Array.isArray(parsed.tokens)).toBe(true);
      expect(parsed.tokens.length).toBeGreaterThan(0);
      expect(parsed.tokens.every((t: any) => typeof t.text === "string" && t.text.length > 0)).toBe(true);
      expect(
        parsed.tokens.every((t: any) => t.reading === null || (typeof t.reading === "string" && t.reading.length > 0))
      ).toBe(true);
      expect(parsed.tokens.map((t: any) => t.text).join("")).toBe(parsed.source_text);
      // the very next non-whitespace content after the end marker is ### 原句,
      // using the SAME sentence — i.e. the example is internally consistent.
      expect(parsed.source_text).toContain("同技術は特に労働力不足");
      expect(parsed.source_text.endsWith("後押しするという。")).toBe(true);
      const endMarkerEnd = SYSTEM_PROMPT_V2.indexOf("<!-- READING_CONTRACT_END -->", closeIdx)
        + "<!-- READING_CONTRACT_END -->".length;
      const nextHeading = SYSTEM_PROMPT_V2.slice(endMarkerEnd).replace(/^\s+/, "");
      expect(nextHeading.startsWith("### 原句")).toBe(true);
    });
  });

  describe("Phase P1-A: grammar/vocabulary selection quality", () => {
    it("1: the plain/basic case-particle carve-out remains present, unweakened", () => {
      expect(SYSTEM_PROMPT_V2).toContain("基本格助詞不得升格為文法點");
      expect(SYSTEM_PROMPT_V2).toMatch(/に／を／が／で／へ/);
      expect(SYSTEM_PROMPT_V2).toContain(
        "不要僅因為出現「に／を／が／で／へ」等基本格助詞的一般格位標記用法，就替它建立獨立的文法點"
      );
    });

    it("2: clarifies the carve-out applies only to plain case-marking uses, not independently-teachable compounds", () => {
      expect(SYSTEM_PROMPT_V2).toContain("這項淘汰僅適用於純粹的格位標記用法");
      expect(SYSTEM_PROMPT_V2).toContain("が作為單純的主語標記");
      expect(SYSTEM_PROMPT_V2).toContain("で作為單純的地點／工具／方式標記");
      expect(SYSTEM_PROMPT_V2).toMatch(/不得僅因表面包含「が」或「で」就自動被淘汰/);
    });

    it("3: contrastive が, では, and でも are named as examples that must not be auto-demoted", () => {
      const clarification = SYSTEM_PROMPT_V2.split("這項淘汰僅適用於純粹的格位標記用法")[1] ?? "";
      expect(clarification).toContain("〜が作為轉折／讓步的子句連接詞（逆接）");
      expect(clarification).toContain("では作為主題化／對比化的複合表現");
      expect(clarification).toContain("でも作為讓步、舉極端例，或其他獨立複合用法");
      // framed as illustrative examples eligible when they carry teaching value —
      // not a mandatory whitelist that must always appear.
      expect(SYSTEM_PROMPT_V2).toContain("這不代表這些用法一定要出現");
      expect(SYSTEM_PROMPT_V2).toMatch(/若原句中沒有這類用法.*就不要為了湊數而勉強列出/);
    });

    it("4: no minimum grammar count is reintroduced — 0 remains a valid answer", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/0\s*[〜~-]\s*5/);
      expect(SYSTEM_PROMPT_V2).toContain("0 個也是有效的答案");
      expect(SYSTEM_PROMPT_V2).not.toMatch(/找出\s*1\s*[〜~-]\s*5/);
    });

    it("5: anti-quota-fill wording remains intact", () => {
      expect(SYSTEM_PROMPT_V2).toContain("不要為了湊數把搭配、基本助詞用法或詞組硬塞進文法分析");
      expect(SYSTEM_PROMPT_V2).toContain("只納入實際出現在【分析対象】中、真正具有學習價值的文法");
      // the new priority principle explicitly disclaims slot-filling too
      expect(SYSTEM_PROMPT_V2).toContain("不得用來湊滿或填滿文法點數量");
    });

    it("6: no JLPT forcing/labels return", () => {
      expect(SYSTEM_PROMPT_V2).toContain("標題不需要、也不應該標注 JLPT 等級（N1〜N5）");
      expect(SYSTEM_PROMPT_V2).not.toContain("JLPT N1,N2,N3 優先");
      expect(SYSTEM_PROMPT_V2).not.toContain("「文法點 + JLPT 等級」");
      expect(SYSTEM_PROMPT_V2).not.toMatch(/找出\s*1\s*[〜~-]\s*5\s*個\s*N1,\s*N2,\s*N3\s*文法點/);
    });

    it("7: a grammar-candidate priority principle is present, and explicitly is not a slot-filling license", () => {
      expect(SYSTEM_PROMPT_V2).toContain("候選文法點之間的優先順序");
      expect(SYSTEM_PROMPT_V2).toContain(
        "優先選擇對理解【分析対象】具有結構關鍵性、屬於核心語法的高價值文法，其次才是次要或附帶性的文法現象"
      );
      expect(SYSTEM_PROMPT_V2).toMatch(/此優先順序僅用於在合格候選之間做取捨，不得用來湊滿或填滿文法點數量/);
      expect(SYSTEM_PROMPT_V2).toContain("也不影響 0〜5 個的彈性範圍");
    });

    it("8: a vocabulary item already touched in grammar/collocation analysis is not automatically excluded from vocab", () => {
      expect(SYSTEM_PROMPT_V2).toContain(
        "單字若同時在文法分析或搭配分析中被提及，不代表應被排除於單字分析之外"
      );
      expect(SYSTEM_PROMPT_V2).toContain("只要該詞本身仍獨立符合上述高價值標準，仍可同時列為單字條目");
      // not a forced-duplication rule, and the ≤4 cap is untouched
      expect(SYSTEM_PROMPT_V2).toContain("不必因此重複列出，也不強制一定要列出");
      expect(SYSTEM_PROMPT_V2).toMatch(/最多\s*4\s*個高價值詞/);
    });

    it("9: P0-C1 Reading Contract first/marker behavior is unaffected by the P1-A wording changes", () => {
      expect(SYSTEM_PROMPT_V2).toContain("必須是整個回應的第一個區塊");
      expect(SYSTEM_PROMPT_V2).toContain("<!-- READING_CONTRACT_START -->");
      expect(SYSTEM_PROMPT_V2).toContain("<!-- READING_CONTRACT_END -->");
      expect(SYSTEM_PROMPT_V2).toMatch(/1\.\s*（最先）讀音契約/);
    });
  });

  describe("Phase P1-B: silent candidate-first grammar/vocabulary selection", () => {
    it("1: the grammar candidate-first scan instruction is present", () => {
      expect(SYSTEM_PROMPT_V2).toContain(
        "在決定最終文法點之前，先在心裡盤點【分析対象】中所有結構上獨立、真正可教的文法候選"
      );
    });

    it("2: the vocabulary candidate-first scan instruction is present", () => {
      expect(SYSTEM_PROMPT_V2).toContain(
        "在決定最終單字名單之前，先在心裡盤點【分析対象】中所有可能符合高價值標準的單字候選"
      );
    });

    it("3: both scans explicitly forbid appearing in the response, in any form", () => {
      const occurrences = SYSTEM_PROMPT_V2.split("不得以任何形式出現在回應中").length - 1;
      expect(occurrences).toBe(2);
    });

    it("4: the grammar scan explicitly protects a candidate nested inside a broader expression", () => {
      const grammarScan = SYSTEM_PROMPT_V2.split("在決定最終文法點之前")[1]?.split("從文句中找出")[0] ?? "";
      expect(grammarScan).toContain("即使某個候選可能落在另一個較大表達的說明範圍內");
      expect(grammarScan).toContain(
        "只要它本身具有獨立的接續形式與功能"
      );
      expect(grammarScan).toContain("不得只因為已被較大表達提及就略過盤點");
      // the illustrative example ties directly to the P1-A carve-out's own
      // examples (passive/honorific expressions vs. a separate contrastive or
      // topicalizing particle compound) — the exact failure pattern P1-A alone
      // did not resolve.
      expect(grammarScan).toContain("句子同時包含被動或敬語表現與另一個轉折助詞、主題化複合助詞等");
    });

    it("5: the vocab scan explicitly includes items already mentioned in grammar/collocation analysis", () => {
      const vocabScan = SYSTEM_PROMPT_V2.split("在決定最終單字名單之前")[1]?.split("可包含動詞")[0] ?? "";
      expect(vocabScan).toContain("包括已經在文法分析或搭配分析中被提及、但本身仍可能獨立成立的詞彙");
    });

    it("6: every P1-A rule remains present and unchanged", () => {
      expect(SYSTEM_PROMPT_V2).toContain("基本格助詞不得升格為文法點");
      expect(SYSTEM_PROMPT_V2).toContain("這項淘汰僅適用於純粹的格位標記用法");
      expect(SYSTEM_PROMPT_V2).toContain("〜が作為轉折／讓步的子句連接詞（逆接）");
      expect(SYSTEM_PROMPT_V2).toContain("では作為主題化／對比化的複合表現");
      expect(SYSTEM_PROMPT_V2).toContain("でも作為讓步、舉極端例，或其他獨立複合用法");
      expect(SYSTEM_PROMPT_V2).toContain("候選文法點之間的優先順序");
      expect(SYSTEM_PROMPT_V2).toContain(
        "單字若同時在文法分析或搭配分析中被提及，不代表應被排除於單字分析之外"
      );
    });

    it("7: 0-5 grammar, 0-is-valid, and anti-quota-fill wording remain", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/0\s*[〜~-]\s*5/);
      expect(SYSTEM_PROMPT_V2).toContain("0 個也是有效的答案");
      expect(SYSTEM_PROMPT_V2).toContain("不要為了湊數把搭配、基本助詞用法或詞組硬塞進文法分析");
      expect(SYSTEM_PROMPT_V2).not.toMatch(/找出\s*1\s*[〜~-]\s*5/);
    });

    it("8: the ≤4 vocabulary cap remains", () => {
      expect(SYSTEM_PROMPT_V2).toMatch(/最多\s*4\s*個高價值詞/);
    });

    it("9: no JLPT forcing returns", () => {
      expect(SYSTEM_PROMPT_V2).toContain("標題不需要、也不應該標注 JLPT 等級（N1〜N5）");
      expect(SYSTEM_PROMPT_V2).not.toContain("JLPT N1,N2,N3 優先");
      expect(SYSTEM_PROMPT_V2).not.toContain("「文法點 + JLPT 等級」");
    });

    it("10: P0-C1 Reading Contract first/marker/order behavior is unchanged", () => {
      expect(SYSTEM_PROMPT_V2).toContain("必須是整個回應的第一個區塊");
      expect(SYSTEM_PROMPT_V2).toContain("<!-- READING_CONTRACT_START -->");
      expect(SYSTEM_PROMPT_V2).toContain("<!-- READING_CONTRACT_END -->");
      expect(SYSTEM_PROMPT_V2).toMatch(/1\.\s*（最先）讀音契約/);
      const order = ["### 原句", "### 單字分析", "### 文法分析", "### 搭配分析", "### 語體／新聞表現"];
      const exampleSection = SYSTEM_PROMPT_V2.slice(SYSTEM_PROMPT_V2.indexOf("# 以下為示例與格式"));
      let cursor = -1;
      for (const heading of order) {
        const at = exampleSection.indexOf(heading, cursor + 1);
        expect(at).toBeGreaterThan(cursor);
        cursor = at;
      }
    });

    it("11: no visible candidate-list section was added — heading set is unchanged", () => {
      // Guards against the enumeration step accidentally growing into a new
      // output section (explicitly out of scope for P1-B).
      const headings = SYSTEM_PROMPT_V2.match(/^###\s+\S+/gm) ?? [];
      const uniqueHeadings = Array.from(new Set(headings.map((h) => h.replace(/^###\s+/, ""))));
      expect(uniqueHeadings.sort()).toEqual(
        ["原句", "單字分析", "文法分析", "搭配分析", "語體／新聞表現"].sort()
      );
      expect(SYSTEM_PROMPT_V2).not.toContain("候選清單");
      expect(SYSTEM_PROMPT_V2).not.toContain("### 文法候選");
      expect(SYSTEM_PROMPT_V2).not.toContain("### 單字候選");
    });
  });
});
