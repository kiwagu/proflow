/**
 * The assistant panel: the transcript, the live turn, and the composer.
 *
 * The session is handed in rather than opened here, so the panel is a pure
 * view over `UseChatSession` and a spec can drive it with a stub. Three
 * decisions are worth naming, because they are what makes a streaming chat
 * readable:
 *
 *  - the turn in flight renders from `streaming.parts`, never from
 *    `messages`. The session keeps them apart precisely so the transcript is
 *    not rewritten per chunk, and reading the live turn out of the
 *    transcript would throw that away and show the reply twice at the moment
 *    it settles.
 *  - an unknown part kind renders nothing. Tool calls are the next slice;
 *    until then the model may still emit them, and a surface that throws on
 *    a part it has not learned yet is a surface with no tools.
 *  - the view follows the reply only while the reader is already at the
 *    bottom. Scrolling up is how a user reads what has already arrived, and
 *    yanking them back down is the defect that makes a long answer
 *    unreadable.
 */
import { Button } from '@workspace/ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible';
import { EmptyState } from '@workspace/ui/components/empty-state';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from '@workspace/ui/components/input-group';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import { cn } from '@workspace/ui/lib/utils';
import type {
  AssistantPart,
  RenderableMessage,
  UseChatSession,
} from '@workspace/workbench-agent';
import { ChevronRight, Send, Square } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { type ChatPanelLabels, defaultChatPanelLabels } from './chat.labels';

/** How close to the bottom still counts as "following the reply", in px. */
const AT_BOTTOM_SLACK = 32;

export type ChatPanelProps = {
  session: UseChatSession;
  labels?: ChatPanelLabels;
  className?: string;
};

export function ChatPanel({ session, labels, className }: ChatPanelProps) {
  const copy = labels ?? defaultChatPanelLabels;
  const [draft, setDraft] = useState('');
  const viewport = useRef<HTMLDivElement | null>(null);
  // Whether the reader is following the stream. A ref, not state: it is read
  // during the scroll effect and must never cause a render of its own.
  const following = useRef(true);

  const { messages, streaming, generating, error, openError, ready } = session;

  // How much has arrived, as one number. The effect below runs when it
  // changes, which is exactly "new content appeared" — re-running on every
  // render would fight the user's own scrolling.
  const arrived =
    messages.length +
    messages.reduce((sum, message) => sum + message.parts.length, 0) +
    (streaming?.parts.length ?? 0);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !following.current) return;
    element.scrollTop = element.scrollHeight;
  }, [arrived]);

  const onScroll = () => {
    const element = viewport.current;
    if (!element) return;
    following.current =
      element.scrollHeight - element.clientHeight - element.scrollTop <=
      AT_BOTTOM_SLACK;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || generating || !ready) return;
    setDraft('');
    // Following again on send: the user just added to the conversation, so
    // the reply is what they are waiting for.
    following.current = true;
    void session.send(text);
  };

  const failure = error ?? openError;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}>
      <h2 className="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase">
        {copy.title}
      </h2>

      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={viewport}
        viewportProps={{
          onScroll,
          'data-testid': 'chat-transcript',
        }}
      >
        <div className="flex flex-col gap-3 pr-2">
          {messages.length === 0 && !streaming ? (
            <EmptyState data-testid="chat-empty">{copy.empty}</EmptyState>
          ) : null}
          {messages.map((message) => (
            <Turn key={message.id} message={message} labels={copy} />
          ))}
          {streaming ? (
            <Turn
              key={streaming.messageId}
              message={{
                id: streaming.messageId,
                role: 'assistant',
                text: '',
                parts: streaming.parts,
                status: 'streaming',
              }}
              labels={copy}
            />
          ) : null}
        </div>
      </ScrollArea>

      {failure ? (
        <p
          className="text-destructive px-1 text-xs"
          role="status"
          data-testid="chat-error"
        >
          {failure}
        </p>
      ) : null}

      <InputGroup>
        <InputGroupTextarea
          data-testid="chat-input"
          aria-label={copy.placeholder}
          placeholder={ready ? copy.placeholder : copy.opening}
          disabled={!ready}
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line: the convention every
            // chat composer shares, and the reason the field is a textarea.
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
        />
        <InputGroupAddon align="block-end">
          {generating ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              data-testid="chat-stop"
              onClick={() => session.stop()}
            >
              <Square aria-hidden />
              {copy.stop}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              data-testid="chat-send"
              disabled={!ready || draft.trim().length === 0}
              onClick={submit}
            >
              <Send aria-hidden />
              {copy.send}
            </Button>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

/** One message: the user's line, or the assistant's parts. */
function Turn({
  message,
  labels,
}: {
  message: RenderableMessage;
  labels: ChatPanelLabels;
}) {
  const mine = message.role === 'user';
  return (
    <div
      data-testid="chat-turn"
      data-role={message.role}
      className={cn('flex flex-col gap-1', mine && 'items-end')}
    >
      <span className="text-muted-foreground text-[11px] font-medium">
        {mine ? labels.you : labels.assistant}
      </span>
      {mine ? (
        <p className="bg-primary text-primary-foreground max-w-[85%] rounded-md px-2.5 py-1.5 text-sm whitespace-pre-wrap">
          {message.text}
        </p>
      ) : (
        <div className="flex max-w-full flex-col gap-2">
          {message.parts.map((part, index) => (
            <Part
              // Parts have no identity of their own; within one message their
              // order is the identity, and it only ever grows at the end.
              key={`${message.id}:${index}`}
              part={part}
              labels={labels}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single assistant part. Kinds this slice does not render yield nothing. */
function Part({
  part,
  labels,
}: {
  part: AssistantPart;
  labels: ChatPanelLabels;
}) {
  switch (part.type) {
    case 'text':
      return (
        <p className="text-sm whitespace-pre-wrap" data-testid="chat-text">
          {part.text}
        </p>
      );
    case 'thinking':
      return (
        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground flex items-center gap-1 text-xs">
            <ChevronRight aria-hidden className="size-3" />
            {labels.thinking}
          </CollapsibleTrigger>
          <CollapsibleContent className="text-muted-foreground border-border mt-1 border-l-2 pl-2 text-xs whitespace-pre-wrap">
            {part.thinking}
          </CollapsibleContent>
        </Collapsible>
      );
    default:
      // Tool calls, results and errors belong to the next slice. Rendering
      // nothing is deliberate; throwing here would take the panel down on a
      // part the model is free to send at any time.
      return null;
  }
}
