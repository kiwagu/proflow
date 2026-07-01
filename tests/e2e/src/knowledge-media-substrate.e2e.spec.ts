/**
 * KB media substrate — real file/video upload + download over the private `kb-media`
 * bucket, RLS-fenced (ADR-0026, slice-13; the MERGE GATE). Making `file`/`video`
 * REAL introduces a NEW access surface over BYTES, so the storage-RLS negatives
 * (assertions 5–10, 11b) are a hard gate. The READ fence (storage.objects SELECT +
 * satellite RLS) mirrors node-read and COMPOSES grants — a per-user / inherited-folder
 * grantee CAN download. The WRITE fence (INSERT/UPDATE/DELETE + the upload authorizer)
 * mirrors node-UPDATE EXACTLY — `owner OR space.knowledge.update`, grants NOT composed —
 * so a mere READ grantee can NEVER overwrite another user's bytes. RLS is the SOLE fence
 * — no app-level filter — so a denial is RLS returning no row / refusing the mint, never
 * an app check dropping it (poc-no-fallbacks).
 *
 * The corpus comes from the SHARED `KNOWLEDGE_BASE_SCENARIO` catalog (the `media`
 * preset, via `seedMediaSubstrateFixture`), whose `file`/`video` nodes are made real by
 * the materializer through the product's OWN transport (authorize → upload the bytes to the
 * server-decided path → confirm the `kmm` satellite; the resumable/TUS switch dropped the
 * single-PUT signed-url leg) — so the demo DB and this
 * test speak ONE create-vocabulary, never a bespoke seeding path. The transport itself
 * runs through the SAME vocabulary (`seedClientFor(actor).uploadMediaUrl/setMedia/
 * downloadMediaUrl` → the REAL `/author/graph/media` + `attribute:'media'` routes,
 * RLS-fenced as the acting user) against REAL Storage.
 *
 *  Functional (Phase 1):
 *   1  upload to an OWNED node → server path authorized; bytes land; `kmm` row present.
 *   2  download that node → signed URL; GET returns the EXACT bytes.
 *   3  ResourcePanel Media section shows filename + humanized size + mime + Download.
 *   3a an IMAGE node (image/png) renders an inline `<img>` preview ABOVE the facts
 *       (ADR-0026 Phase 2, increment 1) — mime-driven, via the SAME download authorizer.
 *   3b a PDF node (application/pdf) renders an inline `<iframe>` preview ABOVE the facts.
 *   3c a VIDEO node (video/mp4) renders an inline `<video controls>` player ABOVE the
 *       facts (ADR-0026 Phase 2, increment 2) — same mime-driven download authorizer.
 *   3d an AUDIO node (audio/wav) renders an inline `<audio controls>` player ABOVE the
 *       facts. 3c/3d assert the facts + Download REMAIN (the player is additive).
 *   4  upload to a `video` node → same path (one substrate serves file & video).
 *   4a org-limit round-trip (ADR-0026 §A4): set `platform.media.max_upload_bytes` LOW at
 *       `organization` scope → the authorizer DENIES (400) an upload exceeding it (the
 *       resolver reflects the set org value); unset → the same upload is AUTHORIZED again
 *       (falls back through the cascade to the 200 MB code default).
 *   4b >50 MiB upload travels the RESUMABLE (TUS) transport end-to-end and lands: a ~60 MiB
 *       payload is authorized → resumable-uploaded via `tus-js-client` (Node) to the
 *       server-decided path under the owner's OWN session JWT → confirmed; the `kmm` row
 *       carries the full ~60 MiB `size_bytes`. PROVES the standard 50 MiB upload cap is
 *       bypassed via TUS + the raised bucket FILE_SIZE_LIMIT (5 GB) is in effect.
 *
 *  RLS / access (the security gate):
 *   5  non-grantee download URL for another user's PRIVATE file → DENIED; direct
 *      object fetch (its own JWT, no signed token) also fails.
 *   6  direct object fetch with NO signed token on the private bucket → 400/401/404.
 *   7  download URL for a file in ANOTHER space → DENIED (cross-space conjunct).
 *   8  grantee of a granted ANCESTOR folder downloads the nested file → signed URL;
 *      bytes returned (inherited-grant composes through storage-RLS).
 *   9  non-owner-non-grantee upload URL for a node it cannot update → DENIED.
 *   10 anon (unauthenticated) hits any media route / bucket object → DENIED.
 *
 *  The read/write asymmetry (a per-user grant is a READ dimension only):
 *   11a a NODE-LEVEL read-grantee (per-user grant, NO space-wide update) requests a
 *       download URL on the granted file → ALLOWED; GET returns the exact bytes (the
 *       read-grant composes through the storage-RLS SELECT).
 *   11b the SAME grantee requests an upload URL on that node → DENIED (the write fence is
 *       owner-or-space-update; grants NOT composed); a direct object write also fails and
 *       the owner's bytes are unchanged. The regression guard: a read-grantee cannot
 *       overwrite someone else's file bytes.
 *
 * Tagged `@full` — needs the running Supabase + author stack + REAL Storage.
 */
import { createClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Upload as TusUpload } from 'tus-js-client';
import { KB_MEDIA_BUCKET } from '@workspace/knowledge-contracts';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  seedClientFor,
  seedMediaSubstrateFixture,
  teardownKnowledgeGraphTenant,
  teardownMediaSubstrateFixture,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
  type MediaSubstrateFixture,
} from './helpers/knowledge-graph-bootstrap.js';
import {
  resetOrganizationMediaMaxUploadBytes,
  setOrganizationMediaMaxUploadBytes,
} from './helpers/runtime-settings.js';
import { resolveAnonKey, resolveSupabaseUrl } from './helpers/test-user.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';
// The proxy's active-space cookie (mirror of @workspace/gateway-auth's ACTIVE_SPACE_COOKIE)
// — inlined to keep the e2e package dep-free, exactly as the sibling render specs do.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

// The seeded media titles (from KNOWLEDGE_BASE_SCENARIO) — the demo DB and this spec
// name the SAME nodes through the one create-vocabulary.
const FILE_OWNED_TITLE = 'Media Handbook (file)';
const FILE_OWNED_FILENAME = 'media-handbook.txt';
const FILE_OWNED_MIME = 'text/plain';

/** Upload bytes to a node AS `actor` through the REAL transport (authorize → PUT →
 * confirm), the SAME three-step flow the product's create flow drives. Returns after the
 * `kmm` satellite is confirmed. Throws on any leg failing (the caller expects success). */
async function uploadAs(
  actor: KnowledgeActor,
  spaceId: string,
  nodeId: string,
  content: string,
  filename: string,
  mimeType = 'text/plain'
): Promise<void> {
  const sizeBytes = new TextEncoder().encode(content).byteLength;
  const client = await seedClientFor(actor);
  try {
    const auth = await client.uploadMediaUrl(spaceId, nodeId, {
      mimeType,
      sizeBytes,
      filename,
    });
    // Resumable/TUS switch (ADR-0026 §A2): authorize is CONTROL-plane — it returns the
    // server-decided storagePath ONLY, no signed URL/token. Upload the bytes to that path
    // under the actor's own session, fenced by the storage.objects INSERT RLS.
    expect(auth.storagePath).toBeTruthy();
    const { error } = await actor.client.storage
      .from(KB_MEDIA_BUCKET)
      .upload(auth.storagePath, new TextEncoder().encode(content), {
        contentType: mimeType,
        upsert: false,
      });
    expect(error, error?.message).toBeNull();
    await client.setMedia({
      spaceId,
      nodeId,
      storagePath: auth.storagePath,
      mimeType,
      sizeBytes,
      originalFilename: filename,
    });
  } finally {
    await client.dispose();
  }
}

/** The resumable (TUS) chunk size — 6 MiB, the Supabase storage-api-required constant for
 * the `/storage/v1/upload/resumable` endpoint (mirrors the product's `TUS_CHUNK_SIZE`). */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/** Resolve an actor's RAW Supabase session access_token (the storage identity the TUS
 * PATCH is fenced on). The actor's `client` is already signed in (in-memory session, no
 * persistence); fall back to a fresh sign-in if the token isn't reachable. */
async function actorAccessToken(actor: KnowledgeActor): Promise<string> {
  const {
    data: { session },
  } = await actor.client.auth.getSession();
  if (session?.access_token) {
    return session.access_token;
  }
  const fresh = createClient(resolveSupabaseUrl(), resolveAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await fresh.auth.signInWithPassword({
    email: actor.email,
    password: actor.password,
  });
  if (error || !data.session?.access_token) {
    throw new Error(
      `actorAccessToken(${actor.email}): ${error?.message ?? 'no session'}`
    );
  }
  return data.session.access_token;
}

/** Drive ONE resumable (TUS) upload of an in-memory Buffer to Storage's TUS endpoint under
 * the actor's OWN session JWT — the SAME transport the product's browser client uses
 * (6 MiB chunks, `x-upsert:false`, `{ bucketName, objectName, contentType }` metadata). The
 * standard storage-api `.upload()` caps at 50 MiB, so a >50 MiB payload MUST travel here.
 * Resolves on `onSuccess`; rejects on `onError`. */
function uploadBytesResumable(opts: {
  payload: Buffer;
  accessToken: string;
  objectName: string;
  contentType: string;
}): Promise<void> {
  const { payload, accessToken, objectName, contentType } = opts;
  return new Promise<void>((resolve, reject) => {
    const upload = new TusUpload(payload, {
      endpoint: `${resolveSupabaseUrl()}/storage/v1/upload/resumable`,
      chunkSize: TUS_CHUNK_SIZE,
      uploadSize: payload.byteLength,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-upsert': 'false',
      },
      metadata: {
        bucketName: KB_MEDIA_BUCKET,
        objectName,
        contentType,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onSuccess: () => resolve(),
      onError: (error) => reject(error),
    });
    upload.start();
  });
}

/** Read the `kb.resource_media_meta` satellite row via the tenant service client — a
 * setup/assertion read (NOT the access path under test), used to prove the `kmm` row
 * landed with the declared mime/size/filename after an upload (assertions 1, 4, 11). */
async function readKmm(
  tenant: KnowledgeGraphTenant,
  nodeId: string
): Promise<{
  mime_type: string;
  size_bytes: number;
  original_filename: string;
  storage_path: string;
} | null> {
  const { data } = await tenant.service
    .schema('kb')
    .from('resource_media_meta')
    .select('mime_type,size_bytes,original_filename,storage_path')
    .eq('node_id', nodeId)
    .maybeSingle();
  return data ?? null;
}

/** POST a media op AS `actor` and return the raw status + parsed body — the unit the
 * RLS negatives assert on (a non-2xx status = DENIED; no `signedUrl` = no egress). */
async function mediaOp(
  actor: KnowledgeActor,
  op: 'upload-url' | 'download-url',
  body: unknown
): Promise<{ status: number; body: { signedUrl?: string } | null }> {
  const client = await seedClientFor(actor);
  try {
    const res = await client.post(`/author/graph/media?op=${op}`, body);
    return res as { status: number; body: { signedUrl?: string } | null };
  } finally {
    await client.dispose();
  }
}

/** The CARD (grid tile) for a node in the content area — scoped to `div.group` so it
 * never matches the sidebar folder list. Mirrors the sibling render specs. */
function card(page: Page, title: string) {
  return page
    .locator('div.group', { has: page.getByText(title, { exact: true }) })
    .first();
}

/** A browser context authenticated AS the actor with the active space pinned. */
async function pageFor(
  context: BrowserContext,
  actor: KnowledgeActor,
  spaceId: string
): Promise<Page> {
  const ssr = await actorSsrAuthCookies(actor);
  const url = new URL(BASE);
  await context.addCookies([
    ...ssr.map((c) => ({
      name: c.name,
      value: c.value,
      domain: url.hostname,
      path: '/',
    })),
    {
      name: ACTIVE_SPACE_COOKIE,
      value: spaceId,
      domain: url.hostname,
      path: '/',
    },
  ]);
  return context.newPage();
}

test.describe('@full ADR-0026 KB media substrate — real upload/download, RLS-fenced', () => {
  test.describe.configure({ timeout: 240_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: MediaSubstrateFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedMediaSubstrateFixture(tenant);
  });

  test.afterAll(async () => {
    await teardownMediaSubstrateFixture(fx);
    if (tenant) {
      await teardownKnowledgeGraphTenant(
        tenant,
        [fx?.otherOwner.userId, fx?.nodeGrantee.userId].filter(
          (id): id is string => Boolean(id)
        )
      );
    }
  });

  // ── Functional (Phase 1) ───────────────────────────────────────────────────

  test('(1) upload to an owned node authorizes a server path, bytes land, and the kmm row is present', async () => {
    // The owned file was uploaded by the materializer through the real transport, so a
    // kmm row + a bucket object already exist. Assert the row carries the declared
    // mime/size/path/filename (end-to-end upload + metadata write).
    const kmm = await readKmm(tenant, fx.fileOwnedId);
    expect(kmm, 'kmm row for the owned file').not.toBeNull();
    expect(kmm?.mime_type).toBe(FILE_OWNED_MIME);
    expect(kmm?.original_filename).toBe(FILE_OWNED_FILENAME);
    expect(kmm?.size_bytes).toBe(
      new TextEncoder().encode(fx.fixtureBytes.fileOwned).byteLength
    );
    expect(kmm?.storage_path).toBe(fx.fileOwnedPath);

    // And the object genuinely exists in the private bucket (service read — setup check).
    const { data, error } = await tenant.service.storage
      .from(KB_MEDIA_BUCKET)
      .download(fx.fileOwnedPath);
    expect(error, error?.message).toBeNull();
    expect(await data?.text()).toBe(fx.fixtureBytes.fileOwned);
  });

  test('(2) download on the owned node issues a signed URL; GET returns the EXACT bytes', async () => {
    const client = await seedClientFor(fx.owner);
    try {
      const { signedUrl, expiresAt } = await client.downloadMediaUrl(
        fx.spaceId,
        fx.fileOwnedId
      );
      expect(signedUrl).toBeTruthy();
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

      const res = await fetch(signedUrl);
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe(fx.fixtureBytes.fileOwned);
    } finally {
      await client.dispose();
    }
  });

  test('(3) the ResourcePanel Media section shows filename + size + mime + Download', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      // Open the KB folder that holds the file card, then single-click it → Details panel.
      await page.goto(`/author/graph?folder=${fx.kbFolderId}`, {
        timeout: 60_000,
      });
      await expect(card(page, FILE_OWNED_TITLE)).toBeVisible({
        timeout: 60_000,
      });
      await card(page, FILE_OWNED_TITLE)
        .getByText(FILE_OWNED_TITLE, { exact: true })
        .click();

      const panel = page.getByRole('complementary', {
        name: FILE_OWNED_TITLE,
      });
      // The Media section (shared MediaFacts view): filename + size are visible text;
      // the raw mime is the tooltip on the friendly type label (e.g. "PLAIN"), so it is
      // asserted via title. Plus the Download control.
      await expect(panel.getByText(FILE_OWNED_FILENAME)).toBeVisible({
        timeout: 30_000,
      });
      await expect(panel.getByTitle(FILE_OWNED_MIME)).toBeVisible();
      await expect(
        panel.getByRole('button', { name: /Download/i })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('(3a) an IMAGE node renders an inline <img> preview ABOVE the facts (mime-driven)', async ({
    browser,
  }) => {
    // ADR-0026 Phase 2, increment 1: an `image/*` mime drives an inline `<img>` in the
    // Media section (alt "Preview of <filename>"), minted via the SAME single-node
    // download authorizer. The facts (filename) still show — the preview is ADDITIVE.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto(`/author/graph?folder=${fx.kbFolderId}`, {
        timeout: 60_000,
      });
      const title = 'Media Preview Image (file)';
      await expect(card(page, title)).toBeVisible({ timeout: 60_000 });
      await card(page, title).getByText(title, { exact: true }).click();

      const panel = page.getByRole('complementary', { name: title });
      const preview = panel.getByRole('img', {
        name: `Preview of ${fx.fileImageFilename}`,
      });
      await expect(preview).toBeVisible({ timeout: 30_000 });
      // The preview loaded real bytes (not a broken image → onError would null it out).
      await expect(async () => {
        const complete = await preview.evaluate(
          (el) =>
            (el as HTMLImageElement).complete &&
            (el as HTMLImageElement).naturalWidth > 0
        );
        expect(complete).toBe(true);
      }).toPass({ timeout: 30_000 });
      // Facts remain (additive): the filename + Download are still present.
      await expect(panel.getByText(fx.fileImageFilename)).toBeVisible();
      await expect(
        panel.getByRole('button', { name: /Download/i })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('(3b) a PDF node renders an inline <iframe> preview ABOVE the facts (mime-driven)', async ({
    browser,
  }) => {
    // ADR-0026 Phase 2, increment 1: an `application/pdf` mime drives a bounded inline
    // `<iframe>` (title "Preview of <filename>") via the SAME download authorizer.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto(`/author/graph?folder=${fx.kbFolderId}`, {
        timeout: 60_000,
      });
      const title = 'Media Preview PDF (file)';
      await expect(card(page, title)).toBeVisible({ timeout: 60_000 });
      await card(page, title).getByText(title, { exact: true }).click();

      const panel = page.getByRole('complementary', { name: title });
      await expect(
        panel.locator(`iframe[title="Preview of ${fx.filePdfFilename}"]`)
      ).toBeVisible({ timeout: 30_000 });
      // Facts remain (additive): the filename + Download are still present.
      await expect(panel.getByText(fx.filePdfFilename)).toBeVisible();
      await expect(
        panel.getByRole('button', { name: /Download/i })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('(3c) a VIDEO node renders an inline <video> player ABOVE the facts (mime-driven)', async ({
    browser,
  }) => {
    // ADR-0026 Phase 2, increment 2: a `video/*` mime drives an inline `<video controls>`
    // player (aria-label "Preview of <filename>") ABOVE the facts, minted via the SAME
    // single-node download authorizer (no new endpoint, no getPublicUrl). The facts +
    // Download still show — the player is ADDITIVE.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto(`/author/graph?folder=${fx.kbFolderId}`, {
        timeout: 60_000,
      });
      const title = 'Intro Clip (video)';
      await expect(card(page, title)).toBeVisible({ timeout: 60_000 });
      await card(page, title).getByText(title, { exact: true }).click();

      const panel = page.getByRole('complementary', { name: title });
      const player = panel.locator(
        `video[aria-label="Preview of ${fx.videoOwnedFilename}"]`
      );
      await expect(player).toBeVisible({ timeout: 30_000 });
      // The player loaded real bytes: metadata (preload="metadata") resolves to a
      // readyState ≥ 1 (HAVE_METADATA) — a broken src would trip onError → null player.
      await expect(async () => {
        const ready = await player.evaluate(
          (el) => (el as HTMLVideoElement).readyState >= 1
        );
        expect(ready).toBe(true);
      }).toPass({ timeout: 30_000 });
      // Facts remain (additive): the filename + Download are still present.
      await expect(panel.getByText(fx.videoOwnedFilename)).toBeVisible();
      await expect(
        panel.getByRole('button', { name: /Download/i })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('(3d) an AUDIO node renders an inline <audio> player ABOVE the facts (mime-driven)', async ({
    browser,
  }) => {
    // ADR-0026 Phase 2, increment 2: an `audio/*` mime drives an inline `<audio controls>`
    // player (aria-label "Preview of <filename>") via the SAME download authorizer. The
    // facts + Download still show — the player is ADDITIVE.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto(`/author/graph?folder=${fx.kbFolderId}`, {
        timeout: 60_000,
      });
      const title = 'Intro Tone (audio)';
      await expect(card(page, title)).toBeVisible({ timeout: 60_000 });
      await card(page, title).getByText(title, { exact: true }).click();

      const panel = page.getByRole('complementary', { name: title });
      const player = panel.locator(
        `audio[aria-label="Preview of ${fx.fileAudioFilename}"]`
      );
      await expect(player).toBeVisible({ timeout: 30_000 });
      await expect(async () => {
        const ready = await player.evaluate(
          (el) => (el as HTMLAudioElement).readyState >= 1
        );
        expect(ready).toBe(true);
      }).toPass({ timeout: 30_000 });
      // Facts remain (additive): the filename + Download are still present.
      await expect(panel.getByText(fx.fileAudioFilename)).toBeVisible();
      await expect(
        panel.getByRole('button', { name: /Download/i })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('(4) upload to a VIDEO node succeeds — one substrate serves file & video', async () => {
    // The seeded video node already has real bytes (materializer, same transport). Prove
    // the kmm row exists + the object is present, then re-upload NEW bytes AS the owner to
    // exercise the live upload path end-to-end on a `video` kind.
    const seeded = await readKmm(tenant, fx.videoOwnedId);
    expect(seeded, 'kmm row for the owned video').not.toBeNull();
    expect(await readKmm(tenant, fx.videoOwnedId)).not.toBeNull();

    const content =
      'A fresh video-node upload over the shared media substrate (ADR-0026 assertion 4).\n';
    await uploadAs(
      fx.owner,
      fx.spaceId,
      fx.videoOwnedId,
      content,
      'reupload-clip.txt'
    );
    const kmm = await readKmm(tenant, fx.videoOwnedId);
    expect(kmm?.original_filename).toBe('reupload-clip.txt');
    expect(kmm?.size_bytes).toBe(new TextEncoder().encode(content).byteLength);

    // The bytes are downloadable AS the owner (round-trips through the real signed URL).
    const client = await seedClientFor(fx.owner);
    try {
      const { signedUrl } = await client.downloadMediaUrl(
        fx.spaceId,
        fx.videoOwnedId
      );
      const res = await fetch(signedUrl);
      expect(await res.text()).toBe(content);
    } finally {
      await client.dispose();
    }
  });

  test('(4a) org-limit round-trip: a low org max DENIES an over-limit upload (400); unset falls back to the 200 MB default', async () => {
    // The SOFT limit is the org-governed `platform.media.max_upload_bytes` (ADR-0026 §A4),
    // resolved org → global → 200 MB default under the CALLER's RLS. Drive the round-trip
    // through the REAL authorizer AS the owner (a legit uploader) — reuse the existing
    // runtime-settings set path (no reinvented dial).
    const ORG_LIMIT = 1024; // 1 KiB — a deliberately tiny org ceiling.
    const OVER_LIMIT = ORG_LIMIT + 1; // just over → must be denied while the row is set.

    // Baseline: with NO org row, a 1 KiB+ upload is well under the 200 MB default → AUTHORIZED.
    const beforeSet = await mediaOp(fx.owner, 'upload-url', {
      spaceId: fx.spaceId,
      nodeId: fx.fileOwnedId,
      mimeType: 'text/plain',
      sizeBytes: OVER_LIMIT,
      filename: 'org-limit-probe.txt',
    });
    expect(beforeSet.status).toBe(200);

    try {
      // Set the org dial LOW. The resolver now returns 1 KiB for uploads in this org's space.
      await setOrganizationMediaMaxUploadBytes(
        tenant.organizationId,
        ORG_LIMIT
      );

      // An upload EXCEEDING the org limit is denied at the authorizer with a clean 400
      // (the resolver reflects the set org value; not a storage/RLS error).
      const denied = await mediaOp(fx.owner, 'upload-url', {
        spaceId: fx.spaceId,
        nodeId: fx.fileOwnedId,
        mimeType: 'text/plain',
        sizeBytes: OVER_LIMIT,
        filename: 'org-limit-probe.txt',
      });
      expect(denied.status).toBe(400);
      expect(denied.body?.signedUrl).toBeFalsy();

      // A size AT/under the org limit still authorizes → the limit is the fence, not a block.
      const allowed = await mediaOp(fx.owner, 'upload-url', {
        spaceId: fx.spaceId,
        nodeId: fx.fileOwnedId,
        mimeType: 'text/plain',
        sizeBytes: ORG_LIMIT,
        filename: 'org-limit-ok.txt',
      });
      expect(allowed.status).toBe(200);
    } finally {
      // Unset → the cascade falls back to the 200 MB default.
      await resetOrganizationMediaMaxUploadBytes(tenant.organizationId);
    }

    // After unset, the previously-denied over-limit upload is AUTHORIZED again (default fence).
    const afterReset = await mediaOp(fx.owner, 'upload-url', {
      spaceId: fx.spaceId,
      nodeId: fx.fileOwnedId,
      mimeType: 'text/plain',
      sizeBytes: OVER_LIMIT,
      filename: 'org-limit-probe.txt',
    });
    expect(afterReset.status).toBe(200);
  });

  // ── Large-file (resumable) path — the raised-cap headline ────────────────────

  test('(4b) a >50 MiB upload travels the resumable (TUS) path and lands (raised FILE_SIZE_LIMIT)', async () => {
    // The headline proof: a ~60 MiB payload EXCEEDS storage-api's STANDARD
    // single-request cap (UPLOAD_FILE_SIZE_LIMIT_STANDARD=52428800, 50 MiB), so it can
    // ONLY land via the RESUMABLE (TUS) transport — the SAME path the product's browser
    // client drives (`/storage/v1/upload/resumable`, 6 MiB chunks, the caller's own
    // session JWT). The authorizer already ACCEPTS the declared size (under the 200 MB
    // soft default + 5 GB hard cap); this closes the last gap — driving the BYTES over
    // TUS from Node via `tus-js-client`. A fresh owned `video` node keeps it isolated.
    const PAYLOAD_BYTES = 60 * 1024 * 1024; // ~60 MiB — > the 50 MiB standard cap.
    const CONTENT_TYPE = 'video/mp4';
    const FILENAME = 'large-clip.mp4';

    const client = await seedClientFor(fx.owner);
    try {
      // A dedicated owned video node for this test (isolated from the seeded corpus).
      const nodeId = await client.createNode(
        fx.spaceId,
        'video',
        'Large Clip (video, >50 MiB)'
      );

      // 1. Authorize — declare the >50 MiB size + mime; get the server-decided path.
      const auth = await client.uploadMediaUrl(fx.spaceId, nodeId, {
        mimeType: CONTENT_TYPE,
        sizeBytes: PAYLOAD_BYTES,
        filename: FILENAME,
      });
      expect(auth.storagePath).toBeTruthy();

      // 2. Resumable-upload the ~60 MiB payload via TUS under the owner's OWN session JWT
      //    (an in-memory Buffer — no fixture file). The standard `.upload()` would 413 on
      //    this size; TUS carries the genuine ~60 MiB over the wire in 6 MiB chunks.
      const accessToken = await actorAccessToken(fx.owner);
      const payload = Buffer.alloc(PAYLOAD_BYTES, 'a');
      await uploadBytesResumable({
        payload,
        accessToken,
        objectName: auth.storagePath,
        contentType: CONTENT_TYPE,
      });

      // 3. Confirm — write the `kmm` satellite (only after the bytes landed).
      await client.setMedia({
        spaceId: fx.spaceId,
        nodeId,
        storagePath: auth.storagePath,
        mimeType: CONTENT_TYPE,
        sizeBytes: PAYLOAD_BYTES,
        originalFilename: FILENAME,
      });

      // 4. Assert the kmm row carries the full ~60 MiB size — PROVES the 50 MiB standard
      //    cap was bypassed via the resumable transport (a standard PUT would have 413'd
      //    before any row could be written).
      const kmm = await readKmm(tenant, nodeId);
      expect(kmm, 'kmm row for the large video').not.toBeNull();
      expect(kmm?.mime_type).toBe(CONTENT_TYPE);
      expect(kmm?.original_filename).toBe(FILENAME);
      expect(kmm?.size_bytes).toBe(PAYLOAD_BYTES);
      expect(kmm?.storage_path).toBe(auth.storagePath);

      // The object genuinely exists at full size in the private bucket (service read —
      // a setup/assertion check, NOT the access path under test): the download authorizer
      // + signed URL are already proven by assertion 2; here we confirm the byte count.
      const { data, error } = await tenant.service.storage
        .from(KB_MEDIA_BUCKET)
        .download(auth.storagePath);
      expect(error, error?.message).toBeNull();
      const landed = await data?.arrayBuffer();
      expect(landed?.byteLength).toBe(PAYLOAD_BYTES);
    } finally {
      await client.dispose();
    }
  });

  // ── RLS / access (the security gate) ────────────────────────────────────────

  test('(5) a non-grantee cannot download another user’s PRIVATE file (URL denied; direct fetch fails)', async () => {
    // `admin` is a non-grantee of Bea's private file. The download authorizer resolves the
    // satellite under admin's RLS → no row → DENIED (no signed URL). Bea (its owner) CAN.
    const denied = await mediaOp(fx.owner, 'download-url', {
      spaceId: fx.spaceId,
      nodeId: fx.privateOtherFileId,
    });
    expect(denied.status).not.toBe(200);
    expect(denied.body?.signedUrl).toBeFalsy();

    // Owner (Bea) can download — proves the denial above is the fence, not a broken node.
    const ownerClient = await seedClientFor(fx.otherOwner);
    try {
      const ok = await ownerClient.downloadMediaUrl(
        fx.spaceId,
        fx.privateOtherFileId
      );
      expect(ok.signedUrl).toBeTruthy();
    } finally {
      await ownerClient.dispose();
    }

    // Direct object fetch under admin's OWN JWT (no signed token): storage-RLS SELECT
    // mirrors node-read, so admin (a non-grantee) is refused the bytes at the object level.
    const { data, error } = await fx.owner.client.storage
      .from(KB_MEDIA_BUCKET)
      .download(fx.privateOtherFilePath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  test('(6) fetching the object path directly with NO signed token is denied (private bucket)', async () => {
    // The path is not a secret and is never the fence. An anon storage client hitting the
    // object URL directly (no signed token) on the PRIVATE bucket must fail closed.
    const anon = createClient(resolveSupabaseUrl(), resolveAnonKey());
    const { data, error } = await anon.storage
      .from(KB_MEDIA_BUCKET)
      .download(fx.fileOwnedPath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();

    // And a raw GET of the public object URL (no token) → non-2xx (bucket is private).
    const publicUrl = `${resolveSupabaseUrl()}/storage/v1/object/${KB_MEDIA_BUCKET}/${fx.fileOwnedPath}`;
    const res = await fetch(publicUrl);
    expect(res.ok).toBe(false);
  });

  test('(7) a download URL for a file in ANOTHER space is denied (cross-space conjunct)', async () => {
    // The space-A owner requests a download of a file that lives in space B (a space it is
    // not a member of). The download authorizer scopes the satellite read to {spaceId,
    // nodeId} under the caller's RLS → no row → DENIED. The space_id conjunct + the
    // predicate's own space check keep the foreign bytes unreachable.
    const denied = await mediaOp(fx.owner, 'download-url', {
      spaceId: fx.spaceId,
      nodeId: fx.otherSpace.fileId,
    });
    expect(denied.status).not.toBe(200);
    expect(denied.body?.signedUrl).toBeFalsy();

    // Sanity: the space-B owner CAN download it in its OWN space (absence above is the
    // space fence, not a broken object).
    const bClient = await seedClientFor(fx.otherSpace.tenant.granted);
    try {
      const ok = await bClient.downloadMediaUrl(
        fx.otherSpace.tenant.spaceId,
        fx.otherSpace.fileId
      );
      expect(ok.signedUrl).toBeTruthy();
    } finally {
      await bClient.dispose();
    }
  });

  test('(8) a grantee of a granted ANCESTOR folder can download the nested file (inherited grant)', async () => {
    // Bea (`otherOwner`) was granted the ANCESTOR folder, never the nested file directly.
    // The inherited-grant disjunct (ADR-0023) composes through the storage-RLS SELECT, so
    // she can mint a signed URL and fetch the bytes.
    const client = await seedClientFor(fx.otherOwner);
    try {
      const { signedUrl } = await client.downloadMediaUrl(
        fx.spaceId,
        fx.inheritedFileId
      );
      expect(signedUrl).toBeTruthy();
      const res = await fetch(signedUrl);
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe(fx.fixtureBytes.inherited);
    } finally {
      await client.dispose();
    }
  });

  test('(9) a non-owner-non-grantee cannot get an upload URL for a node it cannot update', async () => {
    // `nodeGrantee` (a plain `member`, NO space-wide `space.knowledge.update`) targets the
    // OWNER's file it neither owns nor holds ANY grant on (`kb/file-owned`). The write
    // fence (owner-or-space-update, grants not composed) is unsatisfied on every disjunct,
    // so the upload authorizer fails closed. (Bea/`otherOwner` is NOT used here: she holds
    // the `admin` role → space-wide update → she legitimately COULD upload space-wide, so
    // she is not a valid non-authorized actor under the new write fence.)
    const denied = await mediaOp(fx.nodeGrantee, 'upload-url', {
      spaceId: fx.spaceId,
      nodeId: fx.fileOwnedId,
      mimeType: 'text/plain',
      sizeBytes: 32,
      filename: 'nope.txt',
    });
    expect(denied.status).not.toBe(200);
    expect(denied.body?.signedUrl).toBeFalsy();
  });

  test('(10) anon (unauthenticated) is denied on any media route + the bucket object', async () => {
    // No cookies → no session. `requireRlsSession` rejects with a non-2xx before any
    // authorize logic runs (fail-closed baseline).
    const ctx = await (
      await import('@playwright/test')
    ).request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
    try {
      const dl = await ctx.post('/author/graph/media?op=download-url', {
        data: { spaceId: fx.spaceId, nodeId: fx.fileOwnedId },
      });
      expect(dl.ok()).toBe(false);
      const up = await ctx.post('/author/graph/media?op=upload-url', {
        data: {
          spaceId: fx.spaceId,
          nodeId: fx.fileOwnedId,
          mimeType: 'text/plain',
          sizeBytes: 16,
          filename: 'x.txt',
        },
      });
      expect(up.ok()).toBe(false);
    } finally {
      await ctx.dispose();
    }

    // The bucket object itself is unreachable to an unauthenticated storage client.
    const anon = createClient(resolveSupabaseUrl(), resolveAnonKey());
    const { data, error } = await anon.storage
      .from(KB_MEDIA_BUCKET)
      .download(fx.fileOwnedPath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  // ── The read/write asymmetry (a per-user grant is a READ dimension only) ────
  //
  // `nodeGrantee` is a plain `member` (read + create, NO space-wide `space.knowledge.update`)
  // holding a PER-USER grant on this file (owner-uploaded bytes). The grant is READ-only:
  // it composes into the storage-RLS SELECT (download) but NOT into the WRITE fence (upload).
  // 11a proves the read half succeeds; 11b is the regression guard that the write half is
  // DENIED — a read-grantee must never be able to overwrite another user's file bytes.

  test('(11a) a NODE-LEVEL read-grantee CAN download the granted file (read-grant composes on SELECT)', async () => {
    const client = await seedClientFor(fx.nodeGrantee);
    try {
      const { signedUrl } = await client.downloadMediaUrl(
        fx.spaceId,
        fx.nodeGrantFileId
      );
      expect(signedUrl).toBeTruthy();
      const res = await fetch(signedUrl);
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe(fx.fixtureBytes.nodeGrant);
    } finally {
      await client.dispose();
    }
  });

  test('(11b) the SAME read-grantee is DENIED an upload URL + a direct object write (write fence)', async () => {
    // The write fence is `owner OR space.knowledge.update` — grants are NOT composed. The
    // grantee owns neither and lacks space-wide update, so the upload authorizer must 403.
    const denied = await mediaOp(fx.nodeGrantee, 'upload-url', {
      spaceId: fx.spaceId,
      nodeId: fx.nodeGrantFileId,
      mimeType: 'text/plain',
      sizeBytes: 42,
      filename: 'grantee-overwrite.txt',
    });
    expect(denied.status).not.toBe(200);
    expect(denied.body?.signedUrl).toBeFalsy();

    // Defense-in-depth: even attempting to write the object path DIRECTLY under the
    // grantee's OWN JWT (bypassing the authorizer) must fail — the storage.objects
    // INSERT/UPDATE policy mirrors the same write fence, so the grantee cannot overwrite
    // the owner's bytes. `upsert:true` targets the existing object; RLS refuses it.
    const { error: writeError } = await fx.nodeGrantee.client.storage
      .from(KB_MEDIA_BUCKET)
      .upload(
        fx.nodeGrantFilePath,
        new Blob(['tampered by a read-grantee — must be refused\n'], {
          type: 'text/plain',
        }),
        { upsert: true }
      );
    expect(writeError).not.toBeNull();

    // And the OWNER's bytes are intact — the denied write changed nothing.
    const { data, error } = await tenant.service.storage
      .from(KB_MEDIA_BUCKET)
      .download(fx.nodeGrantFilePath);
    expect(error, error?.message).toBeNull();
    expect(await data?.text()).toBe(fx.fixtureBytes.nodeGrant);
  });
});
