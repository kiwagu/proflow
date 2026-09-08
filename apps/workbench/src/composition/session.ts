export interface WorkbenchSession {
  userId: string;
  email: string;
  spaceId: string | null;
  spaceName: string | null;
}

export const platformPath =
  (import.meta.env.VITE_PLATFORM_BASE_PATH as string | undefined) ??
  '/platform';

export function signIn() {
  const next = window.location.pathname + window.location.search;
  window.location.replace(`${platformPath}?next=${encodeURIComponent(next)}`);
}

export async function readSession(): Promise<WorkbenchSession | null> {
  const response = await fetch(`${platformPath}/api/workbench/session`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) return null;
  if (!response.ok || response.redirected)
    throw new Error('Could not verify your session. Please retry.');
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== 'object' ||
    !('userId' in value) ||
    typeof value.userId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(value.userId) ||
    !('spaceId' in value) ||
    !(
      value.spaceId === null ||
      (typeof value.spaceId === 'string' &&
        /^[a-zA-Z0-9_.-]+$/.test(value.spaceId))
    ) ||
    !('email' in value) ||
    typeof value.email !== 'string' ||
    !('spaceName' in value) ||
    !(value.spaceName === null || typeof value.spaceName === 'string')
  ) {
    throw new Error('Invalid session response');
  }
  return value as WorkbenchSession;
}

export function storageNamespace(session: WorkbenchSession): string {
  if (!session.spaceId)
    throw new Error('Choose a space before opening storage');
  return `proflow-${session.userId}-${session.spaceId}`;
}
