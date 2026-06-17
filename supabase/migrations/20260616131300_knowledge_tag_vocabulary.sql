/*
 * knowledge graph — tag vocabulary rows (see docs/knowledge-graph-plan.md §4).
 *
 * purpose
 * - graph-native tagging: a tag is a NODE (knowledge_resources with kind='tag'),
 *   and "resource has tag T" is a directed edge (relation_type='tagged'). This
 *   needs no new column or table — only two vocabulary ROWS, the same data-not-
 *   enum pattern as the base vocabularies. A new kind/relation is one insert.
 *
 * canonical edge direction: from_id = resource, to_id = tag. "Resources with tag
 * T" are therefore the incoming `tagged` edges of T (to_id = T → read from_id),
 * which the existing reverse index (to_id, relation_type, position) already
 * covers. "Filter by tag" is expressed as a traversal, not a filter field.
 *
 * note: NO core DDL here (no column, no ALTER) — only vocabulary rows. The demo
 * tag nodes and `tagged` edges live in the e2e harness, never in a migration
 * (hardcoded-id domain rows would poison the identity-sync worker).
 */

insert into public.resource_kinds (key, label, description) values
  ('tag', 'Tag', 'Tag node; resources link to it via a tagged edge (graph-native tagging).')
on conflict (key) do nothing;

insert into public.relation_types (key, label, description, is_directed) values
  ('tagged', 'Tagged', 'Resource is tagged with the target tag node (from_id=resource, to_id=tag).', true)
on conflict (key) do nothing;
