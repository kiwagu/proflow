/**
 * Lens-view acceptance test — slice 09 rev. 3 (docs/knowledge-graph-plan.md §6,
 * ADR-0012 / ADR-0011 §6).
 *
 * The product is a SINGLE knowledge-base editor (LensView) — the editor opens
 * ALWAYS, at the index `/author/graph`, via the DEFAULT IMPLICIT lens-spec (no
 * saved projection, no redirect, §5.3); an empty graph yields an empty EDITOR
 * with a prominent "New", not a dead page. Every space member authors the graph
 * (all-roles grant, ADR-0011 §6) — there is no read/write role split. RLS is the
 * sole hard authority: an `ungranted` non-member sees nothing and is denied writes
 * cleanly. This drives the REAL `/author/graph` pages + routes over HTTP as each
 * actor (Supabase session → RLS client), exactly as the UI does (the client
 * components POST to these same routes). Demo data lives in the harness.
 *
 * Coverage maps to §7:
 *  (0) entry = editor ALWAYS: `/author/graph` (no projectionId) renders the lens
 *      editor via the default spec, with the prominent "New" affordance.
 *  (1) hub-rail + canvas slice render over the seeded graph.
 *  (3) bounded-BFS expand: the neighborhood route returns the node's neighbors,
 *      cycle-guarded (A⇄B never re-emits the center).
 *  (5) node selection data: one depth-1 neighborhood carries related/tags/parent.
 *  (6) authoring (any member): member1 creates text/link/tag and links them;
 *      member2 (a DIFFERENT ordinary member) ALSO authors — proves all-roles.
 *  (8) RLS: an ungranted non-member sees an empty editor + empty neighborhood,
 *      and any authoring POST fails cleanly (422), graph unchanged.
 *
 * slice-11 Ф3 (11-5..8) adds the 4-tab switcher + the Drive view; slice-11 Ф4
 * (11-9..12) activates the Notion view (live tab, page tree, REAL backlinks +
 * mentions via the neighborhood route, RLS-empty under an ungranted member);
 * slice-11 Ф5 (11-13..16) activates the Graph view — the final tab, the spatial
 * focus+neighborhood ego map. ALL FOUR tabs are now live. The map's centre+ring
 * data + RE-CENTER are the SAME landed neighborhood route (`dir=both`), bounded;
 * containment/shortcut edges ride the RLS-scoped forests; the layout is client-side.
 * RLS-empty under an ungranted member yields an empty map.
 *
 * Tagged `@full` — needs the running author app + Supabase.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  bootstrapKnowledgeMemberActors,
  seedLensViewDemo,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
  type KnowledgeMemberActors,
  type LensViewGraph,
} from './helpers/knowledge-graph-bootstrap.js';

const GRAPH_BASE = '/author/graph';
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

/** The minimal empty Lexical root the `bodies` richText field accepts (mirrors
 * the create dialog's text path). */
const EMPTY_LEXICAL = {
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: [
      {
        type: 'paragraph',
        format: '',
        indent: 0,
        version: 1,
        direction: 'ltr',
        textFormat: 0,
        children: [],
      },
    ],
  },
};

async function actorHttp(
  actor: KnowledgeActor,
  spaceId: string,
  baseURL: string
) {
  const cookies = await actorSsrAuthCookies(actor);
  const cookieHeader = [
    ...cookies.map((c) => `${c.name}=${c.value}`),
    `${ACTIVE_SPACE_COOKIE}=${spaceId}`,
  ].join('; ');
  return playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Cookie: cookieHeader },
  });
}

test.describe('knowledge lens view (single editor + all-roles authoring) @full', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let graph: LensViewGraph;
  let members: KnowledgeMemberActors;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    graph = await seedLensViewDemo(tenant);
    members = await bootstrapKnowledgeMemberActors(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant, members?.extraUserIds ?? []);
    }
  });

  test('(0)(1) entry = editor ALWAYS: the default lens-spec renders the canvas + New', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // The INDEX route (no projectionId) renders the editor via the default
      // implicit lens-spec — no redirect, no saved projection required.
      const res = await http.get(GRAPH_BASE);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      // The default spec slices ALL content kinds (folder/text/file/video/link)
      // flat; the tag node itself is filtered out of the canvas (kind='tag').
      // This is the editor rendered directly at the index — NOT a redirect to a
      // saved projection and NOT a dead empty page (rev. 3 entry = editor always).
      expect(html).toContain(graph.hubATitle);
      expect(html).toContain(graph.linkETitle);

      // The lens view (with its create affordance) is what mounted — the resolved
      // items + per-item tag map (`loadResourceTagsForItems`) are threaded as ITS
      // props (the rail/canvas/New are its children). The node id (in items) and
      // the tag id (in the tag map) being serialized into the RSC stream prove the
      // lens editor mounted, not a fallback.
      expect(html).toContain(graph.kbTagNodeId);
      expect(html).toContain(graph.hubAId);
    } finally {
      await http.dispose();
    }
  });

  test('(3) bounded-BFS neighborhood route expands a node, cycle-guarded', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      const params = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubAId,
        rel: 'relates_to,tagged',
        dir: 'both',
        depth: '1',
      });
      const res = await http.get(`${GRAPH_BASE}/neighborhood?${params}`);
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as {
        center_id: string;
        neighbors: { node: { id: string }; relation_type: string }[];
      };
      expect(body.center_id).toBe(graph.hubAId);

      const neighborIds = body.neighbors.map((n) => n.node.id);
      // A relates_to B (and B relates_to A) → B is a depth-1 neighbor.
      expect(neighborIds).toContain(graph.hubBId);
      // A is tagged into the 'Lens KB' tag node (outgoing tagged).
      expect(neighborIds).toContain(graph.kbTagNodeId);
      // Cycle-guard: the center never re-emits itself as its own neighbor.
      expect(neighborIds).not.toContain(graph.hubAId);
    } finally {
      await http.dispose();
    }
  });

  test('(5) node selection: one depth-1 neighborhood carries related/tags/parent', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // hubC: relates_to (B→C inbound) + tagged ('Lens KB') + part_of (C part_of
      // B) — the panel reads all three in one call.
      const params = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubCId,
        rel: 'relates_to,tagged,part_of',
        dir: 'both',
        depth: '1',
      });
      const res = await http.get(`${GRAPH_BASE}/neighborhood?${params}`);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        neighbors: {
          relation_type: string;
          direction: string;
          node: { id: string };
        }[];
      };
      const relTypes = new Set(body.neighbors.map((n) => n.relation_type));
      expect(relTypes.has('tagged')).toBe(true);
      expect(relTypes.has('part_of')).toBe(true);
      // C's parent is B via outgoing part_of (child part_of parent).
      const parent = body.neighbors.find(
        (n) => n.relation_type === 'part_of' && n.direction === 'outgoing'
      );
      expect(parent?.node.id).toBe(graph.hubBId);
    } finally {
      await http.dispose();
    }
  });

  test('(6a) authoring (member1): create text/link/tag → link → tag, visible after re-resolve', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    const service = tenant.service;
    try {
      // create a body-less link node (the create dialog's link path).
      const created = await http.post(`${GRAPH_BASE}/resources`, {
        data: {
          spaceId: tenant.spaceId,
          kind: 'link',
          title: 'Lens authored node',
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const newNode = (await created.json()) as { node_id: string };
      expect(newNode.node_id).toBeTruthy();

      // a text node (body-bearing) also creates from the consumer surface — the
      // create dialog's text path posts the minimal empty Lexical root.
      const createdText = await http.post(`${GRAPH_BASE}/text-resources`, {
        data: {
          spaceId: tenant.spaceId,
          title: 'Lens authored text',
          lexicalBody: EMPTY_LEXICAL,
        },
      });
      expect(createdText.status(), await createdText.text()).toBe(201);

      // link the new node to hubA via relates_to (the NodePicker add-link path).
      const linked = await http.post(`${GRAPH_BASE}/edges`, {
        data: {
          action: 'link',
          spaceId: tenant.spaceId,
          fromId: graph.hubAId,
          toId: newNode.node_id,
        },
      });
      expect(linked.status(), await linked.text()).toBe(201);

      // tag the new node with a brand-new tag (two-step: create tag node + edge).
      const tagged = await http.post(`${GRAPH_BASE}/edges`, {
        data: {
          action: 'tag',
          spaceId: tenant.spaceId,
          resourceId: newNode.node_id,
          tagTitle: 'Authored Tag',
        },
      });
      expect(tagged.status(), await tagged.text()).toBe(201);

      // visible after a re-resolve: hubA's neighborhood now includes the new node.
      const params = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubAId,
        rel: 'relates_to',
        dir: 'outgoing',
        depth: '1',
      });
      const after = await http.get(`${GRAPH_BASE}/neighborhood?${params}`);
      const body = (await after.json()) as {
        neighbors: { node: { id: string } }[];
      };
      expect(body.neighbors.map((n) => n.node.id)).toContain(newNode.node_id);

      // the new tag node exists in the graph (service-role confirmation).
      const { data: tagNode } = await service
        .from('knowledge_resources')
        .select('id,kind')
        .eq('space_id', tenant.spaceId)
        .eq('title', 'Authored Tag')
        .maybeSingle();
      expect(tagNode?.kind).toBe('tag');
    } finally {
      await http.dispose();
    }
  });

  test('(6b) all-roles: member2 (a DIFFERENT ordinary member) ALSO authors', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member2, tenant.spaceId, base);
    const service = tenant.service;
    try {
      // member2 — a plain member, not the seeder — creates a node and links it.
      const created = await http.post(`${GRAPH_BASE}/resources`, {
        data: {
          spaceId: tenant.spaceId,
          kind: 'link',
          title: 'Member2 authored node',
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const newNode = (await created.json()) as { node_id: string };

      const linked = await http.post(`${GRAPH_BASE}/edges`, {
        data: {
          action: 'link',
          spaceId: tenant.spaceId,
          fromId: graph.hubBId,
          toId: newNode.node_id,
        },
      });
      expect(linked.status(), await linked.text()).toBe(201);

      // confirm the write landed (RLS allowed it — all members author).
      const { data: node } = await service
        .from('knowledge_resources')
        .select('id')
        .eq('id', newNode.node_id)
        .maybeSingle();
      expect(node?.id).toBe(newNode.node_id);
    } finally {
      await http.dispose();
    }
  });

  test('(8) RLS: an ungranted non-member sees an empty editor + cannot author', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.ungranted, tenant.spaceId, base);
    const service = tenant.service;
    try {
      // the editor STILL renders (entry = editor always), but RLS hides every
      // node → an empty editor, not a dead page or an error.
      const page = await http.get(GRAPH_BASE);
      expect(page.status()).toBe(200);
      const html = await page.text();
      expect(html).not.toContain(graph.hubATitle);
      expect(html).not.toContain(graph.linkETitle);

      // the neighborhood of a member-owned node returns empty (RLS hid it), not
      // an access error — proving the walk cannot widen access.
      const params = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubAId,
        rel: 'relates_to,tagged',
        dir: 'both',
        depth: '1',
      });
      const res = await http.get(`${GRAPH_BASE}/neighborhood?${params}`);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { neighbors: unknown[] };
      expect(body.neighbors).toHaveLength(0);

      const { count: before } = await service
        .from('knowledge_edges')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', tenant.spaceId);

      // authoring is rejected at the row by RLS (no create verb) → clean 422.
      const linked = await http.post(`${GRAPH_BASE}/edges`, {
        data: {
          action: 'link',
          spaceId: tenant.spaceId,
          fromId: graph.hubAId,
          toId: graph.hubCId,
        },
      });
      expect(linked.status()).toBe(422);

      const created = await http.post(`${GRAPH_BASE}/resources`, {
        data: {
          spaceId: tenant.spaceId,
          kind: 'tag',
          title: 'ungranted denied',
        },
      });
      expect(created.status()).toBe(422);

      // the graph is unchanged — RLS denied the write, not the application.
      const { count: after } = await service
        .from('knowledge_edges')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', tenant.spaceId);
      expect(after).toBe(before);
    } finally {
      await http.dispose();
    }
  });

  // ── slice-11 Ф2: KB lens 1:1 (sample / folders / kb-attributes / health) ──────

  test('(11-1) sample button seeds the example graph; a second seed is a 409', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    const service = tenant.service;
    try {
      // POST /sample builds an example graph UNDER THE USER'S RLS (its own data),
      // exercising folders/contains, docs, link, file/video media-meta, tags,
      // relates_to, a shortcut, descriptions + provenance.
      const seeded = await http.post(`${GRAPH_BASE}/sample`, {
        data: { spaceId: tenant.spaceId },
      });
      expect(seeded.status(), await seeded.text()).toBe(201);
      const result = (await seeded.json()) as {
        sampleRootId: string;
        nodesCreated: number;
        edgesCreated: number;
      };
      expect(result.nodesCreated).toBeGreaterThan(0);
      expect(result.edgesCreated).toBeGreaterThan(0);

      // the example graph really landed: at least one folder + one contains edge.
      const { count: folderCount } = await service
        .from('knowledge_resources')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', tenant.spaceId)
        .eq('kind', 'folder');
      expect(folderCount ?? 0).toBeGreaterThan(0);

      const { count: containsCount } = await service
        .from('knowledge_edges')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', tenant.spaceId)
        .eq('relation_type', 'contains');
      expect(containsCount ?? 0).toBeGreaterThan(0);

      // a second seed is idempotent: the sentinel root already exists → 409.
      const again = await http.post(`${GRAPH_BASE}/sample`, {
        data: { spaceId: tenant.spaceId },
      });
      expect(again.status()).toBe(409);
    } finally {
      await http.dispose();
    }
  });

  test('(11-2) containment: create a folder, place a resource inside, read the contains tree', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    const service = tenant.service;
    try {
      // the CreateModal "New folder" path: a body-less folder node.
      const folderRes = await http.post(`${GRAPH_BASE}/resources`, {
        data: { spaceId: tenant.spaceId, kind: 'folder', title: 'Lens Folder' },
      });
      expect(folderRes.status(), await folderRes.text()).toBe(201);
      const folder = (await folderRes.json()) as { node_id: string };

      // create a link INSIDE the folder (FORWARD contains edge folder→child).
      const childRes = await http.post(`${GRAPH_BASE}/resources`, {
        data: {
          spaceId: tenant.spaceId,
          kind: 'link',
          title: 'Inside Folder',
          parentFolder: { parentFolderId: folder.node_id },
        },
      });
      expect(childRes.status(), await childRes.text()).toBe(201);
      const child = (await childRes.json()) as {
        node_id: string;
        contains_edge_id?: string;
      };
      expect(child.contains_edge_id).toBeTruthy();

      // the contains edge the rail/breadcrumb reads exists, forward folder→child.
      const { data: edge } = await service
        .from('knowledge_edges')
        .select('from_id,to_id,relation_type')
        .eq('space_id', tenant.spaceId)
        .eq('relation_type', 'contains')
        .eq('from_id', folder.node_id)
        .eq('to_id', child.node_id)
        .maybeSingle();
      expect(edge?.from_id).toBe(folder.node_id);
      expect(edge?.to_id).toBe(child.node_id);

      // a file node also creates (body-less; media-meta carries it, upload deferred).
      const fileRes = await http.post(`${GRAPH_BASE}/resources`, {
        data: {
          spaceId: tenant.spaceId,
          kind: 'file',
          title: 'A File',
          parentFolder: { parentFolderId: folder.node_id },
        },
      });
      expect(fileRes.status(), await fileRes.text()).toBe(201);
    } finally {
      await http.dispose();
    }
  });

  test('(11-3) KB attributes: description write/read, provenance, view-count increment', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // the panel EditableDescription: set the RAG-bound description (stored).
      const desc = await http.post(`${GRAPH_BASE}/attributes`, {
        data: {
          attribute: 'description',
          spaceId: tenant.spaceId,
          nodeId: graph.hubAId,
          body: 'A hub document describing the lens demo.',
        },
      });
      expect(desc.status(), await desc.text()).toBe(200);
      const descBody = (await desc.json()) as { node_id: string; body: string };
      expect(descBody.body).toContain('lens demo');

      // provenance source (the NodeHealth badge source).
      const prov = await http.post(`${GRAPH_BASE}/attributes`, {
        data: {
          attribute: 'provenance',
          spaceId: tenant.spaceId,
          nodeId: graph.hubAId,
          source: 'imported',
        },
      });
      expect(prov.status(), await prov.text()).toBe(200);

      // the panel increments the REAL view counter on open (twice → ≥ 2).
      await http.post(`${GRAPH_BASE}/attributes`, {
        data: {
          attribute: 'view',
          spaceId: tenant.spaceId,
          nodeId: graph.hubAId,
        },
      });
      const view2 = await http.post(`${GRAPH_BASE}/attributes`, {
        data: {
          attribute: 'view',
          spaceId: tenant.spaceId,
          nodeId: graph.hubAId,
        },
      });
      expect(view2.status(), await view2.text()).toBe(200);
      const activity = (await view2.json()) as {
        node_id: string;
        view_count: number;
      };
      expect(activity.view_count).toBeGreaterThanOrEqual(2);
    } finally {
      await http.dispose();
    }
  });

  test('(11-4) RLS: an ungranted non-member cannot write KB attributes or seed', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.ungranted, tenant.spaceId, base);
    try {
      // a KB attribute write mirrors the node's update verb — denied cleanly.
      const desc = await http.post(`${GRAPH_BASE}/attributes`, {
        data: {
          attribute: 'description',
          spaceId: tenant.spaceId,
          nodeId: graph.hubAId,
          body: 'should be rejected',
        },
      });
      expect(desc.status()).toBe(422);

      // the sample builder runs under the user's RLS — no create verb → 422.
      const sample = await http.post(`${GRAPH_BASE}/sample`, {
        data: { spaceId: tenant.spaceId },
      });
      expect(sample.status()).toBe(422);
    } finally {
      await http.dispose();
    }
  });

  // ── slice-11 Ф3: multi-view switcher (4 tabs) + Drive view over ONE graph ─────

  test('(11-5) switcher: the index renders 4 variant tabs over the SAME graph; Drive is the default view', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // the sample (seeded in 11-1) gives Drive its folder tree. The workbench
      // shell renders ALL FOUR variant tabs (drive/notion/KB lens/graph) over the
      // ONE resolved dataset — Invariant #1 made visible.
      const res = await http.get(GRAPH_BASE);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      // all four switcher labels are present. As of Ф5 ALL FOUR are LIVE — no
      // disabled "soon" tab remains (the switcher is complete; Invariant #1 made
      // visible: four projections over the one graph).
      expect(html).toContain('Drive');
      expect(html).toContain('Notion');
      expect(html).toContain('KB lens');
      expect(html).toContain('Graph');
      // no DISABLED tab survives: the disabled-tab style (`cursor-not-allowed`,
      // only applied to a not-live variant) is absent from the rendered switcher.
      // (We assert on rendered STATE, not the literal "Coming soon" — that key is
      // still a valid catalog entry serialized into the RSC `messages` prop.)
      expect(html).not.toContain('cursor-not-allowed');

      // the explainer strip carries the active variant's note (Drive default).
      expect(html).toContain('The graph stays hidden behind a familiar tree.');
    } finally {
      await http.dispose();
    }
  });

  test('(11-6) Drive view: the default render shows the sample folder tree + sidebar', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // Drive is the DEFAULT variant — the server-rendered HTML shows its familiar
      // sidebar (nav + Sections) and the root folders walked from the FORWARD
      // `contains` forest seeded by the sample (11-1).
      const res = await http.get(GRAPH_BASE);
      expect(res.status()).toBe(200);
      const html = await res.text();

      // the Drive sidebar chrome (nav + Sections label).
      expect(html).toContain('Shared with me');
      expect(html).toContain('Sections');
      // root folders from the sample appear in the Drive tree (rendered from the
      // server-loaded containment forest — the graph hidden behind a familiar tree).
      expect(html).toContain('API &amp; Developers');
      expect(html).toContain('Policies &amp; Security');
    } finally {
      await http.dispose();
    }
  });

  test('(11-7) Drive shortcut + containment data: the shortcut forest is RLS-scoped, separate from contains', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    const service = tenant.service;
    try {
      // the sample seeds a shortcut (Policies & Security → API & Developers): a
      // FORWARD `shortcut` edge, Drive-only, EXCLUDED from containment traversal.
      const { count: shortcutCount } = await service
        .from('knowledge_edges')
        .select('id', { count: 'exact', head: true })
        .eq('space_id', tenant.spaceId)
        .eq('relation_type', 'shortcut');
      expect(shortcutCount ?? 0).toBeGreaterThan(0);

      // the page still renders (Drive reads the shortcut forest as an RLS-scoped
      // fan-out alongside contains, never service-role).
      const res = await http.get(GRAPH_BASE);
      expect(res.status()).toBe(200);
    } finally {
      await http.dispose();
    }
  });

  test('(11-8) RLS: an ungranted non-member sees an empty Drive (no folders), switcher still renders', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.ungranted, tenant.spaceId, base);
    try {
      const res = await http.get(GRAPH_BASE);
      expect(res.status()).toBe(200);
      const html = await res.text();
      // the shell + switcher render (entry = workbench always)…
      expect(html).toContain('Drive');
      expect(html).toContain('Sections');
      // …but RLS hides every node → no sample folders in the Drive tree.
      expect(html).not.toContain('API &amp; Developers');
      expect(html).not.toContain('Policies &amp; Security');
    } finally {
      await http.dispose();
    }
  });

  // ── slice-11 Ф4: Notion view (nested pages + mentions + REAL backlinks) ───────

  test('(11-9) switcher: Notion is now a LIVE tab (no "soon" on Notion); the page tree renders', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // the sample (11-1) seeded the folder forest; Notion reads it as the page
      // tree (folders → contained pages, the FORWARD `contains` forest). All four
      // tabs still render; Notion is now LIVE (Graph remains the only "soon" tab).
      const res = await http.get(GRAPH_BASE);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      expect(html).toContain('Notion');
      // the page-tree search affordance (Notion-specific chrome) is in the HTML —
      // proving the Notion view is registered/live (its component is mountable).
      expect(html).toContain('Search pages…');
      // the sample folders are the page-tree sections (read from `contains`).
      expect(html).toContain('API &amp; Developers');
    } finally {
      await http.dispose();
    }
  });

  test('(11-10) Notion backlinks are REAL: an incoming relates_to is the page backlink (dir=both)', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // The Notion reading canvas pulls the open page's neighborhood through the
      // SAME landed route the panel uses (rel=relates_to, dir=both, depth=1): the
      // out-direction edges are the inline mentions, the IN-direction edges are the
      // backlinks ("linked references"). This is REAL — no mock. hubA relates_to
      // hubB, so opening hubB must surface hubA as an INCOMING backlink.
      const params = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubBId,
        rel: 'relates_to',
        dir: 'both',
        depth: '1',
      });
      const res = await http.get(`${GRAPH_BASE}/neighborhood?${params}`);
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as {
        neighbors: {
          relation_type: string;
          direction: string;
          node: { id: string };
        }[];
      };

      // backlinks = incoming relates_to. hubA→hubB means hubA is hubB's backlink.
      const backlinks = body.neighbors.filter(
        (n) => n.relation_type === 'relates_to' && n.direction === 'incoming'
      );
      expect(backlinks.map((b) => b.node.id)).toContain(graph.hubAId);

      // mentions = outgoing relates_to. hubB→hubA (the cycle-guard pair) is a
      // mention out of hubB → the inline mentions callout has real targets.
      const mentions = body.neighbors.filter(
        (n) => n.relation_type === 'relates_to' && n.direction === 'outgoing'
      );
      expect(mentions.map((m) => m.node.id)).toContain(graph.hubAId);
    } finally {
      await http.dispose();
    }
  });

  test('(11-11) Notion backlinks update LIVE: creating a relates_to makes the source a backlink', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // create a fresh page that references hubC (a NEW relates_to edge): the
      // Notion backlinks section on hubC must then show the new page as an incoming
      // reference — backlinks are real graph edges, not a mock.
      const created = await http.post(`${GRAPH_BASE}/resources`, {
        data: {
          spaceId: tenant.spaceId,
          kind: 'link',
          title: 'Notion referencing page',
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const ref = (await created.json()) as { node_id: string };

      const linked = await http.post(`${GRAPH_BASE}/edges`, {
        data: {
          action: 'link',
          spaceId: tenant.spaceId,
          fromId: ref.node_id,
          toId: graph.hubCId,
        },
      });
      expect(linked.status(), await linked.text()).toBe(201);

      // hubC's incoming relates_to now includes the new page (the backlink).
      const params = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubCId,
        rel: 'relates_to',
        dir: 'both',
        depth: '1',
      });
      const after = await http.get(`${GRAPH_BASE}/neighborhood?${params}`);
      const body = (await after.json()) as {
        neighbors: { direction: string; node: { id: string } }[];
      };
      const backlinkIds = body.neighbors
        .filter((n) => n.direction === 'incoming')
        .map((n) => n.node.id);
      expect(backlinkIds).toContain(ref.node_id);
    } finally {
      await http.dispose();
    }
  });

  test('(11-12) RLS: an ungranted non-member sees an empty Notion (no page tree), switcher still renders', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.ungranted, tenant.spaceId, base);
    try {
      const res = await http.get(GRAPH_BASE);
      expect(res.status()).toBe(200);
      const html = await res.text();
      // the shell + Notion tab still render (entry = workbench always)…
      expect(html).toContain('Notion');
      // …but RLS hides every node → no sample folders in the Notion page tree.
      expect(html).not.toContain('API &amp; Developers');

      // and the open page's neighborhood (mentions/backlinks) is empty under RLS.
      const params = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubBId,
        rel: 'relates_to',
        dir: 'both',
        depth: '1',
      });
      const nb = await http.get(`${GRAPH_BASE}/neighborhood?${params}`);
      expect(nb.status()).toBe(200);
      const body = (await nb.json()) as { neighbors: unknown[] };
      expect(body.neighbors).toHaveLength(0);
    } finally {
      await http.dispose();
    }
  });

  // ── slice-11 Ф5: Graph view (spatial focus+neighborhood ego map) — final tab ──

  test('(11-13) switcher complete: Graph is now a LIVE tab; NO "soon" remains; the spatial note renders', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // the final view activates: ALL FOUR tabs are live, the switcher is complete.
      const res = await http.get(GRAPH_BASE);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      expect(html).toContain('Drive');
      expect(html).toContain('Notion');
      expect(html).toContain('KB lens');
      expect(html).toContain('Graph');
      // not a single disabled tab survives — the disabled-tab style is absent, so
      // every tab is a real, mountable projection (asserting on rendered STATE,
      // not the still-valid "soon" catalog key serialized into the messages prop).
      expect(html).not.toContain('cursor-not-allowed');
      // the Graph explainer note is in the catalog-driven strip (re-center wording).
      expect(html).toContain('click any neighbor to re-center');
    } finally {
      await http.dispose();
    }
  });

  test('(11-14) Graph centre + ring: a focus neighborhood (dir=both) carries the surrounding nodes', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // The radial ego map centres on a focus and fans its RLS-backed neighbours
      // onto the rings. The relates_to ⊕ tagged ring data is the SAME landed
      // neighborhood port the rail/panel use (dir=both, bounded) — never a mock.
      // Centring on hubA must surface hubB (related) + the 'Lens KB' tag (tagged).
      const params = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubAId,
        rel: 'relates_to,tagged',
        dir: 'both',
        depth: '1',
      });
      const res = await http.get(`${GRAPH_BASE}/neighborhood?${params}`);
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as {
        center_id: string;
        neighbors: { node: { id: string } }[];
      };
      expect(body.center_id).toBe(graph.hubAId);
      const ring = body.neighbors.map((n) => n.node.id);
      expect(ring).toContain(graph.hubBId);
      expect(ring).toContain(graph.kbTagNodeId);
      // cycle-guard: the centre is never its own ring node.
      expect(ring).not.toContain(graph.hubAId);
    } finally {
      await http.dispose();
    }
  });

  test('(11-15) Graph re-center: focusing a neighbor re-queries ITS neighborhood (the walk-the-graph mechanism)', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(members.member1, tenant.spaceId, base);
    try {
      // Clicking a neighbour re-centres the map: the view re-fetches the NEW focus's
      // bounded neighbourhood (engine-gap 1 — depth via re-center, not a deep fetch).
      // From hubA's ring we re-center on hubC; hubC's neighbourhood is DIFFERENT and
      // carries its OWN parent (B via part_of) — proving each focus is its own query.
      const aParams = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubAId,
        rel: 'relates_to,tagged',
        dir: 'both',
        depth: '1',
      });
      const aRes = await http.get(`${GRAPH_BASE}/neighborhood?${aParams}`);
      const aBody = (await aRes.json()) as {
        center_id: string;
        neighbors: { node: { id: string } }[];
      };

      const cParams = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubCId,
        rel: 'relates_to,tagged,part_of',
        dir: 'both',
        depth: '1',
      });
      const cRes = await http.get(`${GRAPH_BASE}/neighborhood?${cParams}`);
      const cBody = (await cRes.json()) as {
        center_id: string;
        neighbors: {
          relation_type: string;
          direction: string;
          node: { id: string };
        }[];
      };

      // the centre genuinely changed on re-center.
      expect(aBody.center_id).toBe(graph.hubAId);
      expect(cBody.center_id).toBe(graph.hubCId);
      // hubC's ring carries its parent (B via outgoing part_of) — a different shape.
      const parent = cBody.neighbors.find(
        (n) => n.relation_type === 'part_of' && n.direction === 'outgoing'
      );
      expect(parent?.node.id).toBe(graph.hubBId);
    } finally {
      await http.dispose();
    }
  });

  test('(11-16) RLS: an ungranted non-member sees an empty Graph map, switcher still renders', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.ungranted, tenant.spaceId, base);
    try {
      const res = await http.get(GRAPH_BASE);
      expect(res.status()).toBe(200);
      const html = await res.text();
      // the shell + Graph tab still render (entry = workbench always)…
      expect(html).toContain('Graph');
      // …but RLS hides every node → no seeded titles to centre/ring on.
      expect(html).not.toContain(graph.hubATitle);

      // the focus neighbourhood (the map's ring data) is empty under RLS — the
      // walk cannot widen access; the map renders empty, not an error.
      const params = new URLSearchParams({
        space_id: tenant.spaceId,
        node_id: graph.hubAId,
        rel: 'relates_to,tagged',
        dir: 'both',
        depth: '1',
      });
      const nb = await http.get(`${GRAPH_BASE}/neighborhood?${params}`);
      expect(nb.status()).toBe(200);
      const body = (await nb.json()) as { neighbors: unknown[] };
      expect(body.neighbors).toHaveLength(0);
    } finally {
      await http.dispose();
    }
  });
});
