import { ACCESS_SCENARIO } from './access.js';
import { BOARD_SCENARIO } from './board.js';
import {
  DRIVE_CASCADE_SCENARIO,
  DRIVE_COPY_CHAIN_SCENARIO,
  DRIVE_SCENARIO,
} from './drive.js';
import { HIERARCHY_SCENARIO } from './hierarchy.js';
import { KNOWLEDGE_BASE_SCENARIO } from './knowledge-base.js';
import { SHARED_SCENARIO } from './shared.js';
import { TRASH_SCENARIO } from './trash.js';
import type { SeedScenario } from './types.js';

/**
 * Every scenario the CLI seeds, in materialization order. The `drive-cascade` /
 * `drive-copy-chain` fixtures are deliberately ABSENT: they are e2e-only shapes
 * (a multi-parent folder, a copy chain) that the specs materialize directly via
 * `materializeFixture`, NOT demo content — seeding them pollutes the demo Drive and
 * the multi-parent node trips the workbench's key-by-node-id list rendering.
 */
export const ALL_SCENARIOS: SeedScenario[] = [
  DRIVE_SCENARIO,
  ACCESS_SCENARIO,
  KNOWLEDGE_BASE_SCENARIO,
  BOARD_SCENARIO,
  TRASH_SCENARIO,
  SHARED_SCENARIO,
  HIERARCHY_SCENARIO,
];

export {
  ACCESS_SCENARIO,
  BOARD_SCENARIO,
  DRIVE_CASCADE_SCENARIO,
  DRIVE_COPY_CHAIN_SCENARIO,
  DRIVE_SCENARIO,
  HIERARCHY_SCENARIO,
  KNOWLEDGE_BASE_SCENARIO,
  SHARED_SCENARIO,
  TRASH_SCENARIO,
};
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
