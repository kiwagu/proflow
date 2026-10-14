import { describe, expect, it } from 'vitest';
import { allowed, parseWriteScope } from './write-scope.schema.js';

const raw = {
  'node.create': 'all',
  'node.update': { own: ['owner_user_id'] },
  'node.move': { own: ['parent_edge_created_by'] },
  'node.trash': { own: ['owner_user_id'] },
  'node.purge': 'none',
  'node.star': 'all',
  'body.write': { own: ['owner_user_id', 'created_by'] },
};

describe('the write scope', () => {
  const scope = parseWriteScope(raw)!;

  it('says yes to everything when there is no scope to go by', () => {
    expect(allowed(null, 'node.update', {}, 'u1')).toBe(true);
    expect(allowed(null, 'body.write', { owner_user_id: 'u2' }, 'u1')).toBe(
      true
    );
  });

  it('all is yes for any row', () => {
    expect(allowed(scope, 'node.create', { owner_user_id: 'u2' }, 'u1')).toBe(
      true
    );
  });

  it('none is no, even for a row of my own', () => {
    expect(allowed(scope, 'node.purge', { owner_user_id: 'u1' }, 'u1')).toBe(
      false
    );
  });

  it('own is yes when any named column is me', () => {
    expect(allowed(scope, 'node.update', { owner_user_id: 'u1' }, 'u1')).toBe(
      true
    );
    expect(
      allowed(
        scope,
        'body.write',
        { owner_user_id: 'u2', created_by: 'u1' },
        'u1'
      )
    ).toBe(true);
  });

  it('own is no when no named column is me, or the row lacks the column', () => {
    expect(allowed(scope, 'node.update', { owner_user_id: 'u2' }, 'u1')).toBe(
      false
    );
    expect(allowed(scope, 'node.move', {}, 'u1')).toBe(false);
    expect(
      allowed(scope, 'node.move', { parent_edge_created_by: null }, 'u1')
    ).toBe(false);
  });

  it('orUnset lets through a row whose column is empty, but not one that lacks it', () => {
    const moving = parseWriteScope({
      ...raw,
      'node.move': {
        own: ['parent_edge_created_by'],
        orUnset: ['parent_edge_created_by'],
      },
    })!;
    expect(
      allowed(moving, 'node.move', { parent_edge_created_by: null }, 'u1')
    ).toBe(true);
    expect(allowed(moving, 'node.move', {}, 'u1')).toBe(false);
    expect(
      allowed(moving, 'node.move', { parent_edge_created_by: 'u2' }, 'u1')
    ).toBe(false);
    expect(
      allowed(moving, 'node.move', { parent_edge_created_by: 'u1' }, 'u1')
    ).toBe(true);
  });

  it('parsing drops a scope with an action missing or a verdict malformed, without throwing', () => {
    expect(parseWriteScope({ 'node.create': 'all' })).toBeNull();
    expect(parseWriteScope({ ...raw, 'node.star': { own: [] } })).toBeNull();
    expect(parseWriteScope({ ...raw, 'node.star': 'maybe' })).toBeNull();
    expect(parseWriteScope('nope')).toBeNull();
    expect(parseWriteScope(null)).toBeNull();
  });

  it('parsing keeps a valid scope as it is', () => {
    expect(parseWriteScope(raw)).toEqual(raw);
  });
});
