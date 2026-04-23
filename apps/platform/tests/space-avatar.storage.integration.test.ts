import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { hasLiveSupabaseConfig } from './helpers/rbac-permissions-bootstrap.js';
import {
  bootstrapTwoTenants,
  teardownTwoTenants,
  type TwoTenantIsolation,
} from './helpers/space-isolation-bootstrap.js';

const describeLive = hasLiveSupabaseConfig() ? describe : describe.skip;

let env: TwoTenantIsolation;

function randomToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toUploadBody(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describeLive('space avatar storage RLS', () => {
  beforeAll(async () => {
    env = await bootstrapTwoTenants();
  });

  afterAll(async () => {
    if (env) {
      const uploadedPrefixes = [
        `spaces/${env.tenantA.spaceId}/avatar/`,
        `spaces/${env.tenantB.spaceId}/avatar/`,
      ];

      const { data: objects } = await env.service.storage
        .from('media')
        .list(`spaces/${env.tenantA.spaceId}/avatar`, {
          limit: 100,
        });

      const { data: otherObjects } = await env.service.storage
        .from('media')
        .list(`spaces/${env.tenantB.spaceId}/avatar`, {
          limit: 100,
        });

      const objectPaths = [
        ...(objects ?? []).map(
          (object) => `${uploadedPrefixes[0]}${object.name}`
        ),
        ...(otherObjects ?? []).map(
          (object) => `${uploadedPrefixes[1]}${object.name}`
        ),
      ];

      if (objectPaths.length > 0) {
        await env.service.storage.from('media').remove(objectPaths);
      }

      await teardownTwoTenants(env);
    }
  });

  test('space admin can upload own space avatar but cannot write cross-tenant path', async () => {
    const ownPath = `spaces/${env.tenantA.spaceId}/avatar/${randomToken()}.txt`;
    const foreignPath = `spaces/${env.tenantB.spaceId}/avatar/${randomToken()}.txt`;

    const ownUpload = await env.tenantA.client.storage
      .from('media')
      .upload(ownPath, toUploadBody('space-avatar-own'), {
        contentType: 'text/plain',
        upsert: false,
      });

    expect(ownUpload.error).toBeNull();
    expect(ownUpload.data?.path).toBe(ownPath);

    const crossUpload = await env.tenantA.client.storage
      .from('media')
      .upload(foreignPath, toUploadBody('space-avatar-cross'), {
        contentType: 'text/plain',
        upsert: false,
      });

    expect(crossUpload.error).not.toBeNull();

    const { data: foreignObjects } = await env.service.storage
      .from('media')
      .list(`spaces/${env.tenantB.spaceId}/avatar`, {
        limit: 100,
      });

    expect(
      (foreignObjects ?? []).some(
        (object) => object.name === foreignPath.split('/').at(-1)
      )
    ).toBe(false);
  });
});
