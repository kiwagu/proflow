import { ACCESS_SCENARIO } from './access.js';
import { ADVANCED_SHARED_SCENARIO } from './advanced-shared.js';
import { BOARD_SCENARIO } from './board.js';
import { CONTAINMENT_INHERITANCE_SCENARIO } from './containment-inheritance.js';
import { DIRECTORY_PICKER_SCENARIO } from './directory-picker.js';
import {
  DRIVE_CASCADE_SCENARIO,
  DRIVE_COPY_CHAIN_SCENARIO,
  DRIVE_SCENARIO,
} from './drive.js';
import { DRIVE_SIZE_FILTER_SCENARIO } from './drive-size-filter.js';
import { HIERARCHY_SCENARIO } from './hierarchy.js';
import { KNOWLEDGE_BASE_SCENARIO } from './knowledge-base.js';
import { PER_USER_SHARE_SCENARIO } from './per-user-share.js';
import { SHARE_MECHANISM_SCENARIO } from './share-mechanism.js';
import { SHARED_SCENARIO } from './shared.js';
import { TRASH_SCENARIO } from './trash.js';
import type { SeedScenario } from './types.js';

/**
 * Every scenario the CLI seeds, in materialization order. The `drive-cascade` /
 * `drive-copy-chain` / `drive-size-filter` fixtures are deliberately ABSENT: they
 * are e2e-only shapes (a multi-parent folder, a copy chain, a known-byte-size tree)
 * that the specs materialize directly via `materializeFixture`, NOT demo content —
 * seeding them pollutes the demo Drive (the multi-parent node trips the workbench's
 * key-by-node-id list rendering; the size fixture is contrived byte-count files).
 */
export const ALL_SCENARIOS: SeedScenario[] = [
  DRIVE_SCENARIO,
  ACCESS_SCENARIO,
  KNOWLEDGE_BASE_SCENARIO,
  BOARD_SCENARIO,
  TRASH_SCENARIO,
  SHARED_SCENARIO,
  SHARE_MECHANISM_SCENARIO,
  ADVANCED_SHARED_SCENARIO,
  HIERARCHY_SCENARIO,
  PER_USER_SHARE_SCENARIO,
  DIRECTORY_PICKER_SCENARIO,
  CONTAINMENT_INHERITANCE_SCENARIO,
];

export {
  ACCESS_SCENARIO,
  ADVANCED_SHARED_SCENARIO,
  BOARD_SCENARIO,
  CONTAINMENT_INHERITANCE_SCENARIO,
  DIRECTORY_PICKER_SCENARIO,
  DRIVE_CASCADE_SCENARIO,
  DRIVE_COPY_CHAIN_SCENARIO,
  DRIVE_SCENARIO,
  DRIVE_SIZE_FILTER_SCENARIO,
  HIERARCHY_SCENARIO,
  KNOWLEDGE_BASE_SCENARIO,
  PER_USER_SHARE_SCENARIO,
  SHARE_MECHANISM_SCENARIO,
  SHARED_SCENARIO,
  TRASH_SCENARIO,
};
export {
  SIZE_FILTER_BYTES,
  SIZE_FILTER_FOLDER_SUM,
} from './drive-size-filter.js';
export { DIRECTORY_PICKER_DISPLAY_NAMES } from './directory-picker.js';
export { buildKnowledgeBaseSpec } from './knowledge-base.js';
export { buildBoardSpec } from './board.js';
export { lexicalDoc, prose, type LexicalBlock } from './lexical.js';
export {
  materializeScenario,
  type MaterializeDeps,
  type MaterializedScenario,
} from './materialize.js';
export { validateCatalog, validateScenario } from './validate.js';
export type * from './types.js';
