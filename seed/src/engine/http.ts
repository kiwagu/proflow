/**
 * The `/author/graph/*` write surface as typed wrappers — the ONE place that
 * knows each endpoint's request/response contract. Both the seed CLI and the e2e
 * specs build their trees through these, so the create-vocabulary can never drift
 * between the demo database and the tests.
 *
 * Transport-agnostic: a `SeedFetcher` is any object that can POST/GET/PATCH/DELETE
 * JSON. The CLI uses `fetchFetcher` (plain `fetch`); the e2e harness adapts
 * Playwright's `APIRequestContext`. RLS is the sole authority — the fetcher must
 * already carry an actor's auth cookies (see `actorCookieHeader`).
 */

export type SeedResponse = { status: number; body: unknown };

export type SeedFetcher = {
  post(path: string, body: unknown): Promise<SeedResponse>;
  get(path: string): Promise<SeedResponse>;
  patch(path: string, body: unknown): Promise<SeedResponse>;
  del(path: string, body?: unknown): Promise<SeedResponse>;
  dispose(): Promise<void>;
};

/** A `fetch`-backed fetcher for the CLI. `cookie` carries the actor's session. */
export function fetchFetcher(opts: {
  baseUrl: string;
  cookie?: string;
}): SeedFetcher {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts.cookie) headers.cookie = opts.cookie;

  async function req(
    method: string,
    path: string,
    body?: unknown
  ): Promise<SeedResponse> {
    const res = await fetch(new URL(path, opts.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  }

  return {
    post: (p, b) => req('POST', p, b),
    get: (p) => req('GET', p),
    patch: (p, b) => req('PATCH', p, b),
    del: (p, b) => req('DELETE', p, b),
    dispose: async () => {},
  };
}

function expectStatus(
  res: SeedResponse,
  want: number,
  context: string
): unknown {
  if (res.status !== want) {
    throw new Error(
      `${context}: expected ${want}, got ${res.status} — ${JSON.stringify(res.body)}`
    );
  }
  return res.body;
}

export type NodeKind = 'folder' | 'link' | 'tag' | 'file' | 'video';
export type Floor = 'private' | 'space' | 'organization';

export type TextResourceResult = {
  nodeId: string;
  docId: string;
};

export type CopyResult = { nodeId: string; count: number };
export type PurgeResult = { purged: string[]; reason?: string };

/** One grantable co-member as the Share dialog people-picker reads it (ADR-0019/0020):
 * `displayName` + `email` resolved via the co-member directory (`email` may be null). */
export type GrantableMember = {
  userId: string;
  displayName: string;
  email: string | null;
};

/** One per-user grant row as the "who has access" list reads it (ADR-0019/0020):
 * the grantee with a directory-resolved `displayName` + `email`. */
export type UserGrant = {
  userId: string;
  displayName: string;
  email: string | null;
  grantedBy: string;
};

/** ONE keyset page of the grantable-member people-picker (ADR-0021 Part A). The
 * directory pages a keyset cursor over the stable `coalesce(display_name,email) asc,
 * user_id asc` order with the owner + already-granted removed server-side (`p_exclude`),
 * so `items` is a page of REAL grantable candidates, `total` is the count of grantable
 * matches for the query (across all pages → the picker's "+N more"), and `nextCursor` is
 * an OPAQUE token to fetch the next page (`null` on the last page; re-sent as `cursor`). */
export type GrantableMembersPage = {
  items: GrantableMember[];
  nextCursor: string | null;
  total: number;
};

/** The `/author/graph/visibility` GET projection — the Share dialog's whole audience:
 * the broadcast floor, the cohort `choices`, the per-user `grants` ("who has access"),
 * and the searchable, paginated `members` people-picker page (ADR-0020 + ADR-0021). */
export type Visibility = {
  choices: { id: string; name: string; linked: boolean }[];
  floor: Floor;
  grants: UserGrant[];
  members: GrantableMembersPage;
};

/**
 * A `SeedFetcher` enriched with one method per `/author/graph/*` write — the
 * shared create-vocabulary. Raw `post/get/patch/del` stay exposed for negative /
 * edge-case assertions in the specs.
 */
export type SeedClient = SeedFetcher & {
  createFolder(
    spaceId: string,
    title: string,
    parentFolderId?: string
  ): Promise<string>;
  createNode(
    spaceId: string,
    kind: NodeKind,
    title: string,
    parentFolderId?: string
  ): Promise<string>;
  createDoc(
    spaceId: string,
    title: string,
    opts?: { parentFolderId?: string; lexicalBody?: unknown }
  ): Promise<TextResourceResult>;
  publishDoc(spaceId: string, nodeId: string): Promise<void>;
  /** Save a NEW published body version (repeat to build version history). */
  saveRevision(
    spaceId: string,
    nodeId: string,
    lexicalBody: unknown
  ): Promise<void>;
  /** Record a per-user "open" → the node lands in this actor's "Recent" lens. */
  open(spaceId: string, nodeId: string): Promise<void>;
  rename(spaceId: string, resourceId: string, title: string): Promise<void>;
  describe(spaceId: string, nodeId: string, body: string): Promise<void>;
  contain(
    spaceId: string,
    folderId: string,
    childId: string,
    position?: number
  ): Promise<void>;
  shortcut(
    spaceId: string,
    folderId: string,
    targetId: string,
    position?: number
  ): Promise<void>;
  tag(
    spaceId: string,
    resourceId: string,
    tag: { tagId?: string; tagTitle?: string }
  ): Promise<unknown>;
  relate(
    spaceId: string,
    fromId: string,
    toId: string,
    position?: number
  ): Promise<void>;
  copy(
    spaceId: string,
    sourceId: string,
    opts?: { targetFolderId?: string | null; rootTitle?: string }
  ): Promise<CopyResult>;
  trash(spaceId: string, resourceId: string): Promise<void>;
  restore(spaceId: string, resourceId: string): Promise<void>;
  purge(spaceId: string, resourceId: string): Promise<PurgeResult>;
  setFloor(resourceId: string, visibility: Floor): Promise<void>;
  /** Read a node's Share-dialog audience (ADR-0019/0020/0021): the floor, cohort choices,
   * the per-user `grants` ("who has access"), and the searchable, PAGINATED `members`
   * people-picker page. `query` narrows the directory server-side (`?q=`); `cursor` is the
   * opaque keyset token from a prior page's `nextCursor` (omit for page 1); `limit` overrides
   * the default page size of 5 (clamped ≤50 server-side). Driven AS the caller — the
   * co-member directory is fenced to the caller's own active membership (a non-member gets an
   * empty page). The owner + already-granted are excluded from the page AND the `total`. */
  visibility(
    spaceId: string,
    nodeId: string,
    opts?: { query?: string; cursor?: string; limit?: number }
  ): Promise<Visibility>;
  linkScope(resourceId: string, scopeId: string): Promise<void>;
  /** Share a resource to ONE person — a per-user grant that widens that user's
   * READ access (ADR-0019). Owner-sovereign or `space.knowledge.access`; the
   * grantee must be an active member of the resource's space. */
  grantUser(resourceId: string, userId: string): Promise<void>;
  /** Revoke a per-user grant (ADR-0019) — symmetric to `grantUser`. Narrows that
   * user's READ access back, non-destructively (the node returns to owner-only when
   * it was the sole widening disjunct). Owner-sovereign or `space.knowledge.access`. */
  revokeUser(resourceId: string, userId: string): Promise<void>;
  star(spaceId: string, nodeId: string, starred: boolean): Promise<void>;
};

/** Wrap a `SeedFetcher` with the typed `/author/graph/*` create-vocabulary. */
export function makeSeedClient(fetcher: SeedFetcher): SeedClient {
  return {
    ...fetcher,

    async createFolder(spaceId, title, parentFolderId) {
      return this.createNode(spaceId, 'folder', title, parentFolderId);
    },

    async createNode(spaceId, kind, title, parentFolderId) {
      const res = await fetcher.post('/author/graph/resources', {
        spaceId,
        kind,
        title,
        ...(parentFolderId ? { parentFolder: { parentFolderId } } : {}),
      });
      const body = expectStatus(res, 201, `createNode(${kind} "${title}")`);
      return (body as { node_id: string }).node_id;
    },

    async createDoc(spaceId, title, opts) {
      const res = await fetcher.post('/author/graph/text-resources', {
        spaceId,
        title,
        ...(opts?.parentFolderId
          ? { parentFolder: { parentFolderId: opts.parentFolderId } }
          : {}),
        ...(opts?.lexicalBody ? { lexicalBody: opts.lexicalBody } : {}),
      });
      const body = expectStatus(res, 201, `createDoc("${title}")`);
      const j = body as { node_id: string; body_ref: { doc_id: string } };
      return { nodeId: j.node_id, docId: j.body_ref.doc_id };
    },

    async publishDoc(spaceId, nodeId) {
      // Promote the doc's current draft body to PUBLISHED (status-only PATCH, no
      // body) so read mode shows it — a new doc's body is born as a draft.
      const res = await fetcher.patch('/author/graph/text-resources', {
        spaceId,
        nodeId,
        status: 'published',
      });
      expectStatus(res, 200, `publishDoc(${nodeId})`);
    },

    async saveRevision(spaceId, nodeId, lexicalBody) {
      // Save + publish a new body → records another version (Payload drafts).
      const res = await fetcher.patch('/author/graph/text-resources', {
        spaceId,
        nodeId,
        body: lexicalBody,
        status: 'published',
      });
      expectStatus(res, 200, `saveRevision(${nodeId})`);
    },

    async open(spaceId, nodeId) {
      const res = await fetcher.post('/author/graph/opened', {
        spaceId,
        nodeId,
      });
      expectStatus(res, 200, `open(${nodeId})`);
    },

    async rename(spaceId, resourceId, title) {
      const res = await fetcher.patch('/author/graph/resources', {
        spaceId,
        resourceId,
        title,
      });
      expectStatus(res, 200, `rename(${resourceId})`);
    },

    async describe(spaceId, nodeId, body) {
      const res = await fetcher.post('/author/graph/attributes', {
        attribute: 'description',
        spaceId,
        nodeId,
        body,
      });
      expectStatus(res, 200, `describe(${nodeId})`);
    },

    async contain(spaceId, folderId, childId, position) {
      const res = await fetcher.post('/author/graph/edges', {
        action: 'contain',
        spaceId,
        folderId,
        childId,
        ...(position === undefined ? {} : { position }),
      });
      expectStatus(res, 201, `contain(${folderId}→${childId})`);
    },

    async shortcut(spaceId, folderId, targetId, position) {
      const res = await fetcher.post('/author/graph/edges', {
        action: 'shortcut',
        spaceId,
        folderId,
        targetId,
        ...(position === undefined ? {} : { position }),
      });
      expectStatus(res, 201, `shortcut(${folderId}→${targetId})`);
    },

    async tag(spaceId, resourceId, tag) {
      const res = await fetcher.post('/author/graph/edges', {
        action: 'tag',
        spaceId,
        resourceId,
        ...(tag.tagId ? { tagId: tag.tagId } : {}),
        ...(tag.tagTitle ? { tagTitle: tag.tagTitle } : {}),
      });
      return expectStatus(res, 201, `tag(${resourceId})`);
    },

    async relate(spaceId, fromId, toId, position) {
      const res = await fetcher.post('/author/graph/edges', {
        action: 'link',
        spaceId,
        fromId,
        toId,
        ...(position === undefined ? {} : { position }),
      });
      expectStatus(res, 201, `relate(${fromId}→${toId})`);
    },

    async copy(spaceId, sourceId, opts) {
      const res = await fetcher.post('/author/graph/copy', {
        spaceId,
        sourceId,
        targetFolderId: opts?.targetFolderId ?? null,
        ...(opts?.rootTitle ? { rootTitle: opts.rootTitle } : {}),
      });
      const body = expectStatus(res, 201, `copy(${sourceId})`) as {
        node_id: string;
        count: number;
      };
      return { nodeId: body.node_id, count: body.count };
    },

    async trash(spaceId, resourceId) {
      const res = await fetcher.del('/author/graph/resources', {
        spaceId,
        resourceId,
      });
      expectStatus(res, 200, `trash(${resourceId})`);
    },

    async restore(spaceId, resourceId) {
      const res = await fetcher.patch('/author/graph/trash', {
        spaceId,
        resourceId,
      });
      expectStatus(res, 200, `restore(${resourceId})`);
    },

    async purge(spaceId, resourceId) {
      const res = await fetcher.del('/author/graph/trash', {
        spaceId,
        resourceId,
      });
      const body = expectStatus(res, 200, `purge(${resourceId})`);
      return body as PurgeResult;
    },

    async setFloor(resourceId, visibility) {
      const res = await fetcher.patch('/author/graph/visibility', {
        resourceId,
        visibility,
      });
      expectStatus(res, 200, `setFloor(${resourceId})`);
    },

    async visibility(spaceId, nodeId, opts) {
      const params = new URLSearchParams({
        space_id: spaceId,
        node_id: nodeId,
      });
      if (opts?.query !== undefined) params.set('q', opts.query);
      if (opts?.cursor !== undefined) params.set('cursor', opts.cursor);
      if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
      const res = await fetcher.get(`/author/graph/visibility?${params}`);
      const label = [
        opts?.query === undefined ? '' : ` q=${opts.query}`,
        opts?.cursor === undefined ? '' : ` cursor=…`,
        opts?.limit === undefined ? '' : ` limit=${opts.limit}`,
      ].join('');
      const body = expectStatus(res, 200, `visibility(${nodeId}${label})`);
      return body as Visibility;
    },

    async linkScope(resourceId, scopeId) {
      const res = await fetcher.post('/author/graph/visibility', {
        resourceId,
        scopeId,
      });
      expectStatus(res, 201, `linkScope(${resourceId})`);
    },

    async grantUser(resourceId, userId) {
      const res = await fetcher.post('/author/graph/visibility', {
        grantType: 'user',
        resourceId,
        userId,
      });
      expectStatus(res, 201, `grantUser(${resourceId}→${userId})`);
    },

    async revokeUser(resourceId, userId) {
      const res = await fetcher.del('/author/graph/visibility', {
        grantType: 'user',
        resourceId,
        userId,
      });
      expectStatus(res, 200, `revokeUser(${resourceId}→${userId})`);
    },

    async star(spaceId, nodeId, starred) {
      const res = await fetcher.post('/author/graph/starred', {
        spaceId,
        nodeId,
        starred,
      });
      expectStatus(res, 200, `star(${nodeId})`);
    },
  };
}
