---
title: Custom Components - Paths and Import Map
description: Use when: registering Payload custom components by path, configuring export names, or fixing importMap/baseDir resolution.
tags: [payload, components, import-map, registration]
---

# Payload Custom Components: Paths and Import Map

## Pyramid Layer

- Layer: L4 Payload leaf.

## Use This When

- Load this after the registration-and-boundaries router when the problem is component path wiring or import map resolution.

## Stop Here If

- Stop once the component resolves correctly.

## Descend To

- Return to `/.cursor/rules/components-registration-and-boundaries.md` for boundary/type siblings.

## Registration Rules

```typescript
import { buildConfig } from 'payload'

export default buildConfig({
  admin: {
    components: {
      logout: {
        Button: '/src/components/Logout#MyComponent',
      },
      Nav: '/src/components/Nav',
    },
  },
})
```

Use these rules consistently:

1. Paths are relative to the project root unless `config.admin.importMap.baseDir` changes that base.
2. Use `#NamedExport` or `exportName` for named exports.
3. Omit the suffix for default exports.
4. Keep file extensions omitted unless a specific environment requires them.

## Config Object Form

```typescript
{
  logout: {
    Button: {
      path: '/src/components/Logout',
      exportName: 'MyComponent',
      clientProps: { buttonText: 'Sign out' },
      serverProps: { auditScope: 'admin' },
    },
  },
}
```

## importMap and baseDir

```typescript
import path from 'path'
import { fileURLToPath } from 'node:url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname, 'src'),
      importMapFile: path.resolve(dirname, 'app', '(payload)', 'custom-import-map.js'),
    },
    components: {
      Nav: '/components/Nav',
    },
  },
})
```

Use `importMapFile` only when you intentionally need a non-default generated file location.

## Import Map Lifecycle

Payload regenerates the import map automatically on:

1. Application startup.
2. Development HMR.
3. Manual `payload generate:importmap` runs.

The import map is not regenerated during normal runtime after startup or after a production build completes.

When component registration changes and Payload cannot resolve the file, regenerate the import map.

```bash
payload generate:importmap
```

Do not hand-edit the generated import map file. Change config or component paths instead.

## Plugin Author Escape Hatch

If a plugin needs a custom import that is not referenced in a standard component slot, register it through `admin.dependencies` instead of hacking the generated import map.