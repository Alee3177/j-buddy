import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import authService from '../scripts/authService.js';
import JaAlchemyApiService from '../scripts/jaAlchemyApiService.js';
import {
    getPromptVariant,
    setPromptVariant,
} from '../scripts/promptVariant.js';
import { buildContextCacheKey } from '../scripts/surroundingContext.js';
import { enrichMarkdownWithConjugation } from '../scripts/conjugation.js';
import { repairRuby, separateReadingContract, reconcileRuby } from '../scripts/rubyContract.js';

// Configure marked.js to preserve ruby tags and add classes
marked.setOptions({
  gfm: true,
  breaks: true,
  xhtml: true,
  headerIds: false,
});

const ANALYSIS_ALLOWED_TAGS = [
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'ruby', 'rb', 'rt', 'strong',
    'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
];
const ANALYSIS_ALLOWED_ATTR = ['colspan', 'href', 'rowspan', 'title'];
const COMPLETED_ANALYSIS_RESULT_CACHE_VERSION = 1;
const COMPLETED_ANALYSIS_RESULT_STORAGE_KEY = 'lastAnalysisResult';
const CONTROLLED_CHECKBOX_PATTERN = /<input type="checkbox" name="(words|grammars)" value="([^"<>]*)">/g;
export const WEBSITE_URL = 'https://j-buddy-ez3177.web.app/';
export const FAQ_URL = 'https://j-buddy-ez3177.web.app/faq';

export async function openExternalPage(url) {
    await chrome.tabs.create({ url, active: true });
}

function getDomPurify() {
    // The production side panel always has a real browser window. The guarded
    // fallback keeps the pure Node test environment deterministic without
    // weakening the browser rendering path.
    if (typeof createDOMPurify?.sanitize === 'function') return createDOMPurify;
    if (globalThis.window?.document?.createElement) return createDOMPurify(globalThis.window);
    return null;
}

function fallbackSanitizeHtml(html) {
    return String(html || '')
        .replace(/<\/?(?:script|style|iframe|object|embed|form|input|button|svg|math)[^>]*>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s(?:href|src)\s*=\s*(?:"\s*(?:javascript|data):[^"]*"|'\s*(?:javascript|data):[^']*'|\s*(?:javascript|data):[^\s>]*)/gi, '');
}

/**
 * Sanitize the final HTML immediately before it enters the side panel DOM.
 * In particular, raw provider `<input>`/`<form>` markup cannot forge save
 * controls; controlled checkboxes are appended only afterwards.
 */
export function sanitizeAnalysisHtml(html) {
    const purifier = getDomPurify();
    if (!purifier) return fallbackSanitizeHtml(html);
    return purifier.sanitize(html, {
        ALLOWED_TAGS: ANALYSIS_ALLOWED_TAGS,
        ALLOWED_ATTR: ANALYSIS_ALLOWED_ATTR,
        ALLOW_DATA_ATTR: false,
    });
}

function sanitizeCachedAnalysisHtml(html) {
    const checkboxes = [];
    const withCheckboxPlaceholders = String(html || '').replace(
        CONTROLLED_CHECKBOX_PATTERN,
        (checkbox) => {
            const placeholder = `ANALYSIS_CACHE_CHECKBOX_${checkboxes.length}_`;
            checkboxes.push({ placeholder, checkbox });
            return placeholder;
        }
    );
    let sanitizedHtml = sanitizeAnalysisHtml(withCheckboxPlaceholders);
    checkboxes.forEach(({ placeholder, checkbox }) => {
        sanitizedHtml = sanitizedHtml.replace(placeholder, checkbox);
    });
    return sanitizedHtml;
}

/**
 * Stored vocabulary and grammar fields are later rendered by the web app.
 * They are markdown, not HTML, so discard all provider-supplied HTML before
 * the fields leave the extension. Ruby is represented in this stored format
 * as `{word|reading}`, so this does not remove J-Buddy's annotation syntax.
 */
export function sanitizeAnalysisTextForStorage(value) {
    const text = String(value || '');
    const purifier = getDomPurify();
    if (purifier) {
        return purifier.sanitize(text, {
            ALLOWED_TAGS: [],
            ALLOWED_ATTR: [],
            ALLOW_DATA_ATTR: false,
        });
    }

    // The test-only fallback deliberately keeps markdown text while dropping
    // raw HTML tags. The production extension takes the DOMPurify path above.
    return text
        .replace(/<!--([\s\S]*?)-->/g, '')
        .replace(/<\/?[^>]+>/g, '');
}

export function renderAnalysisMarkdown(markdown) {
    const rubyConverted = convertToRuby(markdown);
    return sanitizeAnalysisHtml(marked.parse(rubyConverted));
}

// Function to convert Japanese text with readings in square brackets to HTML with ruby tags
export function convertToRuby(text) {
    if (!text) return '';

    // Handle the format: {漢字|かんじ} to <ruby><rb>漢字</rb><rt>かんじ</rt></ruby>
    return text.replace(/{(.+?)\|(.+?)}/g, (match, kanji, reading) => {
        // Trim any whitespace from kanji and reading
        kanji = kanji.trim();
        reading = reading.trim();
        return `<ruby><rb>${kanji}</rb><rt>${reading}</rt></ruby>`;
    });
}

/**
 * Parse a v0.3 Phase 2A taxonomy section (`### 搭配分析`, `### 語體／新聞表現`)
 * into `{ text }` items — one per top-level markdown bullet.
 *
 * Deliberately coarse: the provider packs form / meaning / register / example
 * into a single inline bullet with only a soft `：` convention, so no sub-field
 * splitting is attempted. Only direct list items (`- ` with 0–3 leading spaces)
 * are taken; nested bullets, non-`-` markers, blank bullets, and the `（無）`
 * sentinel are skipped. Inline ruby `{漢字|かな}` is preserved;
 * `sanitizeAnalysisTextForStorage` drops any provider HTML (mirrors words /
 * grammars). Returns `[]` when the section carries no valid bullets.
 *
 * @param {string} section  the `### …` section chunk from the heading split
 * @returns {Array<{ text: string }>}
 */
function parseTaxonomyBulletSection(section) {
    const firstNewline = section.indexOf('\n');
    const body = firstNewline === -1 ? '' : section.slice(firstNewline + 1);
    const items = [];
    for (const rawLine of body.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        const match = /^ {0,3}-\s+(.+)$/.exec(line);
        if (!match) continue;
        const text = sanitizeAnalysisTextForStorage(match[1].trim());
        if (!text || text === '（無）') continue;
        items.push({ text });
    }
    return items;
}

// Function to format the analysis result using marked.js
export function formatAnalysisResult(markdown) {
    // Handle null/undefined input
    const resultData = {
        "json": { "words": [], "grammars": [] },
        "html": ""
    };
    if (!markdown) return resultData;

    // 2. 切割區塊：以 "#### " 作為分割點
    const sections = markdown.split(/(?=^### )/gm);
    const jsonData = {};

    const wordSection = sections.find(section => section.trim().startsWith('### 單字分析'));
    const grammarSection = sections.find(section => section.trim().startsWith('### 文法分析'));

    // Remove the "### 單字分析" heading
    if (wordSection) {
        const wordContent = wordSection.replace(/^### 單字分析*/m, '').trim();
        // Extract 'term' from "####" headings, leave the rest as 'detail'
        wordContent.split(/^####\s+/gm).forEach(entry => {
            const lines = entry.trim().split('\n');
            // remove <單字>： prefix if exists
            const term = sanitizeAnalysisTextForStorage(
                lines.shift().trim().replace('<單字>', '')
            ); // First line is the term
            const detail = sanitizeAnalysisTextForStorage(lines.join('\n').trim()); // The rest is detail
            // push into jsonData.words
            if (term) {
                if (!jsonData.words) jsonData.words = [];
                jsonData.words.push({ "term": term, "detail": detail });
            }
        });
    }

    if (grammarSection) {
        const grammarContent = grammarSection.replace(/^### 文法分析*/m, '').trim();
        // Extract 'point' from "####" headings, leave the rest as 'explanation'
        grammarContent.split(/^####\s+/gm).forEach(entry => {
            const lines = entry.trim().split('\n');
            // remove <文法>： prefix if exists
            const point = sanitizeAnalysisTextForStorage(
                lines.shift().trim().replace('<文法>', '')
            ); // First line is the point
            const explanation = sanitizeAnalysisTextForStorage(lines.join('\n').trim()); // The rest is explanation
            // push into jsonData.grammars
            if (point) {
                if (!jsonData.grammars) jsonData.grammars = [];
                jsonData.grammars.push({ "point": point, "explanation": explanation });
            }
        });
    }

    // v0.3 Phase 2A: additive collocation / register taxonomy. These sections
    // only exist in the personal-provider (6-section) contract; the managed
    // provider omits them, so the key is added ONLY when the heading is present.
    // Heading present but empty / （無） → the key is an empty array.
    const collocationSection = sections.find(section => section.trim().startsWith('### 搭配分析'));
    if (collocationSection) {
        jsonData.collocations = parseTaxonomyBulletSection(collocationSection);
    }
    const registerSection = sections.find(section => section.trim().startsWith('### 語體'));
    if (registerSection) {
        jsonData.registers = parseTaxonomyBulletSection(registerSection);
    }

    // console.log('jsonData after word section:', jsonData);
    resultData.json = jsonData;

    resultData.html = renderAnalysisMarkdown(markdown);
    // console.log('Formatted HTML:', resultData.html);

    return resultData;
}

function isStructuredAnalysisEntry(entry, fields) {
    return entry
        && typeof entry === 'object'
        && fields.every((field) => typeof entry[field] === 'string');
}

/**
 * Validate and clone the authoritative reading tokens for persistence inside
 * `structured_json.reading` (Japanese Reader v0.3 Phase 1 — learner memory /
 * review / quiz baseline).
 *
 * Pure and total. Accepts ONLY the exact persisted shape:
 *   { version: 1,
 *     source_text: non-empty string,
 *     tokens: non-empty array of
 *       { text: non-empty string, reading: non-empty string | null } }
 * and additionally requires `tokens.map(t => t.text).join('') === source_text`.
 *
 * Returns a fresh object with freshly-built token objects — never a reference to
 * the parser / provider value — or `null` for any malformed input. Readings are
 * never invented, trimmed, width-folded, or otherwise normalized.
 *
 * @param {unknown} reading
 * @returns {{ version: 1, source_text: string, tokens: Array<{ text: string, reading: string|null }> }|null}
 */
function normalizePersistedReading(reading) {
    if (!reading || typeof reading !== 'object' || Array.isArray(reading)) return null;
    if (reading.version !== 1) return null;
    if (typeof reading.source_text !== 'string' || reading.source_text.length === 0) return null;
    if (!Array.isArray(reading.tokens) || reading.tokens.length === 0) return null;

    const tokens = [];
    for (const rawToken of reading.tokens) {
        if (!rawToken || typeof rawToken !== 'object' || Array.isArray(rawToken)) return null;
        const { text } = rawToken;
        const tokenReading = rawToken.reading;
        if (typeof text !== 'string' || text.length === 0) return null;
        const readingOk = tokenReading === null
            || (typeof tokenReading === 'string' && tokenReading.length > 0);
        if (!readingOk) return null;
        tokens.push({ text, reading: tokenReading === null ? null : tokenReading });
    }

    if (tokens.map((token) => token.text).join('') !== reading.source_text) return null;

    return { version: 1, source_text: reading.source_text, tokens };
}

function normalizeStructuredAnalysisResult(json) {
    if (!json || typeof json !== 'object') return null;

    const normalizedJson = {
        ...json,
        words: json.words || [],
        grammars: json.grammars || [],
    };

    // v0.3 Phase 1: an optional `reading` sub-object rides inside structured_json.
    // Keep a structurally-valid one (re-cloned, never by reference); silently
    // drop a malformed one. Absent `reading` (old cached projections, V1 /
    // managed-provider responses, ungrounded contracts) is left untouched.
    if ('reading' in normalizedJson) {
        const normalizedReading = normalizePersistedReading(normalizedJson.reading);
        if (normalizedReading) {
            normalizedJson.reading = normalizedReading;
        } else {
            delete normalizedJson.reading;
        }
    }

    // v0.3 Phase 2A: optional `collocations` / `registers` taxonomy lists. Absent
    // → left absent (old cached projections, managed-provider results). Present
    // but not an array → dropped fail-closed. Present as an array → filtered to
    // freshly-cloned `{ text: non-empty string }` items (an all-invalid array
    // normalizes to []). Malformed taxonomy data never invalidates otherwise
    // valid words / grammars.
    for (const key of ['collocations', 'registers']) {
        if (!(key in normalizedJson)) continue;
        const raw = normalizedJson[key];
        if (!Array.isArray(raw)) {
            delete normalizedJson[key];
            continue;
        }
        normalizedJson[key] = raw.reduce((items, item) => {
            if (item && typeof item === 'object' && !Array.isArray(item)
                && typeof item.text === 'string' && item.text.length > 0) {
                items.push({ text: item.text });
            }
            return items;
        }, []);
    }

    return Array.isArray(normalizedJson.words)
        && Array.isArray(normalizedJson.grammars)
        && normalizedJson.words.every((word) => isStructuredAnalysisEntry(word, ['term', 'detail']))
        && normalizedJson.grammars.every((grammar) => isStructuredAnalysisEntry(grammar, ['point', 'explanation']))
        ? normalizedJson
        : null;
}

function createCompletedAnalysisProjection(cacheKey, response, analysisResult) {
    return JSON.stringify({
        version: COMPLETED_ANALYSIS_RESULT_CACHE_VERSION,
        cacheKey,
        response,
        html: analysisResult.html,
        json: analysisResult.json,
    });
}

function getCachedCompletedAnalysis(cacheKey) {
    const storedProjection = localStorage.getItem(COMPLETED_ANALYSIS_RESULT_STORAGE_KEY);
    if (!storedProjection) return null;

    try {
        const projection = JSON.parse(storedProjection);
        if (projection?.version !== COMPLETED_ANALYSIS_RESULT_CACHE_VERSION
            || projection.cacheKey !== cacheKey
            || typeof projection.response !== 'string'
            || typeof projection.html !== 'string'
            || !projection.html.trim()
            || !normalizeStructuredAnalysisResult(projection.json)) {
            return null;
        }

        const sanitizedHtml = sanitizeCachedAnalysisHtml(projection.html);
        // A projection changed by sanitization is treated as untrusted. Its
        // matching canonical markdown, if present, is reformatted instead.
        if (!sanitizedHtml || sanitizedHtml !== projection.html) return null;

        return {
            html: sanitizedHtml,
            json: normalizeStructuredAnalysisResult(projection.json),
            response: projection.response,
            isSanitized: true,
        };
    } catch {
        return null;
    }
}

function hasMismatchedCompletedAnalysis(cacheKey) {
    try {
        const projection = JSON.parse(localStorage.getItem(COMPLETED_ANALYSIS_RESULT_STORAGE_KEY) || 'null');
        return projection?.version === COMPLETED_ANALYSIS_RESULT_CACHE_VERSION
            && typeof projection.cacheKey === 'string'
            && typeof projection.response === 'string'
            && typeof projection.html === 'string'
            && !!normalizeStructuredAnalysisResult(projection.json)
            && projection.cacheKey !== cacheKey;
    } catch {
        return false;
    }
}

function renderCompletedAnalysis(analysisResult, proseElement, resultElement, loadingElement) {
    saveForLaterJson = analysisResult.json;
    completedAnalysisResponse = analysisResult.response || '';
    proseElement.innerHTML = analysisResult.isSanitized
        ? analysisResult.html
        : sanitizeCachedAnalysisHtml(analysisResult.html);
    resultElement.classList.add('show');
    setLoadingState(loadingElement, false);
    setCompletedAnalysisAvailable(true);
}

function getCompletedAnalysisResponse() {
    return completedAnalysisResponse || localStorage.getItem('lastResponse') || '';
}

function restoreCompletedAnalysis(cacheKey, proseElement, resultElement, loadingElement) {
    const cachedProjection = getCachedCompletedAnalysis(cacheKey);
    if (cachedProjection) {
        renderCompletedAnalysis(cachedProjection, proseElement, resultElement, loadingElement);
        return true;
    }

    // A valid projection is authoritative. Do not pair a legacy key from an
    // interrupted compatibility write with a response for another analysis.
    if (hasMismatchedCompletedAnalysis(cacheKey)) return false;
    if (cacheKey !== localStorage.getItem('lastAnalysisKey')) return false;
    const storedResponse = localStorage.getItem('lastResponse');
    if (!storedResponse) return false;

    const analysisResult = formatAnalysisResult(storedResponse);
    if (!analysisResult.html) return false;

    const normalizedJson = normalizeStructuredAnalysisResult(analysisResult.json);
    if (!normalizedJson) return false;
    const completedAnalysis = { ...analysisResult, json: normalizedJson, response: storedResponse };
    localStorage.setItem(
        COMPLETED_ANALYSIS_RESULT_STORAGE_KEY,
        createCompletedAnalysisProjection(cacheKey, storedResponse, completedAnalysis)
    );
    renderCompletedAnalysis(completedAnalysis, proseElement, resultElement, loadingElement);
    return true;
}

// Function to show error message
function alertMessage(element, message, type = 'error') {
    if (!element) return;
    // Error strings originate from Firebase or a learner-configured provider.
    // Render them as text so a remote error cannot execute markup in the panel.
    element.textContent = String(message || '');
}

// Function to show loading state
function setLoadingState(loadingElement, show) {
    if (show) {
        loadingElement.classList.add('show');
    } else {
        loadingElement.classList.remove('show');
    }
}

function setLoadingMessage(loadingElement, message) {
    const messageElement = loadingElement.querySelector
        ? loadingElement.querySelector('.loading-message')
        : null;
    if (messageElement) {
        messageElement.textContent = message;
    }
}

// Retrieve and display selected text
async function loadSelectedText() {
  const pendingRefreshId = ++pendingSelectionRefreshId;
  const { selectedText, contextBefore = '', contextAfter = '' } =
    await chrome.storage.local.get(['selectedText', 'contextBefore', 'contextAfter']);
  setPendingSelection(selectedText, { before: contextBefore, after: contextAfter }, pendingRefreshId);
}

// Update when new selections or provider-state transitions arrive.
chrome.storage.onChanged.addListener((changes, areaName) => {
    void handleSidepanelStorageChanges(changes, areaName);
});

// Handle messages from background scripts
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'textSelectedChanged') {
      setPendingSelection(request.data, {
        before: request.contextBefore || '',
        after: request.contextAfter || '',
      });
    }
    sendResponse({ status: 'success' });
});

let isAnalizing = false;
let saveForLaterJson = {};
let completedAnalysisResponse = '';
let renderThrottleTimer = null;
let currentSelectedText = '';
let currentContext = { before: '', after: '' };
let pendingSelectedText = '';
let pendingContext = { before: '', after: '' };
let pendingSelectionRefreshId = 0;
let analysisRequestId = 0;
let activeAnalysisKey = null;
let activeAnalysisController = null;
let activeAnalysisRequestIdentity = null;
let activeAnalysisPreviewText = '';
let modeChangeRequestId = 0;
let hasCompletedAnalysis = false;

function normalizeContext(context = {}) {
    return {
        before: context.before || '',
        after: context.after || '',
    };
}

function isValidSelection(selectedText) {
    return !!selectedText && selectedText.length >= 2 && selectedText.length <= 500;
}

function updateAnalyzeAvailability() {
    if (elements?.analyzeButton) {
        elements.analyzeButton.disabled = isAnalizing || !isValidSelection(pendingSelectedText);
    }
}

function setPendingSelection(selectedText, context = {}, refreshId = null) {
    if (refreshId !== null && refreshId !== pendingSelectionRefreshId) return;
    if (refreshId === null) pendingSelectionRefreshId += 1;
    pendingSelectedText = selectedText || '';
    pendingContext = normalizeContext(context);
    if (elements?.pendingSelectionStatus) {
        elements.pendingSelectionStatus.textContent = isValidSelection(pendingSelectedText)
            ? `已選取：「${pendingSelectedText}」；按「開始分析」才會傳送。`
            : '請在頁面選取 2–500 個字元後再開始分析。';
    }
    updateAnalyzeAvailability();
}

export async function handleAnalyzePendingSelection() {
    if (isAnalizing || !isValidSelection(pendingSelectedText)) {
        updateAnalyzeAvailability();
        return;
    }
    if (elements?.analyzeButton) elements.analyzeButton.disabled = true;
    await analizingSelectedText(pendingSelectedText, pendingContext);
}

function isLatestAnalysis(requestId) {
    return requestId === analysisRequestId;
}

function cancelActiveAnalysis() {
    activeAnalysisController?.abort();
    activeAnalysisController = null;
    activeAnalysisRequestIdentity = null;
    setAnalysisCancellationAvailable(false);
}

export async function handleSidepanelStorageChanges(
    changes,
    areaName = 'local',
    panelElements = elements
) {
    if (areaName !== 'local' || !changes || typeof changes !== 'object') return;

    if (changes.selectedText || changes.contextBefore || changes.contextAfter) {
        const pendingRefreshId = ++pendingSelectionRefreshId;
        const { selectedText, contextBefore = '', contextAfter = '' } =
            await chrome.storage.local.get(['selectedText', 'contextBefore', 'contextAfter']);
        setPendingSelection(selectedText, { before: contextBefore, after: contextAfter }, pendingRefreshId);
    }
}

function analysisSourceIdentity() {
    return 'managed:0';
}

function setCompletedAnalysisAvailable(available) {
    hasCompletedAnalysis = available;
    [elements?.copyButton, elements?.saveAsBtn, elements?.saveForLaterBtn]
        .filter(Boolean)
        .forEach((button) => { button.disabled = !available; });
}

function setAnalysisCancellationAvailable(available) {
    if (elements?.cancelAnalysisButton) {
        elements.cancelAnalysisButton.hidden = !available;
    }
}

/**
 * Stop the active provider request without allowing a partial response to
 * become completed Analysis markdown. A visible preview remains useful after
 * the first chunk, but completion-only actions stay disabled.
 */
export function handleCancelAnalysis(panelElements = elements) {
    if (!isAnalizing) return false;

    const previewText = activeAnalysisPreviewText;
    const resultElement = panelElements?.result || document.getElementById('result');
    const proseElement = panelElements?.prose || resultElement?.querySelector('.prose');
    const loadingElement = document.getElementById('loading');
    const previewRenderPending = renderThrottleTimer !== null;

    analysisRequestId += 1;
    cancelActiveAnalysis();
    isAnalizing = false;
    activeAnalysisKey = null;
    activeAnalysisPreviewText = '';
    completedAnalysisResponse = '';
    saveForLaterJson = {};
    if (previewRenderPending) {
        clearTimeout(renderThrottleTimer);
        renderThrottleTimer = null;
    }
    setLoadingState(loadingElement, false);
    setCompletedAnalysisAvailable(false);

    if (previewText) {
        if (previewRenderPending) {
            proseElement.innerHTML = renderAnalysisMarkdown(previewText);
        }
        resultElement.classList.add('show');
        alertMessage(
            panelElements?.alertMessage,
            '分析已停止。以下內容為未完成的預覽，無法儲存、複製或加入收藏。',
            'info'
        );
        panelElements?.alertMessage?.classList.add('show');
    } else {
        proseElement.innerHTML = '';
        resultElement.classList.remove('show');
    }

    return true;
}

function isLatestModeChange(requestId) {
    return requestId === modeChangeRequestId;
}

// Throttled progressive render: re-parses accumulated markdown at most every 80ms
function renderStreamingPreview(proseElement, accumulatedText, requestId) {
    if (renderThrottleTimer) return; // already scheduled
    renderThrottleTimer = setTimeout(() => {
        renderThrottleTimer = null;
        if (!isLatestAnalysis(requestId)) return;
        proseElement.innerHTML = renderAnalysisMarkdown(accumulatedText);
    }, 80);
}

export async function analizingSelectedText(selectedText, context = { before: '', after: '' }, options = {}) {
    const selectedTextForRequest = selectedText || '';
    const contextForRequest = normalizeContext(context);
    const requestIdentity = JSON.stringify({ selectedText: selectedTextForRequest, context: contextForRequest });
    if (!options.force && activeAnalysisRequestIdentity === requestIdentity) {
        return;
    }

    // A replacement must invalidate an active stream before any async setup.
    // Otherwise the prior request can finish while prompt/provider state loads.
    const requestId = ++analysisRequestId;
    cancelActiveAnalysis();
    activeAnalysisRequestIdentity = requestIdentity;
    currentSelectedText = selectedTextForRequest;
    currentContext = contextForRequest;

    const resultElement = document.getElementById('result');
    const proseElement = resultElement.querySelector('.prose');
    const loadingElement = document.getElementById('loading');
    let promptVariant;
    try {
        promptVariant = options.promptVariant || await getPromptVariant();
        if (!isLatestAnalysis(requestId)) return;
    } catch (error) {
        if (isLatestAnalysis(requestId)) {
            activeAnalysisRequestIdentity = null;
            isAnalizing = false;
            activeAnalysisKey = null;
            saveForLaterJson = {};
            proseElement.innerHTML = '';
            resultElement.classList.remove('show');
            setLoadingState(loadingElement, false);
            setCompletedAnalysisAvailable(false);
            console.error('Analysis setup error:', error);
            alertMessage(elements.alertMessage, '無法讀取此頁面上的選取文字。', 'error');
            elements.alertMessage.classList.add('show');
        }
        return;
    }
    if (!isLatestAnalysis(requestId)) return;
    const sourceIdentity = analysisSourceIdentity();
    const cacheKey = selectedTextForRequest
        ? buildContextCacheKey({
            selectedText: selectedTextForRequest,
            context: contextForRequest,
            promptVariant,
            sourceIdentity,
        })
        : '';

    console.log('Analizing Selected Text...');
    let analysisController = null;
    isAnalizing = true;
    updateAnalyzeAvailability();
    activeAnalysisPreviewText = '';
    setAnalysisCancellationAvailable(true);
    setCompletedAnalysisAvailable(false);
    activeAnalysisKey = cacheKey;
    if (renderThrottleTimer) {
        clearTimeout(renderThrottleTimer);
        renderThrottleTimer = null;
    }

    // Clear previous alertMessage
    elements.alertMessage.classList.remove('show');

    try {
        // Cache hit when the complete analysis identity matches. The projection
        // keeps the interactive render state, while canonical markdown remains
        // the source for Copy and Save As.
        if (isValidSelection(selectedTextForRequest)
            && restoreCompletedAnalysis(cacheKey, proseElement, resultElement, loadingElement)) {
            if (!isLatestAnalysis(requestId)) return;
            console.log('Selected text + context same as last time');
        } else if (isValidSelection(selectedTextForRequest)) {
            // Show loading state
            setLoadingMessage(loadingElement, 'AI 正在分析，請稍候…');
            setLoadingState(loadingElement, true);
            proseElement.innerHTML = '';
            resultElement.classList.remove('show');
            saveForLaterJson = {};

            try {
                console.log('Initializing API service...');
                const analysisService = new JaAlchemyApiService();

                console.log('Generating response (streaming)...');
                let firstChunkReceived = false;

                const streamArgs = [selectedTextForRequest, promptVariant, contextForRequest];
                analysisController = new AbortController();
                activeAnalysisController = analysisController;
                await analysisService.generateResponseStream(
                    ...streamArgs,
                    // onChunk: progressively render each chunk
                    (chunk, fullText) => {
                        if (!isLatestAnalysis(requestId)) return;
                        if (!firstChunkReceived) {
                            firstChunkReceived = true;
                            setLoadingMessage(loadingElement, '已收到分析結果，正在整理版面…');
                            resultElement.classList.add('show');
                        }
                        activeAnalysisPreviewText = fullText;
                        renderStreamingPreview(proseElement, fullText, requestId);
                    },
                    // onDone: finalize with full formatting (checkboxes, structured data)
                    (fullText) => {
                        if (!isLatestAnalysis(requestId)) return;
                        // v0.2 Phase 2B-1: split the machine-readable reading
                        // contract (the final ```json block SYSTEM_PROMPT_V2
                        // appends) off the human-readable Markdown BEFORE any
                        // ruby / conjugation / parser / render / cache / save
                        // step sees the text. The contract is metadata: in this
                        // phase it is parsed, validated, and then discarded — it
                        // is NOT yet reconciled against the inline {漢字|かな}
                        // ruby (that is Phase 2B-2). A final block that is not a
                        // provably valid contract is left in place untouched, so
                        // model/user-visible content is never deleted on a guess.
                        const separated = separateReadingContract(fullText);
                        if (separated.contractIssues.length > 0) {
                            const contractCounts = {};
                            for (const issue of separated.contractIssues) {
                                contractCounts[issue.code] = (contractCounts[issue.code] || 0) + 1;
                            }
                            const contractSummary = Object.entries(contractCounts)
                                .map(([code, count]) => `${code}×${count}`)
                                .join(', ');
                            console.warn(`[ruby-contract] invalid reading contract: ${contractSummary}`);
                        }
                        const humanMarkdown = separated.markdown;
                        // v0.2 Phase 2B-2 / P2-A: when a valid reading contract is
                        // present AND it is grounded in the actual selected text
                        // (`selectedTextForRequest`, captured when this request
                        // started — never a fresh page-selection read, so a
                        // selection change mid-stream cannot corrupt it), its
                        // tokens are AUTHORITATIVE for the source sentence.
                        // Rebuild ONLY the `### 原句` source line's inline ruby
                        // from those tokens — deterministically, before repairRuby
                        // / conjugation / parsing. Generated teaching content
                        // (漢字提取 / 單字分析 / 文法分析 / 搭配分析 / 語體 /
                        // examples / templates / the 翻譯 line) is never touched.
                        // No / invalid / ungrounded contract -> plain canonical
                        // fallback (P2-A; V1 + personal-provider lines that are
                        // already correct are left byte-for-byte untouched).
                        const reconciled = reconcileRuby(
                            humanMarkdown, separated.readingContract, selectedTextForRequest
                        );
                        // v0.3 Phase 1 / P2-B: persist the authoritative reading
                        // tokens (for future learner memory / review / quiz
                        // features) as `structured_json.reading` ONLY when
                        // `reconciled.readingTrusted` is true — i.e. reconcileRuby
                        // itself accepted and actually used this exact contract to
                        // produce the final rendered `### 原句` source line. This
                        // is the ONE authoritative trust decision; persistence must
                        // never re-derive grounding independently (a prior,
                        // independent `sourceText === selectedTextForRequest`
                        // check here disagreed with render for multi-line and
                        // ambiguous-candidate-line responses, since it didn't know
                        // about those render-side refusals — P2-B closes that gap).
                        // The contract JSON fence itself never reaches any string
                        // path — only `separated.readingContract` object fields
                        // (the exact contract reconcileRuby evaluated) are read.
                        const persistedReading = reconciled.readingTrusted
                            ? normalizePersistedReading({
                                version: 1,
                                source_text: separated.readingContract.sourceText,
                                tokens: separated.readingContract.tokens,
                            })
                            : null;
                        if (reconciled.issues.length > 0) {
                            const reconcileCounts = {};
                            for (const issue of reconciled.issues) {
                                reconcileCounts[issue.code] = (reconcileCounts[issue.code] || 0) + 1;
                            }
                            const reconcileSummary = Object.entries(reconcileCounts)
                                .map(([code, count]) => `${code}×${count}`)
                                .join(', ');
                            console.warn(`[ruby-contract] reading reconciliation skipped: ${reconcileSummary}`);
                        }
                        // v0.2 Phase 1B: normalize the (reconciled) human-readable
                        // Markdown with the deterministic ruby contract before any
                        // consumer reads it. This only applies conservative,
                        // unambiguous repairs (currently: a plain-text surface
                        // that exactly duplicates the base of the ruby token
                        // right after it, e.g. `以降{以降|いこう}` ->
                        // `{以降|いこう}`). Ambiguous malformed ruby and semantic
                        // reading warnings are left untouched and only reported
                        // below. Streaming-preview rendering is intentionally NOT
                        // run through this — a partial `{漢字` mid-stream is not
                        // malformed final output.
                        const rubyRepair = repairRuby(reconciled.text);
                        if (rubyRepair.remainingIssues.length > 0) {
                            const issueCounts = {};
                            for (const issue of rubyRepair.remainingIssues) {
                                issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
                            }
                            const summary = Object.entries(issueCounts)
                                .map(([code, count]) => `${code}×${count}`)
                                .join(', ');
                            console.warn(
                                `[ruby-contract] ${rubyRepair.remainingIssues.length} unresolved ruby `
                                + `issue(s) after ${rubyRepair.repairs.length} safe repair(s): ${summary}`
                            );
                        }
                        // Enrich the (ruby-normalized) stream with engine-generated
                        // verb conjugation before any consumer reads it, so the
                        // rendered panel, the saved item, Copy, Save-As, and the
                        // cached response all carry the generated table from one
                        // pass (see KTD2). Repair runs first so a duplicated-surface
                        // 辭書形 is corrected before conjugation splices forms.
                        const enrichedText = enrichMarkdownWithConjugation(rubyRepair.text);
                        activeAnalysisPreviewText = '';
                        const formattedResult = formatAnalysisResult(enrichedText);
                        const normalizedJson = normalizeStructuredAnalysisResult(
                            persistedReading
                                ? { ...formattedResult.json, reading: persistedReading }
                                : formattedResult.json
                        );
                        if (!normalizedJson) {
                            throw new Error('Unable to format the completed analysis result.');
                        }
                        const analysisResult = {
                            ...formattedResult,
                            json: normalizedJson,
                            response: enrichedText,
                        };
                        const completedProjection = createCompletedAnalysisProjection(
                            cacheKey,
                            enrichedText,
                            analysisResult
                        );
                        // Advance the cache only after enrichment and formatting
                        // both succeed, so errors cannot leave a key pointing at
                        // a stale or partial result.
                        localStorage.setItem(COMPLETED_ANALYSIS_RESULT_STORAGE_KEY, completedProjection);
                        try {
                            // These legacy values keep older cache consumers working,
                            // but the versioned projection above is the atomic source.
                            localStorage.setItem('lastResponse', enrichedText);
                            localStorage.setItem('lastAnalysisKey', cacheKey);
                            localStorage.setItem('lastSelectedText', selectedTextForRequest);
                        } catch (storageError) {
                            console.warn('Unable to update legacy analysis cache:', storageError);
                        }
                        if (renderThrottleTimer) {
                            clearTimeout(renderThrottleTimer);
                            renderThrottleTimer = null;
                        }
                        renderCompletedAnalysis(analysisResult, proseElement, resultElement, loadingElement);
                    },
                    // onError
                    (errorMessage) => {
                        if (!isLatestAnalysis(requestId)) return;
                        console.warn('Streaming API Error:', errorMessage);
                        if (renderThrottleTimer) {
                            clearTimeout(renderThrottleTimer);
                            renderThrottleTimer = null;
                        }
                        alertMessage(elements.alertMessage, `呼叫分析服務時發生錯誤：${errorMessage}`, 'error');
                        elements.alertMessage.classList.add('show');
                        setLoadingState(loadingElement, false);
                        proseElement.innerHTML = '';
                        resultElement.classList.remove('show');
                        saveForLaterJson = {};
                        completedAnalysisResponse = '';
                        activeAnalysisPreviewText = '';
                        setCompletedAnalysisAvailable(false);
                    },
                    { signal: analysisController.signal }
                );
            } catch (apiError) {
                if (!isLatestAnalysis(requestId)) return;
                console.warn('Calling API Error:', apiError);
                alertMessage(elements.alertMessage, `呼叫分析服務時發生錯誤：${apiError.message}`, 'error');
                elements.alertMessage.classList.add('show');
                setLoadingState(loadingElement, false);
                proseElement.innerHTML = '';
                resultElement.classList.remove('show');
                saveForLaterJson = {};
                completedAnalysisResponse = '';
                activeAnalysisPreviewText = '';
                setCompletedAnalysisAvailable(false);
            }
        } else {
            if (!isLatestAnalysis(requestId)) return;
            alertMessage(elements.alertMessage, '尚未選取文字，或文字長度不符。請在頁面選取 2–500 個字元後重新開啟側邊欄。', 'info');
            elements.alertMessage.classList.add('show');
            elements.result.classList.remove('show');
        }
    } catch (error) {
        if (!isLatestAnalysis(requestId)) return;
        console.error('General Error:', error);
        alertMessage(elements.alertMessage, '無法讀取此頁面上的選取文字。', 'error');
        elements.alertMessage.classList.add('show');
        elements.result.classList.remove('show');
        setLoadingState(loadingElement, false);
    }
    if (isLatestAnalysis(requestId)) {
        if (activeAnalysisController === analysisController) {
            activeAnalysisController = null;
        }
        isAnalizing = false;
        activeAnalysisKey = null;
        activeAnalysisRequestIdentity = null;
        activeAnalysisPreviewText = '';
        setAnalysisCancellationAvailable(false);
        updateAnalyzeAvailability();
    }
}

// Generate a filename using local datetime formatted as YYYY-MM-DD_HH:MM:SS.md
function generateFilenameAndHeading() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return {
        filename: `毎日の日本語_${year}-${month}-${day}_${hours}:${minutes}:${seconds}.md`,
        heading: `## 毎日の日本語 ${year}年${month}月${day}日 ${hours}:${minutes}:${seconds}\n`,
    };
}

// Function to handle the "Save As" functionality
async function saveAsFile() {
  if (!hasCompletedAnalysis) {
    alertMessage(elements?.alertMessage, '請等待分析完成後再匯出。', 'info');
    elements?.alertMessage?.classList.add('show');
    return;
  }
  try {
    // The filename should use local datetime, and formatted as: YYYY-MM-DD_HH-MM-SS.md
    const suggestedName = generateFilenameAndHeading(); 
    let text = getCompletedAnalysisResponse();
    text = suggestedName.heading + "\n" + text;

    const handle = await window.showSaveFilePicker({
      id: 'saveAsFile',
      suggestedName: suggestedName.filename,
      startIn: 'documents',
      types: [{
        description: 'Markdown 檔案',
        accept: {
          'text/markdown': ['.md']
        }
      }],
    });

    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    console.log('File saved successfully!');
  } catch (err) {
    console.error('Error saving file:', err);
  }
}

// Function to handle "Save For Later" button click
async function handleSaveForLater() {
    if (!elements?.saveForLaterBtn) return;
    if (!hasCompletedAnalysis) {
        alertMessage(elements.alertMessage, '請等待分析完成後再儲存。', 'info');
        elements.alertMessage.classList.add('show');
        return;
    }
    // P7.4: saveItems now requires sign-in for BOTH personal and shared
    // saves (previously only personal saves were auth-gated). The button is
    // disabled while signed out (updateAuthUI) so a normal user cannot reach
    // this function without a session; if it's still reached without one
    // (e.g. a race), the callable rejects with `unauthenticated` and
    // jaAlchemyApiService.js maps that to a friendly, save-kind-specific
    // sign-in message below — no separate pre-flight check duplicated here.

    // Check if button is already saving
    if (elements.saveForLaterBtn.classList.contains('saving')) return;

    // Build vocabulary array from all parsed words
    const words = (saveForLaterJson.words || []).map(word => ({
        term: word.term,
        detail: word.detail
    }));

    // Build grammar array from all parsed grammars
    const grammars = (saveForLaterJson.grammars || []).map(grammar => ({
        point: grammar.point,
        explanation: grammar.explanation
    }));

    // Get share checkbox state
    const isShared = elements.shareCheckbox?.checked ?? false;
    const isLoggedIn = authService.isLoggedIn();
    const user = authService.getUser();

    // Build the analysis object
    const analysis = {
        words: words,
        grammars: grammars,

        page: {
            rendered_markdown: getCompletedAnalysisResponse(),
            structured_json: saveForLaterJson,
        },
        is_shared: isShared,
        metadata: {
            source_text: localStorage.getItem('lastSelectedText') || '',
            source_url: await getCurrentTabUrl(),
            saved_at: new Date().toISOString()
        }
    };

    // Show loading state
    elements.saveForLaterBtn.classList.add('saving');
    elements.saveForLaterBtn.disabled = true;

    try {
        // Initialize API service and save
        const jaAlchemyApiService = new JaAlchemyApiService();
        
        // Determine userId - only include if logged in and not sharing
        let userId = null;
        if (isLoggedIn && user && !isShared) {
            userId = user.uid;
        }

        const result = await jaAlchemyApiService.saveAnalysis(analysis, userId);

        // Show success message. P7.4: a repeated identical shared save is
        // deduplicated server-side and reported as alreadyExists — a clean,
        // friendly notice, not an error.
        const message = result.alreadyExists
            ? '此分析已存在於共享收藏中，未重複新增。'
            : isShared
                ? `已成功儲存分析頁面至共享收藏！`
                : `已成功儲存分析頁面！`;
        alertMessage(elements.alertMessage, message, 'info');
        elements.alertMessage.classList.add('show');
        // Scroll to top to see the message
        window.scrollTo({ top: 0, behavior: 'smooth' });

        console.log('[Save Analysis Page] Save successful:', result);
    } catch (error) {
        console.error('[Save Analysis Page] Save error:', error);
        alertMessage(elements.alertMessage, `儲存項目時發生錯誤：${error.message}`, 'error');
        elements.alertMessage.classList.add('show');
    } finally {
        // Hide loading state
        elements.saveForLaterBtn.classList.remove('saving');
        elements.saveForLaterBtn.disabled = false;
    }
}

// Helper function to get current tab URL
async function getCurrentTabUrl() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab?.url || '';
    } catch (error) {
        console.error('[Save For Later] Error getting tab URL:', error);
        return '';
    }
}

// Handle click outside font size menu
function handleClickOutside(e, elements) {
    if (!elements?.fontSizeBtn?.contains(e.target)) {
      toggleFontSizeMenu(elements, false);
    }
}

// Initialize font size from config
async function initializeFontSize(elements) {
    console.log('[Sidebar] Initializing font size...');
    if (!elements.prose || !elements.fontSizeMenu) return;
    try {
      const savedFontSize = 14;
      elements.prose.style.fontSize = `${savedFontSize}px`;
      elements.prose.style.lineHeight = `calc(2.0rem * ${savedFontSize}/16)`;
      initializeFontSizeMenu(elements, savedFontSize);
    } catch (error) {
      console.error('[Sidebar] Error loading font size preference:', error);
      const defaultSize = 14;
      elements.prose.style.fontSize = `${defaultSize}px`;
      elements.prose.style.lineHeight = `calc(2.0rem * ${defaultSize}/16)`;
      initializeFontSizeMenu(elements, defaultSize);
    }
}

// Initialize font size menu
export function initializeFontSizeMenu(elements, currentSize) {
    console.log('[Sidebar] Initializing font size menu...');
    if (!elements?.fontSizeMenu) return;
  
    // Clear existing options
    elements.fontSizeMenu.innerHTML = '';
  
    // Create options for specific sizes
    const sizes = [12, 14, 16, 18, 20];
    sizes.forEach((size) => {
      const option = document.createElement('div');
      option.className = `font-size-option${size === currentSize ? ' selected' : ''}`;
      option.textContent = `${size}px`;
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        handleFontSizeChange(elements, size);
        toggleFontSizeMenu(elements, false);
      });
      elements.fontSizeMenu.appendChild(option);
    });
    console.log('[Sidebar] Initializing font size menu done.');
}

// Handle font size change
export async function handleFontSizeChange(elements, newSize) {
    if (!elements?.prose) return;
    
    // Update font size through Config
    const validSize = newSize;
    elements.prose.style.fontSize = `${validSize}px`;
    elements.prose.style.lineHeight = `calc(2.0rem * ${validSize}/16)`;
    
    // Update selected state in menu
    const options = elements.fontSizeMenu?.querySelectorAll('.font-size-option');
    options?.forEach((option) => {
      option.classList.toggle('selected', option.textContent === `${validSize}px`);
    });
}
  
// Toggle font size menu
export function toggleFontSizeMenu(elements, show) {
    if (!elements?.fontSizeMenu) return;
    elements.fontSizeMenu.classList.toggle('visible', show);
    // If showing menu, add click outside listener
    if (show) {
      setTimeout(() => {
        document.addEventListener('click', (e) => handleClickOutside(e, elements));
      }, 0);
    } else {
      document.removeEventListener('click', (e) => handleClickOutside(e, elements));
    }
}

export function updateAnalysisModeUi(elements, selectedVariant) {
    elements.analysisModeButtons?.forEach((button) => {
        const isSelected = button.dataset.promptVariant === selectedVariant;
        button.classList.toggle('selected', isSelected);
        button.setAttribute('aria-pressed', String(isSelected));
    });
}


export async function initializeAnalysisMode(elements) {
    const selectedVariant = await getPromptVariant();
    updateAnalysisModeUi(elements, selectedVariant);
}

export async function handleAnalysisModeChange(elements, variant) {
    const requestId = ++modeChangeRequestId;
    updateAnalysisModeUi(elements, variant);

    try {
        const currentVariant = await getPromptVariant();
        if (!isLatestModeChange(requestId)) return;

        if (variant === currentVariant) {
            updateAnalysisModeUi(elements, variant);
            return;
        }

        const selectedVariant = await setPromptVariant(variant);
        if (!isLatestModeChange(requestId)) return;

        updateAnalysisModeUi(elements, selectedVariant);
        updateAnalyzeAvailability();
    } catch (error) {
        if (!isLatestModeChange(requestId)) return;
        console.error('[Sidebar] Failed to change analysis mode:', error);
        alertMessage(elements.alertMessage, `切換分析模式失敗：${error.message}`, 'error');
        elements.alertMessage.classList.add('show');
    }
}

export function setSidepanelElementsForTesting(testElements) {
    elements = testElements;
}

export { handleSaveForLater, isValidSelection };

// DOM element references
let elements = null;

// Initialize DOM elements
async function initElements() {
  elements = {
    prose: document.querySelector('.prose'),
    themeToggle: document.querySelector('#themeToggle'),
    websiteButton: document.querySelector('#websiteButton'),
    faqButton: document.querySelector('#faqButton'),
    alertMessage: document.querySelector('#alertMessage'),
    copyButton: document.querySelector('.copy-button'),
    fontSizeBtn: document.querySelector('#fontSizeBtn'),
    fontSizeMenu: document.querySelector('#fontSizeMenu'),
    saveAsBtn: document.getElementById('saveAsBtn'),
    saveForLaterBtn: document.getElementById('saveForLaterBtn'),
    cancelAnalysisButton: document.getElementById('cancelAnalysisButton'),
    analyzeButton: document.getElementById('analyzeButton'),
    pendingSelectionStatus: document.getElementById('pendingSelectionStatus'),
    shareCheckbox: document.getElementById('shareCheckbox'),
    shareCheckboxContainer: document.getElementById('shareCheckboxContainer'),
    analysisModeButtons: document.querySelectorAll('.analysis-mode-option'),
    result: document.getElementById('result'),
    // Auth elements
    authSection: document.querySelector('#authSection'),
    authSignedOut: document.querySelector('#authSignedOut'),
    authSignedIn: document.querySelector('#authSignedIn'),
    signInBtn: document.querySelector('#signInBtn'),
    signOutBtn: document.querySelector('#signOutBtn'),
    userPhoto: document.querySelector('#userPhoto'),
    userDisplayName: document.querySelector('#userDisplayName'),
    userEmail: document.querySelector('#userEmail')
  };

  // Initialize font size
  await initializeFontSize(elements);
  await initializeAnalysisMode(elements);
  setCompletedAnalysisAvailable(false);

  return elements;
}

// Update UI based on authentication state
function updateAuthUI() {
    if (!elements) return;

    const user = authService.getUser();
    const isLoggedIn = authService.isLoggedIn();

    console.log('[Auth] Updating UI - Logged in:', isLoggedIn);

    if (isLoggedIn && user) {
        // Show signed-in state
        elements.authSignedOut.style.display = 'none';
        elements.authSignedIn.style.display = 'flex';
        
        // Update user info
        elements.userPhoto.src = user.photoURL || '';
        elements.userDisplayName.textContent = user.displayName || '';
        elements.userEmail.textContent = user.email || '';

        // Sign-in enables persistence capability, but never enables an
        // incomplete/old analysis while a personal stream is still running.
        if (elements.saveForLaterBtn) {
            elements.saveForLaterBtn.disabled = !hasCompletedAnalysis;
            elements.saveForLaterBtn.title = '儲存分析頁面';
        }

        // Enable share checkbox when logged in
        if (elements.shareCheckbox && elements.shareCheckboxContainer) {
            elements.shareCheckbox.disabled = false;
            elements.shareCheckboxContainer.classList.remove('disabled');
        }
    } else {
        // Show signed-out state
        elements.authSignedOut.style.display = 'flex';
        elements.authSignedIn.style.display = 'none';

        // P7.4: saveItems now requires an authenticated caller for BOTH
        // personal AND shared saves (previously shared saves were
        // unauthenticated). A signed-out save would always be rejected
        // server-side now, so disable the button here instead of letting the
        // user hit a failed save — with a title explaining why.
        if (elements.saveForLaterBtn) {
            elements.saveForLaterBtn.disabled = true;
            elements.saveForLaterBtn.title = '請先登入才能儲存或分享';
        }

        // Auto-check share checkbox when logged out (items will be saved as shared
        // once signed in). Left checked+disabled for continuity with the
        // signed-in default; the save button above is what actually gates the save.
        if (elements.shareCheckbox && elements.shareCheckboxContainer) {
            elements.shareCheckbox.checked = true;
            elements.shareCheckbox.disabled = true; // Cannot uncheck when not logged in
            elements.shareCheckboxContainer.classList.add('disabled');
        }
    }
}

// Handle sign-in button click
async function handleSignIn() {
    if (!elements?.signInBtn) return;

    // Disable button while signing in
    elements.signInBtn.disabled = true;

    try {
        console.log('[Sidepanel] Initiating sign-in...');
        const user = await authService.signInWithGoogle();
        console.log('[Sidepanel] Sign-in successful:', user.email);
        updateAuthUI();
        
        // Show success message
        alertMessage(elements.alertMessage, `歡迎回來，${user.displayName}！`, 'info');
        elements.alertMessage.classList.add('show');
        
        setTimeout(() => {
            elements.alertMessage.classList.remove('show');
        }, 3000);
    } catch (error) {
        console.error('[Sidepanel] Sign-in error:', error);
        alertMessage(elements.alertMessage, `登入失敗：${error.message}`, 'error');
        elements.alertMessage.classList.add('show');
    } finally {
        elements.signInBtn.disabled = false;
    }
}

// Handle sign-out button click
async function handleSignOut() {
    if (!elements?.signOutBtn) return;

    // Disable button while signing out
    elements.signOutBtn.disabled = true;

    try {
        console.log('[Auth] Initiating sign-out...');
        await authService.signOut();
        console.log('[Auth] Sign-out successful');
        updateAuthUI();
        
        // Show info message
        alertMessage(elements.alertMessage, '您已登出。', 'info');
        elements.alertMessage.classList.add('show');
        
        setTimeout(() => {
            elements.alertMessage.classList.remove('show');
        }, 3000);
    } catch (error) {
        console.error('[Auth] Sign-out error:', error);
        alertMessage(elements.alertMessage, `登出失敗：${error.message}`, 'error');
        elements.alertMessage.classList.add('show');
    } finally {
        elements.signOutBtn.disabled = false;
    }
}

// Set up event listeners
export async function setupEventListeners() {
    if (!elements) {
      console.log('[Sidebar] Initializing elements...');
      elements = await initElements();
    }

    // Theme toggle
    elements.themeToggle?.addEventListener('click', () => handleThemeToggle(elements));
    elements.websiteButton?.addEventListener('click', () => {
      void openExternalPage(WEBSITE_URL);
    });
    elements.faqButton?.addEventListener('click', () => {
      void openExternalPage(FAQ_URL);
    });

    elements.analysisModeButtons?.forEach((button) => {
      button.addEventListener('click', async () => {
        await handleAnalysisModeChange(elements, button.dataset.promptVariant);
      });
    });
    elements.cancelAnalysisButton?.addEventListener('click', () => {
      handleCancelAnalysis(elements);
    });
    elements.analyzeButton?.addEventListener('click', () => {
      void handleAnalyzePendingSelection();
    });
    // Font size button
    elements.fontSizeBtn?.addEventListener('click', e => {
      e.stopPropagation();
      const isVisible = elements.fontSizeMenu?.classList.contains('visible');
      toggleFontSizeMenu(elements, !isVisible);
    });

    // Save As button
    elements.saveAsBtn?.addEventListener('click', e => {
      e.stopPropagation();
      saveAsFile();
    });

    // Copy button for prose
    elements.copyButton?.addEventListener('click', async () => {
        if (!hasCompletedAnalysis) {
            alertMessage(elements.alertMessage, '請等待分析完成後再複製。', 'info');
            elements.alertMessage.classList.add('show');
            return;
        }
        try {
            const proseContent = getCompletedAnalysisResponse();
            await navigator.clipboard.writeText(proseContent);

            // Show check icon
            elements.copyButton.classList.add('copied');

            // Reset back to copy icon after 3 seconds
            setTimeout(() => {
                elements.copyButton.classList.remove('copied');
            }, 3000);
        } catch (error) {
            console.error('[Sidebar] Failed to copy text:', error);
        }
    });

    // Save For Later button
    elements.saveForLaterBtn?.addEventListener('click', async () => {
        await handleSaveForLater();
    });

    // Sign in button
    elements.signInBtn?.addEventListener('click', async () => {
        await handleSignIn();
    });

    // Sign out button
    elements.signOutBtn?.addEventListener('click', async () => {
        await handleSignOut();
    });
}

// Initialize theme
async function initializeTheme(elements) {
    const { themeToggle } = elements;
    if (!themeToggle) {
      console.error('[Sidebar] Theme toggle not found');
      return;
    }
  
    // Load default theme and apply immediately
    const savedTheme = 'light';
  
    // Apply theme immediately
    document.documentElement.setAttribute('data-theme', savedTheme);
    await updateThemeIcons(elements, savedTheme === 'dark');
}
  
  // Update theme icons
async function updateThemeIcons(elements, isDark) {
    const {
      themeToggle
    } = elements;
    if (!themeToggle) {
      console.error('[Sidebar] Theme toggle not found');
      return;
    }
    const sunIcon = themeToggle.querySelector('.sun-icon');
    const moonIcon = themeToggle.querySelector('.moon-icon');
    if (!sunIcon || !moonIcon) {
      console.error('[Sidebar] Theme icons not found:', {
        sunIcon: !!sunIcon,
        moonIcon: !!moonIcon
      });
      return;
    }
    sunIcon.style.display = isDark ? 'none' : 'block';
    moonIcon.style.display = isDark ? 'block' : 'none';
}
  
// Handle theme toggle click
async function handleThemeToggle(elements) {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
    document.documentElement.setAttribute('data-theme', newTheme);
    await updateThemeIcons(elements, newTheme === 'dark');
}

// Initialize everything when the document is ready
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize elements and event listeners
    await setupEventListeners();

    // Initialize theme
    await initializeTheme(elements);

    // Wait for authService to finish initializing
    console.log('[Sidepanel] Waiting for authService initialization...');
    await authService.init();
    console.log('[Sidepanel] AuthService initialized');

    // Initialize authentication state
    updateAuthUI();

    // Load selected text
    await loadSelectedText();
});
