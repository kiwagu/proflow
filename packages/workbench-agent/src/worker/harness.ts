/**
 * @file A dev harness for the page↔worker bridge.
 *
 * The bridge is the pair of ends that only exist together: the page's
 * client and the worker's serve loop, talking over `postMessage`. Testing
 * either alone proves nothing about the pairing — a renamed message type
 * would pass both halves' own specs and break the product. So the harness
 * runs the real client against the real serve loop with a linked pair of
 * message ports standing in for the Worker, and asserts on what crosses.
 *
 * What it deliberately does NOT do is start a real Worker: the worker's
 * composition root opens a database and loads WebAssembly, neither of which
 * belongs in a unit test. The module under test is the protocol.
 */
import { createAgentWorkerClient, serveAgent } from '@workspace/ai-agent';

/**
 * A `Worker`-shaped object over one end of a `MessageChannel`, and the
 * global scope the worker side of the protocol expects on the other.
 *
 * `serveAgent` reads `self`, so the worker end is installed as `self` for
 * the duration of the call and restored afterwards — the alternative is
 * making production code take its scope as a parameter purely for a test.
 */
export function linkedWorkerPair(): {
  page: Worker;
  runWorkerSide: (serve: () => void) => void;
  close: () => void;
} {
  const channel = new MessageChannel();
  channel.port1.start();
  channel.port2.start();

  const page = {
    postMessage: (message: unknown) => channel.port1.postMessage(message),
    addEventListener: (type: string, handler: EventListener) =>
      channel.port1.addEventListener(type, handler),
    removeEventListener: (type: string, handler: EventListener) =>
      channel.port1.removeEventListener(type, handler),
    terminate: () => {
      channel.port1.close();
      channel.port2.close();
    },
  } as unknown as Worker;

  return {
    page,
    runWorkerSide(serve) {
      const globals = globalThis as { self?: unknown };
      const previous = globals.self;
      globals.self = channel.port2;
      try {
        serve();
      } finally {
        globals.self = previous;
      }
    },
    close() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/**
 * A live page↔worker pair: the real client, the real serve loop, and the
 * agent dependencies a spec supplies.
 */
export function createBridgeHarness(deps: Parameters<typeof serveAgent>[0]): {
  client: ReturnType<typeof createAgentWorkerClient>;
  close: () => void;
} {
  const link = linkedWorkerPair();
  const client = createAgentWorkerClient(link.page);
  link.runWorkerSide(() => serveAgent(deps));
  return { client, close: link.close };
}
