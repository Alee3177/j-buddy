---
module: functions/models/translationProfile
problem_type: terminology-governance
tags: [p8-d4, p8-d4-1, oriwish, translation-profile, japanese-ec, terminology]
---

# ORIWISH Japanese EC Translation Profile — v0.1

Profile id: `oriwish-ja-business-v1` · Profile version: `"3"`
Code: `japanese-alchemy-hosting/functions/src/models/translationProfile.ts`
Canonical source: [`sources/ORIWISH-OW01-Canonical-Product-Source-v0.1.md`](sources/ORIWISH-OW01-Canonical-Product-Source-v0.1.md)

## 1. Purpose / scope

This document governs the terminology glossary, protected terms, and brand
voice shipped in the `oriwish-ja-business-v1` server-side translation
profile (see [[p8d2-translation-profile]] for the framework it extends).
It is the reference for what is in the active runtime profile, what was
deliberately left out, and why — so future phases don't have to
re-derive provenance from the code alone.

**P8-D4.1 update:** P8-D4 shipped this profile with zero source-confirmed
terms (no ORIWISH material existed in the repo at the time). P8-D4.1
grounded it against real, owner-verified ORIWISH source material — see
Section 3. This document no longer states that no ORIWISH source material
exists; it now exists, and is recorded verbatim in the canonical source
doc linked above.

## 2. Product domain

ORIWISH's product domain is Japanese-style textile lifestyle accessories:
wallets / long wallets, textile-based accessories, Japanese-pattern
products, and gift-oriented consumer goods, described in Japanese-EC
product-page copy. Confirmed directly by OW_01 (a Japanese-pattern long
wallet, SKU `oriwish_01`). This supersedes the P8-D2 framework content,
which used industrial-automation terms (精密滑台 / 線性滑軌 / XYZ-300 /
ISO 9001) purely as architecture-validation test fixtures — those were
never real ORIWISH facts and remain removed from the production profile
entirely (kept nowhere, not even as test-only fixtures).

## 3. Source policy

P8-D4 searched this repository for ORIWISH source material and found
none. P8-D4.1 was supplied real, owner-verified source material directly
by the project owner:

- **OW_01** (SKU `oriwish_01`): a canonical product identity string,
  product description, confirmed material/dimension/weight/color-count
  facts, and three product cautions.
- **Owner-verified bilingual EC copy**: 18 approved Chinese→Japanese
  sentence/phrase pairs, some drawn from OW_01's own copy and some general
  ORIWISH brand-voice reference sentences.

Both are transcribed verbatim, with no paraphrasing, in
[`sources/ORIWISH-OW01-Canonical-Product-Source-v0.1.md`](sources/ORIWISH-OW01-Canonical-Product-Source-v0.1.md).
That document is now the SOURCE-CONFIRMED evidence base for this profile.

**`PRODUCT-NR-001_夜薔薇網紗長錢包_黑` remains ungrounded.** Its historical
existence is acknowledged, but no canonical product text for it is
available — see Section 10.

## 4. Provenance classes

- **A — SOURCE-CONFIRMED**: directly evidenced by OW_01 or the
  owner-verified bilingual copy (Section 3). *(19 of 29 active glossary
  groups.)*
- **B — GENERIC-EC**: generic but standard Japanese EC/textile
  terminology, directly applicable to the product domain, but not
  directly evidenced by the current source set. *(10 of 29 active
  glossary groups; also the current classification of the `ORIWISH`
  protected term's *general use as a brand name*, though the string
  itself is obviously brand-confirmed.)*
- **C — UNCERTAIN / HUMAN REVIEW REQUIRED**: ambiguous translation,
  multiple reasonable Japanese equivalents, or contradictory register
  evidence. *(kept out of the runtime profile — see Section 9.)*

Promotion to Class A required a direct match against the canonical source
document — either an exact/near-exact bilingual sentence/phrase pair, or
(for pure self-identity terms, e.g. 質感/収納) the term's literal
appearance in OW_01's own Chinese text, since no translation judgment call
is being made for a self-map. Terms that only *implied* a mapping, or
where the source showed a **different, more evocative** rendering than
this project's original v0.1 guess, were deliberately NOT promoted (see
per-term notes in Section 5) — promotion required confirmation, not mere
plausibility.

## 5. Active glossary (29 groups, 33 source aliases)

### 5a. SOURCE-CONFIRMED (Class A) — 19 groups

| Source term(s) | Japanese canonical | Category | Evidence |
|---|---|---|---|
| 長夾 / 長錢包 / 長財布 | 長財布 | product-type | OW_01 identity/description + bilingual pairs #1, #8 (長錢包 alias itself is not separately evidenced but is harmless — same confirmed target) |
| 和風圖案 / 和柄 | 和柄 | textile-pattern | OW_01 identity + bilingual pairs #1, #3 |
| 櫻花圖案 / 桜柄 | 桜柄 | textile-pattern | OW_01 description ("華麗的櫻花圖案") + bilingual pair #6 |
| 金襴織 | 金襴織 | textile-pattern (preserve-as-is) | OW_01 description + material list + bilingual pair #4 |
| 西陣織 | 西陣織 | textile-pattern (preserve-as-is) | Bilingual pair #2 ONLY — **not** in OW_01's own material list (金襴織錦布料、布料、金屬配件). Never treat this as confirming OW_01 itself is made of 西陣織 (Section 8). |
| 高雅 / 上品 | 上品 | characteristics | OW_01 identity/description + bilingual pairs #3, #5 |
| 華麗 | 華やか | characteristics | OW_01 description + bilingual pair #4 |
| 質感 | 質感 | characteristics | OW_01 description ("布料質感"); self-map, no translation judgment call |
| 收納 | 収納 | gift-lifestyle | OW_01 description ("收納於包包中") + bilingual pair #9 (JA side); self-map |
| 包包 | バッグ | gift-lifestyle | OW_01 description + bilingual pair #9 (包/包包 near-variant) |
| 禮物 | 贈り物 | gift-lifestyle | OW_01 description + bilingual pair #12 |
| 外盒 | 外箱 | ec-copy | Bilingual pair #13 |
| 顏色 | カラー | ec-copy | OW_01 caution text + bilingual pair #16 (extracted from confirmed compound 顏色款式→カラーバリエーション) |
| 顏色款式 | カラーバリエーション | ec-copy | Bilingual pair #16 (exact) |
| 色調 / 色合 | 色合い | characteristics | Bilingual pair #7 confirms 色調→色合い; 色合 (this project's original guess) kept only as an unconfirmed-but-harmless synonym alias |
| 尺寸 | サイズ | ec-copy | Bilingual pair #8, decomposed (長夾→長財布 independently confirmed elsewhere, leaving 尺寸→サイズ as the necessary remainder) |
| 布料 | 布地 | textile-pattern | Bilingual pair #18 (exact) — **corrects** this project's original v0.1 guess of 生地 |
| 購買前請確認 | ご購入前にご確認ください | ec-copy | Bilingual pair #17 (exact) |
| 共10色可選 | 全10色から選べる | gift-lifestyle | Bilingual pair #14 (exact). **SKU-specific literal, not a general "共N色" pattern** — see the note in Section 5c and in the code comment above this entry. |

### 5b. GENERIC-EC (Class B) — 10 groups

| Source term(s) | Japanese canonical | Category | Note |
|---|---|---|---|
| 收納包 | 収納ポーチ | product-type | "收納包" as a noun never appears in the source (only "收納" + "包包" separately) |
| 櫻花 / 桜 | 桜 | textile-pattern | Bare form appears only as a product-name tag; only the compound 櫻花圖案→桜柄 has direct bilingual confirmation |
| 輕量 / 軽量 | 軽量 | characteristics | Appears only as a product-name tag with no accompanying Japanese; the source's actual sentences for this concept (輕巧/輕鬆) were rendered evocatively (軽やかさ/持ち運びしやすい), not literally — kept safe/generic rather than promoted |
| 禮品 | ギフト | gift-lifestyle | ギフト as a target is contextually supported (bilingual pair #13), but the source word "禮品" itself is never used — OW_01 uses 禮物 |
| 商品說明 | 商品説明 | ec-copy | Not used verbatim in the source; standard EC label |
| 商品特色 | 商品の特徴 | ec-copy | Not used verbatim in the source; standard EC label |
| 商品尺寸 | 商品サイズ | ec-copy | Not used verbatim; source uses bare 尺寸 (now separately SOURCE-CONFIRMED — see 5a) |
| 素材 | 素材 | ec-copy | Not used verbatim; OW_01 uses 材質-adjacent wording (金襴織錦布料、布料、金屬配件), never the word 素材 itself |
| 方便攜帶 | 持ち運びしやすい | gift-lifestyle | Target concept/word confirmed via bilingual pair #11's context, but the exact 4-character source phrase never appears verbatim |
| 日常使用 | 日常使い | gift-lifestyle | Source term appears verbatim in OW_01 description, but the one sentence using it (bilingual pair #10) was translated as a fully restyled phrase (毎日に寄り添う軽やかさ), not with 日常使い — kept as a safe literal fallback, not promoted |

### 5c. Deterministic rules (unchanged from P8-D2/P8-D4)

Exact lexical matching, case-sensitive where applicable, longest-match-
first ordering in the rendered prompt, no fuzzy/semantic substitution, one
canonical target per source phrase, many aliases -> one target,
conflicting entries fail closed at profile-load time.

**Deliberately excluded from the static glossary as a general pattern:**
variable-count phrases such as 共N色/全N色. An exact-lexical entry can
only ever encode one literal N. The one entry that IS active
(共10色可選 → 全10色から選べる) is a **SKU-specific literal convenience
entry** justified because it matches OW_01's own confirmed color count
exactly (共10色) — it is not a stand-in for "any color count." A different
SKU's color count simply won't match this entry and falls through to
ordinary translation, still covered by the profile-independent
`COMMON_TRANSLATION_RULES` numeric-preservation rule ("日期、單位、價格、
百分比等數值資訊必須原樣保留"). Full caution/disclaimer sentences (screen/
lighting color variance, fabric cut-position pattern variance) are handled
the same way — as ordinary translated prose under the factual-preservation
rule, not as literal glossary entries — since they are whole clauses, not
terms.

## 6. Protected terms

`["ORIWISH"]`

`oriwish_01` is an internal SKU code, not a customer-facing identifier —
consistent with Section F's original guidance not to auto-promote internal
filenames/codes to protected terms. No other genuine SKU values, product
codes, approved series names, or trademarked names were found in the
current source set to protect.

Still audited and explicitly rejected (unchanged from P8-D4):
- `XYZ-300`, `ISO 9001` — P8-D2 test-fixture identifiers, never real
  ORIWISH facts. Removed entirely.

## 7. Brand voice v0.1

> 典雅、溫和、貼近日常生活的日系電商語氣，適用於和風布飾、長夾等禮品類商品頁面文案。
> 用詞含蓄、不誇張，避免「絕對」「最高級」「唯一」等宣傳性極端用語，也不得使用其他行銷式浮誇語言；
> 可在不影響事實內容的前提下潤飾文字，使其更自然通順、更貼近日本電商讀者的閱讀習慣；
> 絕對不可無中生有地新增原文沒有提及的材質、產地、認證、手工製作、獎項、耐用性或功效等宣稱。

Unchanged from P8-D4. Characterized as: elegant, refined, warm, natural
Japanese EC copy; understated rather than exaggerated; suitable for
Japanese-style textile accessories and gifting; clear product information;
not overly poetic; not cheap/aggressive sales language. The
owner-verified bilingual pairs in Section 3 (e.g. 西陣織が織りなす、和の美
しさ。/ やさしく咲く桜柄) confirm this register is accurate to real ORIWISH
copy — they are used only to calibrate tone, never baked in as forced
literal output.

## 8. Explicit prohibited assumptions

The brand voice must never invent, and no glossary/protected-term entry
implies:
- materials not stated by the source text (OW_01's confirmed material is
  ONLY 金襴織錦布料、布料、金屬配件 — never assume 西陣織 fabric for OW_01
  itself; that term's evidence is the separate bilingual copy set, not
  OW_01's material list)
- dimensions, weight, or color count not stated by the source text (OW_01's
  confirmed values: 約19×10×1.8cm, 約300g, 共10色 — never generalize these
  to any other SKU)
- origin claims (e.g. "京都西陣で製造") beyond what the source states,
  even when 西陣織/金襴織 appear
- manufacturing claims, artisan/handcrafted claims
- Nishijin certification or origin certification of any kind
- luxury claims, awards, authenticity guarantees
- durability or performance claims
- quality certifications

Preserving 金襴織 or 西陣織 in a translation is a terminology-consistency
action only; it is not, and must never be read as, a factual assertion
about how any specific ORIWISH product is actually made.

## 9. Uncertain / excluded terms (Class C — kept out of the runtime profile)

| Term | Why excluded |
|---|---|
| 光澤 | **New in P8-D4.1.** Contradictory register evidence: bilingual pair #5 renders "高雅光澤" as "上品なきらめき" (evocative), not the more literal 光沢 (this project's original v0.1 guess). No other source instance resolves which register ORIWISH actually prefers for bare 光澤 — removed from the active profile rather than guessed at. Needs a human decision once more source sentences using this word are available. |
| 小包 | Ambiguous — could mean a small wallet/pouch or a shipping parcel depending on context; no single safe canonical target |
| 配件 | Ambiguous — could render as アクセサリー, 小物, or 付属品 depending on context |
| 錦布 | Multiple reasonable Japanese equivalents (錦, 錦織, 唐錦); risk of implying unconfirmed Nishijin-specific provenance if rendered too specifically |
| 網紗 | Multiple reasonable renderings (メッシュ, レース, チュール); appears only in the still-ungrounded `PRODUCT-NR-001` filename — see Section 10 |
| 紋樣 | Overlaps with already-covered 圖案/柄 mappings (和柄, 桜柄); standalone rendering (紋様 vs 柄) is too context-dependent to fix as one canonical target |
| 共N色 / 全N色 as a general pattern | Exact-lexical glossary cannot safely encode a variable digit; see Section 5c. (The one SKU-specific literal, 共10色可選, IS active — see Section 5a.) |
| 拍攝光線, 裁切位置, 手工測量 | Fragments of caution/disclaimer clauses; too context-dependent as standalone terms — handled as ordinary prose under factual-preservation, not glossary entries |
| 夜薔薇, 網紗 (from `PRODUCT-NR-001_夜薔薇網紗長錢包_黑`) | No canonical product text exists to confirm meaning or canonical rendering — see Section 10 |

These must stay outside the runtime profile until a human confirms one
canonical rendering (or real source material resolves the ambiguity).

## 10. PRODUCT-NR-001 findings

`PRODUCT-NR-001_夜薔薇網紗長錢包_黑` remains ungrounded after P8-D4.1. The
P8-D4.1 source grounding supplied OW_01 and general bilingual copy, but
no canonical product text, specification, or bilingual pairing for
PRODUCT-NR-001 itself. Its historical existence as a filename/project
reference is acknowledged (per the P8-D4.1 task's own framing), but per
Section C's explicit instruction, no specs or material composition were
inferred from the filename, and 夜薔薇 / 網紗 remain excluded (Section 9)
rather than guessed at. No PRODUCT-NR-001-specific benchmark was added.

## 11. Version policy

- `translationProfileId`: **`oriwish-ja-business-v1`** — still unchanged.
  Renaming would orphan any already-persisted P8-D3
  `structured_json.translation.translationProfileId` reference for no
  benefit; `version` already carries "content changed."
- `translationProfileVersion` history:
  - `"1"` — P8-D2 industrial-automation architecture-validation fixture.
  - `"2"` — P8-D4 wholesale replacement with lifestyle/EC content (all
    GENERIC-EC, no source-confirmed terms).
  - `"3"` — **P8-D4.1.** Grounding against real source material was not,
    by itself, reason to bump the version (Section I's own instruction:
    documentation/provenance improvements alone don't require a bump).
    This bump is justified because grounding surfaced two changes that
    DO materially change runtime translation output:
    1. **布料's target corrected** from 生地 to 布地 (bilingual pair #18
       showed the owner-verified rendering differs from this project's
       original guess) — a BREAKING change per Section 11's own
       "canonical target changes" rule.
    2. **光澤 removed** from the active glossary (contradictory register
       evidence found — Section 9) — a BREAKING change per Section 11's
       own "an existing term is removed" rule.
    Everything else in this pass (new SOURCE-CONFIRMED entries such as
    外盒→外箱, 顏色款式→カラーバリエーション, 尺寸→サイズ,
    共10色可選→全10色から選べる, and the 色調 alias added to the existing
    色合い target) is additive/PATCH-or-MINOR on its own and would not
    have required a bump alone — but one breaking change in a batch is
    enough to require bumping the whole batch once, not per-entry.

PATCH/MINOR/BREAKING definitions are unchanged from P8-D4:
- **PATCH**: typo fix; adding a new non-conflicting glossary alias to an
  existing target.
- **MINOR**: new terminology group (new target) added; new protected
  term added; brand-voice wording refined without changing what it
  forbids/allows.
- **BREAKING**: an existing source term's canonical Japanese target
  changes; an existing term is removed; a protected term is removed or
  starts being translated; brand-voice permissions change.

No external profile registry is implemented — the profile remains a
static, server-authored, immutable in-code configuration (per [[p8d1-terminology-brand-style-architecture-audit]]).

## 12. Benchmark cases

Benchmarks A-D are **REAL / SOURCE-DERIVED** (built directly from OW_01 /
the owner-verified bilingual copy). Benchmark E is **GENERIC EC EXAMPLE**.
None require one exact whole-sentence translation for PASS — they
validate terminology consistency, factual preservation, and register (per
Section L's instruction).

**A — Product identity (REAL / SOURCE-DERIVED, OW_01 identity string):**
`ORIWISH 和風圖案長夾 櫻花 金襴織 高雅 輕量 共10色` → expect ORIWISH
preserved; 和柄/長財布/桜柄-family, 金襴織, 上品 terminology consistent;
Japanese EC register; no new facts.

**B — Size and weight (REAL / SOURCE-DERIVED, OW_01 confirmed
attributes):** `本體：約19 × 10 × 1.8cm` / `重量：約300g` → expect every
number and unit preserved exactly (19, 10, 1.8, cm, 300, g), no invented
specs, no rounding.

**C — Gift / EC copy (REAL / SOURCE-DERIVED, bilingual pairs #12-14):**
`也推薦作為禮物。` / `附外盒，適合送給重要的人。` / `共10色可選。` → expect
gift register (贈り物/外箱/ギフト-adjacent), the confirmed 10-color fact
preserved, no added promotional claims beyond what these three sentences
state.

**D — Product caution (REAL / SOURCE-DERIVED, OW_01 caution #2 + bilingual
pair #18):** `因布料裁切位置不同，每件商品的圖案分布可能略有不同。` →
expect the disclaimer's full meaning preserved (fabric cut-position →
pattern-placement variance), Japanese EC caution register, no omission.

**E — Lifestyle description (GENERIC EC EXAMPLE):** a product description
combining 高雅, 華麗, 金襴織, and pattern language → expect natural
Japanese product copy, consistent terminology, elegant but restrained
wording (no invented superlatives).

Automated in `test/models/translationProfileP8D41.test.ts` (terminology +
factual-preservation + register assertions) and the sample-sentence
assertions in `test/v1/multilingualPreStage.test.ts`,
`test/v1/explainCallable.test.ts`, `test/v1/explainStreamCallableHandler.test.ts`.

## 13. Review / update procedure

1. Before adding a term, search for real ORIWISH source material first,
   and check it against the canonical source doc
   (`sources/ORIWISH-OW01-Canonical-Product-Source-v0.1.md`) before
   marking anything Class A. If new source material arrives, add it to
   that doc (or a new dated one) rather than only updating this file.
2. Run `validateTranslationProfile` (via the existing test suite) after
   any change — it fails closed on duplicate/conflicting source terms,
   oversized entries, forbidden characters, or an oversized serialized
   profile.
3. Bump `version` per Section 11's PATCH/MINOR/BREAKING rules; never
   silently reuse an existing version string for changed content, and
   never bump merely for documentation/provenance-only changes.
4. Re-run `npm test`, `npm run lint`, `npm run build` in
   `japanese-alchemy-hosting/functions` before considering the change
   done.
5. Update this document's glossary tables and provenance notes in the
   same change — this file, the canonical source doc, and the code must
   never drift apart.
