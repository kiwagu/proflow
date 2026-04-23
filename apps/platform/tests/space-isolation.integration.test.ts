/**
 * Space isolation integration tests.
 *
 * Verifies that RLS policies, RPCs, and membership checks enforce strict
 * data isolation between two independent tenants (org + space + user).
 *
 * Setup: User A owns Org-A / Space-A, User B owns Org-B / Space-B.
 * Each test proves that one tenant cannot see or mutate the other's data.
 *
 * @smoke — critical isolation invariants (fast, run in CI on every push).
 * Full   — comprehensive matrix (privilege escalation, invite cross-boundary, etc.).
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { hasLiveSupabaseConfig } from './helpers/rbac-permissions-bootstrap.js';
import {
  bootstrapTwoTenants,
  createAnonClient,
  teardownTwoTenants,
  type TwoTenantIsolation,
} from './helpers/space-isolation-bootstrap.js';

const describeLive = hasLiveSupabaseConfig() ? describe : describe.skip;

let env: TwoTenantIsolation;

describeLive('space isolation matrix', () => {
  beforeAll(async () => {
    env = await bootstrapTwoTenants();
  });

  afterAll(async () => {
    if (env) await teardownTwoTenants(env);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SMOKE — critical isolation invariants
  // ═══════════════════════════════════════════════════════════════════════════

  describe('space isolation — smoke', () => {
    test('@smoke user A sees own space membership, not space B', async () => {
      const { tenantA, tenantB } = env;

      // A sees own membership
      const { data: ownRows, error: ownErr } = await tenantA.client
        .from('space_memberships')
        .select('space_id')
        .eq('space_id', tenantA.spaceId);

      expect(ownErr).toBeNull();
      expect(ownRows!.length).toBeGreaterThan(0);
      expect(ownRows!.every((r) => r.space_id === tenantA.spaceId)).toBe(true);

      // A cannot see B's memberships
      const { data: crossRows } = await tenantA.client
        .from('space_memberships')
        .select('space_id')
        .eq('space_id', tenantB.spaceId);

      expect(crossRows ?? []).toHaveLength(0);
    });

    test('@smoke user A cannot see space B in spaces table', async () => {
      const { tenantA, tenantB } = env;

      const { data } = await tenantA.client
        .from('spaces')
        .select('id')
        .eq('id', tenantB.spaceId);

      expect(data ?? []).toHaveLength(0);
    });

    test('@smoke user A cannot see org B', async () => {
      const { tenantA, tenantB } = env;

      const { data } = await tenantA.client
        .from('organizations')
        .select('id')
        .eq('id', tenantB.organizationId);

      expect(data ?? []).toHaveLength(0);
    });

    test('@smoke user A cannot create invite for space B (cross-space RPC)', async () => {
      const { tenantA, tenantB } = env;

      const { error } = await tenantA.client.rpc('rpc_create_space_invite', {
        p_space_id: tenantB.spaceId,
        p_email: 'cross-space-test@example.test',
        p_role_key: 'member',
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not allowed/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL — comprehensive isolation matrix
  // ═══════════════════════════════════════════════════════════════════════════

  describe('space isolation — full', () => {
    // ── SELECT isolation ─────────────────────────────────────────────────────

    test('user B cannot see space A memberships', async () => {
      const { tenantA, tenantB } = env;

      const { data } = await tenantB.client
        .from('space_memberships')
        .select('space_id')
        .eq('space_id', tenantA.spaceId);

      expect(data ?? []).toHaveLength(0);
    });

    test('user A cannot see space_invites for space B', async () => {
      const { tenantA, tenantB } = env;

      // Create an invite in space B as tenant B.
      const { error: createErr } = await tenantB.client.rpc(
        'rpc_create_space_invite',
        {
          p_space_id: tenantB.spaceId,
          p_email: 'someone@example.test',
          p_role_key: 'member',
        }
      );
      expect(createErr).toBeNull();

      // A queries invites for space B — should see nothing.
      const { data } = await tenantA.client
        .from('space_invites')
        .select('id, space_id')
        .eq('space_id', tenantB.spaceId);

      expect(data ?? []).toHaveLength(0);
    });

    test('user A cannot see org_memberships of org B', async () => {
      const { tenantA, tenantB } = env;

      const { data } = await tenantA.client
        .from('organization_memberships')
        .select('organization_id')
        .eq('organization_id', tenantB.organizationId);

      expect(data ?? []).toHaveLength(0);
    });

    // ── RPC cross-boundary ───────────────────────────────────────────────────

    test('user B cannot create invite for space A', async () => {
      const { tenantA, tenantB } = env;

      const { error } = await tenantB.client.rpc('rpc_create_space_invite', {
        p_space_id: tenantA.spaceId,
        p_email: 'cross-b-to-a@example.test',
        p_role_key: 'member',
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not allowed/i);
    });

    test('user A cannot revoke invite in space B', async () => {
      const { tenantA, tenantB } = env;

      // Create invite in space B via tenant B.
      const { data: inv } = await tenantB.client.rpc(
        'rpc_create_space_invite',
        {
          p_space_id: tenantB.spaceId,
          p_email: 'revoke-cross-test@example.test',
          p_role_key: 'member',
        }
      );

      expect(inv).not.toBeNull();
      const inviteId = (inv as { id: string }).id;

      // A tries to revoke B's invite.
      const { error } = await tenantA.client.rpc('rpc_revoke_space_invite', {
        p_invite_id: inviteId,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not allowed/i);
    });

    test('user B cannot accept invite meant for user A email', async () => {
      const { tenantA, tenantB } = env;

      // Create invite in space A for user A's email.
      const { data: inv } = await tenantA.client.rpc(
        'rpc_create_space_invite',
        {
          p_space_id: tenantA.spaceId,
          p_email: tenantA.email,
          p_role_key: 'member',
        }
      );

      expect(inv).not.toBeNull();
      const token = (inv as { token: string }).token;

      // B tries to accept A's invite.
      const { error } = await tenantB.client.rpc('rpc_accept_space_invite', {
        p_token: token,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/email does not match/i);
    });

    // ── Privilege escalation ─────────────────────────────────────────────────

    test('space admin cannot invite with admin role (escalation blocked)', async () => {
      const { tenantA, service } = env;

      // Create a third user who is space_admin (not org_admin) in space A.
      const suffix = `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `e2e-esc-${suffix}@example.test`;
      const password = `Pw!${suffix}Aa9`;
      const { data: u, error: uErr } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (uErr || !u.user) throw new Error(`esc user: ${uErr?.message}`);
      const escUserId = u.user.id;

      try {
        // Give them space_admin only (no org_admin).
        await service.from('space_memberships').insert({
          space_id: tenantA.spaceId,
          user_id: escUserId,
          status: 'active',
        });
        const { data: spaceAdminRole } = await service
          .from('roles')
          .select('id')
          .eq('key', 'space_admin')
          .single();
        if (!spaceAdminRole?.id) {
          throw new Error('space_admin role not found');
        }
        await service.from('user_role').insert({
          user_id: escUserId,
          space_id: tenantA.spaceId,
          role_id: spaceAdminRole.id,
        });

        // Sign in as escalation user.
        const escClient = createAnonClient();
        const { error: signErr } = await escClient.auth.signInWithPassword({
          email,
          password,
        });
        if (signErr) throw new Error(`esc sign-in: ${signErr.message}`);

        // Try to invite someone with admin role — should fail.
        const { error } = await escClient.rpc('rpc_create_space_invite', {
          p_space_id: tenantA.spaceId,
          p_email: 'escalation-target@example.test',
          p_role_key: 'space_admin',
        });

        expect(error).not.toBeNull();
        expect(error!.message).toMatch(/only organization admins/i);

        // But authed role should succeed.
        const { error: authedErr } = await escClient.rpc(
          'rpc_create_space_invite',
          {
            p_space_id: tenantA.spaceId,
            p_email: 'escalation-authed@example.test',
            p_role_key: 'member',
          }
        );
        expect(authedErr).toBeNull();
      } finally {
        await service
          .from('space_invites')
          .delete()
          .eq('created_by_user_id', escUserId);
        await service
          .from('space_memberships')
          .delete()
          .eq('user_id', escUserId);
        await service.from('user_role').delete().eq('user_id', escUserId);
        await service.from('profiles').delete().eq('user_id', escUserId);
        await service.auth.admin.deleteUser(escUserId);
      }
    });

    // ── Direct DML blocked ───────────────────────────────────────────────────

    test('user A cannot INSERT membership into space B', async () => {
      const { tenantA, tenantB } = env;

      const { error } = await tenantA.client.from('space_memberships').insert({
        space_id: tenantB.spaceId,
        user_id: tenantA.userId,
        status: 'active',
      });

      // RLS should deny this.
      expect(error).not.toBeNull();
    });

    test('user A cannot UPDATE membership in space B', async () => {
      const { tenantA, tenantB } = env;

      // Try to update B's membership status.
      const { data, error } = await tenantA.client
        .from('space_memberships')
        .update({ status: 'suspended' })
        .eq('space_id', tenantB.spaceId)
        .eq('user_id', tenantB.userId)
        .select();

      // Either error or zero affected rows (RLS filters the WHERE).
      if (!error) {
        expect(data ?? []).toHaveLength(0);
      }
    });

    test('user A cannot DELETE membership in space B', async () => {
      const { tenantA, tenantB } = env;

      const { data, error } = await tenantA.client
        .from('space_memberships')
        .delete()
        .eq('space_id', tenantB.spaceId)
        .eq('user_id', tenantB.userId)
        .select();

      if (!error) {
        expect(data ?? []).toHaveLength(0);
      }

      // Verify B's membership still exists.
      const { data: check } = await tenantB.client
        .from('space_memberships')
        .select('space_id')
        .eq('space_id', tenantB.spaceId)
        .eq('user_id', tenantB.userId);

      expect(check!.length).toBeGreaterThan(0);
    });
  });
});
