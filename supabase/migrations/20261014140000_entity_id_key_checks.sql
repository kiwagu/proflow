/*
 * Entity ids on the server: CHECK constraints on the keys the clients
 * replicate, added NOT VALID.
 *
 * What they guard
 * - Every id column a client takes in as a key — the document id of a body,
 *   and the id, space and node columns of the replicated graph tables — must
 *   hold a well-formed id of its kind, in lowercase. The clients take a
 *   stored key only exactly as it is stored and refuse anything else, so a
 *   key the server let in malformed or in mixed case would be left out on
 *   every device that reads it.
 * - The writer of a document update must be a writer id. Clients only
 *   compare it with their own, but it is written by clients, and nothing
 *   else held its shape.
 *
 * Why NOT VALID, on purpose
 * - The constraints apply to every row written from now on. Rows already
 *   stored are not checked here: they are the operator's to verify, with the
 *   same expression, and then to validate one by one with
 *   `alter table ... validate constraint ...`.
 * - Until then an existing row that does not conform can still be read but
 *   no longer written: any update of it is refused. On a database whose ids
 *   all came from the generator and the clients, there is no such row.
 *
 * Idempotent: each constraint is dropped if present and added again.
 */


alter table public.crdt_documents drop constraint if exists crdt_documents_id_is_entity_id;
alter table public.crdt_documents add constraint crdt_documents_id_is_entity_id
  check (public.is_entity_id_with_prefix(id, 'doc') and id = lower(id)) not valid;

alter table public.crdt_updates drop constraint if exists crdt_updates_writer_is_entity_id;
alter table public.crdt_updates add constraint crdt_updates_writer_is_entity_id
  check (public.is_entity_id_with_prefix(writer, 'wrt') and writer = lower(writer)) not valid;

alter table public.knowledge_resources drop constraint if exists knowledge_resources_id_is_entity_id;
alter table public.knowledge_resources add constraint knowledge_resources_id_is_entity_id
  check (public.is_entity_id_with_prefix(id, 'knr') and id = lower(id)) not valid;
alter table public.knowledge_resources drop constraint if exists knowledge_resources_space_id_is_entity_id;
alter table public.knowledge_resources add constraint knowledge_resources_space_id_is_entity_id
  check (public.is_entity_id_with_prefix(space_id, 'spc') and space_id = lower(space_id)) not valid;

alter table public.knowledge_edges drop constraint if exists knowledge_edges_id_is_entity_id;
alter table public.knowledge_edges add constraint knowledge_edges_id_is_entity_id
  check (public.is_entity_id_with_prefix(id, 'kne') and id = lower(id)) not valid;
alter table public.knowledge_edges drop constraint if exists knowledge_edges_space_id_is_entity_id;
alter table public.knowledge_edges add constraint knowledge_edges_space_id_is_entity_id
  check (public.is_entity_id_with_prefix(space_id, 'spc') and space_id = lower(space_id)) not valid;
alter table public.knowledge_edges drop constraint if exists knowledge_edges_from_id_is_entity_id;
alter table public.knowledge_edges add constraint knowledge_edges_from_id_is_entity_id
  check (public.is_entity_id_with_prefix(from_id, 'knr') and from_id = lower(from_id)) not valid;
alter table public.knowledge_edges drop constraint if exists knowledge_edges_to_id_is_entity_id;
alter table public.knowledge_edges add constraint knowledge_edges_to_id_is_entity_id
  check (public.is_entity_id_with_prefix(to_id, 'knr') and to_id = lower(to_id)) not valid;

alter table public.resource_user_state drop constraint if exists resource_user_state_id_is_entity_id;
alter table public.resource_user_state add constraint resource_user_state_id_is_entity_id
  check (public.is_entity_id_with_prefix(id, 'rus') and id = lower(id)) not valid;
alter table public.resource_user_state drop constraint if exists resource_user_state_space_id_is_entity_id;
alter table public.resource_user_state add constraint resource_user_state_space_id_is_entity_id
  check (public.is_entity_id_with_prefix(space_id, 'spc') and space_id = lower(space_id)) not valid;
alter table public.resource_user_state drop constraint if exists resource_user_state_resource_id_is_entity_id;
alter table public.resource_user_state add constraint resource_user_state_resource_id_is_entity_id
  check (public.is_entity_id_with_prefix(resource_id, 'knr') and resource_id = lower(resource_id)) not valid;

alter table kb.resource_description drop constraint if exists resource_description_id_is_entity_id;
alter table kb.resource_description add constraint resource_description_id_is_entity_id
  check (public.is_entity_id_with_prefix(id, 'krd') and id = lower(id)) not valid;
alter table kb.resource_description drop constraint if exists resource_description_space_id_is_entity_id;
alter table kb.resource_description add constraint resource_description_space_id_is_entity_id
  check (public.is_entity_id_with_prefix(space_id, 'spc') and space_id = lower(space_id)) not valid;
alter table kb.resource_description drop constraint if exists resource_description_node_id_is_entity_id;
alter table kb.resource_description add constraint resource_description_node_id_is_entity_id
  check (public.is_entity_id_with_prefix(node_id, 'knr') and node_id = lower(node_id)) not valid;

alter table kb.resource_link drop constraint if exists resource_link_id_is_entity_id;
alter table kb.resource_link add constraint resource_link_id_is_entity_id
  check (public.is_entity_id_with_prefix(id, 'krl') and id = lower(id)) not valid;
alter table kb.resource_link drop constraint if exists resource_link_space_id_is_entity_id;
alter table kb.resource_link add constraint resource_link_space_id_is_entity_id
  check (public.is_entity_id_with_prefix(space_id, 'spc') and space_id = lower(space_id)) not valid;
alter table kb.resource_link drop constraint if exists resource_link_node_id_is_entity_id;
alter table kb.resource_link add constraint resource_link_node_id_is_entity_id
  check (public.is_entity_id_with_prefix(node_id, 'knr') and node_id = lower(node_id)) not valid;

alter table kb.media_blob drop constraint if exists media_blob_id_is_entity_id;
alter table kb.media_blob add constraint media_blob_id_is_entity_id
  check (public.is_entity_id_with_prefix(id, 'kmb') and id = lower(id)) not valid;
alter table kb.media_blob drop constraint if exists media_blob_space_id_is_entity_id;
alter table kb.media_blob add constraint media_blob_space_id_is_entity_id
  check (public.is_entity_id_with_prefix(space_id, 'spc') and space_id = lower(space_id)) not valid;

alter table kb.resource_media_meta drop constraint if exists resource_media_meta_id_is_entity_id;
alter table kb.resource_media_meta add constraint resource_media_meta_id_is_entity_id
  check (public.is_entity_id_with_prefix(id, 'kmm') and id = lower(id)) not valid;
alter table kb.resource_media_meta drop constraint if exists resource_media_meta_space_id_is_entity_id;
alter table kb.resource_media_meta add constraint resource_media_meta_space_id_is_entity_id
  check (public.is_entity_id_with_prefix(space_id, 'spc') and space_id = lower(space_id)) not valid;
alter table kb.resource_media_meta drop constraint if exists resource_media_meta_node_id_is_entity_id;
alter table kb.resource_media_meta add constraint resource_media_meta_node_id_is_entity_id
  check (public.is_entity_id_with_prefix(node_id, 'knr') and node_id = lower(node_id)) not valid;
alter table kb.resource_media_meta drop constraint if exists resource_media_meta_blob_id_is_entity_id;
alter table kb.resource_media_meta add constraint resource_media_meta_blob_id_is_entity_id
  check (public.is_entity_id_with_prefix(blob_id, 'kmb') and blob_id = lower(blob_id)) not valid;
