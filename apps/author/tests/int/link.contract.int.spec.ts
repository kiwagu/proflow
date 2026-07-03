import { describe, expect, it } from 'vitest';

import {
  LINK_URL_MAX_LENGTH,
  deriveLinkHost,
  linkUrlSchema,
} from '@workspace/knowledge-contracts';

/**
 * The link-URL contract (slice-10 §2.4) — the http(s)-only allow-list that fences
 * what may ever land in `kb.resource_link.url` (and thus in an `<a href>`): the
 * anti-stored-XSS gate. The DB CHECK `resource_link_http_only` is the second belt;
 * this spec pins the FIRST (zod) belt's exact behaviour.
 */
describe('link url contract', () => {
  it('accepts absolute http(s) URLs (trimmed)', () => {
    expect(
      linkUrlSchema.safeParse('https://status.acme.com/incidents').success
    ).toBe(true);
    expect(linkUrlSchema.safeParse('http://intranet.local/page').success).toBe(
      true
    );
    expect(linkUrlSchema.parse('  https://a.io/x  ')).toBe('https://a.io/x');
  });

  it('rejects every non-http(s) scheme (the anti-stored-XSS allow-list)', () => {
    expect(linkUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(linkUrlSchema.safeParse('JaVaScRiPt:alert(1)').success).toBe(false);
    expect(
      linkUrlSchema.safeParse('data:text/html,<script>1</script>').success
    ).toBe(false);
    expect(linkUrlSchema.safeParse('vbscript:msgbox(1)').success).toBe(false);
    expect(linkUrlSchema.safeParse('ftp://files.example/a').success).toBe(
      false
    );
    expect(linkUrlSchema.safeParse('file:///etc/passwd').success).toBe(false);
  });

  it('rejects non-URLs, relative refs, and over-length values', () => {
    expect(linkUrlSchema.safeParse('not a url').success).toBe(false);
    expect(linkUrlSchema.safeParse('/relative/path').success).toBe(false);
    expect(linkUrlSchema.safeParse('//protocol.relative/x').success).toBe(
      false
    );
    expect(linkUrlSchema.safeParse('').success).toBe(false);
    const over = `https://a.io/${'x'.repeat(LINK_URL_MAX_LENGTH)}`;
    expect(linkUrlSchema.safeParse(over).success).toBe(false);
  });

  it('derives the lowercase hostname (no port, no path) as the display host', () => {
    expect(deriveLinkHost('https://Status.Acme.example:8443/incidents')).toBe(
      'status.acme.example'
    );
    expect(deriveLinkHost('http://a.io')).toBe('a.io');
    expect(deriveLinkHost('nope')).toBeNull();
  });
});
