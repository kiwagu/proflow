/**
 * Entry used only by the esbuild step to produce a single ESM file for
 * Supabase Edge Functions (`_shared/notifications.bundle.mjs`).
 */
export { prepareAuthEmailFromGoTrueHook } from './email/gotrue.js';
export type { GoTrueSendEmailHookPayload } from './email/gotrue.js';
