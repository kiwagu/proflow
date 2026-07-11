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
    'The deep Drive resource tree (folders, docs, drafts, versions, shortcut). The `drive` + `media` presets also tag the e2e-only `drive-size-filter` fixture (ABSENT from the demo seed): a known-byte-size tree for the cross-lens "Only files" (uploaded-artifacts) filter + the list Size column — a media branch (a 512 B file + a 512 B video → the folder sums to 1 KB) beside a media-less branch + loose text/link leaves, plus two loose leaves sharing a `Falcon` title token (a real file + a plain text node) for the SEARCH-lens "Only files" variant — materialized directly by `knowledge-drive-size-filter.e2e.spec.ts` (Drive lenses) and `knowledge-search-size-filter.e2e.spec.ts` (Search lens). It ALSO tags the e2e-only `bulk-actions` fixture (release-hardening B2, likewise ABSENT from the demo seed): a folder of four selectable content siblings (for the multi-select bulk action bar — bulk Trash / Star / Move + SHIFT-range) beside two pre-trashed docs (for bulk Restore + Empty Trash), materialized directly by `knowledge-bulk-actions.e2e.spec.ts`.',
  access: 'Two-user sharing: private / cohort-shared / space-published.',
  'per-user-share':
    'Per-person sharing: a private doc granted to one named member — grantee sees it in "Shared with me" (`shared`), the owner sees it in "Shared by me" (`shared-by-me`, a SharedByMeEntry over the same grant), third member blind. Named co-members feed the Share people-picker directory, and a ten-member cohort exercises the paginated directory-v2 picker — page of 5 + "+N more" + keyset "Show more", owner/granted excluded.',
  'knowledge-base': 'A tagged article slice surfaced as a KB grid.',
  media:
    'The KB media substrate: real `file`/`video` nodes whose bytes travel the product’s signed-upload transport into the private `kb-media` bucket (a `kmm` satellite + a bucket object both exist), a PRIVATE file owned by another user (the download RLS-negative), a file nested under an ancestor-shared folder (inherited-grant download positive), and a file per-user-granted to a node-only member without space-wide update (the read/write asymmetry — the read-grant allows download, but the write fence blocks upload). Bytes egress ONLY via short-lived signed URLs; `storage.objects` SELECT + satellite RLS is the read fence, and the WRITE fence composes NO grants (owner-or-space-update only, so a read-grantee cannot overwrite bytes). Purging a confirmed media node from Trash best-effort reaps its `kb-media` object under the caller’s RLS (a real confirmed file is reserved for the trash → purge lifecycle).',
  search:
    'The lexical-search corpus: a multi-locale match set (Cyrillic `Договор аренды`, accented `Égérie`, English `Getting Started`, the Phase-2 typo target `Привет команде`) plus the RLS-absence proof — another user’s PRIVATE node (absent from a non-grantee’s search) and an ancestor-shared child (present for the grantee via the inherited-grant disjunct) — plus a six-level-deep folder chain (`Level One`…`Level Five` ⊃ the `abyssal` leaf) for the Pro-gated ADVANCED (`?view=advanced`) deep-tree lens: the matched leaf rendered in its fully-expanded ancestor tree at unbounded depth.',
  board: 'Documents at workflow statuses on a gated review board.',
  status:
    'The resource WORKFLOW lifecycle (B1): one folder of three content docs, one per state — draft, active, archived — each written through the product’s own `PATCH /author/graph/status` route at seed time (a text doc is born `active`, so the state is set explicitly). Drives the ResourcePanel status transition control (a SegmentedControl) and the Drive status facet (`graph.lens.filterStatus`, shown when ≥2 distinct content statuses are present). Also rides the `drive` preset so the demo Drive shows a live status facet.',
  shared:
    'Cross-shared docs that fill "Shared with me" for both demo users, plus the mechanism-distinction fixture — one viewer sees four nodes one per access mechanism (personal / cohort / broadcast + a both-granted precedence winner) — plus the advanced-shared structural-view fixture: a shared folder ⊃ a shared doc (nests in the tree) + a doc whose parent is private (orphan-at-root), the same set the tariff-gated ADVANCED (tree) layout renders over the flat digest — plus the containment-inheritance fixture: sharing a folder makes its OWNER-SCOPED descendants readable (live, additive-OR, across per-user/cohort/floor), but never a third party’s nested node even under an admin’s folder-share.',
  hierarchy: 'A reporting line: the manager sees a report’s private content.',
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
