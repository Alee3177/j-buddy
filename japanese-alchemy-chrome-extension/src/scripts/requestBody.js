/**
 * Pure builder for the explain request body, shared by the streaming and callable
 * API methods in jaAlchemyApiService. Extracted into its own module so the
 * body-construction logic is unit-testable without importing the firebase-backed
 * service module.
 *
 * context_before / context_after are included only when non-empty, so the
 * no-context request body is identical to today's shape (backward compatible).
 *
 * @param {string} content - the selected text (analysis target)
 * @param {string} promptVersion - "v1" | "v2"
 * @param {{ before?: string, after?: string }} [context]
 * @param {"natural"|"news"|"business"} [translationStyle] - P8-C2: only affects
 *   zh/en source text that goes through translation; omitted entirely when not
 *   provided so the server's own "natural" default applies (backward compatible
 *   request shape when a caller doesn't pass one).
 * @returns {{ content: string, prompt: string, context_before?: string, context_after?: string, translationStyle?: string }}
 */
export function buildRequestBody(content, promptVersion, context, translationStyle) {
  const body = { content, prompt: promptVersion || 'v2' };
  const before = context && context.before;
  const after = context && context.after;
  if (before) body.context_before = before;
  if (after) body.context_after = after;
  if (translationStyle) body.translationStyle = translationStyle;
  return body;
}
