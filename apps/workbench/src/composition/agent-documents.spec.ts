import { ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { IDocumentRepository } from '@workspace/domain';
import type { WriteScope } from '@workspace/knowledge-contracts';
import { guardDocumentWrites } from './agent-documents';

/**
 * What the assistant writes goes through the same rights as what the person
 * types: a document they may only read is not saved, renamed or trashed on
 * the assistant's say-so, and nothing is created where they may not create.
 */

const MEMBER: WriteScope = {
  'node.create': 'all',
  'node.update': { own: ['owner_user_id'] },
  'node.move': { own: ['parent_edge_created_by'] },
  'node.trash': { own: ['owner_user_id'] },
  'node.purge': { own: ['owner_user_id'] },
  'node.star': 'all',
  'body.write': { own: ['owner_user_id'] },
};
const NO_CREATE: WriteScope = { ...MEMBER, 'node.create': 'none' };

function base() {
  const done = <T>(value: T) =>
    vi.fn(async () => ok(value) as Result<T, string>);
  return {
    invalidate: vi.fn(),
    create: done({ id: 'doc-new' }),
    load: done(null),
    save: done(true),
    rename: done(undefined),
    softDelete: done(undefined),
  } as unknown as IDocumentRepository & {
    save: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

const owners: Record<string, string> = { mine: 'user-1', theirs: 'user-2' };
const guard = (documents: IDocumentRepository, scope: WriteScope | null) =>
  guardDocumentWrites(documents, {
    scope: () => scope,
    userId: 'user-1',
    ownerOfDocument: async (id) => owners[id] ?? null,
  });

const save = (id: string) => ({
  id,
  tree: { root: { type: 'root' } } as never,
  markdown: '',
  preview: '',
  author: { user: 'user-1', src: 'ai' as const },
});

describe('the documents the assistant writes through', () => {
  it("refuses to save, rename or trash someone else's document, and never reaches the store", async () => {
    const documents = base();
    const guarded = guard(documents, MEMBER);

    expect((await guarded.save(save('theirs'))).isErr()).toBe(true);
    expect((await guarded.rename('theirs', 'New name')).isErr()).toBe(true);
    expect((await guarded.softDelete('theirs')).isErr()).toBe(true);
    expect(documents.save).not.toHaveBeenCalled();
    expect(documents.rename).not.toHaveBeenCalled();
    expect(documents.softDelete).not.toHaveBeenCalled();
  });

  it("passes the person's own document through", async () => {
    const documents = base();
    const guarded = guard(documents, MEMBER);

    expect((await guarded.save(save('mine'))).isOk()).toBe(true);
    expect((await guarded.rename('mine', 'New name')).isOk()).toBe(true);
    expect(documents.save).toHaveBeenCalledTimes(1);
    expect(documents.rename).toHaveBeenCalledTimes(1);
  });

  it('refuses to create where the person may not create', async () => {
    const documents = base();
    expect(
      (await guard(documents, NO_CREATE).create({ title: 'x' })).isErr()
    ).toBe(true);
    expect(documents.create).not.toHaveBeenCalled();
    expect((await guard(documents, MEMBER).create({ title: 'x' })).isOk()).toBe(
      true
    );
  });

  it('asks the scope at the moment of the write, not when it was wrapped', async () => {
    const documents = base();
    let scope: WriteScope | null = MEMBER;
    const guarded = guardDocumentWrites(documents, {
      scope: () => scope,
      userId: 'user-1',
      ownerOfDocument: async (id) => owners[id] ?? null,
    });
    expect((await guarded.save(save('theirs'))).isErr()).toBe(true);
    scope = { ...MEMBER, 'body.write': 'all' };
    expect((await guarded.save(save('theirs'))).isOk()).toBe(true);
  });

  it('refuses a write whose right is revoked while the owner is still being looked up', async () => {
    const documents = base();
    let scope: WriteScope | null = {
      ...MEMBER,
      'body.write': 'all',
      'node.update': 'all',
      'node.trash': 'all',
    };
    const lookups: Array<() => void> = [];
    const guarded = guardDocumentWrites(documents, {
      scope: () => scope,
      userId: 'user-1',
      ownerOfDocument: (id) =>
        new Promise((resolve) =>
          lookups.push(() => resolve(owners[id] ?? null))
        ),
    });

    const writes = [
      guarded.save(save('theirs')),
      guarded.rename('theirs', 'New name'),
      guarded.softDelete('theirs'),
    ];
    scope = MEMBER;
    for (const finish of lookups) finish();

    for (const result of await Promise.all(writes))
      expect(result.isErr()).toBe(true);
    expect(documents.save).not.toHaveBeenCalled();
    expect(documents.rename).not.toHaveBeenCalled();
    expect(documents.softDelete).not.toHaveBeenCalled();
  });
});
