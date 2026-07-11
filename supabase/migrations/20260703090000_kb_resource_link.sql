/*
 * kb.resource_link (krl) — the URL satellite that makes a `kind='link'` node REAL
 * (slice-10 §2.4, ADR-0013 satellite machinery). A link node's CONTENT is its
 * external URL — one 1:1 row keyed by node_id, exactly the resource_description
 * mold: same shared triggers (updated_at stamper + same-space guard), same RLS
 * verb mirror (read = space.knowledge.read; write = space.knowledge.update).
 *
 * The URL is an ATTRIBUTE of the link node, never an edge (a `link` edge connects
 * graph nodes; the external URL points OUT of the graph). Logically link-kind
 * only — not enforced cross-table (slice-10: the kind guard is optional; the app
 * write path only offers the attribute for link nodes).
 *
 * Scheme fence (defense-in-depth): the URL lands in an <a href> — the zod contract
 * is the primary http(s)-only allow-list, and this CHECK is the DB belt so no
 * future writer can store a javascript:/data: URL (stored-XSS). No unfurl/fetch
 * anywhere — the server never dereferences the URL (no SSRF surface this slice).
 */

create table kb.resource_link (
  id text primary key default public.entity_id_generate('krl'),
  node_id text not null unique references public.knowledge_resources (id) on delete cascade,
  space_id text not null references public.spaces (id) on delete cascade,
  url text not null,
  -- Denormalized display host (e.g. "status.acme.com") — derived server-side from
  -- the URL at write time; the card meta line reads it without parsing the URL.
  host text,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint resource_link_http_only check (url ~* '^https?://'),
  constraint resource_link_url_length check (char_length(url) <= 2048)
);

comment on table kb.resource_link is
  'KB node satellite (1:1): the external URL of a kind=link node (slice-10 §2.4). http(s)-only (anti stored-XSS — the URL renders as an href). Mirrors node access; never a parallel graph.';

create index resource_link_space_id_idx on kb.resource_link (space_id);

-- Shared satellite machinery (built with resource_description, reused as designed).
create trigger resource_link_set_updated_at
before update on kb.resource_link
for each row execute function kb.set_updated_at();

create trigger resource_link_same_space_guard
before insert or update on kb.resource_link
for each row execute function kb.assert_satellite_same_space();

-- ---------------------------------------------------------------------------
-- RLS: mirror the parent node's access (read = read; write = update)
-- ---------------------------------------------------------------------------
alter table kb.resource_link enable row level security;
revoke all on kb.resource_link from public;
grant select, insert, update, delete on kb.resource_link to authenticated;
-- service_role bypasses RLS but still needs the privilege for reconcile jobs.
grant select, insert, update, delete on kb.resource_link to service_role;

create policy "kb_link select mirrors node read"
on kb.resource_link for select to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.read')
  )
);

create policy "kb_link insert mirrors node update"
on kb.resource_link for insert to authenticated
with check (
  resource_link.created_by = (select auth.uid())
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);

create policy "kb_link update mirrors node update"
on kb.resource_link for update to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
)
with check (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);

create policy "kb_link delete mirrors node update"
on kb.resource_link for delete to authenticated
using (
  exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_link.node_id
      and private.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.update')
  )
);
