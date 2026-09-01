/*
 * hardening pass over the server sync surface (crdt documents, server search
 * index, workbench blobs), from the security review of that surface.
 *
 * two findings, both about privileges the tables were BORN with rather than
 * anything the feature migrations wrote. new tables in this schema inherit the
 * stack's default privileges, which hand `authenticated` the full table-level
 * set — including verbs the access model never intended to expose.
 *
 * ---------------------------------------------------------------------------
 * 1. TRUNCATE reachable by `authenticated` (defense in depth)
 * ---------------------------------------------------------------------------
 * TRUNCATE is not filtered by row level security: it is a table-level
 * privilege, so a session holding it removes EVERY row regardless of how
 * carefully the policies fence individual ones. The whole append-only argument
 * for crdt_updates — no UPDATE policy, no DELETE policy, removal only through
 * the guarded compaction rpc — is written at the row level and TRUNCATE steps
 * around all of it.
 *
 * This is NOT currently reachable from the public API: `authenticated` is a
 * NOLOGIN role that PostgREST switches into per request, and PostgREST issues
 * no TRUNCATE. So this closes a latent hole rather than an open one — but the
 * grant is pure surface with no legitimate client use, and the cost of holding
 * it is that one future path reaching SQL under that role turns a row-level
 * fence into a whole-table wipe. Revoked for the same reason the anon
 * table-grants were revoked in the feature migrations: unused privilege is
 * removed, not documented.
 *
 * Also revoked: REFERENCES (lets a role point a foreign key at these tables,
 * which pins rows against deletion) and TRIGGER (lets a role attach a trigger
 * that runs on other users' writes). Neither has a client use either.
 *
 * ---------------------------------------------------------------------------
 * 2. the pre-certificate UPDATE window was unreachable in practice
 * ---------------------------------------------------------------------------
 * The blob storage policies deliberately allow UPDATE on an object only while
 * no metadata row certifies it — the window a resumable upload needs to touch
 * its object more than once, closed the moment the row appears.
 *
 * That window never actually opened. An UPDATE with a WHERE clause must first
 * READ the row, so the SELECT policy applies too — and the SELECT policy
 * requires the certificate row, which by definition does not exist yet during
 * the window. The UPDATE predicate evaluated true on its own; the read fenced
 * it to zero rows first, so a resumable upload's second touch silently
 * affected nothing.
 *
 * The fix is a narrow SELECT policy for exactly that window: the uploader may
 * see their OWN not-yet-certified object in a space where they hold
 * space.files.create. It cannot widen read access to content — an uncertified
 * object is by construction bytes this same user is in the middle of writing,
 * and the moment the certificate row lands, this policy stops matching and the
 * ordinary certified-read policy takes over. `owner` is set by storage from
 * the authenticated identity, so scoping by it keeps one user out of another's
 * in-flight upload.
 */

-- ---------------------------------------------------------------------------
-- 1. drop the privileges no client path uses
-- ---------------------------------------------------------------------------

revoke truncate, references, trigger on table public.crdt_documents from authenticated;
revoke truncate, references, trigger on table public.crdt_updates from authenticated;
revoke truncate, references, trigger on table public.crdt_document_versions from authenticated;
revoke truncate, references, trigger on table public.server_document_chunk from authenticated;
revoke truncate, references, trigger on table public.server_document_index_state from authenticated;
revoke truncate, references, trigger on table public.workbench_blobs from authenticated;

-- anon holds no policy on any of these, but the table-level grants the schema
-- defaults leave behind are removed for the same reason.
revoke all on table public.crdt_documents from anon;
revoke all on table public.crdt_updates from anon;
revoke all on table public.crdt_document_versions from anon;
revoke all on table public.server_document_chunk from anon;
revoke all on table public.server_document_index_state from anon;
revoke all on table public.workbench_blobs from anon;

-- the derive worker is the only writer of the search projection; clients read
-- it and nothing more. re-asserted here so the intent survives a future
-- default-privilege change.
revoke insert, update, delete on table public.server_document_chunk from authenticated;
revoke insert, update, delete on table public.server_document_index_state from authenticated;

-- ---------------------------------------------------------------------------
-- 2. make the pre-certificate window readable to its own uploader
-- ---------------------------------------------------------------------------

create policy "workbench_blobs objects select own uncertified upload"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'workbench-blobs'
  and (storage.foldername(name))[1] = 'spaces'
  and (storage.foldername(name))[3] = 'blobs'
  and owner = (select auth.uid())
  and public.auth_user_can_access_in_space(
        (storage.foldername(name))[2],
        'space.files.create'
      )
  and not exists (
    select 1
    from public.workbench_blobs b
    where b.space_id = (storage.foldername(name))[2]
      and b.hash = storage.filename(name)
  )
);
