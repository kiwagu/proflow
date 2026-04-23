---
title: Queries
description: Use when: implementing or reviewing Payload Local API, REST, or GraphQL query patterns.
tags: [payload, queries, local-api, rest, graphql]
---

# Payload CMS Queries

## Pyramid Layer

- Layer: L2 Payload router.

## Use This When

- Load this after the Payload router when the task is specifically about Local API, REST, or GraphQL query shapes.
- Use this file to choose the narrowest query leaf before loading examples.

## Stop Here If

- Stop here once the task is clearly about filter syntax, Local API access behavior, or transport/performance.

## Descend To

- Query operators and where clauses: `/.cursor/rules/query-operators-and-where-patterns.md`
- Local API methods and access behavior: `/.cursor/rules/local-api-and-access-behavior.md`
- REST, GraphQL, and performance: `/.cursor/rules/query-transports-and-performance.md`
- Return to `/.cursor/rules/payload-overview.md` if the task expands into sibling Payload concerns.

Query work splits into three narrow concerns:

1. Filter syntax and `where` clause composition.
2. Local API behavior and access-control semantics.
3. REST, GraphQL, and query performance.

Load only the matching leaf above.
