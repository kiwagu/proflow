import { describe, expect, it } from 'vitest';
import { supabaseAuthStorageKey } from './supabase-auth-storage-key';

describe('supabaseAuthStorageKey', () => {
  it('derives the key from the first hostname label, as supabase-js does', () => {
    expect(supabaseAuthStorageKey('https://api.proflow.local')).toBe(
      'sb-api-auth-token'
    );
    expect(supabaseAuthStorageKey('https://abcdefgh.supabase.co')).toBe(
      'sb-abcdefgh-auth-token'
    );
    expect(supabaseAuthStorageKey('http://127.0.0.1:54321')).toBe(
      'sb-127-auth-token'
    );
  });

  it('ignores the path, so a client under a path prefix of the same host shares the name', () => {
    expect(supabaseAuthStorageKey('https://proflow.local/backend')).toBe(
      'sb-proflow-auth-token'
    );
  });
});
