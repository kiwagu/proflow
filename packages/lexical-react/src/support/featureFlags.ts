/**
 * Feature flags.
 *
 * The tree these came from resolves them through a remote flag service. Here
 * they are constants: a local-first app has no one to ask, and a flag whose
 * value can never change at runtime is more honestly a constant than a lookup
 * that always returns the same thing.
 */

/** Index document text so it can be searched. */
export const ENABLE_MARKDOWN_SEARCH_TEXT = true;

/** Report mentions to a backend that would count them. There is none. */
export const ENABLE_MENTION_TRACKING = false;

/** Render SVG attachments inline. */
export const ENABLE_SVG_PREVIEW = true;

/** Show time-to-first-token timing in dev builds. */
export const ENABLE_TTFT = false;

/** Whether this build targets a development backend. There is no backend. */
export const DEV_MODE_ENV = false;

/** Comment threads on document text. Not part of the local editor. */
export const ENABLE_MARKDOWN_COMMENTS = false;

/**
 * Inline AI editing from the selection popup. The flag name and override
 * keep the popup's gating code intact; the editing session runs in the
 * agent worker, so the override is on.
 */
export const INLINE_AI_EDITING_FLAG = 'inline-ai-editing';
export const INLINE_AI_EDITING_OVERRIDE: boolean | undefined = true;
