/*
 * knowledge graph — resource-workflow as data (see docs/knowledge-graph-plan.md §5).
 *
 * purpose
 * - resource_workflows: a reusable, space-shared status state-machine held as DATA
 *   (states + allowed transitions + guards as jsonb), NOT a postgres enum and NOT a
 *   per-node jsonb copy. one lifecycle applies to many nodes; a new lifecycle is one
 *   insert, zero migration. this is the same profile as the view_types/relation_types
 *   vocabularies: global reference data, natural-key pk, RLS select-only.
 * - the stored `definition` is XState-compatible ({ initial, states.<s>.on.<e> =
 *   { target, guard? } }), so the thin in-house transition validator reads it today
 *   and an XState createMachine(config) adopts it later with zero data migration.
 * - powers the `requires_state` gating rule (a node is available iff its status is in
 *   an allowed set) and the generic transition validator behind POST /author/graph/transition.
 *
 * natural-key pk exception (documented, parity with knowledge_vocabularies)
 * - workflow keys are stable, human-readable reference strings ('default',
 *   'document_review') embedded in node data and the validator; a ulid id would be
 *   unreadable and non-portable. allowed "stable external/reference key" exception to
 *   db-domain-ids-and-naming (no new entity-id prefixes registered).
 *
 * rls
 * - resource_workflows is global reference data, NOT a space-scoped domain resource.
 *   select is granted to authenticated (= true); there are no write policies —
 *   workflow definitions change only via migration seed (exact copy of the vocab pattern).
 *
 * status CHECK
 * - knowledge_resources.status was a coarse placeholder CHECK (draft/active/archived).
 *   this slice widens it ONCE to the full POC set (adds in_review/approved). this is NOT
 *   an ADR-0004 §2 violation: app extensibility lives in resource_workflows.definition
 *   (data); the CHECK is a closed technical guard of the known value set. a status
 *   reference-vocabulary table is the clean finish, deliberately deferred.
 *
 * permissions
 * - registers space.knowledge.transition (move a workflow at all) and
 *   space.knowledge.approve (an optional per-transition guard verb). transition maps
 *   onto admin + author; approve maps onto admin (POC).
 */

-- ---------------------------------------------------------------------------
-- permission verbs + role mapping
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description) values
  ('space.knowledge.transition', 'Move a knowledge resource through its workflow (status transition) in one space.'),
  ('space.knowledge.approve', 'Authorize an approval-guarded workflow transition in one space.')
on conflict (key) do nothing;

-- `member` (the all-roles floor, ADR-0011 §6) gets `transition` so any space
-- member can move a workflow; `approve` stays admin-only (approval guard).
with mapping(role_key, permission_key) as (
  values
    ('admin', 'space.knowledge.transition'),
    ('admin', 'space.knowledge.approve'),
    ('author', 'space.knowledge.transition'),
    ('member', 'space.knowledge.transition')
)
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from mapping m
join public.roles r
  on r.key = m.role_key
 and r.role_kind = 'system'
 and r.owner_organization_id is null
 and r.archived_at is null
join public.permissions p on p.key = m.permission_key
on conflict (role_id, permission_id) do nothing;

-- ---------------------------------------------------------------------------
-- resource_workflows (workflow-as-data vocabulary)
-- ---------------------------------------------------------------------------

create table public.resource_workflows (
  key text primary key,
  label text not null,
  description text,
  -- states + allowed transitions + guards AS DATA (XState-compatible, ADR-0007):
  -- { initial, states: { <state>: { on: { <event>: { target, guard? } } } } }.
  -- validated at the app boundary by workflowDefinitionSchema; the DB does not crack it.
  definition jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.resource_workflows is
  'Vocabulary (data, not enum): reusable status state-machines over knowledge_resources.status. New lifecycle = one insert, zero migration. definition is XState-compatible jsonb.';

-- ---------------------------------------------------------------------------
-- knowledge_resources: bind an optional workflow + widen the status CHECK
-- ---------------------------------------------------------------------------

-- additive nullable FK: a node with no explicit workflow uses the 'default' lifecycle.
-- workflow_key is chosen by projection/authoring DATA, never by code.
alter table public.knowledge_resources
  add column workflow_key text references public.resource_workflows (key);

comment on column public.knowledge_resources.workflow_key is
  'Optional FK to resource_workflows(key); null = the default draft/active/archived lifecycle. Additive, applies uniformly to all nodes (no per-app model).';

-- widen the coarse status guard ONCE to the full POC set (one ALTER). app
-- extensibility lives in resource_workflows.definition (data); this CHECK is a
-- closed technical guard of the known value set.
alter table public.knowledge_resources
  drop constraint knowledge_resources_status_check;

alter table public.knowledge_resources
  add constraint knowledge_resources_status_check
  check (status in ('draft', 'active', 'archived', 'in_review', 'approved'));

-- ---------------------------------------------------------------------------
-- seed workflow definitions (platform vocab — data, not code)
-- ---------------------------------------------------------------------------

insert into public.resource_workflows (key, label, description, definition) values
  (
    'default',
    'Default',
    'Default node lifecycle (draft → active → archived).',
    '{
      "initial": "draft",
      "states": {
        "draft":    { "on": { "activate": { "target": "active" } } },
        "active":   { "on": { "archive":  { "target": "archived" } } },
        "archived": {}
      }
    }'::jsonb
  ),
  (
    'document_review',
    'Document review',
    'Review lifecycle: draft → in_review → approved (approval-guarded) → archived.',
    '{
      "initial": "draft",
      "states": {
        "draft":     { "on": { "submit":  { "target": "in_review" } } },
        "in_review": { "on": { "approve": { "target": "approved", "guard": "space.knowledge.approve" },
                               "reject":  { "target": "draft" } } },
        "approved":  { "on": { "archive": { "target": "archived" } } },
        "archived":  {}
      }
    }'::jsonb
  )
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- rls: global reference data, readable by any authenticated user; no writes
-- ---------------------------------------------------------------------------

alter table public.resource_workflows enable row level security;

revoke all on public.resource_workflows from public;

grant select on public.resource_workflows to authenticated;

create policy "resource_workflows readable by authenticated"
on public.resource_workflows
for select
to authenticated
using (true);

-- no insert/update/delete policies: workflow definitions change only via migration seed.
