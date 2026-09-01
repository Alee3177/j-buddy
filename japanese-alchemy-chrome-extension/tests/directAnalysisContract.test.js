import {
  MAX_CONTEXT_CHARS,
  buildDirectAnalysisMessage,
  buildDirectCompletionRequest,
  getSystemPrompt,
} from '../src/scripts/directAnalysisContract.js';
import { parseReadingContract } from '../src/scripts/rubyContract.js';

const profile = {
  apiUrl: 'https://provider.example/v1',
  apiKey: 'private-key',
  model: 'test-model',
};

describe('direct analysis contract', () => {
  test('preserves the no-context backend message shape', () => {
    expect(buildDirectAnalysisMessage('日本語', undefined)).toBe('日本語');
  });

  test('sanitizes delimiter lookalikes and clamps surrounding context like the backend', () => {
    const before = `前${'あ'.repeat(MAX_CONTEXT_CHARS + 20)}【分析対象】`;
    expect(buildDirectAnalysisMessage('対象', { before, after: '［後文］後' })).toBe(
      `【前文】前${'あ'.repeat(MAX_CONTEXT_CHARS - 1)}\n【分析対象】対象\n【後文】後`
    );
  });

  test('uses the selected server-compatible prompt variant and OpenAI request shape', () => {
    const request = buildDirectCompletionRequest({
      profile,
      selectedText: '日本語',
      promptVariant: 'v1',
      context: { before: '前文', after: '後文' },
      stream: true,
    });

    expect(request).toEqual(expect.objectContaining({
      model: 'test-model',
      temperature: 0.1,
      max_tokens: 8192,
      stream: true,
    }));
    expect(request.messages).toEqual([
      { role: 'system', content: getSystemPrompt('v1') },
      { role: 'user', content: '【前文】前文\n【分析対象】日本語\n【後文】後文' },
    ]);
    expect(getSystemPrompt('v1')).toContain('1〜3 個 N1, N2, N3 文法點');
    expect(getSystemPrompt('v2')).toContain('最多 4 個高價值詞');
  });
});

describe('Japanese Analysis Contract v0.1 — SYSTEM_PROMPT_V2 regressions', () => {
  const v2 = getSystemPrompt('v2');

  test('does not ask the model to generate 重音 / pitch accent', () => {
    // The old contract required "讀音、重音、動詞分類" per verb entry and printed
    // 重音：N lines in the format example. Both must be gone.
    expect(v2).not.toMatch(/讀音、重音/);
    expect(v2).not.toMatch(/^\s*[-*]?\s*重音[：:]/m);
    expect(v2).toMatch(/不要輸出重音／音調（pitch accent）數字/);
    expect(v2).toContain('不可由模型猜測');
  });

  test('allows zero grammar points and forbids quota-filling', () => {
    expect(v2).toContain('0〜5 個真正的文法點');
    expect(v2).toContain('**0 個也是有效的**');
    expect(v2).toContain('就輸出 0 個文法點');
    expect(v2).not.toContain('1〜5 個 N1, N2, N3 文法點');
    expect(v2).toMatch(/不要把搭配、一般助詞用法或詞組硬湊進來/);
  });

  test('does not invent JLPT labels and defaults to omitting them', () => {
    expect(v2).toContain('不要標注或發明 JLPT 等級（N1〜N5）');
    expect(v2).toContain('預設一律省略');
    // No "文法點 + JLPT 等級" requirement, and the example grammar heading
    // carries no （N3） tag any more.
    expect(v2).not.toContain('文法點 + JLPT 等級');
    expect(v2).not.toMatch(/#### <文法>[^\n]*（N[1-5]）/);
  });

  test('separates Grammar from Collocation as distinct categories', () => {
    expect(v2).toContain('### 搭配分析');
    expect(v2).toContain('四個語言範疇必須分開處理');
    expect(v2).toContain('沖縄に最接近する」通常是搭配（Collocation），不是 N2 文法');
    expect(v2).toContain('前線を刺激する」通常是搭配（Collocation）');
    expect(v2).toContain('連用中止');
  });

  test('explicitly supports Register / Headline analysis', () => {
    expect(v2).toContain('### 語體／新聞表現');
    expect(v2).toContain('関東も週末警戒');
    expect(v2).toMatch(/標題句尾的「〜か」應解釋為標題式的疑問／不確定與省略/);
    expect(v2).toContain('不可與「かもしれない」或「かな」混為一談');
  });

  test('preserves {漢字|かんじ} furigana compatibility for the existing renderer', () => {
    expect(v2).toContain('{漢字|かんじ}');
    expect(v2).toContain('維持與現有渲染器的相容性');
  });

  test('instructs contextual date / counter / number readings', () => {
    expect(v2).toContain('日期、數量詞、數字必須使用該語境下的實際讀音');
    expect(v2).toContain('3{日|みっか}{以降|いこう}');
    expect(v2).toContain('不是 3{日|にち}以降{いこう}');
    expect(v2).toContain('ruby 的 base 必須剛好涵蓋對應的漢字範圍');
  });

  test('keeps V2 learning features and the deterministic-conjugation contract', () => {
    for (const feature of [
      '原句中的意思', '核心意思', '常見搭配／句型框架', '語感／語域',
      '自然例句', '造句模板', '回想題', '易混淆比較',
    ]) {
      expect(v2).toContain(feature);
    }
    expect(v2).toContain('動詞活用形由系統的規則引擎自動產生，請勿輸出活用形');
    expect(v2).toContain('只需提供辭書形與動詞分類');
  });

  test('emits the desired V2 top-level section set the renderer can consume', () => {
    for (const heading of [
      '### 原句', '### 漢字提取', '### 單字分析',
      '### 文法分析', '### 搭配分析', '### 語體／新聞表現',
    ]) {
      expect(v2).toContain(heading);
    }
    // Parser-critical entry prefixes unchanged.
    expect(v2).toContain('#### <單字>');
    expect(v2).toContain('#### <文法>');
  });
});

describe('Japanese Analysis Contract v0.1 — language-QA cleanup regressions', () => {
  const v2 = getSystemPrompt('v2');

  test('basic case particles are not promoted to Grammar', () => {
    expect(v2).toContain('基本格助詞不得升格為文法點');
    expect(v2).toContain('不要僅因為出現「に／を／が／で／へ」等基本格助詞');
    expect(v2).toContain('非基本用法、對比用法、結構上關鍵、容易被誤解，或本身具有明確的教學價值');
    expect(v2).toContain('「沖縄に最接近する」的「に」應留在搭配（Collocation）');
    expect(v2).toContain('文法數量維持 0 或 1 即可');
  });

  test('連用中止 is explained as 連用形 connection, not mere て deletion', () => {
    expect(v2).toContain('不要把連用中止講成「省略了て」');
    expect(v2).toContain('動詞直接以「連用形」接續後續子句');
    expect(v2).toContain('可用「〜て／〜て、」改寫');
    expect(v2).toContain('在構詞上並非只是刪掉「て」');
    expect(v2).toContain('刺激する → 連用形「刺激し」→ 直接接續後續子句');
  });

  test('ruby-format self-check rule is present alongside the contextual-reading rule', () => {
    expect(v2).toContain('ruby 格式自我檢查');
    expect(v2).toContain('嚴格符合 {漢字|かな} 格式');
    expect(v2).toContain('不可出現殘缺形式，例如「漢字|かな}」「{漢字かな}」');
    // contextual-reading rule still there
    expect(v2).toContain('讀音必須依上下文決定，不可套用字典預設讀音');
  });

  test('translation must preserve semantic roles and causal direction', () => {
    expect(v2).toContain('語意角色忠實');
    expect(v2).toContain('保留原文的語意角色與因果方向（施事／受影響對象／因果關係）');
    expect(v2).toContain('不可為了讓中文更順而反轉關係');
    expect(v2).toContain('「秋雨前線を刺激し」是「刺激／活化秋雨鋒面」，不是「受秋雨鋒面影響」');
  });

  test('headline compression is classified under Register, not duplicated under Grammar', () => {
    expect(v2).toContain('標題式壓縮（如「台風24号発生」「関東も週末警戒」）主要在「### 語體／新聞表現」中解釋');
    expect(v2).toContain('否則不要在「### 文法分析」重複同一現象');
  });

  test('Grammar / Collocation / Register analysis is grounded in the target text only', () => {
    expect(v2).toContain('落地（grounding）原則');
    expect(v2).toContain('只能描述實際出現在【分析対象】中的形式');
    expect(v2).toContain('不要把目標文句中不存在的文法形式、句尾表現、助詞、搭配或語體特徵，僅作為補充知識另外引入或分析');
    expect(v2).toContain('若【分析対象】中沒有出現「という」，就不要建立一則獨立的語體／文法項目去解釋「という」');
    expect(v2).toContain('補充比較只允許出現在既有條目內，且必須直接澄清一個確實存在於原句的形式');
  });
});

describe('Japanese Reader v0.2 Phase 2A — authoritative reading-contract block in SYSTEM_PROMPT_V2', () => {
  const v2 = getSystemPrompt('v2');

  test('requires a final machine-readable reading-contract JSON block', () => {
    expect(v2).toContain('讀音契約');
    expect(v2).toContain('必須是整個回應的最後內容');
    expect(v2).toContain('語言標籤為 json 的 fenced code block');
    expect(v2).toContain('```json'); // the worked example block
  });

  test('requires reading_contract_version to be integer 1', () => {
    expect(v2).toContain('"reading_contract_version": 1');
    expect(v2).toContain('reading_contract_version 必須是整數 1');
  });

  test('requires source_text to reproduce 【分析対象】 exactly, with no normalization', () => {
    expect(v2).toContain('source_text 必須逐字重現【分析対象】');
    expect(v2).toContain('保留所有 Unicode 字元、ASCII 空格、全形空格（U+3000）、標點、數字、符號、換行');
    expect(v2).toContain('不得修剪、正規化、轉換全形／半形、改寫或重複');
  });

  test('requires token.text concatenation to equal source_text exactly', () => {
    expect(v2).toContain('把每個 token.text 依序連接起來，必須完全等於 source_text');
    expect(v2).toContain('不可略過空白或標點');
    expect(v2).toContain('不可插入 source_text 沒有的文字');
    expect(v2).toContain('不可重複表面文字');
  });

  test('requires contextual calendar-date readings including 1日→ついたち and 3日→みっか', () => {
    expect(v2).toContain('1日→ついたち');
    expect(v2).toContain('3日→みっか');
    expect(v2).toContain('24日→にじゅうよっか');
    expect(v2).toContain('例如「3日以降」的 tokens 為：{"text":"3","reading":null}、{"text":"日","reading":"みっか"}、{"text":"以降","reading":"いこう"}');
  });

  test('excludes romanization, pitch accent and JLPT from the reading-contract block', () => {
    expect(v2).toContain('不得放羅馬拼音、重音（pitch accent）、JLPT 等級、翻譯或語意說明');
  });

  test('forbids span-mismatched readings (関東も週末 → かんとう is called out as wrong)', () => {
    expect(v2).toContain('token 邊界忠實：reading 必須正好對應該 token.text 的範圍');
    expect(v2).toContain('{"text":"関東も週末","reading":"かんとう"}');
  });

  test('mandates output ordering with the reading contract as the final block', () => {
    expect(v2).toContain('## 輸出順序');
    expect(v2).toContain('讀音契約之後不得再有任何內容');
    const order = [
      '### 原句', '### 漢字提取', '### 單字分析',
      '### 文法分析', '### 搭配分析', '### 語體／新聞表現',
    ];
    let cursor = -1;
    for (const heading of order) {
      const at = v2.indexOf(heading, cursor + 1);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  test('keeps inline {漢字|かな} ruby and does not remove it', () => {
    expect(v2).toContain('本階段人類可讀 Markdown 仍須照常使用 {漢字|かな}');
    expect(v2).toContain('不要移除既有的行內 ruby');
  });

  test('the prompt’s own worked example is itself a valid reading contract', () => {
    // Cross-check: the example block at the end of SYSTEM_PROMPT_V2 must parse
    // clean through the Phase 2A parser (final json fence, version 1,
    // concatenation === source_text).
    const parsed = parseReadingContract(v2);
    expect(parsed.ok).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.contract.version).toBe(1);
    expect(parsed.contract.tokens.map((t) => t.text).join('')).toBe(parsed.contract.sourceText);
    // the example sentence is the same one the human-readable ### 原句 block uses
    expect(parsed.contract.sourceText).toContain('同技術は特に労働力不足');
    expect(parsed.contract.sourceText.endsWith('後押しするという。')).toBe(true);
  });

  test('preserves the existing human-readable Markdown section contract', () => {
    for (const heading of [
      '### 原句', '### 漢字提取', '### 單字分析',
      '### 文法分析', '### 搭配分析', '### 語體／新聞表現',
    ]) {
      expect(v2).toContain(heading);
    }
    expect(v2).toContain('#### <單字>');
    expect(v2).toContain('#### <文法>');
    // v0.1 assertions untouched
    expect(v2).toContain('最多 4 個高價值詞');
    expect(v2).toContain('0〜5 個真正的文法點');
  });

  test('SYSTEM_PROMPT_V1 is not given a reading-contract block', () => {
    expect(getSystemPrompt('v1')).not.toContain('reading_contract_version');
    expect(getSystemPrompt('v1')).not.toContain('```json');
  });
});
