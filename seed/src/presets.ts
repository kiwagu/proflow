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
  'per-user-share':
    'Per-person sharing: a private doc granted to one named member (ADR-0019) — grantee sees it in "Shared with me" (`shared`), the owner sees it in "Shared by me" (`shared-by-me`, a SharedByMeEntry over the same grant — ADR-0021 Part B), third member blind. Named co-members feed the Share people-picker directory (ADR-0020), and a ten-member cohort exercises the paginated directory-v2 picker — page of 5 + "+N more" + keyset "Show more", owner/granted excluded (ADR-0021 Part A).',
  'knowledge-base': 'A tagged article slice surfaced as a KB grid.',
  search:
    'The lexical-search corpus (ADR-0024): a multi-locale match set (Cyrillic `Договор аренды`, accented `Égérie`, English `Getting Started`, the Phase-2 typo target `Привет команде`) plus the RLS-absence proof — another user’s PRIVATE node (absent from a non-grantee’s search) and an ancestor-shared child (present for the grantee via the inherited-grant disjunct).',
  board: 'Documents at workflow statuses on a gated review board.',
  shared:
    'Cross-shared docs that fill "Shared with me" for both demo users, plus the mechanism-distinction fixture — one viewer sees four nodes one per access mechanism (personal / cohort / broadcast + a both-granted precedence winner, ADR-0021 Part C) — plus the advanced-shared structural-view fixture: a shared folder ⊃ a shared doc (nests in the tree) + a doc whose parent is private (orphan-at-root), the same set the tariff-gated ADVANCED (tree) layout renders over the flat digest (ADR-0022) — plus the containment-inheritance fixture: sharing a folder makes its OWNER-SCOPED descendants readable (live, additive-OR, across per-user/cohort/floor), but never a third party’s nested node even under an admin’s folder-share (ADR-0023).',
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
