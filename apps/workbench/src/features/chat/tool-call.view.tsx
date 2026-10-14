/**
 * Tool calls as the reader sees them.
 *
 * On the wire a call and its answer are two parts, arriving turns apart —
 * that is what makes an interrupted turn recoverable, and the `parts`
 * contract is not this view's to change. To a reader, though, they are one
 * event: "the assistant looked something up, and here is what came back".
 * So the pairing happens at render time, keyed by the call's `id`, and the
 * transcript shows one card per call that grows a result rather than two
 * cards that mention the same tool.
 *
 * Two decisions follow from that and are worth naming:
 *
 *  - a result with no matching call still gets a card. The call may have
 *    been persisted before a crash, or the stream may have dropped it; a
 *    result that renders nothing is a result the reader cannot tell from a
 *    tool that never ran.
 *  - the payload is truncated before it reaches the DOM, not hidden by CSS.
 *    A tool may answer with a whole file, and a transcript that pastes it
 *    in is a transcript nobody can scroll.
 */
import { Badge } from '@workspace/ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible';
import { cn } from '@workspace/ui/lib/utils';
import type { AssistantPart } from '@workspace/workbench-agent';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { ChatPanelLabels } from './chat.labels';

/** How much of a tool payload is worth showing inline, in characters. */
export const TOOL_PAYLOAD_LIMIT = 2000;

export type ToolCallState = 'running' | 'done' | 'failed';

/** One tool call with whatever has come back for it so far. */
export interface ToolCallGroup {
  id: string;
  name: string;
  state: ToolCallState;
  /** Absent when the call itself never arrived. */
  input?: unknown;
  output?: unknown;
  message?: string;
}

function isToolPart(
  part: AssistantPart
): part is Extract<AssistantPart, { id: string }> {
  return (
    part.type === 'tool-call' ||
    part.type === 'tool-result' ||
    part.type === 'tool-error'
  );
}

/**
 * Collapses a turn's parts into one group per tool call.
 *
 * Keyed by `id`, never by `name`: the same tool is routinely called twice
 * in a turn, and keying by name would show the second call's result under
 * the first call — reporting a call that is still running as finished.
 * Order follows first appearance, so the transcript reads in the order the
 * calls were made.
 */
export function groupToolCalls(parts: AssistantPart[]): ToolCallGroup[] {
  const groups = new Map<string, ToolCallGroup>();
  for (const part of parts) {
    if (!isToolPart(part)) continue;
    const group = groups.get(part.id) ?? {
      id: part.id,
      name: part.name,
      state: 'running' as ToolCallState,
    };
    if (part.type === 'tool-call') {
      group.input = part.input;
    } else if (part.type === 'tool-result') {
      group.output = part.output;
      group.state = 'done';
    } else {
      group.message = part.message;
      group.state = 'failed';
    }
    group.name = part.name;
    groups.set(part.id, group);
  }
  return [...groups.values()];
}

/** A payload as text, cut to a length a transcript can carry. */
export function formatPayload(value: unknown): {
  text: string;
  withheld: number;
} {
  const full = (() => {
    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      // A tool may answer with something that does not survive JSON —
      // a cycle, a BigInt. Showing its coarse shape beats showing nothing.
      return String(value);
    }
  })();
  if (full.length <= TOOL_PAYLOAD_LIMIT) return { text: full, withheld: 0 };
  return {
    text: full.slice(0, TOOL_PAYLOAD_LIMIT),
    withheld: full.length - TOOL_PAYLOAD_LIMIT,
  };
}

const BADGE_VARIANT: Record<
  ToolCallState,
  'secondary' | 'outline' | 'destructive'
> = {
  running: 'secondary',
  done: 'outline',
  failed: 'destructive',
};

/** One tool call: what was asked, what came back, and whether it is done. */
export function ToolCallView({
  group,
  labels,
}: {
  group: ToolCallGroup;
  labels: ChatPanelLabels;
}) {
  const status =
    group.state === 'running'
      ? labels.toolRunning
      : group.state === 'failed'
        ? labels.toolFailed
        : labels.toolDone;

  return (
    <div
      data-testid="chat-tool"
      data-state={group.state}
      className={cn(
        'border-border flex flex-col gap-1.5 rounded-md border px-2.5 py-2',
        group.state === 'failed' && 'border-destructive/60'
      )}
    >
      <div className="flex items-center gap-2">
        {group.state === 'running' ? (
          <Loader2 aria-hidden className="text-muted-foreground size-3" />
        ) : null}
        <span className="text-sm font-medium">{group.name}</span>
        <Badge variant={BADGE_VARIANT[group.state]} className="ml-auto">
          {status}
        </Badge>
      </div>

      {group.input === undefined ? null : (
        <Payload
          value={group.input}
          label={labels.toolInput}
          more={labels.toolMore}
          testId="chat-tool-input"
        />
      )}
      {group.output === undefined ? null : (
        <Payload
          value={group.output}
          label={labels.toolOutput}
          more={labels.toolMore}
          testId="chat-tool-output"
        />
      )}
      {group.message === undefined ? null : (
        <p className="text-destructive text-xs" data-testid="chat-tool-error">
          {group.message}
        </p>
      )}
    </div>
  );
}

/** A call's arguments or its answer, behind its own disclosure. */
function Payload({
  value,
  label,
  more,
  testId,
}: {
  value: unknown;
  label: string;
  more: (count: number) => string;
  testId: string;
}) {
  const { text, withheld } = formatPayload(value);
  return (
    <Collapsible>
      <CollapsibleTrigger
        data-testid={`${testId}-trigger`}
        className="text-muted-foreground flex items-center gap-1 text-xs"
      >
        <ChevronRight aria-hidden className="size-3" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre
          data-testid={`${testId}-body`}
          className="text-muted-foreground bg-muted/40 mt-1 max-h-60 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap"
        >
          {text}
        </pre>
        {withheld > 0 ? (
          <p
            data-testid={`${testId}-more`}
            className="text-muted-foreground mt-1 text-[11px]"
          >
            {more(withheld)}
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
