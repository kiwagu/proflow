/*
 * kb search foundation — the data-layer substrate for lexical search over the
 * knowledge graph (the first rung of the findability ladder). This migration is
 * pure infrastructure: extensions + an ICU collation + a normalize function + GIN
 * trigram indexes. NOTHING queries it yet — it is additive, forward-only, and
 * safe to land alone (no behavior change). The search engine + contracts + Drive
 * lens land in later phases (see docs/knowledge-graph-plan.md).
 *
 * Search is a READ capability over the ONE graph (not a new entity, not a new
 * data model): it matches public.knowledge_resources.title + the existing
 * kb.resource_description.body satellite, and returns the same resource nodes a
 * projection would — fenced by the same RLS at query time. This migration only
 * adds the derived index infrastructure those reads will use.
 *
 * Matching model (pinned to verified facts of the live DB — PostgreSQL 17.6, ICU
 * enabled): substring/fuzzy matching runs over a NORMALIZED text expression +
 * pg_trgm (PG17 forbids LIKE/ILIKE on a nondeterministic collation — verified);
 * the ICU nondeterministic collation is for ORDER BY / equality ONLY. Extensions
 * live in the `extensions` schema (alongside pg_net/pgcrypto/uuid-ossp) to avoid
 * the `extension_in_public` advisor lint.
 *
 * Dependency order below: extensions -> collation -> normalize fn -> indexes
 * (the indexes depend on the IMMUTABLE function, which depends on unaccent).
 */

-- ===========================================================================
-- 1. Extensions (in `extensions`, never public — avoids extension_in_public)
-- ===========================================================================
create extension if not exists pg_trgm       with schema extensions;
create extension if not exists unaccent      with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;
-- fuzzystrmatch.levenshtein is the short-query (< 3 chars) match tier built in a
-- later phase; installed now so this foundation is complete.

-- ===========================================================================
-- 2. ICU nondeterministic collation — the server mirror of compareText
-- ===========================================================================
-- locale 'und-u-kn-true-ks-level1':
--   kn-true   = numeric-natural ordering ("World2" before "World10")
--   ks-level1 = case- AND accent-insensitive equality (Latin and Cyrillic)
-- This mirrors Intl.Collator({ numeric: true, sensitivity: 'base' }) used by the
-- TS sorter, closing the deferred "Postgres must mirror compareText" note.
--
-- USE FOR ORDER BY / equality ONLY — NEVER in a LIKE/ILIKE. PG17 forbids
-- LIKE/ILIKE on a nondeterministic collation (verified: "nondeterministic
-- collations are not supported for LIKE"). Substring/prefix matching runs over
-- kb.search_normalize(...) (plain text), not over this collation.
--
-- ё/е fold: at ks-level1, Cyrillic ё folds onto е ('ёжик' = 'ежик'), exactly as
-- é folds onto e. This is the INTENDED case+accent-insensitive search behavior
-- (a query for 'ежик' finds 'ёжик' and vice versa), NOT a bug. Distinguishing
-- them would require a level-2/3 collation on a different ordered surface.
create collation kb.text_ci_ai (
  provider = icu,
  locale = 'und-u-kn-true-ks-level1',
  deterministic = false
);

comment on collation kb.text_ci_ai is
  'ICU nondeterministic collation (numeric-natural, case+accent-insensitive) — server mirror of compareText. ORDER BY / equality ONLY; never LIKE (PG17 forbids LIKE on nondeterministic collation). ё/е (and é/e) fold at level 1 by design.';

-- ===========================================================================
-- 3. kb.search_normalize(text) — IMMUTABLE normalize fn (indexable expression)
-- ===========================================================================
-- IMMUTABILITY TRICK: plain unaccent(text) is only STABLE (it resolves the
-- default dictionary by name at call time — a catalog lookup). Passing the
-- dictionary EXPLICITLY as a regdictionary lets this wrapper be IMMUTABLE, which
-- is REQUIRED to build an index on the functional expression below. House style:
-- set search_path = '' + fully-qualified refs (matches kb.set_updated_at()).
--
-- COST of the trick: if the unaccent dictionary file is ever swapped, the
-- dependent GIN indexes must be reindexed MANUALLY (the planner trusts the
-- IMMUTABLE marker). Accepted — the dictionary is static in practice.
create function kb.search_normalize(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, lower(p_text));
$$;

comment on function kb.search_normalize(text) is
  'IMMUTABLE normalize for lexical search: lower() + accent-fold via explicit-regdictionary unaccent (the trick that makes it IMMUTABLE, so it can be indexed). If the unaccent dictionary is ever swapped, REINDEX the dependent GIN indexes manually — accepted, the dictionary is static.';

-- ===========================================================================
-- 4. GIN trigram indexes (schema-qualified gin_trgm_ops — pg_trgm in extensions)
-- ===========================================================================
-- The IMMUTABLE marker on kb.search_normalize is what lets these build — a build
-- failure here means the function is not actually immutable.
create index knowledge_resources_title_trgm_idx
  on public.knowledge_resources using gin (kb.search_normalize(title) extensions.gin_trgm_ops);

create index resource_description_body_trgm_idx
  on kb.resource_description using gin (kb.search_normalize(body) extensions.gin_trgm_ops);
