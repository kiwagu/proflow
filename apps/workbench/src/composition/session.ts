export interface WorkbenchSession {
  userId: string;
  email: string;
  spaceId: string | null;
  spaceName: string | null;
}

export const platformPath =
  (import.meta.env.VITE_PLATFORM_BASE_PATH as string | undefined) ??
  '/platform';

/**
 * The server could not be reached at all — as opposed to answering "not
 * signed in" or answering badly. Only this one failure is survivable
 * offline; the others say something definite that must be obeyed.
 */
export class SessionUnreachable extends Error {
  constructor(cause: unknown) {
    super('Could not reach the server to verify your session.', { cause });
    this.name = 'SessionUnreachable';
  }
}

export function signIn() {
  const next = window.location.pathname + window.location.search;
  window.location.replace(`${platformPath}?next=${encodeURIComponent(next)}`);
}

export async function readSession(): Promise<WorkbenchSession | null> {
  let response: Response;
  try {
    response = await fetch(`${platformPath}/api/workbench/session`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new SessionUnreachable(error);
  }
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

/**
 * The account cookies, as a stable fingerprint. They are never a source of
 * identity — only a signal that the identity the server last confirmed may
 * have changed and has to be confirmed again.
 *
 * What leaves this function is a digest, never the cookies: those cookies
 * are the serialized session itself, refresh token included, and the
 * browser lets scripts read them. A record pinned to an account must not
 * become a second copy of what pins it — one that would outlive the
 * cookies it was taken from, in a store no cookie attribute protects.
 */
export function authCookieFingerprint(): string {
  return digest(
    document.cookie
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('sb-'))
      .sort()
      .join(';')
  );
}

/**
 * FNV-1a, 64 bit. Deliberately not a security primitive: the requirement
 * is that the cookies cannot be read back out of what is stored, while two
 * different sets still have to look different. Sixty-four bits rather than
 * thirty-two so that "the account changed" stays a reliable signal; a
 * collision there would silently mean "it did not".
 */
function digest(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

const REMEMBERED = 'workbench.session';

/**
 * The last identity the server confirmed, kept so a reload with no network
 * can open the local documents belonging to it.
 *
 * This extends a rule the app already follows while running: an account
 * already verified keeps editing locally through an outage, while opening
 * a new one still requires the server. Without it the offline promise only
 * survives as long as the tab does — a reload would show a failure over a
 * database sitting intact on the device.
 *
 * It carries no secret and grants nothing: what is kept beside the
 * identity is a digest of the account cookies, not the cookies, and the
 * local database it opens is already on this device under that account's
 * namespace. The moment the server is reachable it has the last word,
 * including signing the user out.
 */
export function rememberSession(session: WorkbenchSession): void {
  try {
    window.localStorage.setItem(
      REMEMBERED,
      JSON.stringify({ session, cookies: authCookieFingerprint() })
    );
  } catch {
    // A browser refusing storage is not a reason to fail a boot that
    // otherwise succeeded; it only costs the offline reload.
  }
}

export function forgetSession(): void {
  try {
    window.localStorage.removeItem(REMEMBERED);
  } catch {
    // Nothing to do: there is no other place it could have been kept.
  }
}

/**
 * The remembered identity, but only for the account whose cookies are
 * still present. A different (or absent) account has to be verified by the
 * server, which is exactly what cannot be done offline — so it is turned
 * away rather than guessed at.
 */
export function recallSession(): WorkbenchSession | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('cookies' in value) ||
    value.cookies !== authCookieFingerprint() ||
    !('session' in value)
  ) {
    return null;
  }
  const session = value.session;
  if (
    !session ||
    typeof session !== 'object' ||
    !('userId' in session) ||
    typeof session.userId !== 'string' ||
    !('email' in session) ||
    typeof session.email !== 'string' ||
    !('spaceId' in session) ||
    !(session.spaceId === null || typeof session.spaceId === 'string') ||
    !('spaceName' in session) ||
    !(session.spaceName === null || typeof session.spaceName === 'string')
  ) {
    return null;
  }
  return session as WorkbenchSession;
}
