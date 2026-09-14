export type DetectedLanguage = "ja" | "zh" | "en" | "unknown";

const HIRAGANA = /[぀-ゟ]/g;
const KATAKANA = /[゠-ヿｦ-ﾝ]/g;
const HAN = /[一-鿿㐀-䶿豈-﫿]/g;
const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/g;
const LATIN = /[A-Za-z]/g;

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * Cheap, dependency-free script-based language-routing precheck (P8-B).
 *
 * Not a general-purpose language identifier — it only routes among the three
 * languages the pipeline supports (ja/zh/en), with an explicit "unknown"
 * bucket for everything else. It is a script-priority cascade rather than a
 * single "contains kana" signal:
 *   1. Kana present -> "ja" (kana is unique to Japanese among these scripts,
 *      and real Japanese sentences often carry only a small minority of kana
 *      against a kanji-heavy body, so any real kana is decisive).
 *   2. No kana, but Hangul present -> "unknown" (explicitly not one of the
 *      three supported languages, rather than being forced into zh/en).
 *   3. No kana, Han characters present -> "zh" (mixed Han + Latin text, e.g.
 *      a Chinese product title quoting a Latin brand name, is still Chinese
 *      source text; Latin dominance by character count does not flip this).
 *   4. No kana/Han, Latin present -> "en".
 *   5. Nothing classifiable (digits/punctuation/symbols/emoji only) ->
 *      "unknown".
 *
 * Known limitation (carried from the P8-A audit): Japanese written with zero
 * kana (rare — kanji-only) is indistinguishable from Chinese under this
 * heuristic and would route to "zh", triggering an unnecessary (but
 * harmless, since the translation target is Japanese) translation pass.
 */
export function detectLanguage(text: string): DetectedLanguage {
  const kana = count(text, HIRAGANA) + count(text, KATAKANA);
  if (kana > 0) return "ja";

  const hangul = count(text, HANGUL);
  if (hangul > 0) return "unknown";

  const han = count(text, HAN);
  if (han > 0) return "zh";

  const latin = count(text, LATIN);
  if (latin > 0) return "en";

  return "unknown";
}
