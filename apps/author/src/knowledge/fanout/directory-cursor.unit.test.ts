import { describe, expect, it } from 'vitest';

import {
  decodeDirectoryCursor,
  encodeDirectoryCursor,
} from './directory-cursor';

/**
 * Directory keyset cursor codec (ADR-0021 Part A / A1). The cursor is an opaque
 * base64url(json{k,u}) token carrying the last seen row's stable position; the round-trip
 * must be lossless, the encoding URL-safe + unpadded, and any null/blank/malformed token
 * must fail SOFT to `null` (= first page — a picker cursor is not a security boundary).
 */
describe('directory-cursor', () => {
  it('round-trips a keyset position losslessly', () => {
    const cursor = {
      k: 'Ada Lovelace',
      u: '11111111-1111-1111-1111-111111111111',
    };
    const token = encodeDirectoryCursor(cursor);
    expect(decodeDirectoryCursor(token)).toEqual(cursor);
  });

  it('round-trips keys with unicode + symbols (utf-8 safe)', () => {
    const cursor = {
      k: 'Zoë — Ünïçødé +/=',
      u: '22222222-2222-2222-2222-222222222222',
    };
    expect(decodeDirectoryCursor(encodeDirectoryCursor(cursor))).toEqual(
      cursor
    );
  });

  it('emits a URL-safe, unpadded token (base64url)', () => {
    const token = encodeDirectoryCursor({
      k: '???>>>',
      u: '33333333-3333-3333-3333-333333333333',
    });
    expect(token).not.toMatch(/[+/=]/);
  });

  it('decodes null / undefined / blank to null (first page)', () => {
    expect(decodeDirectoryCursor(null)).toBeNull();
    expect(decodeDirectoryCursor(undefined)).toBeNull();
    expect(decodeDirectoryCursor('')).toBeNull();
    expect(decodeDirectoryCursor('   ')).toBeNull();
  });

  it('decodes a malformed / non-JSON token to null (fail-soft)', () => {
    expect(decodeDirectoryCursor('not-base64-$$$')).toBeNull();
    expect(decodeDirectoryCursor('Zm9vYmFy')).toBeNull(); // base64 of "foobar" (not JSON)
  });

  it('rejects a token missing a component or with an empty user_id', () => {
    const onlyK = Buffer.from(JSON.stringify({ k: 'x' }), 'utf8').toString(
      'base64url'
    );
    const emptyU = Buffer.from(
      JSON.stringify({ k: 'x', u: '' }),
      'utf8'
    ).toString('base64url');
    expect(decodeDirectoryCursor(onlyK)).toBeNull();
    expect(decodeDirectoryCursor(emptyU)).toBeNull();
  });
});
