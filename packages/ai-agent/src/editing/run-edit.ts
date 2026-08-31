import {
  createEditingSession,
  loadSnapshot,
  toSnapshot,
} from '@workspace/ai-ops/ai-toolkit';
import { Doc } from '@workspace/ai-ops/doc';
import type { DocumentOp } from '@workspace/ai-ops/editor';
import { serializeWithXml } from '@workspace/ai-ops/utils';
import type { LanguageModel } from 'ai';
import type { SerializedEditorState } from 'lexical';
import { supervisor } from './agents';
import { mockAwarenessSource } from './awareness';
import type { CodeRunner } from './runtime';
import { runInSandbox } from './sandbox';
import type { UsageEntry } from './token-tracker';
import type { Writer } from './tools';

export type ResolvedModels = {
  supervisor: LanguageModel;
  interpret: LanguageModel;
  coding: () => LanguageModel;
};

export type RunEditArgs = {
  /** The document as the editor serializes it; the session edits a copy. */
  state: SerializedEditorState;
  prompt: string;
  models: ResolvedModels;
  /** Snippet runner — the QuickJS sandbox in the app, `new Function` in tests. */
  runner?: CodeRunner;
  signal?: AbortSignal;
  /** Run an intent-interpretation pass before dispatching edits. */
  interpret?: boolean;
  /**
   * Called as the session progresses, with the document as it stands so
   * far. Throttled: at most one call per `progressEveryMs`, plus the last.
   */
  onProgress?: (partial: EditOutcome) => void;
  progressEveryMs?: number;
};

export type EditOutcome = { ops: DocumentOp[]; state: SerializedEditorState };

export type { UsageEntry };

export type RunEditResult = {
  usage: UsageEntry[];
  /** Every operation the session applied, in order. */
  ops: DocumentOp[];
  /** The document after the session, for callers that persist it whole. */
  state: SerializedEditorState;
  text: string;
  clarification?: string;
};

/**
 * Run an AI edit session on a document.
 *
 * The origin ran this beside a live collaboration session: remote edits
 * folded into the working copy as they arrived, and the AI's writes went out
 * through the same sync. Here the session works on a headless copy of the
 * document handed in by the caller, and hands back both the operations (so
 * an open editor can replay them into its own undo stack) and the resulting
 * state (so a closed document can simply be saved).
 */
export async function runEditSession(
  args: RunEditArgs
): Promise<RunEditResult> {
  const session = createEditingSession();
  loadSnapshot(session, args.state);

  const allOps: DocumentOp[] = [];
  // Progress, throttled: serializing the session is not free, and the
  // listener repaints an editor on every call.
  const every = args.progressEveryMs ?? 400;
  let lastProgress = 0;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  const reportProgress = () => {
    if (!args.onProgress) return;
    const due = every - (Date.now() - lastProgress);
    if (due <= 0) {
      lastProgress = Date.now();
      args.onProgress({ ops: [...allOps], state: toSnapshot(session) });
      return;
    }
    if (progressTimer) return;
    progressTimer = setTimeout(() => {
      progressTimer = undefined;
      reportProgress();
    }, due);
  };
  // One writer per coder, as in the origin; without collaborators to show a
  // cursor to, a writer is a `Doc` over the shared session and nothing else.
  const borrowWriter = async (): Promise<Writer> => ({
    doc: new Doc(session),
    awarenessSource: mockAwarenessSource(),
    release: () => {},
  });

  const result = await supervisor(session, args.prompt, args.models, {
    borrowWriter,
    signal: args.signal,
    interpret: args.interpret,
    runner: args.runner ?? runInSandbox,
    // Animated typing exists for people watching a shared document; there is
    // no one to watch a worker.
    typingAnimations: false,
    onOps: (ops) => {
      allOps.push(...ops);
      reportProgress();
    },
  });
  if (progressTimer) clearTimeout(progressTimer);

  return {
    usage: result.totalUsage.toEntries(),
    ops: allOps,
    state: toSnapshot(session),
    text: result.text,
    clarification: result.clarification,
  };
}

/** The document's text as the models see it; exposed for tests and tooling. */
export function describeDocument(state: SerializedEditorState): string {
  const session = createEditingSession();
  loadSnapshot(session, state);
  return serializeWithXml(session);
}
