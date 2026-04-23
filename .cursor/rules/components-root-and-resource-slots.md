---
title: Custom Components - Root and Resource Slots
description: Use when: choosing root, collection, or global Payload admin component slots.
tags: [payload, components, slots, admin-ui]
---

# Payload Custom Components: Root and Resource Slots

## Pyramid Layer

- Layer: L4 Payload leaf.

## Use This When

- Load this after the slots-and-overrides router when the task is about where a component mounts in the admin shell or a resource screen.

## Stop Here If

- Stop once the correct root, collection, or global slot is identified.

## Descend To

- Return to `/.cursor/rules/components-slots-and-overrides.md` for field-slot or props siblings.

## Root Components

Root components change the overall admin shell and should stay rare.

| Surface | Config Path |
| --- | --- |
| Navigation shell | `admin.components.Nav` |
| Small icon | `admin.components.graphics.Icon` |
| Login or header logo | `admin.components.graphics.Logo` |
| Logout button | `admin.components.logout.Button` |
| Header actions | `admin.components.actions` |
| Header inserts | `admin.components.header` |
| Dashboard inserts | `admin.components.beforeDashboard`, `admin.components.afterDashboard` |
| Login screen inserts | `admin.components.beforeLogin`, `admin.components.afterLogin` |
| Navigation inserts | `admin.components.beforeNavLinks`, `admin.components.afterNavLinks` |
| Settings menu entries | `admin.components.settingsMenu` |
| Context providers | `admin.components.providers` |
| Custom views | `admin.components.views` |

```typescript
export default buildConfig({
  admin: {
    components: {
      graphics: {
        Logo: '/components/Logo',
        Icon: '/components/Icon',
      },
      actions: ['/components/ClearCacheButton'],
    },
  },
})
```

## Collection and Global Components

```typescript
import type { CollectionConfig, GlobalConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    components: {
      edit: {
        PreviewButton: '/components/PostPreview',
        SaveButton: '/components/CustomSave',
      },
      list: {
        Header: '/components/PostsListHeader',
        beforeList: ['/components/ListFilters'],
      },
    },
  },
  fields: [],
}

export const Settings: GlobalConfig = {
  slug: 'settings',
  admin: {
    components: {
      edit: {
        PreviewButton: '/components/SettingsPreview',
      },
    },
  },
  fields: [],
}
```

Use resource-level overrides when the customization belongs to one resource instead of the whole admin shell.