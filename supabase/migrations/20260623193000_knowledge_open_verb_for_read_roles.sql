-- ---------------------------------------------------------------------------
-- Grant `space.knowledge.open` to every role that already holds
-- `space.knowledge.read`.
--
-- The activity spine (20260622193000) mapped `space.knowledge.open` to `member`
-- only (per ADR-0011 §6's "member gets the full set"). But this deployment's
-- knowledge verbs (read/update/progress) are held by `admin`/`author`, with NO
-- role hierarchy — and the real users are admins. So the per-user "open" write
-- (POST /author/graph/opened) was RLS-rejected for every actual user, leaving
-- `resource_user_state.last_opened_at` empty and the Drive "Recent" (recently
-- viewed by me) permanently empty.
--
-- Recording an open is the softest knowledge action — you may record an open of
-- anything you can READ. So the verb must follow `space.knowledge.read`. This is
-- derived (not hard-coded to admin/author) so it stays correct as read-roles
-- evolve. Idempotent; the existing `member` mapping is left intact.
-- ---------------------------------------------------------------------------

insert into public.role_permission (role_id, permission_id)
select rp.role_id, p_open.id
from public.role_permission rp
join public.permissions p_read
  on p_read.id = rp.permission_id
 and p_read.key = 'space.knowledge.read'
cross join public.permissions p_open
where p_open.key = 'space.knowledge.open'
on conflict (role_id, permission_id) do nothing;
