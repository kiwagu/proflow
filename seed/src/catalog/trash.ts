import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * Trash scenario — the soft-delete lifecycle as demo content. A live folder holds
 * a kept doc beside a trashed one; two more folders are trashed WHOLE (their docs
 * soft-cascade with them, ADR-0018), plus a couple of loose trashed docs — so the
 * Trash lens has real content (folders + docs), all reversible.
 */
export const TRASH_SCENARIO: SeedScenario = {
  id: 'trash',
  title: 'Trash lifecycle',
  summary:
    'A populated Trash lens — two trashed folders (with their docs) and loose trashed docs beside a live folder; reversible soft-delete that preserves references.',
  presets: ['trash'],
  tree: [
    {
      ref: 'trash/folder',
      kind: 'folder',
      title: 'Cleanup',
      description: 'Soft-delete in action: one doc trashed, one kept.',
      children: [
        {
          ref: 'trash/kept',
          kind: 'text',
          title: 'Active Note',
          body: prose(
            'A live note that stays in the folder while its sibling sits in Trash.'
          ),
        },
        {
          ref: 'trash/removed',
          kind: 'text',
          title: 'Deleted Note',
          body: prose(
            'This note has been moved to Trash. It is hidden from normal browse but fully restorable.'
          ),
        },
      ],
    },
    {
      ref: 'trash/old-drafts',
      kind: 'folder',
      title: 'Old Drafts',
      description: 'A whole folder sent to Trash — its docs go with it.',
      children: [
        {
          ref: 'trash/old-drafts/q1',
          kind: 'text',
          title: 'Q1 Planning (archived)',
          body: prose(
            'Our Q1 planning doc — superseded by the current roadmap and kept only for reference.',
            'Moved to Trash during cleanup; restore it if we need the original numbers.'
          ),
        },
        {
          ref: 'trash/old-drafts/api',
          kind: 'text',
          title: 'Deprecated API Notes',
          body: prose(
            'Notes on the old v1 API, retired when we moved to v2.',
            'Safe to delete once the migration is fully done — here for now, in Trash.'
          ),
        },
      ],
    },
    {
      ref: 'trash/temp',
      kind: 'folder',
      title: 'Temp Uploads',
      description: 'A scratch folder nobody needs anymore.',
      children: [
        {
          ref: 'trash/temp/notes',
          kind: 'text',
          title: 'Throwaway Notes',
          body: prose(
            'Scratch notes from a brainstorm — nothing here was decided, so it went to Trash.'
          ),
        },
      ],
    },
    {
      ref: 'trash/cancelled',
      kind: 'text',
      title: 'Cancelled Meeting Notes',
      body: prose(
        'Notes for a sync that was cancelled. Trashed, but recoverable if the meeting is rescheduled.'
      ),
    },
  ],
  // The two folders trash WHOLE (their docs soft-cascade); the loose docs trash too.
  trash: ['trash/removed', 'trash/old-drafts', 'trash/temp', 'trash/cancelled'],
};
