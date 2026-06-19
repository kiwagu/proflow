// MOCK — pending backend (slice-11), for owner discussion.
//
// The Notion reading canvas renders the open page's BODY as inline paragraphs with
// inline @-mention chips (prototype `NotionReader` + `Mention`). The document body
// for `kind=text` lives in Payload (Lexical, ADR-0002) and the read-path for that
// body is NOT built in this slice — the node only carries a `body_ref` indicator.
// Inline mention ANCHORS inside the Lexical body are a further seam (a mention node
// that fan-outs a `relates_to` edge on save — slice-11 §5 engine-gap 3 / OPEN
// DECISION 3, deferred to prototype-parity).
//
// To reach pixel-1:1 NOW and surface that gap for the owner, this module returns a
// DETERMINISTIC stub body explicitly marked as a mock (owner directive Ф4 §2 — a
// labelled stub, never a silent fake). The REAL backlinks + the REAL mentions
// callout (out-`relates_to` from `resolveNeighborhood`) are NOT mocked — only the
// page body text and the inline-anchor placement of mentions inside that text.
//
// What is mocked here (and ONLY here):
//   • the page body paragraphs — a fixed, title-seeded set of sentences.
//   • the inline placement of the page's REAL out-`relates_to` neighbors as @-mention
//     chips WITHIN that mocked body (the mention TARGETS are real graph edges; only
//     their inline anchoring in the prose is synthetic, since the real Lexical body
//     has no mention anchors yet).
//
// Everything else in the canvas (breadcrumb, tags, description, health, the mentions
// CALLOUT list, backlinks) is REAL. When the body read-path + inline-mention anchors
// land, delete this file and render the real Lexical body — the canvas shape is
// unchanged.

/** One real out-`relates_to` neighbor the page mentions (id + display title). */
export type MockMentionTarget = { id: string; title: string };

/** A run within a mocked body paragraph: plain text, or an inline mention chip
 * pointing at a REAL related node. */
export type MockBodyRun =
  | { type: 'text'; text: string }
  | { type: 'mention'; id: string; title: string };

/** A mocked body paragraph = an ordered list of text/mention runs. */
export type MockBodyParagraph = { runs: MockBodyRun[] };

/**
 * Build a deterministic mocked body for the open Notion page. The prose is fixed
 * (title-seeded) so the canvas is pixel-1:1; the page's REAL out-`relates_to`
 * neighbors are woven in as inline @-mention chips so the inline-mention affordance
 * is exercised against real graph data. Deterministic: same node + same mentions →
 * same body, every render (no randomness, no silent variation).
 *
 * `mentions` MUST already be the real out-`relates_to` neighbors of the node (read
 * from `resolveNeighborhood`). The first two are anchored inline in the prose; any
 * extra still appear in the (real) mentions callout above.
 */
export function mockNotionBody(args: {
  title: string;
  mentions: MockMentionTarget[];
}): MockBodyParagraph[] {
  const { title, mentions } = args;
  const [first, second] = mentions;

  const paragraphs: MockBodyParagraph[] = [
    {
      runs: [
        {
          type: 'text',
          text: `${title} is part of the knowledge base. This page describes its purpose and how it connects to the rest of your space.`,
        },
      ],
    },
  ];

  if (first) {
    paragraphs.push({
      runs: [
        { type: 'text', text: 'For the related context, see ' },
        { type: 'mention', id: first.id, title: first.title },
        {
          type: 'text',
          text: second
            ? ', which in turn builds on '
            : '. Follow the link to keep reading.',
        },
        ...(second
          ? ([
              { type: 'mention', id: second.id, title: second.title },
              { type: 'text', text: '. Follow either link to keep reading.' },
            ] as MockBodyRun[])
          : []),
      ],
    });
  }

  paragraphs.push({
    runs: [
      {
        type: 'text',
        text: 'Backlinks below show every page that references this one — the same graph, read as documents that link documents.',
      },
    ],
  });

  return paragraphs;
}
