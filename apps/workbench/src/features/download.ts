/**
 * Hands `text` to the browser as a file to save under `name`.
 *
 * The anchor is attached for the click, because a detached anchor's click is
 * ignored by some browsers, and the object url is released right after: the
 * download has started by then, and a url kept alive pins the bytes.
 */
export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
