import { isAllowedMediaMime } from '@workspace/knowledge-contracts';

import type { SeedNode, SeedScenario } from './types.js';

/**
 * Offline catalog validation — pure, no DB. Catches the authoring mistakes that
 * would otherwise only surface against the live stack: duplicate/empty refs,
 * cross-references that point at nothing (owner/scope/tag/actor/node), invalid
 * presets, and malformed Lexical bodies. Runs in `bun run test:vitest` (CI) over
 * `ALL_SCENARIOS`, and as a fast fail-first gate in the CLI before any endpoint call.
 */

/** Actor refs the materializer always provides: `admin` → tenant.granted (the `admin`
 * role, all knowledge verbs) and `viewer` → tenant.member (the `member` role, read +
 * create — authors its OWN content). NOTE: `viewer` is the member actor, NOT the
 * verb-less `tenant.ungranted` negative actor (which has no catalog ref). */
export const BUILTIN_ACTOR_REFS = ['admin', 'viewer'] as const;

function collectNodes(nodes: SeedNode[]): SeedNode[] {
  const out: SeedNode[] = [];
  const walk = (ns: SeedNode[]): void => {
    for (const n of ns) {
      out.push(n);
      if (n.kind === 'folder') walk(n.children ?? []);
    }
  };
  walk(nodes);
  return out;
}

function isLexical(body: unknown): boolean {
  return (
    !!body &&
    typeof body === 'object' &&
    'root' in (body as Record<string, unknown>)
  );
}

/** Return a list of human-readable problems for one scenario ([] = valid). */
export function validateScenario(s: SeedScenario): string[] {
  const errors: string[] = [];
  const fail = (msg: string): void => {
    errors.push(`[${s.id || '?'}] ${msg}`);
  };

  if (!s.id) fail('scenario has an empty id');
  if (!s.summary) fail('scenario has an empty summary');
  if (!Array.isArray(s.presets) || s.presets.length === 0) {
    fail('presets must be a non-empty array');
  }

  // Actors known to this scenario (built-ins + declared).
  const actors = new Set<string>([
    ...BUILTIN_ACTOR_REFS,
    ...(s.actors ?? []).map((a) => a.ref),
  ]);
  const actorOk = (ref: string, where: string): void => {
    if (!actors.has(ref)) fail(`${where}: unknown actor "${ref}"`);
  };

  const scopes = new Set((s.scopes ?? []).map((sc) => sc.ref));

  // Nodes: ref uniqueness + per-node cross-refs.
  const nodes = collectNodes(s.tree);
  const nodeRefs = new Set<string>();
  for (const n of nodes) {
    if (!n.ref) fail('a node has an empty ref');
    else if (nodeRefs.has(n.ref)) fail(`duplicate node ref "${n.ref}"`);
    nodeRefs.add(n.ref);
    if (!n.title) fail(`node "${n.ref}" has an empty title`);
    if (n.owner) actorOk(n.owner, `node "${n.ref}" owner`);
    for (const sc of n.scopes ?? []) {
      if (!scopes.has(sc))
        fail(`node "${n.ref}" scope "${sc}" is not declared`);
    }
    for (const a of n.starredBy ?? []) actorOk(a, `node "${n.ref}" starredBy`);
    for (const a of n.openedBy ?? []) actorOk(a, `node "${n.ref}" openedBy`);
    for (const a of n.userGrants ?? [])
      actorOk(a, `node "${n.ref}" userGrants`);
    for (const t of n.tags ?? []) {
      if (!t) fail(`node "${n.ref}" has an empty tag title`);
    }
    if (n.kind === 'text') {
      if (n.body !== undefined && !isLexical(n.body)) {
        fail(
          `node "${n.ref}" body is not a Lexical doc (use prose/lexicalDoc)`
        );
      }
      for (const rev of n.revisions ?? []) {
        if (!isLexical(rev)) fail(`node "${n.ref}" has a non-Lexical revision`);
      }
    }
    // Media payload (ADR-0026): only file/video carry bytes; the declared mime must
    // pass the same denylist gate the upload authorizer enforces, else the live
    // upload would 400 — catch it offline.
    if (n.kind === 'file' || n.kind === 'video') {
      const media = n.media;
      if (media) {
        if (!media.bytes) fail(`node "${n.ref}" media has empty bytes`);
        if (
          media.encoding !== undefined &&
          media.encoding !== 'utf8' &&
          media.encoding !== 'base64'
        ) {
          fail(
            `node "${n.ref}" media encoding "${media.encoding}" is invalid (utf8 | base64)`
          );
        }
        if (!media.filename)
          fail(`node "${n.ref}" media has an empty filename`);
        if (!media.mimeType) {
          fail(`node "${n.ref}" media has an empty mimeType`);
        } else if (!isAllowedMediaMime(media.mimeType)) {
          fail(
            `node "${n.ref}" media mimeType "${media.mimeType}" is not allowed (in the denylist)`
          );
        }
      }
    } else if ('media' in n && n.media) {
      fail(`node "${n.ref}" (kind "${n.kind}") cannot carry a media payload`);
    }
  }
  const nodeOk = (ref: string, where: string): void => {
    if (!nodeRefs.has(ref)) fail(`${where}: unknown node ref "${ref}"`);
  };

  // Actor display names (ADR-0020 directory): if declared, must be non-empty so the
  // co-member directory resolves a real name rather than the email/short-id fallback.
  for (const a of s.actors ?? []) {
    if (a.displayName !== undefined && a.displayName.trim() === '') {
      fail(`actor "${a.ref}" has an empty displayName`);
    }
  }

  // Scope memberships + reporting lines.
  for (const sc of s.scopes ?? []) {
    if (!sc.ref) fail('a scope has an empty ref');
    for (const m of sc.members ?? []) actorOk(m, `scope "${sc.ref}" member`);
  }
  for (const l of s.reportingLines ?? []) {
    actorOk(l.manager, 'reportingLine manager');
    actorOk(l.subordinate, 'reportingLine subordinate');
  }

  // Edge-like references resolve to a node ref in the tree.
  for (const c of s.contains ?? []) {
    nodeOk(c.folder, 'contains.folder');
    nodeOk(c.child, 'contains.child');
    if (c.by) actorOk(c.by, 'contains.by');
  }
  for (const sh of s.shortcuts ?? []) {
    nodeOk(sh.folder, 'shortcut.folder');
    nodeOk(sh.target, 'shortcut.target');
  }
  for (const ed of s.edges ?? []) {
    nodeOk(ed.from, 'edge.from');
    nodeOk(ed.to, 'edge.to');
    if (!ed.relation) fail('an edge has an empty relation type');
  }
  for (const tr of s.trash ?? []) nodeOk(tr, 'trash');

  // Projections.
  for (const p of s.projections ?? []) {
    if (!p.ref) fail('a projection has an empty ref');
    if (!p.name) fail(`projection "${p.ref}" has an empty name`);
    if (!p.view) fail(`projection "${p.ref}" has an empty view`);
    if (typeof p.spec !== 'function') {
      fail(`projection "${p.ref}" spec must be a builder function`);
    }
    if (p.owner) actorOk(p.owner, `projection "${p.ref}" owner`);
  }

  return errors;
}

/** Validate a whole catalog; returns the flattened problem list ([] = valid). */
export function validateCatalog(scenarios: SeedScenario[]): string[] {
  return scenarios.flatMap(validateScenario);
}
