---
title: Custom Endpoints
description: Use when: adding or changing custom Payload REST endpoints, auth checks, or endpoint helper patterns.
tags: [payload, endpoints, api, routes, webhooks]
---

# Payload Custom Endpoints

## Pyramid Layer

- Layer: L2 Payload router.

## Use This When

- Load this after the Payload router when the task is specifically about custom REST endpoints, authentication checks, or webhook handlers.
- Use this file to choose the narrowest endpoint leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about handler logic, endpoint placement, or response/error shape.

## Descend To

- Request parsing and auth patterns: `/.cursor/rules/endpoints-request-and-auth-patterns.md`
- Placement and mounting surfaces: `/.cursor/rules/endpoints-placement-and-routing.md`
- CORS, errors, and response shaping: `/.cursor/rules/endpoints-errors-cors-and-responses.md`
- Return to `/.cursor/rules/payload-overview.md` if the task expands into sibling Payload concerns.

Endpoint work splits into three narrow concerns:

1. Request parsing and auth checks inside handlers.
2. Placement on collection, global, or root config surfaces.
3. CORS, error handling, and response shaping.

Load only the matching leaf above.
