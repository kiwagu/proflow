import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText } from './download';

describe('handing text to the user as a file', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers a download under the given name and releases the object url', () => {
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:note');
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicks.push(this);
    });

    downloadText('note.md', '# Hi', 'text/markdown');

    const [blob] = url.mock.calls[0] ?? [];
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('text/markdown');
    expect(clicks.map((a) => [a.download, a.href])).toEqual([
      ['note.md', 'blob:note'],
    ]);
    expect(revoke).toHaveBeenCalledWith('blob:note');
  });
});
