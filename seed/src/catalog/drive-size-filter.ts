import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Drive size-&-filter fixture — the worked example for the cross-lens "Only files"
 * (uploaded-artifacts) filter and the list-view Size column. Making
 * `file`/`video` REAL (a `media` satellite with `byteSize`) let the Drive add
 * two purely-presentational capabilities over the resolved canvas + `kbData`:
 *
 *  1. the "Only files" toggle chip (`graph.drive.filterUploaded`) — FLAT mode keeps only
 *     uploaded artifacts (a `file`/`video` with real bytes), a TREE/advanced render prunes
 *     the containment to branches that hold ≥1 artifact (ancestor folders on the path to a
 *     file survive; empty branches drop);
 *  2. the Size column (`graph.table.size`) in the list layout — a file/video shows its
 *     humanized `byteSize` (B/KB/MB via `formatBytes`), a folder shows the RECURSIVE SUM of
 *     its VISIBLE descendant artifact bytes (a media-less folder sums to 0 → "0 B", since the
 *     folder-size index totals EVERY folder), and a non-artifact LEAF (text/link/tag) shows
 *     an em dash "—".
 *
 * To assert the folder-size ARITHMETIC on a small known tree, the byte sizes are EXACT and
 * chosen to round cleanly: the two nested artifacts are 512 B + 512 B, so their common
 * subfolder — and every ancestor on their path — sums to exactly 1024 B = "1 KB". Fixtures
 * are UTF-8 ASCII (`'x'.repeat(n)`), so the string length IS the byte length.
 *
 * The tree deliberately mixes every prune/size case the two behaviours must cover:
 *  - `size/media-branch` ⊃ `size/nested` ⊃ two artifacts (512 B file + 512 B video) — the
 *    branch that SURVIVES "Only files" (ancestors kept to the files); the folder-sum path
 *    (nested → 1 KB, media-branch → 1 KB) for the arithmetic assertion;
 *  - `size/empty-branch` ⊃ a text doc, NO media — the branch that DROPS under "Only files"
 *    and whose Size cell is "0 B" (a folder with no descendant artifact sums to 0);
 *  - `size/loose-doc` (text) + `size/loose-link` (link) — loose non-artifact leaves that
 *    show "—" for Size and DROP under "Only files".
 *
 * The two artifacts AND the loose text doc are `starred`, so the FLAT Starred lens carries a
 * mix of artifacts + a non-artifact — the flat "Only files" keep-only-artifacts proof (the
 * two files stay, the starred doc drops), distinct from the TREE prune above.
 *
 * The SAME fixture ALSO proves the cross-lens "Only files" chip on the SEARCH lens (the chip
 * now lives on EVERY lens shelf via the shared `LensToolbar`). Search
 * RESULTS are a flat leaf list, so the chip filters them with the SAME `isUploadedArtifact`
 * predicate: ON keeps only uploaded artifacts. To exercise that in the browser, the fixture
 * adds two loose leaves under the root that share ONE distinctive title token (`Falcon`) so a
 * single search term matches BOTH — one an uploaded artifact, one a plain text node:
 *  - `size/search-file` (`Falcon Report (file)`) — a real 512 B file (an uploaded artifact),
 *    the SEARCH hit that SURVIVES "Only files";
 *  - `size/search-doc` (`Falcon Memo`) — a plain text node (a non-artifact), the SEARCH hit
 *    that DROPS under "Only files".
 * Both title-prefix-match `falcon` (case-insensitive, like the corpus `GETTING` proof), and
 * the token collides with no other node in the tree, so the search returns exactly these two.
 * They sit at the ROOT as loose leaves (NOT inside `size/nested`/`size/media-branch`), so the
 * folder-sum arithmetic (nested = 1 KB) the Drive spec asserts is untouched; and they are NOT
 * `starred`, so the FLAT Starred lens proof above is unchanged. The search leaves add only to
 * the SEARCH result set, which the Drive list/tree specs never read.
 *
 * e2e-only (like `drive-cascade` / `drive-copy-chain`): ABSENT from `ALL_SCENARIOS`, so it
 * never pollutes the demo Drive with contrived byte-sized files. The size/filter render spec
 * materializes it directly via `materializeFixture` and asserts against these named `ref`s.
 * It rides the `drive` + `media` presets (its `presets` field feeds `bun run seed:list`).
 */

/** The exact byte size of each seeded artifact — the string length equals the UTF-8 byte
 * length (ASCII `'x'.repeat`), so the Size column and the folder-sum are deterministic.
 * 512 + 512 = 1024 → the nested folder (and its ancestors) render "1 KB". */
export const SIZE_FILTER_BYTES = {
  /** `size/file-small` — a 512-byte file → "512 B". */
  fileSmall: 512,
  /** `size/video-small` — a 512-byte video → "512 B" (one substrate serves file & video). */
  videoSmall: 512,
} as const;

/** The subtree byte-sum of `size/nested` (and, transitively, `size/media-branch`): the two
 * 512-byte artifacts → 1024 B, which `formatBytes` renders as "1 KB". The folder-sum
 * arithmetic assertion keys on THIS. */
export const SIZE_FILTER_FOLDER_SUM =
  SIZE_FILTER_BYTES.fileSmall + SIZE_FILTER_BYTES.videoSmall;

const fill = (bytes: number): string => 'x'.repeat(bytes);

export const DRIVE_SIZE_FILTER_SCENARIO: SeedScenario = {
  id: 'drive-size-filter',
  title: 'Drive size & "Only files" fixture',
  summary:
    'A small containment tree with real uploaded artifacts of KNOWN byte sizes — the worked example for the cross-lens "Only files" (uploaded-artifacts) filter and the list-view Size column. A media branch (a nested folder with a 512 B file + a 512 B video → the folder sums to 1 KB) survives "Only files" and carries a size; an empty branch (a folder with only a text doc → Size "0 B") and loose text/link leaves (Size "—") drop under "Only files".',
  presets: ['drive', 'media'],
  tree: [
    {
      ref: 'size/root',
      kind: 'folder',
      title: 'Size Root',
      description:
        'Top of the size/filter fixture — the browse tree the Size column + "Only files" prune act over.',
      children: [
        {
          // The branch that SURVIVES "Only files" (its subtree holds artifacts) and whose
          // Size sums to its descendant artifact bytes (1 KB).
          ref: 'size/media-branch',
          kind: 'folder',
          title: 'Media Branch',
          description:
            'Holds the nested media — survives "Only files"; Size = the recursive descendant sum (1 KB).',
          children: [
            {
              // The innermost folder directly containing the two artifacts — the arithmetic
              // subject: 512 B + 512 B = 1024 B → the Size cell reads "1 KB".
              ref: 'size/nested',
              kind: 'folder',
              title: 'Nested Media',
              description:
                'Directly contains the two 512-byte artifacts — Size sums to exactly 1 KB.',
              children: [
                {
                  // A real 512-byte file → its own Size cell reads "512 B"; a member of the
                  // folder-sum; kept under "Only files" (an uploaded artifact).
                  ref: 'size/file-small',
                  kind: 'file',
                  title: 'Report A (file)',
                  description: 'A 512-byte uploaded file — Size "512 B".',
                  // Starred so it appears in the FLAT Starred lens — where "Only files"
                  // KEEPS it (an uploaded artifact) alongside the starred non-artifact
                  // that gets dropped (the flat keep-only-artifacts proof).
                  starred: true,
                  media: {
                    bytes: fill(SIZE_FILTER_BYTES.fileSmall),
                    mimeType: 'text/plain',
                    filename: 'report-a.txt',
                  },
                },
                {
                  // A real 512-byte VIDEO — one substrate serves file & video; its Size cell
                  // reads "512 B", it joins the folder-sum, and it survives "Only files".
                  // Real MP4 bytes are unnecessary for the size/filter render (no player is
                  // asserted here) — a tiny text-mime payload keeps the fixture deterministic
                  // AND makes the byte count exact. The mime must still pass the allow gate.
                  ref: 'size/video-small',
                  kind: 'video',
                  title: 'Clip B (video)',
                  description:
                    'A 512-byte uploaded video — Size "512 B"; joins the folder-sum.',
                  // Starred → present in the FLAT Starred lens; kept under "Only files".
                  starred: true,
                  media: {
                    bytes: fill(SIZE_FILTER_BYTES.videoSmall),
                    mimeType: 'video/mp4',
                    filename: 'clip-b.mp4',
                  },
                },
              ],
            },
          ],
        },
        {
          // The branch that DROPS under "Only files" (no descendant artifact) — its Size
          // cell is "0 B" (a folder with no descendant media sums to 0).
          ref: 'size/empty-branch',
          kind: 'folder',
          title: 'Empty Branch',
          description:
            'A folder with only a text doc — no media, so it DROPS under "Only files" and shows "0 B" for Size.',
          children: [
            {
              ref: 'size/doc-inside',
              kind: 'text',
              title: 'Branch Notes',
              description: 'A text doc — Size "—"; drops under "Only files".',
              body: prose(
                'A plain text document with no uploaded bytes. It exists to prove the "Only files" filter drops non-artifact nodes and the Size column shows an em dash for a non-artifact leaf.',
                'Because this is the only child of its folder, the folder itself has no descendant media — so it too drops under "Only files"; its Size cell sums to zero and reads "0 B".'
              ),
            },
          ],
        },
        {
          // A loose text leaf directly under the root — Size "—", drops under "Only files".
          ref: 'size/loose-doc',
          kind: 'text',
          title: 'Loose Note',
          description: 'A loose text doc — Size "—"; drops under "Only files".',
          // Starred so the FLAT Starred lens carries a NON-artifact alongside the two
          // starred artifacts — under "Only files" this one DROPS (the flat filter keeps
          // only uploaded artifacts), the two files stay.
          starred: true,
          body: prose(
            'A loose text note at the top of the fixture. It shows an em dash in the Size column and disappears when "Only files" is toggled on.'
          ),
        },
        {
          // A loose link leaf — Size "—", drops under "Only files" (a link is not an
          // uploaded artifact). Carries a REAL external URL (slice-10 §2.4): the card
          // meta shows the host, the panel Link section shows/opens the URL.
          ref: 'size/loose-link',
          kind: 'link',
          title: 'Loose Link',
          url: 'https://status.acme.example/incidents',
          description: 'A loose link — Size "—"; drops under "Only files".',
        },
        {
          // The SEARCH-lens "Only files" positive — a real uploaded artifact whose TITLE
          // shares the distinctive `Falcon` token so a single search term returns it AND the
          // non-artifact below. It SURVIVES "Only files" on the search shelf (an artifact).
          // Loose at the root + NOT starred, so the Drive folder-sum + Starred proofs are
          // untouched; it exists purely to be a searchable artifact hit.
          ref: 'size/search-file',
          kind: 'file',
          title: 'Falcon Report (file)',
          description:
            'A real uploaded file whose title matches the search token "Falcon" — the search-lens "Only files" positive (an artifact, kept).',
          media: {
            // A 512-byte text-mime payload — bytes are irrelevant to the search filter (only
            // the real media satellite matters for `isUploadedArtifact`), so reuse the same
            // deterministic ASCII fill the other artifacts use.
            bytes: fill(SIZE_FILTER_BYTES.fileSmall),
            mimeType: 'text/plain',
            filename: 'falcon-report.txt',
          },
        },
        {
          // The SEARCH-lens "Only files" negative — a plain text node sharing the SAME
          // `Falcon` title token, so the search returns it alongside the artifact above.
          // It DROPS under "Only files" on the search shelf (a non-artifact leaf), the proof
          // the chip FUNCTIONALLY filters search results, not just renders on the shelf.
          ref: 'size/search-doc',
          kind: 'text',
          title: 'Falcon Memo',
          description:
            'A plain text note whose title matches the search token "Falcon" — the search-lens "Only files" negative (a non-artifact, dropped).',
          body: prose(
            'A plain text memo whose title carries the distinctive "Falcon" token. It shares that term with a real uploaded file, so a single search for "Falcon" returns both — and toggling "Only files" on the search shelf drops this non-artifact note while keeping the file.'
          ),
        },
      ],
    },
  ],
};
