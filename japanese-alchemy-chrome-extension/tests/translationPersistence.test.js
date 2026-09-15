/**
 * P8-D3: TRANSLATION PROFILE PERSISTENCE & REPRODUCIBILITY
 *
 * Covers the three pieces added to sidepanel.js for reproducible/auditable
 * saves of translated (zh/en) analyses:
 *   - buildTranslationMetadataForSave(preStage) — builds the persisted
 *     `translation` block ONLY from the authoritative server preStage
 *     contract, never from displayed labels.
 *   - normalizePersistedTranslation(translation) — fail-closed validator for
 *     a persisted/cached `translation` block.
 *   - normalizeStructuredAnalysisResult(json) — the structured_json pipeline
 *     `translation` now rides through, exercised end-to-end here.
 */
import {
    buildTranslationMetadataForSave,
    normalizePersistedTranslation,
    normalizeStructuredAnalysisResult,
} from '../src/sidepanel/sidepanel.js';

describe('buildTranslationMetadataForSave', () => {
    test('zh + natural style, no profile: builds sourceLanguage/style/translatedJapanese only', () => {
        const preStage = {
            detectedLanguage: 'zh',
            translationStyle: 'natural',
            analysisContent: '台風が接近しています。',
        };
        expect(buildTranslationMetadataForSave(preStage)).toEqual({
            sourceLanguage: 'zh',
            translationStyle: 'natural',
            translatedJapanese: '台風が接近しています。',
        });
    });

    test('zh + business style with a profile: includes profile id/version verbatim', () => {
        const preStage = {
            detectedLanguage: 'zh',
            translationStyle: 'business',
            translationProfileId: 'oriwish-ja-business-v1',
            translationProfileVersion: '1',
            analysisContent: '弊社の製品をご案内申し上げます。',
        };
        expect(buildTranslationMetadataForSave(preStage)).toEqual({
            sourceLanguage: 'zh',
            translationStyle: 'business',
            translationProfileId: 'oriwish-ja-business-v1',
            translationProfileVersion: '1',
            translatedJapanese: '弊社の製品をご案内申し上げます。',
        });
    });

    test('en source: sourceLanguage is "en"', () => {
        const preStage = {
            detectedLanguage: 'en',
            translationStyle: 'news',
            analysisContent: '台風が接近している。',
        };
        expect(buildTranslationMetadataForSave(preStage).sourceLanguage).toBe('en');
    });

    test('translatedJapanese is preStage.analysisContent byte-for-byte, not re-derived', () => {
        const analysisContent = '  raw *server* content — not re-rendered\n';
        const preStage = { detectedLanguage: 'zh', translationStyle: 'natural', analysisContent };
        expect(buildTranslationMetadataForSave(preStage).translatedJapanese).toBe(analysisContent);
    });

    test('never invents/leaks profile fields absent from preStage', () => {
        const preStage = { detectedLanguage: 'zh', translationStyle: 'natural', analysisContent: 'x' };
        const result = buildTranslationMetadataForSave(preStage);
        expect(result).not.toHaveProperty('translationProfileId');
        expect(result).not.toHaveProperty('translationProfileVersion');
    });

    test('never carries glossary/protectedTerms/brandVoice/prompt content — only the five documented fields exist', () => {
        const preStage = {
            detectedLanguage: 'zh',
            translationStyle: 'business',
            translationProfileId: 'oriwish-ja-business-v1',
            translationProfileVersion: '1',
            analysisContent: 'x',
            // Even if a caller's preStage object somehow carried extra fields
            // (it never does in practice — see PreStageResult), the builder
            // must not copy anything beyond the five documented keys.
            terminologyGlossary: [{ source: 'a', target: 'b' }],
            protectedTerms: ['ORIWISH'],
            brandVoice: { description: 'formal' },
        };
        const result = buildTranslationMetadataForSave(preStage);
        expect(Object.keys(result).sort()).toEqual(
            ['sourceLanguage', 'translatedJapanese', 'translationProfileId', 'translationProfileVersion', 'translationStyle'].sort()
        );
    });
});

describe('normalizePersistedTranslation', () => {
    test('accepts a valid zh block with no profile', () => {
        const input = { sourceLanguage: 'zh', translationStyle: 'natural', translatedJapanese: 'x' };
        expect(normalizePersistedTranslation(input)).toEqual(input);
    });

    test('accepts a valid en block with a profile', () => {
        const input = {
            sourceLanguage: 'en',
            translationStyle: 'business',
            translationProfileId: 'oriwish-ja-business-v1',
            translationProfileVersion: '1',
            translatedJapanese: 'x',
        };
        expect(normalizePersistedTranslation(input)).toEqual(input);
    });

    test('rejects null/non-object/array input', () => {
        expect(normalizePersistedTranslation(null)).toBeNull();
        expect(normalizePersistedTranslation(undefined)).toBeNull();
        expect(normalizePersistedTranslation('x')).toBeNull();
        expect(normalizePersistedTranslation([])).toBeNull();
    });

    test('rejects an unsupported/missing sourceLanguage (e.g. "ja" must never be persisted)', () => {
        expect(normalizePersistedTranslation({
            sourceLanguage: 'ja', translationStyle: 'natural', translatedJapanese: 'x',
        })).toBeNull();
        expect(normalizePersistedTranslation({
            translationStyle: 'natural', translatedJapanese: 'x',
        })).toBeNull();
    });

    test('rejects empty/missing translationStyle or translatedJapanese', () => {
        expect(normalizePersistedTranslation({
            sourceLanguage: 'zh', translationStyle: '', translatedJapanese: 'x',
        })).toBeNull();
        expect(normalizePersistedTranslation({
            sourceLanguage: 'zh', translationStyle: 'natural', translatedJapanese: '',
        })).toBeNull();
    });

    test('drops the WHOLE block when only one of profileId/profileVersion is present (treated as corrupted)', () => {
        expect(normalizePersistedTranslation({
            sourceLanguage: 'zh', translationStyle: 'natural', translatedJapanese: 'x',
            translationProfileId: 'oriwish-ja-business-v1',
        })).toBeNull();
        expect(normalizePersistedTranslation({
            sourceLanguage: 'zh', translationStyle: 'natural', translatedJapanese: 'x',
            translationProfileVersion: '1',
        })).toBeNull();
    });

    test('never guesses/repairs — an unknown-shape profileId (non-string) is dropped fail-closed', () => {
        expect(normalizePersistedTranslation({
            sourceLanguage: 'zh', translationStyle: 'natural', translatedJapanese: 'x',
            translationProfileId: 123, translationProfileVersion: '1',
        })).toBeNull();
    });
});

describe('normalizeStructuredAnalysisResult — translation passthrough', () => {
    test('a valid translation block survives, cloned (not the same reference), for a zh save', () => {
        const translation = { sourceLanguage: 'zh', translationStyle: 'natural', translatedJapanese: '台風が接近しています。' };
        const result = normalizeStructuredAnalysisResult({ words: [], grammars: [], translation });
        expect(result.translation).toEqual(translation);
        expect(result.translation).not.toBe(translation);
    });

    test('Japanese fast-path analyses never carry a translation block (absent key stays absent)', () => {
        const result = normalizeStructuredAnalysisResult({ words: [], grammars: [] });
        expect(result).not.toHaveProperty('translation');
    });

    test('old saved/cached items with no translation metadata still normalize and read normally', () => {
        const legacyJson = {
            words: [{ term: '猫', detail: 'cat' }],
            grammars: [{ point: 'は', explanation: 'topic marker' }],
        };
        const result = normalizeStructuredAnalysisResult(legacyJson);
        expect(result).not.toBeNull();
        expect(result.words).toEqual(legacyJson.words);
        expect(result.grammars).toEqual(legacyJson.grammars);
        expect(result).not.toHaveProperty('translation');
    });

    test('a malformed translation block is dropped fail-closed WITHOUT invalidating otherwise-valid words/grammars', () => {
        const result = normalizeStructuredAnalysisResult({
            words: [{ term: '猫', detail: 'cat' }],
            grammars: [],
            translation: { sourceLanguage: 'fr', translationStyle: 'natural', translatedJapanese: 'x' },
        });
        expect(result).not.toBeNull();
        expect(result).not.toHaveProperty('translation');
        expect(result.words).toEqual([{ term: '猫', detail: 'cat' }]);
    });

    test('translation coexists with reading/collocations/registers without interference', () => {
        const reading = {
            version: 1,
            source_text: '猫',
            tokens: [{ text: '猫', reading: 'ねこ' }],
        };
        const translation = { sourceLanguage: 'zh', translationStyle: 'natural', translatedJapanese: '猫' };
        const result = normalizeStructuredAnalysisResult({
            words: [], grammars: [],
            reading,
            collocations: [{ text: 'a' }],
            registers: [{ text: 'b' }],
            translation,
        });
        expect(result.reading).toEqual(reading);
        expect(result.collocations).toEqual([{ text: 'a' }]);
        expect(result.registers).toEqual([{ text: 'b' }]);
        expect(result.translation).toEqual(translation);
    });
});
