'use client';

import * as React from 'react';

import { STRUCTURAL_LENS_SCOPES } from '../views/registry/projection-view.types';
import type {
  DriveScope,
  LensView,
} from '../views/registry/projection-view.types';

/**
 * The navigation LOCATION + URL/history sync for the Drive workbench.
 *
 * The location — current folder (`?folder=`, null → root), open document (`?doc=`, the
 * reader overlay), filter scope (`?scope=`, Starred/Recent/…), lexical-search term
 * (`?q=`) and lens display mode (`?view=`) — is mirrored in the URL so it survives
 * refresh and is shareable. But it is held in React STATE seeded from the SERVER-read
 * initial values, NOT read from `useSearchParams` during render: that keeps the SSR'd
 * HTML identical to the client's first render (no hydration mismatch). `pushState` keeps
 * the URL/history in sync; a `popstate` (browser back/forward, the reader's Back) reads
 * it back in.
 *
 * Selection (the Details drawer) stays OUTSIDE this hook — it is a transient drawer, not
 * a location. The nav callbacks that clear/record it receive `clearSelection`/`recordOpen`.
 */
export function useDriveNavigation({
  initialFolder,
  initialDoc,
  initialScope,
  initialSearchTerm,
  initialLensView,
  advancedStructuralEntitled,
  clearSelection,
  recordOpen,
}: {
  initialFolder: string | null;
  initialDoc: string | null;
  initialScope: DriveScope;
  initialSearchTerm: string;
  initialLensView: LensView;
  advancedStructuralEntitled: boolean;
  clearSelection: () => void;
  recordOpen: (nodeId: string) => void;
}) {
  const [folderId, setFolderId] = React.useState<string | null>(initialFolder);
  const [docId, setDocId] = React.useState<string | null>(initialDoc);
  const [scope, setScope] = React.useState<DriveScope>(initialScope);
  // The lexical-search term, mirrored in the URL (`?q=`) exactly as
  // `?folder=`/`?scope=` are — so a search lens is shareable + survives refresh. Only
  // carries meaning on the 'search' scope (the other lenses ignore it).
  const [searchTerm, setSearchTerm] = React.useState<string>(initialSearchTerm);
  // The lens display mode — seeded from the SERVER-resolved
  // EFFECTIVE mode (already clamped to 'flat' when the space is not entitled), so the
  // SSR'd toolbar + canvas agree with the client's first render (no hydration flip).
  // Mirrored in the URL (`?view=`) exactly as `?scope=`. The advanced entitlement is
  // the commercial gate; the client clamps too so a forged URL never advances the mode.
  const [lensView, setLensView] = React.useState<LensView>(initialLensView);

  // Write the location to the URL via the History API (no server re-run): the canvas
  // filters client-side, so navigation never refetches the (identical) data. A
  // relative `?query` keeps the app `basePath`; an empty query clears to the pathname.
  const pushLocation = React.useCallback(
    (loc: {
      folder: string | null;
      doc: string | null;
      scope: DriveScope;
      view: LensView;
      /** The search term — only set by the 'search'-scope callers (`?q=`). */
      q?: string;
    }) => {
      const params = new URLSearchParams();
      if (loc.folder) params.set('folder', loc.folder);
      if (loc.doc) params.set('doc', loc.doc);
      if (loc.scope !== 'kb') params.set('scope', loc.scope);
      // The Shared-lens display mode rides the URL exactly as `?scope=` does — only
      // when it deviates from the default 'flat', and only carries meaning on a
      // Shared scope (the server/view ignore it elsewhere).
      if (loc.view !== 'flat') params.set('view', loc.view);
      // The search term rides the URL only on the 'search' scope — a
      // shareable deep-link `?scope=search&q=<term>`. `loc.q` is undefined for every
      // non-search caller, so the param is absent everywhere else.
      if (loc.scope === 'search' && loc.q) params.set('q', loc.q);
      const qs = params.toString();
      window.history.pushState(
        null,
        '',
        qs ? `?${qs}` : window.location.pathname
      );
    },
    []
  );

  // Browser back/forward (and the reader's `router.back()`) change the URL without
  // one of our `pushState`s — sync state back from the URL so the canvas follows
  // history.
  React.useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      const s = p.get('scope');
      setFolderId(p.get('folder'));
      setDocId(p.get('doc'));
      setScope(
        s === 'home' ||
          s === 'starred' ||
          s === 'recent' ||
          s === 'shared' ||
          s === 'shared-by-me' ||
          s === 'trash' ||
          s === 'search'
          ? s
          : 'kb'
      );
      setSearchTerm(p.get('q') ?? '');
      // Clamp the URL `?view=` to the entitlement — a forged 'advanced' on a locked
      // plan reads back as 'flat' (the same fence the server applies on first load).
      setLensView(
        p.get('view') === 'advanced' && advancedStructuralEntitled
          ? 'advanced'
          : 'flat'
      );
      clearSelection();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [advancedStructuralEntitled, clearSelection]);

  // Browse the tree → a folder (null = root). Clears a now-stale selection + open doc.
  // Normally this returns to the 'kb' scope (the flat filters are not folders you enter)
  // — EXCEPT an advanced STRUCTURAL lens, which IS folder-
  // navigable WITHIN its lens: drilling a folder there STAYS on the lens scope
  // (`?scope=<lens>&folder=…&view=advanced`) and narrows to that folder's subtree within
  // the lens node-set (Shared / Shared-by-me / Starred / Trash).
  const goFolder = React.useCallback(
    (id: string | null) => {
      const stayInLens =
        STRUCTURAL_LENS_SCOPES.has(scope) &&
        lensView === 'advanced' &&
        advancedStructuralEntitled;
      const nextScope: DriveScope = stayInLens ? scope : 'kb';
      clearSelection();
      setFolderId(id);
      setDocId(null);
      setScope(nextScope);
      pushLocation({
        folder: id,
        doc: null,
        scope: nextScope,
        view: lensView,
      });
      if (id) {
        recordOpen(id); // entering a folder is a deliberate open (root is not a node)
      }
    },
    [
      pushLocation,
      recordOpen,
      clearSelection,
      lensView,
      scope,
      advancedStructuralEntitled,
    ]
  );

  // Switch the sidebar filter (kb / starred / recent) — a shareable location. Leaving
  // KB is signalled to the caller via `onLeaveKb` so it can close the split (a
  // KB-browse-only affordance).
  const goScope = React.useCallback(
    (next: DriveScope, onLeaveKb?: () => void) => {
      clearSelection();
      setScope(next);
      if (next !== 'kb') {
        onLeaveKb?.();
      }
      // Clicking a sidebar lens always lands at its ROOT — a flat lens is not a folder
      // location, and the KB lens returns to the tree root (it must NOT inherit a folder
      // drilled in the advanced Shared tree, whose `?folder=` is a Shared-subset node).
      // This is also what frees the KB lens from the advanced-Shared folder-drill that
      // keeps `goFolder` on the Shared scope: the lens switch roots here.
      setFolderId(null);
      pushLocation({
        folder: null,
        doc: docId,
        scope: next,
        view: lensView,
        // Entering 'search' carries the current term into the URL; any other scope
        // leaves `q` absent (the param is search-only).
        q: next === 'search' ? searchTerm : undefined,
      });
    },
    [pushLocation, clearSelection, docId, lensView, searchTerm]
  );

  // Live search-term changes — mirror the term into client state +
  // the URL (`?q=`) via `replaceState` (no new history entry per keystroke), so the
  // search lens is shareable + survives refresh without flooding browser history.
  const setSearch = React.useCallback((next: string) => {
    setSearchTerm(next);
    const params = new URLSearchParams();
    params.set('scope', 'search');
    if (next) {
      params.set('q', next);
    }
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, []);

  // Switch the lens display mode — Flat ↔ Advanced. Only
  // reachable from a structural lens's toolbar toggle (shown for the STRUCTURAL_LENS_
  // SCOPES and ENABLED only when entitled), so 'advanced' can never be set on a locked
  // plan from here; the URL clamp (popstate) + the server clamp guard the hand-edited path.
  const goLensView = React.useCallback(
    (next: LensView) => {
      const effective =
        next === 'advanced' && advancedStructuralEntitled ? next : 'flat';
      setLensView(effective);
      // PERSIST the choice via a server-read cookie, exactly
      // as the grid/list layout toggle does — so the mode is remembered across sessions
      // (the server reads it on the next load with no hydration flip). GATED to the
      // entitled (Pro) plan: a locked plan never writes the cookie, so it can never
      // remember 'advanced' (the toggle is disabled there anyway; this is belt-and-braces).
      if (advancedStructuralEntitled && typeof document !== 'undefined') {
        document.cookie = `lens-view=${effective};path=/;max-age=31536000;samesite=lax`;
      }
      // FLAT is a digest, not a folder location — leaving the advanced tree drops any
      // drilled `?folder=` so the flat lens shows its whole set (and the URL is clean).
      const nextFolder = effective === 'flat' ? null : folderId;
      if (effective === 'flat') {
        setFolderId(null);
      }
      pushLocation({ folder: nextFolder, doc: docId, scope, view: effective });
    },
    [pushLocation, folderId, docId, scope, advancedStructuralEntitled]
  );

  // Open a document in the reader overlay (dismiss the transient Details panel).
  const openDocument = React.useCallback(
    (id: string) => {
      clearSelection();
      setDocId(id);
      pushLocation({ folder: folderId, doc: id, scope, view: lensView });
      recordOpen(id);
    },
    [pushLocation, clearSelection, folderId, scope, recordOpen, lensView]
  );

  return {
    folderId,
    setFolderId,
    docId,
    setDocId,
    scope,
    setScope,
    searchTerm,
    lensView,
    pushLocation,
    goFolder,
    goScope,
    setSearch,
    goLensView,
    openDocument,
  };
}
