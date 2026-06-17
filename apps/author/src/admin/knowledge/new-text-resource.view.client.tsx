'use client';

import { Button, useTranslation } from '@payloadcms/ui';
import { useCallback, useEffect, useState } from 'react';

import { authorApiPath } from '@/lib/platform-login';
import type {
  CustomTranslationsKeys,
  CustomTranslationsObject,
} from '@/i18n/custom-translations';

/**
 * Custom Payload admin-view — "create text resource" (slice-03 §4). ONE author
 * act: title + body + one optional explicit edge → a single POST to our own
 * fan-out endpoint (`/author/graph/text-resources`).
 *
 * Reversibility guardrails (ADR-0005, acceptance §7.1):
 *  (a) THIN presentation over our OWN Postgres endpoints. Graph data comes from
 *      `/author/graph/*` (RLS), never Payload auto-API. `@payloadcms/ui` is used
 *      as a COMPONENT library (Button) — no document drawers / collection-list
 *      internals / field-context hooks.
 *  (b) Domain/fan-out logic lives in the server application module; this view
 *      holds NONE of it. A future shadcn port is a reskin, not a rewrite.
 */

type ResourceOption = {
  id: string;
  title: string;
  kind: string;
  status: string;
};

type FanoutResult = {
  node_id: string;
  body_ref: { collection: string; doc_id: string };
  edge_id?: string;
};

const EDGE_NONE = 'none';

/** Wrap plain text into the minimal Lexical root the `bodies` richText accepts. */
function toLexicalBody(text: string): unknown {
  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      direction: 'ltr',
      children: [
        {
          type: 'paragraph',
          format: '',
          indent: 0,
          version: 1,
          direction: 'ltr',
          textFormat: 0,
          children: text
            ? [
                {
                  type: 'text',
                  mode: 'normal',
                  text,
                  detail: 0,
                  format: 0,
                  style: '',
                  version: 1,
                },
              ]
            : [],
        },
      ],
    },
  };
}

export default function NewTextResourceView() {
  const { t } = useTranslation<
    CustomTranslationsObject,
    CustomTranslationsKeys
  >();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [relationType, setRelationType] = useState<string>(EDGE_NONE);
  const [targetId, setTargetId] = useState<string>('');
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<FanoutResult | null>(null);

  // (a) read the active space from our own endpoint.
  useEffect(() => {
    let cancelled = false;
    void fetch(authorApiPath('/api/auth/active-space'), {
      cache: 'no-store',
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { spaceId?: unknown } | null) => {
        if (!cancelled && typeof body?.spaceId === 'string') {
          setSpaceId(body.spaceId);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // (a) load edge-target candidates from our own RLS endpoint.
  useEffect(() => {
    if (!spaceId) {
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({ space_id: spaceId });
    void fetch(authorApiPath(`/graph/resources?${qs.toString()}`), {
      cache: 'no-store',
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { resources?: ResourceOption[] } | null) => {
        if (!cancelled && Array.isArray(body?.resources)) {
          setResources(body.resources);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const onSave = useCallback(async () => {
    if (!spaceId || !title.trim()) {
      setMessage(t('author:knowledge.newTextResource.missingFields'));
      return;
    }
    setSubmitting(true);
    setMessage(null);
    setResult(null);

    const edge =
      relationType !== EDGE_NONE && targetId
        ? { relationType, toId: targetId }
        : undefined;

    try {
      const response = await fetch(authorApiPath('/graph/text-resources'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          title: title.trim(),
          lexicalBody: toLexicalBody(bodyText),
          edge,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | (FanoutResult & { message?: string })
        | { message?: string }
        | null;
      if (!response.ok) {
        setMessage(
          (body && 'message' in body && body.message) ||
            t('author:knowledge.newTextResource.saveFailed', {
              status: response.status,
            })
        );
        return;
      }
      setResult(body as FanoutResult);
      setMessage(t('author:knowledge.newTextResource.saved'));
      setTitle('');
      setBodyText('');
      setRelationType(EDGE_NONE);
      setTargetId('');
    } finally {
      setSubmitting(false);
    }
  }, [spaceId, title, bodyText, relationType, targetId, t]);

  return (
    <div
      className="gutter--left gutter--right"
      style={{ maxWidth: 720, marginTop: 'var(--base)' }}
      data-testid="new-text-resource-view"
    >
      <h1>{t('author:knowledge.newTextResource.title')}</h1>
      <p>
        {t('author:knowledge.newTextResource.activeSpace')}{' '}
        <code data-testid="ntr-space">{spaceId ?? '—'}</code>
      </p>

      <div style={{ display: 'grid', gap: 'var(--base)' }}>
        <label>
          {t('author:knowledge.newTextResource.fieldTitle')}
          <input
            data-testid="ntr-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label>
          {t('author:knowledge.newTextResource.fieldBody')}
          <textarea
            data-testid="ntr-body"
            rows={6}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
          />
        </label>

        <label>
          {t('author:knowledge.newTextResource.fieldEdge')}
          <select
            data-testid="ntr-relation"
            value={relationType}
            onChange={(e) => setRelationType(e.target.value)}
          >
            <option value={EDGE_NONE}>
              {t('author:knowledge.newTextResource.edgeNone')}
            </option>
            <option value="prerequisite">prerequisite</option>
            <option value="relates_to">relates_to</option>
          </select>
        </label>

        {relationType !== EDGE_NONE ? (
          <label>
            {t('author:knowledge.newTextResource.fieldTarget')}
            <select
              data-testid="ntr-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">
                {t('author:knowledge.newTextResource.selectNode')}
              </option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} ({r.kind})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div>
          <Button
            buttonStyle="primary"
            disabled={submitting}
            onClick={() => void onSave()}
          >
            {submitting
              ? t('author:knowledge.newTextResource.saving')
              : t('author:knowledge.newTextResource.save')}
          </Button>
        </div>

        {message ? <p data-testid="ntr-message">{message}</p> : null}
        {result ? (
          <pre data-testid="ntr-result">{JSON.stringify(result, null, 2)}</pre>
        ) : null}
      </div>
    </div>
  );
}
