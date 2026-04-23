import { expect, test } from './fixtures.js';

import { loginViaUi } from './helpers/auth.js';
import {
  deleteOrganizationCascade,
  bootstrapOrgSpaceAdminForUser,
} from './helpers/platform-org-bootstrap.js';
import {
  deleteOutboxJobsByIdempotencyKeys,
  findLatestInviteByEmail,
  listMaildevMessagesByRecipient,
  listOutboxJobsByIdempotencyKey,
  maildevHealthcheck,
  notificationsHealthcheck,
  postDirectEmailRequest,
  postGoTrueSendEmailHook,
  type GoTrueHookPayload,
} from './helpers/notifications.js';

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('notifications outbox flows @full', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    await notificationsHealthcheck();
    await maildevHealthcheck();
  });

  test('direct email API dedupes by Idempotency-Key and delivers one message', async () => {
    const suffix = randomSuffix();
    const recipient = `e2e-direct-${suffix}@example.test`;
    const idempotencyKey = `e2e-direct-${suffix}`;
    const outboxKey = `notify:direct-email:${idempotencyKey}`;

    try {
      const body = {
        channel: 'email',
        to: recipient,
        locale: 'en',
        template: {
          templateKey: 'auth_email_action',
          data: {
            actionType: 'recovery',
            confirmUrl: `https://proflow.local/platform/auth/confirm?token_hash=${suffix}&type=recovery`,
          },
        },
      };

      const first = await postDirectEmailRequest({ idempotencyKey, body });
      const second = await postDirectEmailRequest({ idempotencyKey, body });

      expect(first.idempotencyKey).toBe(outboxKey);
      expect(second.idempotencyKey).toBe(outboxKey);
      expect(second.jobId).toBe(first.jobId);

      await expect
        .poll(async () => listOutboxJobsByIdempotencyKey(outboxKey), {
          timeout: 60_000,
          intervals: [250, 500, 1_000, 2_000],
        })
        .toHaveLength(1);

      await expect
        .poll(
          async () => {
            const [job] = await listOutboxJobsByIdempotencyKey(outboxKey);
            return typeof job?.queue_message_id === 'number';
          },
          {
            timeout: 60_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            const [job] = await listOutboxJobsByIdempotencyKey(outboxKey);
            return job?.status ?? null;
          },
          {
            timeout: 60_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .toBe('completed');

      await expect
        .poll(
          async () => {
            const messages = await listMaildevMessagesByRecipient(recipient);
            return messages.length;
          },
          {
            timeout: 60_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .toBe(1);
    } finally {
      await deleteOutboxJobsByIdempotencyKeys([outboxKey]);
    }
  });

  test('GoTrue hook dedupes duplicate payloads and delivers one auth email', async ({
    seededUser,
  }) => {
    const suffix = randomSuffix();
    const tokenHash = `hash-${suffix}`;
    const outboxKey = `gotrue:send-email:${seededUser.id}:recovery:${tokenHash}`;

    const payload: GoTrueHookPayload = {
      user: {
        id: seededUser.id,
        email: seededUser.email,
        user_metadata: { locale: 'en' },
      },
      email_data: {
        token: `token-${suffix}`,
        token_hash: tokenHash,
        redirect_to: 'https://proflow.local/platform/update-password',
        email_action_type: 'recovery',
        site_url: 'https://proflow.local',
      },
    };

    try {
      await postGoTrueSendEmailHook(payload);
      await postGoTrueSendEmailHook(payload);

      await expect
        .poll(async () => listOutboxJobsByIdempotencyKey(outboxKey), {
          timeout: 60_000,
          intervals: [250, 500, 1_000, 2_000],
        })
        .toHaveLength(1);

      await expect
        .poll(
          async () => {
            const [job] = await listOutboxJobsByIdempotencyKey(outboxKey);
            return typeof job?.queue_message_id === 'number';
          },
          {
            timeout: 60_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            const [job] = await listOutboxJobsByIdempotencyKey(outboxKey);
            return job?.status ?? null;
          },
          {
            timeout: 60_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .toBe('completed');

      await expect
        .poll(
          async () => {
            const messages = await listMaildevMessagesByRecipient(
              seededUser.email
            );
            return messages.filter((message) => {
              const serialized = JSON.stringify(message.raw);
              return serialized.includes(tokenHash);
            }).length;
          },
          {
            timeout: 60_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .toBe(1);
    } finally {
      await deleteOutboxJobsByIdempotencyKeys([outboxKey]);
    }
  });

  test('platform invite UI creates one invite outbox job and delivers the email', async ({
    page,
    seededUser,
  }) => {
    const bootstrap = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const inviteEmail = `e2e-invitee-${randomSuffix()}@example.test`;
    let inviteOutboxKey: string | null = null;

    try {
      await loginViaUi(page, {
        email: seededUser.email,
        password: seededUser.password,
      });

      await page.goto('/platform/space-settings');
      const manager = page.getByTestId(
        `space-invite-manager-${bootstrap.spaceId}`
      );
      await expect(manager).toBeVisible({ timeout: 15_000 });

      const form = manager.getByTestId(
        `space-invite-form-${bootstrap.spaceId}`
      );
      await form.locator('input[name="email"]').fill(inviteEmail);
      await form.locator('button[type="submit"]').click();

      await expect(
        manager.getByTestId(`space-invite-token-banner-${bootstrap.spaceId}`)
      ).toBeVisible({ timeout: 20_000 });

      await expect
        .poll(
          async () =>
            findLatestInviteByEmail({
              spaceId: bootstrap.spaceId,
              email: inviteEmail,
            }),
          {
            timeout: 30_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .not.toBeNull();

      const resolvedInvite = await findLatestInviteByEmail({
        spaceId: bootstrap.spaceId,
        email: inviteEmail,
      });

      if (!resolvedInvite) {
        throw new Error('Expected a space invite row after UI creation');
      }

      inviteOutboxKey = `notify:space-invite-email:${resolvedInvite.id}`;

      await expect
        .poll(async () => listOutboxJobsByIdempotencyKey(inviteOutboxKey!), {
          timeout: 60_000,
          intervals: [250, 500, 1_000, 2_000],
        })
        .toHaveLength(1);

      await expect
        .poll(
          async () => {
            const [job] = await listOutboxJobsByIdempotencyKey(
              inviteOutboxKey!
            );
            return typeof job?.queue_message_id === 'number';
          },
          {
            timeout: 60_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            const [job] = await listOutboxJobsByIdempotencyKey(
              inviteOutboxKey!
            );
            return job?.status ?? null;
          },
          {
            timeout: 60_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .toBe('completed');

      await expect
        .poll(
          async () => {
            const messages = await listMaildevMessagesByRecipient(inviteEmail);
            return messages.filter((message) => {
              const serialized = JSON.stringify(message.raw);
              return serialized.includes(resolvedInvite.token);
            }).length;
          },
          {
            timeout: 60_000,
            intervals: [250, 500, 1_000, 2_000],
          }
        )
        .toBe(1);
    } finally {
      if (inviteOutboxKey) {
        await deleteOutboxJobsByIdempotencyKeys([inviteOutboxKey]);
      }
      await deleteOrganizationCascade(bootstrap.organizationId);
    }
  });
});
