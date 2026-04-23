---
title: Custom Components - Styling Performance and Troubleshooting
description: Use when: styling Payload custom components, optimizing admin runtime performance, or debugging component loading problems.
tags: [payload, components, styling, performance, troubleshooting]
---

# Payload Custom Components: Styling Performance and Troubleshooting

## Pyramid Layer

- Layer: L4 Payload leaf.

## Use This When

- Load this after the runtime-styling router when the task is about presentation quality or fixing broken component behavior.

## Stop Here If

- Stop once the styling rule or fix is clear.

## Descend To

- Return to `/.cursor/rules/components-runtime-and-styling.md` for hooks/data siblings.

## Styling

Prefer Payload theme tokens and admin SCSS primitives over hardcoded colors.

```tsx
import './styles.scss'
```

```scss
.my-component {
  background-color: var(--theme-elevation-500);
  color: var(--theme-text);
  padding: var(--base);
  border-radius: var(--border-radius-m);
}
```

If the component needs Payload SCSS mixins, import them explicitly.

```scss
@import '~@payloadcms/ui/scss';
```

## Performance Rules

1. Prefer server components unless the component truly needs client behavior.
2. Minimize client bundle size and avoid broad UI imports outside admin context.
3. Use `useFormFields` instead of broad form subscriptions.
4. Avoid repeated async client fetches.

## Troubleshooting

If admin hooks are undefined:

1. Confirm the file is a client component.
2. Confirm it renders inside the Payload admin runtime.
3. Confirm all `@payloadcms/*` packages are on the exact same version.

If the component still does not load:

1. Verify import-map generation.
2. Verify the configured slot path.
3. Verify the export name.
4. Check the component file for TypeScript errors.