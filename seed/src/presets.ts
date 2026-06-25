import { ALL_SCENARIOS } from './catalog/index.js';
import type { SeedScenario } from './catalog/types.js';

/**
 * Presets narrow the seed to a feature subset. `all` (the default) materializes
 * everything; named presets group the scenarios that demonstrate one capability,
 * so the seed stays runnable as the catalog grows. A scenario opts into a preset
 * via its `presets` field — `all` is implicit for every scenario.
 */
export const PRESET_DESCRIPTIONS: Record<string, string> = {
  all: 'Everything in the dictionary (default).',
  drive:
    'The deep Drive resource tree (folders, docs, drafts, versions, shortcut).',
  access: 'Two-user sharing: private / cohort-shared / space-published.',
  'knowledge-base': 'A tagged article slice surfaced as a KB grid.',
  board: 'Documents at workflow statuses on a gated review board.',
  shared: 'Cross-shared docs that fill "Shared with me" for both demo users.',
  hierarchy:
    'A reporting line: the manager sees a report’s private content (ADR-0008).',
  trash: 'The soft-delete lifecycle as standing demo content.',
};

/** All preset names, `all` first. */
export function presetNames(): string[] {
  const named = new Set<string>();
  for (const s of ALL_SCENARIOS) for (const p of s.presets) named.add(p);
  return ['all', ...[...named].sort()];
}

/** The scenarios a preset selects (in catalog order). */
export function scenariosForPreset(preset: string): SeedScenario[] {
  if (preset === 'all') return ALL_SCENARIOS;
  const selected = ALL_SCENARIOS.filter((s) => s.presets.includes(preset));
  if (selected.length === 0) {
    throw new Error(
      `Unknown preset "${preset}". Known: ${presetNames().join(', ')}`
    );
  }
  return selected;
}
