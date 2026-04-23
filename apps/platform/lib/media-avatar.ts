import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';

export const MEDIA_BUCKET = 'media';
export const PUBLIC_MEDIA_PREFIX = `/storage/v1/object/public/${MEDIA_BUCKET}/`;

export function toOptionalTrimmed(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildAvatarObjectPath(
  scopePrefix: string,
  ownerId: string,
  fileName: string,
  nestedPath?: string
): string {
  return nestedPath
    ? `${scopePrefix}/${ownerId}/${nestedPath}/${fileName}`
    : `${scopePrefix}/${ownerId}/${fileName}`;
}

export function extractOwnedAvatarObjectPath(
  value: string,
  scopePrefix: string,
  ownerId: string
): string | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      if (parsedUrl.origin !== new URL(supabaseUrl).origin) {
        return null;
      }
    } catch {
      return null;
    }
  }

  if (!parsedUrl.pathname.startsWith(PUBLIC_MEDIA_PREFIX)) {
    return null;
  }

  const objectPath = decodeURIComponent(
    parsedUrl.pathname.slice(PUBLIC_MEDIA_PREFIX.length)
  );
  const parts = objectPath.split('/');

  if (parts.length < 3) {
    return null;
  }

  const [folder, entityId, ...rest] = parts;

  if (folder !== scopePrefix || entityId !== ownerId || rest.length === 0) {
    return null;
  }

  return objectPath;
}

export async function removeMediaObjects(
  supabase: SupabaseClient<Database>,
  objectPaths: Array<string | null>
): Promise<void> {
  const uniquePaths = [
    ...new Set(
      objectPaths.filter(
        (objectPath): objectPath is string => objectPath !== null
      )
    ),
  ];

  if (uniquePaths.length === 0) {
    return;
  }

  await supabase.storage.from(MEDIA_BUCKET).remove(uniquePaths);
}
