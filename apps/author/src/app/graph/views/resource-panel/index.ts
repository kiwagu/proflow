/**
 * ResourcePanel module — public surface. The node DETAIL panel shown when a node is
 * selected in the workbench (shared across lenses, not Drive-specific). Cross-module
 * imports go through this barrel; the section sub-components (access / description /
 * versions), the section-label primitive, and the fetch helper are internals.
 */
export { ResourcePanel } from './resource-panel';
export type { ResourcePanelProps, SelectedNode } from './resource-panel';
