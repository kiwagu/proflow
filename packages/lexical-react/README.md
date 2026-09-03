# Lexical React bindings (`@workspace/lexical-react`)

The React layer over the headless `@workspace/lexical-nodes` package:
`EditorMount`, the plugin manager, decorator registry, reactive signal/store
helpers, and the editor theme/styles.

## Role in the architecture

`@workspace/lexical-nodes` stays framework-free; everything that needs React
(mounting an editor, rendering decorator nodes, node accessory menus, plugin
composition) lives here. Hosts import `EditorMount` plus the plugin set and get
a working editor; decorators are registered as plain `React.FC` components so
the node package never learns about React. Ships `./styles.css` for the editor
chrome.

## Commands

```bash
bun run test        # vitest
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
