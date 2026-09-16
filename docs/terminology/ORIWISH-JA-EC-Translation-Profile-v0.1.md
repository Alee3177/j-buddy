---
module: functions/models/translationProfile
problem_type: terminology-governance
tags: [p8-d4, oriwish, translation-profile, japanese-ec, terminology]
---

# ORIWISH Japanese EC Translation Profile — v0.1

Profile id: `oriwish-ja-business-v1` · Profile version: `"2"`
Code: `japanese-alchemy-hosting/functions/src/models/translationProfile.ts`

## 1. Purpose / scope

This document governs the terminology glossary, protected terms, and brand
voice shipped in the `oriwish-ja-business-v1` server-side translation
profile (see [[p8d2-translation-profile]] for the framework it extends).
It is the reference for what is in the active runtime profile, what was
deliberately left out, and why — so future phases don't have to
re-derive provenance from the code alone.

## 2. Product domain

ORIWISH's product domain, as specified for this phase, is Japanese-style
textile lifestyle accessories: wallets / long wallets, textile-based
accessories, Japanese-pattern products, and gift-oriented consumer goods,
described in Japanese-EC product-page copy. This explicitly supersedes the
P8-D2 framework content, which used industrial-automation terms
(精密滑台 / 線性滑軌 / XYZ-300 / ISO 9001) purely as architecture-validation
test fixtures — those were never real ORIWISH facts and have been removed
from the production profile entirely (kept nowhere, not even as test-only
fixtures, since no test in this codebase needs them post-P8-D4).

## 3. Source policy

Before writing this profile, the repository was searched for actual
ORIWISH source material: product copy, `oriwish_01`, `PRODUCT-NR-001`,
bilingual copy, approved prompts, reviews, SKU/product records, and
product imaging directories, plus the literal terms listed in the P8-D4
task spec (夜薔薇, 網紗, 長錢包, 長夾, 長財布, 和風, 和柄, 櫻花, 桜, 金襴織,
西陣織, 錦布, 輕量, 軽量, 禮品, ギフト, 贈り物, 外盒, 外箱, 全10色, 商品圖,
商品資料, 商品文案).

**Result: no ORIWISH product/content source files were found in this
repository.** The only incidental hits were unrelated (a 桜 example
sentence in an unrelated grammar-prompt fixture, and 輕量 in an unrelated
planning doc about "lightweight reading aid"); neither is ORIWISH material.
No `PRODUCT-NR-001` file, image, or bilingual copy of any kind exists
locally.

Because of this, **no term in this profile is classified
SOURCE-CONFIRMED (Class A)** — that class requires the term be explicitly
found in ORIWISH project/product material, and none was available to
verify against. Every active entry is classified GENERIC-EC / GENERIC
TEXTILE (Class B): standard, well-established Japanese e-commerce and
textile vocabulary that is directly and safely applicable to the stated
product domain, independent of ORIWISH-specific confirmation.

**If real ORIWISH source material becomes available** (product copy,
SKU records, approved bilingual pages), the correct action is to re-audit
this table entry-by-entry against that material and upgrade confirmed
entries to Class A — not to assume the current Class B judgment calls are
already correct for ORIWISH's actual usage.

## 4. Provenance classes

- **A — SOURCE-CONFIRMED**: explicitly found in ORIWISH project/product
  material. *(none in this profile; see Section 3.)*
- **B — GENERIC-EC**: generic but standard Japanese EC/textile
  terminology, directly applicable to the product domain. *(all 26 active
  glossary groups + the ORIWISH protected term.)*
- **C — UNCERTAIN / HUMAN REVIEW REQUIRED**: ambiguous translation,
  multiple reasonable Japanese equivalents, or insufficiently supported
  brand-specific wording. *(kept out of the runtime profile — see Section
  9.)*

## 5. Active glossary (26 groups, 33 source aliases)

| Source term(s) | Japanese canonical | Category | Provenance | Note |
|---|---|---|---|---|
| 長夾 / 長錢包 / 長財布 | 長財布 | product-type | GENERIC-EC | Standard J term for a long/bifold-style wallet |
| 收納包 | 収納ポーチ | product-type | GENERIC-EC | Standard pouch/organizer term |
| 和風圖案 / 和柄 | 和柄 | textile-pattern | GENERIC-EC | Standard term for "Japanese-style pattern" |
| 櫻花圖案 / 桜柄 | 桜柄 | textile-pattern | GENERIC-EC | Must match before 櫻花 alone (Section E) |
| 櫻花 / 桜 | 桜 | textile-pattern | GENERIC-EC | Bare flower/motif term |
| 金襴織 | 金襴織 | textile-pattern | GENERIC-EC (preserve-as-is) | Real Japanese weave-name term; preserving it if the source uses it is NOT a claim the product is made this way (Section H) |
| 西陣織 | 西陣織 | textile-pattern | GENERIC-EC (preserve-as-is) | Same caveat — carries origin/prestige connotation; never infer manufacturer/certification from this entry alone |
| 布料 | 生地 | textile-pattern | GENERIC-EC | Standard fabric term |
| 高雅 / 上品 | 上品 | characteristics | GENERIC-EC | Elegant/refined register |
| 輕量 / 軽量 | 軽量 | characteristics | GENERIC-EC | Direct kanji correspondence, common in EC listings |
| 華麗 | 華やか | characteristics | GENERIC-EC | |
| 光澤 | 光沢 | characteristics | GENERIC-EC | |
| 質感 | 質感 | characteristics | GENERIC-EC | Same kanji, self-map |
| 色合 | 色合い | characteristics | GENERIC-EC | |
| 商品說明 | 商品説明 | ec-copy | GENERIC-EC | |
| 商品特色 | 商品の特徴 | ec-copy | GENERIC-EC | |
| 商品尺寸 | 商品サイズ | ec-copy | GENERIC-EC | |
| 素材 | 素材 | ec-copy | GENERIC-EC | Self-map |
| 顏色 | カラー | ec-copy | GENERIC-EC | |
| 購買前請確認 | ご購入前にご確認ください | ec-copy | GENERIC-EC | Standard EC boilerplate lead-in |
| 禮物 | 贈り物 | gift-lifestyle | GENERIC-EC | |
| 禮品 | ギフト | gift-lifestyle | GENERIC-EC | |
| 包包 | バッグ | gift-lifestyle | GENERIC-EC | |
| 方便攜帶 | 持ち運びしやすい | gift-lifestyle | GENERIC-EC | |
| 日常使用 | 日常使い | gift-lifestyle | GENERIC-EC | |
| 收納 | 収納 | gift-lifestyle | GENERIC-EC | Self-map; also used in "收納於包包中"-style phrasing |

Deterministic rules preserved from P8-D2/P8-D1 (unchanged): exact lexical
matching, case-sensitive where applicable, longest-match-first ordering in
the rendered prompt, no fuzzy/semantic substitution, one canonical target
per source phrase, many aliases -> one target, conflicting entries fail
closed at profile-load time.

**Deliberately excluded from the static glossary:** variable-count phrases
such as 共10色/全10色 ("N colors"). An exact-lexical glossary entry can only
ever encode one literal N, and a fixed "全10色" entry would silently
mistranslate any other actual color count. Preserving the real digits is
already handled, profile-independent, by the shared
`COMMON_TRANSLATION_RULES` numeric-preservation rule ("日期、單位、價格、
百分比等數值資訊必須原樣保留"). Full caution/disclaimer sentences (screen/
lighting color variance, fabric cut-position pattern variance) are handled
the same way — as ordinary translated prose under the factual-preservation
rule, not as literal glossary entries — since they are whole clauses, not
terms.

## 6. Protected terms

`["ORIWISH"]`

Audited and explicitly rejected as protected terms:
- `XYZ-300`, `ISO 9001` — P8-D2 test-fixture identifiers, never real
  ORIWISH facts. Removed entirely; not even kept as test-only fixtures
  (no test needs them post-P8-D4).
- Internal filenames (e.g. `PRODUCT-NR-001_...`) are not customer-facing
  identifiers and must never be auto-promoted to protected terms.

No genuine SKU values, product codes, approved series names, or
trademarked names beyond `ORIWISH` itself were found locally to protect.

## 7. Brand voice v0.1

> 典雅、溫和、貼近日常生活的日系電商語氣，適用於和風布飾、長夾等禮品類商品頁面文案。
> 用詞含蓄、不誇張，避免「絕對」「最高級」「唯一」等宣傳性極端用語，也不得使用其他行銷式浮誇語言；
> 可在不影響事實內容的前提下潤飾文字，使其更自然通順、更貼近日本電商讀者的閱讀習慣；
> 絕對不可無中生有地新增原文沒有提及的材質、產地、認證、手工製作、獎項、耐用性或功效等宣稱。

Characterized (per Section G) as: elegant, refined, warm, natural Japanese
EC copy; understated rather than exaggerated; suitable for Japanese-style
textile accessories and gifting; clear product information; not overly
poetic; not cheap/aggressive sales language. Reference-tone phrases from
the task spec (e.g. 西陣織が織りなす、和の美しさ。/ 上品な和柄を、毎日の暮ら
しに。) were used only to calibrate this register — they are NOT baked
into the profile as literal output, and the model is never instructed to
force them into every translation.

`translationStyle = business` + this profile means polished Japanese
EC/product-page copy, not industrial B2B language — this is an explicit
correction from the P8-D2 sample, whose brand voice described "日本 B2B
工業產品溝通慣例" register instructions. Those instructions are gone.

## 8. Explicit prohibited assumptions

The brand voice must never invent, and no glossary/protected-term entry
implies:
- materials not stated by the source text
- dimensions, weight, or color count not stated by the source text
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
| 小包 | Ambiguous — could mean a small wallet/pouch or a shipping parcel depending on context; no single safe canonical target |
| 配件 | Ambiguous — could render as アクセサリー, 小物, or 付属品 depending on context |
| 錦布 | Multiple reasonable Japanese equivalents (錦, 錦織, 唐錦); risk of implying unconfirmed Nishijin-specific provenance if rendered too specifically |
| 網紗 | Multiple reasonable renderings (メッシュ, レース, チュール); appears only in the unverifiable `PRODUCT-NR-001` filename example, no source text available to disambiguate |
| 紋樣 | Overlaps with already-covered 圖案/柄 mappings (和柄, 桜柄); standalone rendering (紋様 vs 柄) is too context-dependent to fix as one canonical target |
| 共10色 / 全10色 (and any literal color-count phrase) | Exact-lexical glossary cannot safely encode a variable digit; see Section 5 |
| 拍攝光線, 裁切位置, 手工測量 | Fragments of caution/disclaimer clauses; too context-dependent as standalone terms — handled as ordinary prose under factual-preservation, not glossary entries |
| 夜薔薇, 網紗 (from `PRODUCT-NR-001_夜薔薇網紗長錢包_黑`) | No local text/product data exists to confirm meaning or canonical rendering — see Section 10 |

These must stay outside the runtime profile until a human confirms one
canonical rendering (or real source material resolves the ambiguity).

## 10. PRODUCT-NR-001 findings

`PRODUCT-NR-001_夜薔薇網紗長錢包_黑` was named in the task spec as a
candidate source. No file, image, product record, or any other material
matching this name (or `PRODUCT-NR-001`, `oriwish_01`) exists anywhere in
this repository. Only the filename itself is known — no underlying
product text or specifications were available to extract or verify.
Per Section M's instruction, no specifications were inferred from the
filename alone, and 夜薔薇 / 網紗 were kept out of the active profile
(Section 9) rather than guessed at. No PRODUCT-NR-001-specific benchmark
was added.

## 11. Version policy

- `translationProfileId`: **`oriwish-ja-business-v1`** — kept unchanged
  from P8-D2/P8-D3 rather than renamed to `oriwish-ja-business`. Reason:
  P8-D3 already persists `structured_json.translation.translationProfileId`
  for any saved analysis that used this id; renaming the id string would
  silently orphan that reference for no benefit, since the `id` field
  alone doesn't need to encode "content changed" — `version` already
  does that job.
- `translationProfileVersion`: bumped **`"1"` -> `"2"`**. Treated as a
  BREAKING change even though no individual glossary *target* for a
  still-present term changed meaning — the entire P8-D2 industrial
  fixture content (protected terms + glossary + brand voice) was removed
  wholesale and replaced, which is a stronger change than the MINOR
  category ("new terminology groups", "new protected terms") describes on
  its own. Any P8-D3-persisted record with `translationProfileVersion:
  "1"` reflects the OLD test-fixture content; `"2"` reflects this real
  v0.1 lifestyle/EC content.

Going forward:
- **PATCH**: typo fix; adding a new non-conflicting glossary alias to an
  existing target.
- **MINOR**: new terminology group (new target) added; new protected
  term added; brand-voice wording refined without changing what it
  forbids/allows.
- **BREAKING**: an existing source term's canonical Japanese target
  changes; an existing term is removed; a protected term is removed or
  starts being translated; brand-voice permissions change (e.g. allowing
  a previously-forbidden claim type).

No external profile registry is implemented — the profile remains a
static, server-authored, immutable in-code configuration (per [[p8d1-terminology-brand-style-architecture-audit]]).

## 12. Benchmark cases

All benchmarks below are **GENERIC EC EXAMPLE** register/terminology
checks, built from the domain concepts given in the task spec — none are
independently source-confirmed, per Section 3. They validate terminology
consistency, factual preservation, and register, not exact-sentence
matching (per Section L's instruction).

1. **Core product identity** — `ORIWISH 和風圖案長夾採用金襴織與西陣織的布料，
   展現高雅又輕量的日式質感。` → expect ORIWISH preserved; 和柄/長財布/桜/
   金襴織/西陣織/生地/上品/軽量 terminology consistent; Japanese EC register;
   no new facts. Automated in
   `test/models/translationProfileP8D4.test.ts` and the sample-sentence
   assertions in `test/v1/multilingualPreStage.test.ts`,
   `test/v1/explainCallable.test.ts`, `test/v1/explainStreamCallableHandler.test.ts`.
2. **Lifestyle description** — a product description combining 高雅,
   華麗, 金襴織, and pattern language → expect natural Japanese product
   copy, consistent terminology, elegant but restrained wording (no
   invented superlatives). Covered by the brand-voice content tests.
3. **Size/weight factual preservation** — any sentence with concrete
   dimensions/weight (e.g. "約19 × 10 × 1.8cm" / "約300g") → expect all
   numbers/units preserved exactly, no invented specs. Covered by the
   profile-independent `COMMON_TRANSLATION_RULES` numeric-preservation
   rule, asserted directly in `translationProfileP8D4.test.ts`.
4. **Gift / color selection** — "適合作為禮物，共有10種顏色可選" style
   content → expect gift-register (贈り物/ギフト), カラー terminology,
   digits preserved by the numeric rule (not a glossary literal), no
   added promotional claims.
5. **Product caution / disclaimer** — screen/lighting color-variance and
   fabric cut-position pattern-variance wording → expect standard
   Japanese EC caution register via ordinary factual-preserving
   translation (ご購入前にご確認ください glossary term covers the
   lead-in), no omission of disclaimer meaning, no literal-sentence
   requirement.

## 13. Review / update procedure

1. Before adding a term, search for real ORIWISH source material first
   (Section 3's search list is the starting point). Only mark a term
   Class A if you can point to the actual file/content.
2. Run `validateTranslationProfile` (via the existing test suite) after
   any change — it fails closed on duplicate/conflicting source terms,
   oversized entries, forbidden characters, or an oversized serialized
   profile.
3. Bump `version` per Section 11's PATCH/MINOR/BREAKING rules; never
   silently reuse an existing version string for changed content.
4. Re-run `npm test`, `npm run lint`, `npm run build` in
   `japanese-alchemy-hosting/functions` before considering the change
   done.
5. Update this document's glossary table and provenance notes in the
   same change — this file and the code must never drift apart.
