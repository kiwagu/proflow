# `@workspace/seed` — reference content, one dictionary

The seed is the single home for **reference content** that creates the platform's
worked examples. It exists to serve four jobs at once:

1. **e2e consistency** — the Drive e2e specs build their trees from the SAME
   catalog the demo uses, so the database seed and the tests share one
   create-vocabulary (and the `ref` names anchor human ↔ LLM feedback).
2. **No more hand-built trees** — one command materializes a whole resource tree
   together with its access model.
3. **Demo population** — the demo site is filled by running this seed.
4. **Self-documentation** — each scenario's `summary` and real Lexical bodies make
   the seed the platform's learning material. Content is English-only.

Everything is created the way the product creates it: by driving the live
`/author/graph/*` endpoints as an authenticated user under RLS (migrations never
seed domain content — that poisons the author identity-sync worker).

## Run it

```bash
bun run seed                        # all presets → the stable demo tenant
bun run seed --preset=drive         # just the Drive scenarios
bun run seed --fresh --preset=drive # ephemeral tenant, torn down after (CI/smoke)
bun run seed --reset                # zero the demo space content (no re-seed)
bun run seed --manifest=seed.json   # also dump the seeded ref→id map to JSON
bun run seed:list                   # presets + scenario summaries (no DB writes)
```

The catalog is validated offline before any endpoint call (and in CI via
`bun run test:vitest` → `src/catalog/validate.ts`): duplicate/empty `ref`s,
cross-references that point at nothing (owner / scope / tag / actor / node), bad
presets, malformed Lexical bodies. The `--manifest` JSON is the machine-readable
dictionary — every demo node named by its stable `ref`, keyed by scenario — for
LLM ↔ human feedback and demo verification.

Needs the stack running (the author app + Postgres + Payload/Mongo), exactly like
the `@full` e2e suite. Supabase keys are read from `seed/.env` then `tests/e2e/.env`
(see `.env.example`); the shell wins over both.

### Tenant modes

- `--demo` (default) — a **stable** org/space (`proflow-demo` / `demo-space`) and a
  `demo-viewer@proflow.local` viewer (password `ProflowDemo!1`). Idempotent: the
  shell is reused and the space content is rebuilt from scratch each run, so the end
  state is deterministic.
- `--fresh` — a brand-new random tenant, torn down at the end. For CI smoke.
- `--reset` — zero the demo space's content (no re-seed), then exit.

The demo content is authored and explored under the `demo-*` users: it is owned by
**`demo-admin@proflow.local`** (the `admin` role), with **`demo-viewer@proflow.local`**
as a `space_admin` — both password `ProflowDemo!1`. Content is private-by-default
(ADR-0017), so log in as `demo-admin` to see and edit it.

### Presets

`all` (default) materializes everything. Named presets — `drive`, `access`,
`per-user-share`, `knowledge-base`, `search`, `media`, `board`, `shared`, `hierarchy`, `trash` —
group the scenarios for one capability so the seed stays runnable as the catalog grows. A
scenario opts into a preset via its `presets` field. `access` is cohort/floor sharing;
`shared` is the "Shared with me" lens — cross-shared docs that fill it both ways PLUS the
mechanism-distinction fixture (ADR-0021 Part C): one non-owner `viewer` sees four nodes
owned by another member, one per access MECHANISM — a per-user grant (→ `personal`), a
cohort grant to a cohort the viewer belongs to (→ `cohort`), a space-floor publish
(→ `broadcast`), and a both-granted node that must win as `personal` (precedence
`personal > cohort > broadcast`). The Wave 3b render/badge e2e draws it via
`seedShareMechanismFixture`. The `shared` preset ALSO carries the `advanced-shared`
fixture (ADR-0022): the worked example for the tariff-gated ADVANCED (structural) display
of the Shared lenses, which renders the SAME RLS-visible shared node-set as the KB
containment TREE (vs the flat digest), gated by the COMMERCIAL `advanced_shared_view`
entitlement. The minimal tree — a shared FOLDER ⊃ a shared DOC (so the doc NESTS under the
folder in the tree) plus a published doc whose containing folder stays PRIVATE (so the doc
appears at the ROOT — graceful-absence, no synthetic ancestor). It is view-only: the advanced
tree just reuses `buildContainment` over the shared subset (no resolver change, Invariant #1),
so the SAME three nodes the flat digest lists are re-arranged structurally. The ADR-0022
e2e draws the tree via `seedAdvancedSharedFixture`; the COMMERCIAL entitlement rows are
control-plane config (a service-role `runtime_settings` upsert via `setAdvancedSharedEntitlement`),
out of scope for a content scenario.
The `shared` preset ALSO carries the `containment-inheritance` fixture (ADR-0023): the
worked example for owner-scoped, LIVE containment access inheritance — sharing a folder
makes its OWNER-SCOPED descendants readable to the grantee (a new child auto-appears, a
revoke removes the subtree), additive-OR (a self-granted child survives the folder revoke),
across the per-user / cohort / space-floor conferring dimensions — but NEVER cross-owner
(a third party's node merely FILED into the folder, even an admin's folder-share, stays
private; only that owner's OWN explicit grant exposes it). The MINIMAL multi-owner tree —
a shared folder ⊃ A's own child / deep own subfolder+grandchild / a self-granted child,
an admin's curator-folder, a space-floor folder, and a cohort-folder — with three
ownerB-owned nested nodes (the owner-scope negatives) FILED via the `contains` `by`
cross-owner filer. It is a pure RLS-predicate widening (no new endpoint, no resolver
change): the ADR-0023 access-matrix e2e draws the tree via `seedContainmentInheritanceFixture`
and drives the live arcs (new-child / revoke / re-grant) through the same create-vocabulary.
`per-user-share` is per-person sharing (a private doc granted to one named member,
ADR-0019 — the grantee sees it, a third un-granted member stays blind). That ONE grant is
read from BOTH ends of the grant graph (ADR-0021 Part B): the grantee sees the doc in the
"Shared with me" lens (DriveScope `shared`), while the OWNER sees the same grant in the
"Shared by me" lens (DriveScope `shared-by-me`) — a read-only projection over
`knowledge_resource_user_grants WHERE granted_by = me`, surfaced as a `SharedByMeEntry`
(`{ resourceId, grantees }`). The catalog adds no second grant for the opposite direction;
both lenses read the one `per-user-share/granted` row, and the un-granted sibling appears in
neither. (Wave 2 a landed only the `shared-by-me` DATA slice; the lens render + its e2e
assertion are the Wave 2 b close-out — the scenario already carries the data they will draw
from.) Its space is multi-member with named co-members, so the SAME scenario also feeds the
Share dialog's co-member identity directory (ADR-0020): the people-picker + "who has access"
rows resolve a co-member's `display_name` + `email` (never a bare short-id), search (`?q=`)
narrows it, and a non-member of the space gets an empty directory (the membership fence).
The `per-user-share` preset ALSO carries the `directory-picker` scenario — a ten-member
grantable cohort sharing one space with a private share target — that exercises the
paginated directory-v2 picker (ADR-0021 Part A): a page of 5 + "+N more", a keyset
"Show more" next page with no overlap, and `p_exclude` dropping the owner + the
already-granted member from BOTH the page and the `total_count`.
`search` is the lexical-search corpus (ADR-0024 / slice-12): the `knowledge-base` scenario
ALSO opts into it, layering a multi-locale match set onto the KB articles — a Cyrillic node
(`Договор аренды`, case-insensitive prefix), an accented node (`Égérie`, `unaccent` fold),
the English `Getting Started` (case-insensitive prefix), the Phase-2 fuzzy typo target
(`Привет команде`, found by `превет` via `pg_trgm` word_similarity — NOT a prefix, so only
the fuzzy tier surfaces it), and the Phase-2 ranking pair (`Onboarding Guide` whose TITLE
matches `onboarding` vs `Workspace Setup` whose DESCRIPTION does, proving the banded scorer
ranks title above description at equal tier) — PLUS the RLS-absence proof (ADR-0024 §6):
a PRIVATE node owned by a SECOND space member (`searcherB`) that must stay ABSENT from a
non-grantee's search, and a child under a folder shared to `searcherB` that is PRESENT for
them via the ADR-0023 inherited-grant disjunct composing through search. RLS is the SOLE
fence — there is no app-level visibility filter — so the search SELECT runs as the user
through the reused projection-resolve transport (ADR-0009). The other-space negative
(a node in a DIFFERENT space) is built in the e2e fixture's second tenant, since a catalog
scenario is single-space.
The `search` corpus ALSO carries a SIX-LEVEL-DEEP folder chain — `kb/deep/level-1`…
`kb/deep/level-5` (`Level One`…`Level Five`) ⊃ `kb/deep/leaf` (`Abyssal Treasure`, the
distinctive term `abyssal` in its DESCRIPTION) — for the Pro-gated ADVANCED search lens
(`/author/graph?scope=search&q=…&view=advanced`): Flat view lists the matched leaf, while
Advanced view places it in its FULLY-EXPANDED ancestor-folder tree, recursively, to ANY
depth (search = a filtered KB). A query for `abyssal` matches only the leaf; the advanced
view must render every ancestor folder on the path root → leaf, expanded, with the snippet
highlight on the leaf. The chain is nested via the scenario's `children` (the same
`contain` create-vocabulary), never an inline spec tree — `seedSearchCorpusFixture`
surfaces `deepLeafId`/`deepLeafTitle`/`deepLeafTerm` + the `deepChainFolderTitles`/
`deepChainFolderIds` (outermost first) so a deep-tree advanced-search spec can assert the
whole path renders.
`media` is the KB media substrate (ADR-0026 / slice-13; slice-14 resumable/TUS switch): the
`knowledge-base` scenario ALSO opts into it, making `file`/`video` nodes REAL by uploading a
small byte payload through the product's OWN transport — the materializer authorizes the
upload (`/author/graph/media?op=upload-url`), which returns the SERVER-decided `storagePath`
only (the single-PUT signed-url/token leg was removed with the resumable switch), uploads the
bytes to that path in the private `kb-media` bucket under the owner's session (the product
client uses resumable TUS; the seed runs in Node with tiny fixtures, so it uses the storage-js
STANDARD `upload` — same `storage.objects` INSERT RLS fence, no `tus-js-client` dep), then
confirms the `kb.resource_media_meta` (`kmm`) satellite (`attribute:'media'`), so both a bucket
object AND a satellite row exist, fenced by the SAME `storage.objects` / satellite RLS as
production (never a service-role / direct-SQL seed). A
node opts in by declaring a `media: { bytes, mimeType, filename }` payload on a `file`/`video`
node (the mime must pass `isAllowedMediaMime`; the validator enforces it offline). The corpus
carries: a real `file` (`kb/file-owned`) + a real `video` (`kb/video-owned`) owned by the
primary user (the happy path — upload, download the exact bytes, ResourcePanel Media section);
a real IMAGE (`kb/file-image`, `image/png`) and a real PDF (`kb/file-pdf`, `application/pdf`)
whose bytes are genuine base64-decoded binaries — the inline MIME-driven PREVIEW (ADR-0026
Phase 2, increment 1): `image/*` → an inline `<img>`, `application/pdf` → an inline `<iframe>`
(the `text/plain` files already cover the no-preview case), minted via the SAME single-node
download authorizer as Download (no new endpoint);
a PRIVATE file owned by `searcherB` (`kb/file-private-other`, the download RLS-negative); a
file nested under the ancestor-shared folder (`kb/inherited-file`, the ADR-0023 inherited-grant
download positive for the grantee); and a REAL file (owner-uploaded bytes) per-user-granted
to a NODE-ONLY member (`kb/file-node-grant`, granted to `mediaGrantee` — a plain `member`
WITHOUT space-wide `space.knowledge.update`), which exercises the READ/WRITE ASYMMETRY: the
per-user grant is a READ dimension, so the grantee CAN download the bytes (the storage-RLS
SELECT composes grants) but is DENIED an upload (the WRITE fence mirrors node-UPDATE exactly
— `owner OR space.knowledge.update`, grants NOT composed — so a read-grantee can never
overwrite another user's file bytes); and a REAL confirmed file (`kb/file-purge-reap`)
reserved for the trash → purge lifecycle — purging it best-effort reaps its `kb-media` object
(the ADR-0026 touch-item). Bytes egress ONLY via short-lived signed URLs; RLS is
the sole fence. The ADR-0026 media matrix e2e (`knowledge-media-substrate.e2e.spec.ts`) draws
this corpus via `seedMediaSubstrateFixture` and drives the REAL `/author/graph/media`
upload/download transport against REAL Storage.

## The dictionary

Catalog scenarios (`src/catalog/*.ts`) are **declarative data** addressed by stable
`ref` strings. `materializeScenario` walks a scenario through the endpoints and
returns `ref → id`, so the demo and the e2e specs name the very same nodes.

```
src/
  engine/      tenant bootstrap (ephemeral + demo), actors, SSR cookies,
               the /author/graph/* HTTP wrappers (the create-vocabulary)
  catalog/     the dictionary: drive, access, knowledge-base, board, shared,
               share-mechanism, advanced-shared, hierarchy, per-user-share,
               directory-picker, containment-inheritance, trash + the projection
               spec builders + the materializer
  presets.ts   preset → scenario selection
  cli.ts       the `bun run seed` entrypoint
```

## How e2e consumes it

`@workspace/e2e` depends on `@workspace/seed`. The e2e helper re-exports the engine
primitives (so existing specs are unchanged) and the Drive specs build their trees
with the shared HTTP client + catalog fixtures (`drive-cascade`, `drive-copy-chain`).
The per-person-sharing access-matrix spec
(`knowledge-per-user-share.e2e.spec.ts`) likewise draws ENTIRELY from the shared
`per-user-share` scenario via `seedPerUserShareFixture` — the seeded grant, the
revoke→re-grant arc, and the authority/cross-space negatives all run through the one
`grantUser` / `revokeUser` vocabulary, never inline create/delete helpers. The same
spec also drives the co-member directory (ADR-0020) through the shared `visibility`
wrapper (`GET /author/graph/visibility?q=`): the picker/grant rows resolve the seeded
co-member `display_name`s, search narrows, and a non-member sees an empty directory.
A second describe-block in the same spec draws the `directory-picker` scenario's
ten-member space via `seedDirectoryPickerFixture` and exercises the PAGINATED picker
(ADR-0021): the `visibility` wrapper now returns `members` as a keyset PAGE
(`{ items, nextCursor, total }`) and accepts `{ cursor, limit }`, so the spec asserts a
page of 5 + an accurate "+N more" `total`, a "Show more" (`cursor`) next page with no
overlap, search narrowing the `total` below a page, and `p_exclude` dropping the owner +
already-granted (and a just-granted member) from BOTH the page and the count.

The containment-inheritance access-matrix spec
(`knowledge-containment-inheritance.e2e.spec.ts`, ADR-0023) likewise draws its whole
multi-owner tree from the shared `containment-inheritance` scenario via
`seedContainmentInheritanceFixture` — the folder grant (`grantUser`), the cross-owner
filing (`contain`, with the catalog's `contains.by` filer), the floor (`setFloor`) and
the cohort link (`linkScope`) are all created the product's way. The LIVE arcs (a NEW
child auto-appearing, a folder REVOKE removing the inherited subtree, a RE-GRANT, and a
`contains` cycle that must not hang or over-grant) run through the SAME
`seedClientFor(actor)` create-vocabulary, never inline create/delete helpers — so the
demo DB and the test exercise one owner-scoped inheritance predicate identically.

The lexical-search matrix spec (`knowledge-search.e2e.spec.ts`, ADR-0024 / slice-12)
draws its corpus from the shared `knowledge-base` scenario via `seedSearchCorpusFixture`,
and runs the search itself through the SAME create-vocabulary — `seedClientFor(actor).search`
POSTs `/author/graph/search`, the REAL route, RLS-fenced as the acting user — so a hit's
presence/absence is the live runtime truth. It asserts the match classes (Cyrillic /
accented / case-insensitive prefix, plus the Phase-2 fuzzy typo and title>description
ranking) and the security proof: another user's PRIVATE node is
ABSENT for a non-grantee, an ancestor-shared child is PRESENT for the grantee (inherited
grant), and a node in a SECOND tenant (built by the fixture, since the catalog is
single-space) stays out of an in-space search — every absence proven by RLS, not an app filter.

The SAME `seedSearchCorpusFixture` corpus also backs the Phase-3 cross-client proof
(ADR-0024 §5): a SECOND consumer of the search capability — the command palette — drives
the SAME `/author/graph/search` path under the SAME RLS transport, so its results are
IDENTICAL to the Drive lens for the same term. The command-palette render spec
(`knowledge-command-palette-search.e2e.spec.ts`) opens the palette in the browser (the
top-bar `command-palette-trigger`, then types into `command-palette-input`) over the SAME
shared fixture — no inline tree — and asserts the match classes (`договор` / `egerie` /
`GETTING`) plus the RLS-absence half (a non-grantee's PRIVATE node and another space's node
stay ABSENT), proving search is a SUBSTRATE capability, not Drive-bound. One corpus, two
consumers, one dictionary.

The Drive size-&-filter render spec (`knowledge-drive-size-filter.e2e.spec.ts`, ADR-0026
render) draws its whole tree from the shared `drive-size-filter` fixture (an e2e-only
scenario, `drive` + `media` presets) via `seedDriveSizeFilterFixture` — never an inline
`createFolder`/`createDoc`/upload tree — so the demo vocabulary and the test build the
known-byte-size tree the SAME way, through the one create-vocabulary (its `file`/`video`
bytes ride the SAME real media-upload transport as the media substrate, so the artifacts
carry real `media` satellites with `byteSize` — the "Only files" predicate requires a real
satellite, not a byte-less stub). The fixture is a small containment tree — a media branch
(a nested folder with a 512 B file + a 512 B video, so the folder sums to exactly 1 KB), a
media-less "empty" branch (a folder with only a text doc), and loose text/link leaves — plus
the three artifacts/doc `starred` so the FLAT Starred lens carries a mix. The spec (KB browse
LIST layout, forced via the `drive-layout=list` cookie) asserts the three behaviours purely in
the browser over the resolved canvas + `kbData`: (1) the Size column — a file/video shows its
humanized `byteSize` ("512 B"), a folder shows the recursive VISIBLE-descendant sum
("1 KB" = 512 + 512, the arithmetic proof; a media-less folder sums to "0 B"), a non-artifact
LEAF (text/link) shows "—"; (2) the "Only files" chip
(`aria-pressed`) in TREE mode PRUNES the containment to branches holding ≥1 artifact (the
media branch survives, the empty branch + loose leaves drop); (3) the same chip in FLAT mode
(the Starred lens) keeps ONLY uploaded artifacts (the two files stay, the starred doc drops).
It is purely presentational — no new endpoint, no resolver change.

The SAME `drive-size-filter` fixture ALSO backs the SEARCH-lens variant of that chip
(`knowledge-search-size-filter.e2e.spec.ts`, ADR-0026 render): the "Only files" chip now lives
on EVERY lens shelf via the shared `LensToolbar`, and on Search it FUNCTIONALLY filters the
result set (a flat leaf list) with the SAME `isUploadedArtifact` predicate. The fixture carries
two loose leaves sharing ONE distinctive title token (`Falcon`) — a REAL uploaded file
(`size/search-file`, an artifact) and a plain text node (`size/search-doc`, a non-artifact) — so
a single browser search for `Falcon` (POST `/author/graph/search`, RLS-fenced as the owner)
returns BOTH; toggling the chip ON keeps the file and drops the note (the chip filters, not just
renders). The search leaves are loose at the root + NOT starred, so the Drive folder-sum + Starred
proofs above are untouched. One fixture, two consumers (the Drive lenses + the Search lens), one
dictionary.

The KB media matrix spec (`knowledge-media-substrate.e2e.spec.ts`, ADR-0026 / slice-13, the
MERGE GATE) draws its corpus from the SAME `knowledge-base` scenario via
`seedMediaSubstrateFixture`, and drives the REAL upload/download transport against REAL
Storage through the shared create-vocabulary — `seedClientFor(actor).uploadMediaUrl` /
`.setMedia` / `.downloadMediaUrl` (the live `/author/graph/media` + `attribute:'media'`
routes), each RLS-fenced as the acting user. It proves the FUNCTIONAL path (upload → the exact
bytes round-trip on download → the ResourcePanel Media section) for `file` AND `video`, and the
SECURITY gate (the bytes inherit the FULL access model because `storage.objects` RLS delegates
to `auth_user_can_access_resource`): a non-grantee cannot mint a download URL nor fetch the
object directly, the direct/anon object path fails closed on the private bucket, a cross-space
node is unreachable, an ancestor-folder grantee downloads the nested file via the inherited
grant, a non-owner-non-grantee (no space-wide update) cannot mint an UPLOAD URL, and — the
read/write asymmetry — a NODE-ONLY read-grantee (a per-user grant, no space-wide update) CAN
download the granted file (read-grant composes on the storage-RLS SELECT) but is DENIED an
upload of it (the write fence mirrors node-UPDATE exactly — `owner OR space.knowledge.update`,
grants NOT composed — so a read-grantee can never overwrite the bytes; a direct object write
also fails and the owner's bytes stay intact). It ALSO proves the PURGE REAP (the ADR-0026
touch-item): trashing then purging a confirmed media node (the resource DELETE then the
trash-route DELETE, both through the shared create-vocabulary — `seedClientFor(actor).trash` /
`.purge`) best-effort reaps its `kb-media` object, so after the purge the object no longer
resolves and the `kmm` satellite is gone. The other-space negative is built in the
fixture's second tenant (the catalog is single-space). Every denial is proven by RLS, not an
app filter.

## Extending the catalog

When a feature lands, add or grow a scenario (declarative data + a real body + a
`summary`), wire it into a preset, and have a consuming e2e draw from it. The
`seed-curator` agent owns keeping the seed, the demo, and the e2e dictionary in
lockstep — never by seeding through migrations.
