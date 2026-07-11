/*
 * knowledge graph — per-user "starred" flag on the per-user state anchor
 * (see docs/knowledge-graph-plan.md §2).
 *
 * purpose
 * - adds a per-(user, resource) boolean `starred` to resource_user_state so a user
 *   can pin their own knowledge resources. Reuses the existing per-user state row;
 *   no new table and no jsonb (a real boolean column the overlay carries).
 *
 * rls
 * - NO new policy. starred is row-level state on resource_user_state, already
 *   covered by the existing own-rows insert/update policies (verb
 *   space.knowledge.progress). Star toggling deliberately shares the per-user-state
 *   write path: a user who may advance their own progress may also star their own
 *   rows. Reading uses the existing own-rows select policy (space.knowledge.read).
 */

alter table public.resource_user_state
  add column starred boolean not null default false;

comment on column public.resource_user_state.starred is
  'Per-(user, resource) pin flag. Shares the existing own-rows insert/update policies (space.knowledge.progress) — no dedicated RLS; star toggling reuses the per-user-state write path.';

-- hot path: my starred rows in a space (partial — only true rows are indexed):
create index resource_user_state_starred_idx
  on public.resource_user_state (user_id, space_id)
  where starred;
