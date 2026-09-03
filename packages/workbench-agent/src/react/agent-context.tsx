/**
 * @file The agent, as the React tree sees it.
 *
 * One worker per page, started by the composition root and handed down —
 * a component asks for the agent, never for a Worker. The provider also
 * owns the single registration of editor hooks on the worker client, so an
 * editor pane can register itself with a hook instead of reaching into the
 * client.
 */
import type { AgentWorkerClient, EditOutcome } from '@workspace/ai-agent';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react';
import type { EditorDocumentBridge } from '../editor/bridge';
import {
  createEditorBridgeRegistry,
  openDocumentHooks,
} from '../editor/bridge';

export interface AgentContextValue {
  client: AgentWorkerClient;
  /**
   * Register the live editor the agent should read from and write to.
   * Returns the disposer; the last registration wins.
   */
  registerEditorBridge: (bridge: EditorDocumentBridge) => () => void;
}

const Ctx = createContext<AgentContextValue | null>(null);

export function AgentProvider(props: {
  client: AgentWorkerClient;
  children: ReactNode;
}) {
  // Lazy state, not a ref: the registry is created once and read during
  // render to build the context value, which a ref may not be.
  const [registry] = useState(createEditorBridgeRegistry);
  const { client } = props;

  useEffect(() => {
    client.setOpenDocumentHooks(openDocumentHooks(registry.current));
    return () => client.setOpenDocumentHooks(undefined);
  }, [client, registry]);

  const value = useMemo<AgentContextValue>(
    () => ({ client, registerEditorBridge: registry.register }),
    [client, registry]
  );

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAgent must be used within <AgentProvider />');
  return ctx;
}

/**
 * Registers an editor with the agent for as long as the caller is mounted.
 *
 * The bridge is re-read per call through effect events rather than captured,
 * so an editor whose document changes does not have to re-register — and a
 * registration is not torn down and rebuilt on every render.
 */
export function useEditorBridge(bridge: EditorDocumentBridge): void {
  const { registerEditorBridge } = useAgent();

  const documentId = useEffectEvent(() => bridge.documentId());
  const readState = useEffectEvent((id: string) => bridge.readState(id));
  const applyEdit = useEffectEvent(
    (id: string, result: EditOutcome, partial: boolean) =>
      bridge.applyEdit(id, result, partial)
  );

  useEffect(
    () => registerEditorBridge({ documentId, readState, applyEdit }),
    [registerEditorBridge]
  );
}
