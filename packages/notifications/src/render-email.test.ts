import { describe, expect, test } from 'bun:test';

import { renderEmail } from './email/render-email.js';

import { initializeMessages } from './i18n/messages.js';

// Initialize message catalogs before running tests
await initializeMessages(['en', 'es']);

describe('renderEmail', () => {
  test('renders auth_email_action in English', async () => {
    const out = await renderEmail('en', {
      templateKey: 'auth_email_action',
      data: {
        actionType: 'recovery',
        confirmUrl:
          'https://example.com/auth/confirm?token_hash=x&type=recovery',
      },
    });
    expect(out.subject).toContain('password');
    expect(out.html).toContain('https://example.com/auth/confirm');
    expect(out.text).toContain('https://example.com/auth/confirm');
  });

  test('renders auth_email_action in Russian', async () => {
    const out = await renderEmail('ru', {
      templateKey: 'auth_email_action',
      data: {
        actionType: 'signup',
        confirmUrl: 'https://example.com/auth/confirm?token_hash=y&type=signup',
      },
    });
    expect(out.subject.length).toBeGreaterThan(0);
    expect(out.html).toContain('https://example.com/auth/confirm');
  });

  test('renders space_invite with React Email', async () => {
    const out = await renderEmail('en', {
      templateKey: 'space_invite',
      data: {
        inviteUrl: 'https://proflow.local/platform/invite/start?t=abc',
        spaceName: 'Engineering',
        organizationName: 'Acme',
        expiresAtUtc: '2026-12-31T23:59:59.000Z',
      },
    });
    expect(out.subject).toContain('Engineering');
    expect(out.subject).toContain('Acme');
    expect(out.html).toContain('https://proflow.local/platform/invite/start');
    expect(out.text).toContain('https://proflow.local/platform/invite/start');
    expect(out.html).toContain('2026-12-31');
  });
});
