# Domain events (`@workspace/domain-events`)

Versioned envelope schemas for cross-service domain events — identity
lifecycle, space/org lifecycle, space invite notifications — plus their NATS
JetStream subject/stream constants.

## Role in the architecture

Contract package between producers and consumers of the event bus: an event's
shape (Zod envelope + parse helpers) and its address (stream name, subject
prefix, subject builders) are defined once here, so both sides compile against
the same truth. The `.nats` subpath exports keep transport constants separate
from the pure schemas — a consumer that only validates payloads never imports
NATS specifics.

## Commands

```bash
bun run build       # tsc -p tsconfig.build.json (emits dist/)
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
