# `editor` API

All edits go through the `editor` object. `id` is a node id from the XML. Methods that create a node return a handle you can pass to later calls. Pass plain text only. `scope` is optional: `{ kind: 'all' }` for every match, `{ kind: 'nth', n: N }` for the 1-based Nth match, or omitted (defaults to `{ kind: 'all' }`).

## Inline Formatting By Match

- `bold(id, match, scope?)` · `italic(id, match, scope?)` · `underline(id, match, scope?)` · `strike(id, match, scope?)` · `inlineCode(id, match, scope?)`
- `unbold(id, match, scope?)` · `unitalic(id, match, scope?)` · `ununderline(id, match, scope?)` · `unstrike(id, match, scope?)` · `uninlineCode(id, match, scope?)`
- `format(id, match, format, on?, scope?)` where `format` is `bold`, `italic`, `underline`, `strike`, or `code`
- `clearFormat(id, match?, scope?)` · `clearAllFormat(id)`
- `highlight(id, match, scope?)` · `unhighlight(id, match, scope?)`
- `link(id, match, url, scope?)` · `unlink(id, match, scope?)`

```ts
editor.bold('b1', 'quick');
editor.italic('b1', 'brown');
editor.highlight('b1', 'the');
editor.link('b1', 'fox', 'https://x');
```

Before:

```xml
<root>
  <p id="b1">
    <text id="t1">the quick brown fox</text>
  </p>
</root>
```

After:

```xml
<root>
  <p id="b1">
    <mark id="b2">
      <text id="t1">the</text>
    </mark>
    <text id="t2"> </text>
    <text id="t3" bold="true">quick</text>
    <text id="t4"> </text>
    <text id="t5" italic="true">brown</text>
    <text id="t6"> </text>
    <a id="b3" href="https://x">
      <text id="t7">fox</text>
    </a>
  </p>
</root>
```

## Inline Formatting By Text Node

- `boldNode(textId)` · `italicNode(textId)` · `underlineNode(textId)` · `strikeNode(textId)` · `codeNode(textId)`
- `formatNode(textId, format, on?)` · `clearNodeFormat(textId)`

```ts
editor.boldNode('t1');
editor.underlineNode('t1');
```

Before:

```xml
<root>
  <p id="b1">
    <text id="t1">Hello world</text>
  </p>
</root>
```

After:

```xml
<root>
  <p id="b1">
    <text id="t1" bold="true" underline="true">Hello world</text>
  </p>
</root>
```

## Text Content

- `setText(id, text)` — replaces the block's whole contents with one plain run, deleting any bold/code spans, links, mentions and line breaks it contained. Use it to rewrite a block from scratch.
- `replace(id, find, to, scope?)` — rewrites matching text in place, leaving the rest of the block intact. Use it to edit existing prose. `find` must sit within a single text run.
- `appendText(id, text)` · `prependText(id, text)`
- `setEquation(id, tex)`

```ts
editor.setText('b1', 'replaced');
editor.appendText('b2', '!!!');
editor.prependText('b3', '> ');
editor.replace('b3', 'third', 'THIRD');
editor.setEquation('eq1', 'y^2');
```

Before:

```xml
<root>
  <p id="b1"><text id="t1">first</text></p>
  <p id="b2"><text id="t2">second</text></p>
  <p id="b3"><text id="t3">third</text></p>
  <equation id="eq1" equation="x^2" />
</root>
```

After:

```xml
<root>
  <p id="b1"><text id="t1">replaced</text></p>
  <p id="b2"><text id="t2">second!!!</text></p>
  <p id="b3"><text id="t3">&gt; THIRD</text></p>
  <equation id="eq1" equation="y^2" />
</root>
```

## Block Type Conversion

- `convertToParagraph(id)` · `convertToHeading(id, level)` · `convertToQuote(id)` · `convertToCodeBlock(id, language)` · `setLanguage(id, language)`

```ts
editor.convertToHeading('b1', 2);
editor.convertToQuote('b2');
editor.convertToCodeBlock('b3', 'ts');
editor.convertToParagraph('b4');
editor.setLanguage('b3', 'python');
```

Before:

```xml
<root>
  <p id="b1"><text id="t1">Title</text></p>
  <p id="b2"><text id="t2">A quote</text></p>
  <p id="b3"><text id="t3">code here</text></p>
  <h3 id="b4"><text id="t4">Back to paragraph</text></h3>
</root>
```

After:

```xml
<root>
  <h2 id="b1~v1"><text id="t1">Title</text></h2>
  <blockquote id="b2~v1"><text id="t2">A quote</text></blockquote>
  <code id="b3~v1" language="python">code here</code>
  <p id="b4~v1"><text id="t4">Back to paragraph</text></p>
</root>
```

Converting a block's type gives it a fresh id: the old id with a `~vN` suffix (`b1` → `b1~v1`, again → `b1~v2`). It's the SAME block — the suffix just marks the retype, and the stem tells you which block it was. Both the suffixed id and the original resolve later in the same code, but going forward use the id shown in the latest XML.

## Lists

- `bulletList(idOrIds)` · `numberedList(idOrIds)` · `checklist(idOrIds)` · `setListType(id, kind)`
- `check(id)` · `uncheck(id)` · `setChecked(id, bool)`
- `indent(id, by?)` · `outdent(id, by?)` · `setIndent(id, level)`
- `insertListItemAfter(liId, text, list?)` · `insertListItemBefore(liId, text, list?)` · `removeListItem(liId)`
- `appendListItem(listId, text)` · `prependListItem(listId, text)`

To add an item relative to an _existing_ sibling, use `insertListItemAfter`/`Before` with that `<li>`'s id. `list` (`'bullet'`|`'number'`|`'check'`, default `'bullet'`) sets the new item's kind; when it differs from the surrounding list, the item is wrapped in a nested sublist of that kind.

To add an item to a list as a whole -- including a list that is currently **empty** (no `<li>` to anchor on) -- use `appendListItem`/`prependListItem` with the `<ul>`/`<ol>` id; the item inherits the list's kind. All four methods return a handle to the new `<li>` you can use in later calls.

```ts
editor.checklist(['b1', 'b2']);
editor.check('b1');
editor.indent('b2');
editor.outdent('b2');
editor.setChecked('b2', false);
const li = editor.insertListItemAfter('li1', 'second item');
editor.insertListItemAfter(li, 'nested', 'number');
editor.removeListItem('li2');
const first = editor.appendListItem('ol3', 'first step'); // populate an empty list
editor.appendListItem('ol3', 'second step');
```

Before:

```xml
<root>
  <ul id="list1"><li id="li1"><text id="t1">first item</text></li><li id="li2"><text id="t2">old item</text></li></ul>
</root>
```

After:

```xml
<root>
  <ul id="list1">
    <li id="li1"><text id="t1">first item</text></li>
    <li id="b1"><text id="t3">second item</text></li>
    <li id="b2">
      <ol id="b3"><li id="b4"><text id="t4">nested</text></li></ol>
    </li>
  </ul>
</root>
```

Before:

```xml
<root>
  <p id="b1"><text id="t1">task b</text></p>
  <p id="b2"><text id="t2">task a</text></p>
  <ul id="list1"><li id="li1"><text id="t3">z</text></li><li id="li2"><text id="t4">a</text></li></ul>
</root>
```

After:

```xml
<root>
  <ul id="b3">
    <li id="b4"><text id="t1">task b</text></li>
    <li id="b5"><text id="t2">task a</text></li>
  </ul>
  <ul id="list1"><li id="li2"><text id="t4">a</text></li><li id="li1"><text id="t3">z</text></li></ul>
</root>
```

The XML view does not show a list's kind or an item's checked state — a check list renders as `<ul>` like any other. Do not infer either from the XML; act on the instruction you were given.

## Structure

- `insertParagraphAfter(id, text?)` · `insertParagraphBefore(id, text?)`
- `insertHeadingAfter(id, level, text?)` · `insertHeadingBefore(id, level, text?)`
- `insertQuoteAfter(id, text?)` · `insertCodeBlockAfter(id, language, text?)`
- `insertBlockAfter(id, spec)` · `insertBlockBefore(id, spec)`
- `appendParagraph(text?)` · `prependParagraph(text?)` · `appendBlock(spec)` · `prependBlock(spec)`
- `move(id, position)` where `position` is `{ after: id }`, `{ before: id }`, `{ appendToRoot: true }`, or `{ prependToRoot: true }`
- `remove(id)` · `removeMany(ids)` · `merge(ids, separator?)`

```ts
editor.insertHeadingBefore('b1', 1, 'Title');
const c = editor.insertParagraphAfter('b2', 'Conclusion');
editor.appendText(c, '!');
editor.appendParagraph('Footer');
editor.move('b2', { after: c });
editor.remove('b4');
```

Before:

```xml
<root>
  <p id="b1"><text id="t1">Intro</text></p>
  <p id="b2"><text id="t2">Body</text></p>
  <p id="b4"><text id="t3">Remove me</text></p>
</root>
```

After:

```xml
<root>
  <h1 id="b3"><text id="t4">Title</text></h1>
  <p id="b1"><text id="t1">Intro</text></p>
  <p id="b5"><text id="t5">Conclusion!</text></p>
  <p id="b2"><text id="t2">Body</text></p>
  <p id="b6"><text id="t6">Footer</text></p>
</root>
```

## Tables

- `insertTableAfter(id, rows)` · `insertTableBefore(id, rows)` · `appendTable(rows)` where `rows` is `string[][]` and row 0 is the header
- `setCell(tableId, row, col, text)`
- `addRow(tableId, at?)` · `addColumn(tableId, at?)` · `removeRow(tableId, row)` · `removeColumn(tableId, col)`

```ts
const t = editor.appendTable([['Item', 'Done']]);
editor.addRow(t);
editor.setCell(t, 1, 1, 'yes');
```

Before:

```xml
<root>
  <p id="b1"><text id="t1">Tasks</text></p>
</root>
```

After:

```xml
<root>
  <p id="b1"><text id="t1">Tasks</text></p>
  <table id="b2">
    <tablerow id="b3"><tablecell id="b4" header="true"><p id="b5"><text id="t2">Item</text></p></tablecell><tablecell id="b6" header="true"><p id="b7"><text id="t3">Done</text></p></tablecell></tablerow>
    <tablerow id="b8"><tablecell id="b9"><p id="b10" /></tablecell><tablecell id="b11"><p id="b12"><text id="t4">yes</text></p></tablecell></tablerow>
  </table>
</root>
```

## Media, Math, And Inline Objects

Media is addressed by **content hash**, never by URL — the document references bytes already stored in the workspace. Use the hash supplied in the task; never invent one.

- `insertDivider(afterId)`
- `insertImage(afterId, { hash, mime?, alt?, width?, height? })`
- `insertVideo(afterId, { hash, mime?, controls?, width?, height? })`
- `insertEquation(afterId, tex)` · `insertInlineEquation(blockId, at, tex)`
- `insertLineBreak(blockId, at)` — inserts a **soft line break** (Shift+Enter) within a block. Use only when multiple lines must live in a single semantic block (poetry, addresses, signature blocks). For ordinary multi-line content, insert separate paragraph nodes instead.
- `insertTextAfterInline(inlineRef, text)` — inserts a plain text node immediately after an inline object. Use this (not `appendText`) when you need text to follow an inline equation, line break, mention, or other inline node.

The `at` in `insertInlineEquation`/`insertLineBreak`/`insertMention` is a **character offset into the block's plain text** — inline objects don't count toward it. Compute it (`text.length`, `text.indexOf('word')`) rather than guessing. When you do use `insertLineBreak` for soft-break content, set the first line then add each break at the running text length and `insertTextAfterInline` the next line:

```ts
editor.setText('b1', 'Lily pad hoppers');
const br1 = editor.insertLineBreak('b1', 'Lily pad hoppers'.length);
editor.insertTextAfterInline(br1, 'Croaking through the night');
const br2 = editor.insertLineBreak(
  'b1',
  'Lily pad hoppers'.length + 'Croaking through the night'.length
);
editor.insertTextAfterInline(br2, 'Splash, then silence');
```

```ts
editor.insertDivider('b1');
editor.insertImage('b1', {
  hash: 'b1946ac9',
  mime: 'image/png',
  alt: 'cat',
  width: 640,
  height: 480,
});
editor.insertVideo('b1', {
  hash: 'c3ab8ff1',
  mime: 'video/mp4',
  controls: true,
});
editor.insertEquation('b1', 'E=mc^2');
const eq = editor.insertInlineEquation('b2', 0, 'x^2');
editor.insertTextAfterInline(eq, ' is x squared');
editor.insertLineBreak('b2', 3);
```

Before:

```xml
<root>
  <p id="b1"><text id="t1">Above</text></p>
  <p id="b2"><text id="t2">Below</text></p>
</root>
```

After:

```xml
<root>
  <p id="b1"><text id="t1">Above</text></p>
  <equation id="b3" equation="E=mc^2" />
  <video id="b4" hash="c3ab8ff1" />
  <image id="b5" hash="b1946ac9" alt="cat" />
  <horizontalrule id="b6" />
  <p id="b2">
    <equation id="b7" equation="x^2" inline="true" />
    <text id="t3"> is</text>
    <br id="b8" />
    <text id="t4"> x squared</text>
    <text id="t2">Below</text>
  </p>
</root>
```

## Update Existing Media

- `setImageAlt(id, alt)`
- `setMediaHash(id, hash)` — repoints an image or a video at different bytes
- `setVideoControls(id, controls)`

```ts
editor.setImageAlt('img1', 'dog');
editor.setMediaHash('img1', 'ccc');
editor.setMediaHash('vid1', 'ddd');
editor.setVideoControls('vid1', false);
```

Before:

```xml
<root>
  <image id="img1" hash="aaa" alt="cat" />
  <video id="vid1" hash="bbb" />
</root>
```

After:

```xml
<root>
  <image id="img1" hash="ccc" alt="dog" />
  <video id="vid1" hash="ddd" />
</root>
```

## Mentions

A mention is a reference to one knowledge-base resource. There is a single method and a single spec; `kind` is an open vocabulary (`'document'`, `'folder'`, `'file'`, `'user'`, ...). Use the ids, kinds and labels supplied in the task -- do not invent them.

- `insertMention(blockId, at, { resourceId, kind, label, display?, params? })`
  - `label` is the text the reader sees.
  - `display` is `'inline'` (default) or `'card'` for a block-like rendering.
  - `params` is an optional `Record<string, string>` of extra referent detail.

```ts
editor.insertMention('b1', 6, {
  resourceId: 'd1',
  kind: 'document',
  label: 'Roadmap',
});
editor.insertMention('b1', 6, {
  resourceId: 'u1',
  kind: 'user',
  label: 'Ada Lovelace',
});
```

Before:

```xml
<root>
  <p id="b1"><text id="t1">Email </text></p>
</root>
```

After:

```xml
<root>
  <p id="b1">
    <text id="t1">Email </text>
    <resource-mention id="m1" resource="d1" kind="document" label="Roadmap" display="inline" />
    <resource-mention id="m2" resource="u1" kind="user" label="Ada Lovelace" display="inline" />
  </p>
</root>
```

## Node Specs

- `{ block: 'paragraph', text? }`
- `{ block: 'heading', level, text? }`
- `{ block: 'quote', text? }`
- `{ block: 'code', language, text? }`
- `{ block: 'list', list: 'bullet'|'number'|'check', items: string[] }`
- `{ block: 'table', rows }`
- `{ block: 'divider' }`
- `{ block: 'image', hash, mime?, alt?, width?, height? }`
- `{ block: 'video', hash, mime?, controls?, width?, height? }`
- `{ block: 'equation', tex, inline? }`
- `{ inline: 'linebreak' }`
- `{ inline: 'equation', tex }`
- `{ inline: 'mention', mention: { resourceId, kind, label, display?, params? } }`

```ts
editor.appendBlock({ block: 'heading', level: 2, text: 'Section' });
editor.appendBlock({
  block: 'list',
  list: 'check',
  items: ['todo a', 'todo b'],
});
editor.appendBlock({ block: 'code', language: 'ts', text: 'const x = 1' });
```

Before:

```xml
<root>
  <p id="b1"><text id="t1">Doc</text></p>
</root>
```

After:

```xml
<root>
  <p id="b1"><text id="t1">Doc</text></p>
  <h2 id="b2"><text id="t2">Section</text></h2>
  <ul id="b3"><li id="b4"><text id="t3">todo a</text></li><li id="b5"><text id="t4">todo b</text></li></ul>
  <code id="b6" language="ts">const x = 1</code>
</root>
```
