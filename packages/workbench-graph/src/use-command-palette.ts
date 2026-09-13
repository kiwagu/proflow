'use client';

import { useGraphNodes } from '@workspace/persistence-pglite/react';
import type { GraphNode } from '@workspace/persistence-pglite';
import { useHotkey } from '@workspace/ui/hooks/use-hotkey';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphReader, useSpaceId } from './graph-services.js';

/**
 * The command palette's state: the ⌘K / Ctrl+K binding, the term, and the
 * results.
 *
 * The search is the local title index (Postgres FTS over the replica, prefix
 * terms on the `simple` configuration with a substring fallback) — the same
 * query the search lens runs. That removes the debounce-and-fetch loop the
 * server-backed palette needed: a local query answers in one round-trip to the
 * worker, so the palette keeps up with typing and works offline.
 *
 * Results are still delivered in the reader's rank order and never re-ranked
 * by the list component.
 */

/** Below this many characters a term matches too much to be useful. */
const MIN_TERM_LENGTH = 2;

/**
 * The keystroke that opens the palette, exported so the surface that ADVERTISES
 * it renders from the same description the binding is registered with — a hint
 * and its shortcut cannot then drift apart. Render it with `hotkeyLabel`, which
 * is where the platform question is answered.
 */
export const COMMAND_PALETTE_HOTKEY = { key: 'k', mod: true } as const;

export function useCommandPalette() {
  const reader = useGraphReader();
  const spaceId = useSpaceId();

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  /**
   * The last answer the search produced, tagged with the term it answers.
   *
   * One piece of state rather than three, and it is written ONLY from the
   * query's callback — never from the effect body. That is what keeps the
   * empty/loading/results split derivable: an answer for a term the user has
   * moved past simply stops matching, so it can neither be shown nor be
   * mistaken for "resolved", and clearing the box needs no state reset at all.
   */
  const [answer, setAnswer] = useState<{
    term: string;
    rows: GraphNode[];
  } | null>(null);

  /**
   * The space's live nodes — held ONLY as a change signal for the search
   * below. Ranked title search is a one-shot query rather than a live one (it
   * has a term and a limit, which a subscription would have to re-open on
   * every keystroke anyway), so without this the results of an open palette
   * would keep listing a node someone has since trashed — and picking it would
   * open something that is no longer there. Subscribing to the rows the search
   * reads makes the box re-resolve when they change, which is the same
   * guarantee every other surface here gets for free.
   */
  const liveNodes = useGraphNodes(reader, spaceId, 'live');

  // ⌘K / Ctrl+K toggles the palette, through the app's one shortcut registry —
  // so it stays out of the way while the user is typing in the editor, and an
  // overlay's own binding can outrank it.
  useHotkey(COMMAND_PALETTE_HOTKEY, () => setOpen((prev) => !prev));

  const trimmed = term.trim();
  const tooShort = trimmed.length < MIN_TERM_LENGTH;
  const searching = open && !tooShort;

  // Every query gets a sequence number, and a result is only accepted when it
  // is still the newest: local queries are fast but not instantaneous, and out
  // of order delivery would show the results of a term the user has moved past.
  const sequence = useRef(0);

  useEffect(() => {
    if (!searching) {
      return;
    }
    const ticket = ++sequence.current;
    const accept = (rows: GraphNode[]) => {
      if (ticket === sequence.current) {
        setAnswer({ term: trimmed, rows });
      }
    };
    void reader
      .searchByTitle(spaceId, trimmed)
      // A failed local query answers with nothing rather than leaving the
      // previous rows up: showing hits that no longer match would be a lie.
      .then(accept, () => accept([]));
  }, [liveNodes, reader, searching, spaceId, trimmed]);

  /** Opening or closing resets to a fresh command box. */
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    setTerm('');
  }, []);

  /**
   * Escape dismisses an OPEN palette, registered only while it is open so the
   * key stays free for whatever is behind it otherwise. `whileTyping` because
   * the focus sits in the palette's own search box when the user reaches for
   * it — this is the dismiss class the registry's typing guard exempts.
   *
   * The dialog's own Escape handling would also close it; going through the
   * registry is what makes the close identical to every other one (the term is
   * reset, so re-opening is a fresh box) instead of a second path with its own
   * behaviour.
   */
  useHotkey(
    { key: 'Escape', whileTyping: true },
    () => handleOpenChange(false),
    {
      enabled: open,
    }
  );

  // An answer counts only while it answers the term in the box.
  const current = searching && answer?.term === trimmed ? answer : null;
  const items = current?.rows ?? [];
  const resolved = current !== null;

  return {
    open,
    setOpen: handleOpenChange,
    term,
    setTerm,
    trimmed,
    items,
    /** A query for the term in the box is still in flight. */
    loading: searching && !resolved,
    resolved,
    tooShort,
    /** Nothing matched a term long enough to have been searched. */
    showEmpty: resolved && items.length === 0,
  };
}

/**
 * What activating a node does — declared once so every surface (palette,
 * search lens, a card) dispatches identically and a new kind needs an entry
 * here rather than a branch at each call site.
 *
 *   - `navigate`: jump INTO the node as a location (containers)
 *   - `read`:     open it in the reader (documents)
 *   - `inspect`:  open the details panel (leaf resources — the default)
 */
export type NodeActivation = 'navigate' | 'read' | 'inspect';

const KIND_ACTIVATION: Record<string, NodeActivation> = {
  folder: 'navigate',
  text: 'read',
};

export function activationForKind(kind: string): NodeActivation {
  return KIND_ACTIVATION[kind] ?? 'inspect';
}

/** What a host wires the palette's selection to, one handler per activation. */
export type CommandPaletteHandlers = {
  onOpenFolder: (nodeId: string) => void;
  onOpenDocument: (nodeId: string) => void;
  onInspect: (node: GraphNode) => void;
};

/** Dispatch a picked node by its kind's activation behaviour. */
export function commitPaletteSelection(
  node: GraphNode,
  handlers: CommandPaletteHandlers
): void {
  switch (activationForKind(node.kind)) {
    case 'navigate':
      handlers.onOpenFolder(node.id);
      return;
    case 'read':
      handlers.onOpenDocument(node.id);
      return;
    default:
      handlers.onInspect(node);
  }
}
