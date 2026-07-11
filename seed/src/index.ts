/**
 * `@workspace/seed` — the shared seed/demo/dictionary engine. The CLI (`src/cli.ts`)
 * populates a tenant from this; `@workspace/e2e` imports the SAME catalog + engine
 * so the database seed and the tests speak one create-vocabulary.
 */
export * from './engine/index.js';
export * from './catalog/index.js';
export {
  PRESET_DESCRIPTIONS,
  presetNames,
  scenariosForPreset,
} from './presets.js';
