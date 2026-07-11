-- ---------------------------------------------------------------------------
-- Read-tier knowledge verbs — single derive-from-read seeding (ADR-0017 §3).
--
-- Reconciles the knowledge verb model into three tiers, replacing name-by-name
-- per-role seeding for the READ-TIER with one derived grant:
--
--   * read-tier  (read, open, progress) — "interact with what you can see":
--     a pure read, or a verb that touches ONLY one's OWN state (recording an
--     open, advancing own progress). Held by every role that holds
--     space.knowledge.read. Seeded HERE, DERIVED — so it stays correct as
--     read-roles evolve and never drifts again.
--   * author-tier (create, update, delete, transition) — mutate SHARED content
--     or workflow state. Stay hard-mapped to admin/author (20260615190243,
--     20260617190200). `transition` is author-tier — it moves shared workflow
--     state, so read capability must NOT imply holding it (this tightens
--     ADR-0017 §3's earlier "soft transition" read-tier note).
--   * access-tier (access) — audience / access management. admin-only
--     (20260617190300).
--
-- SUPERSEDES ADR-0011 §6 (full space.knowledge.* grant to the base `member`
-- role): never landed in this deployment, real users are admins, and the
-- vestigial member->open mapping (removed at source in 20260622193000) left
-- `member` holding `open` without `read`. Recording an open / advancing one's
-- own progress is the softest knowledge action — you may do it for anything
-- you can READ. Idempotent.
-- ---------------------------------------------------------------------------

insert into public.role_permission (role_id, permission_id)
select rp_read.role_id, p_soft.id
from public.role_permission rp_read
join public.permissions p_read
  on p_read.id = rp_read.permission_id
 and p_read.key = 'space.knowledge.read'
join public.permissions p_soft
  on p_soft.key in (
       'space.knowledge.open',
       'space.knowledge.progress'
     )
on conflict (role_id, permission_id) do nothing;
