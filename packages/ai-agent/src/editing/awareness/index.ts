import type { Awareness } from '@workspace/ai-ops/queue';

/**
 * Where an AI writer's cursor is, as seen by other participants.
 *
 * The origin broadcasts this over live collaboration so people watching the
 * document see the assistant type. Nothing is watching here — the edit
 * session runs beside the only user — so the source records and discards.
 */
export interface AwarenessSource {
  apply(x: Awareness): void;
  clear(): void;
}

/** Records every applied `Awareness` and never broadcasts. */
export function mockAwarenessSource(): AwarenessSource & { seen: Awareness[] } {
  const seen: Awareness[] = [];
  return {
    seen,
    apply(x) {
      seen.push(x);
    },
    clear() {},
  };
}
