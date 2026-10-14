import {
  parseWriteScope,
  type WriteScope,
} from '@workspace/knowledge-contracts';

export interface WorkbenchSession {
  userId: string;
  email: string;
  spaceId: string | null;
  spaceName: string | null;
  /**
   * Where this deployment's replica talks to, as the server states it.
   *
   * Only an online answer carries it: the SPA keeps it as a local setting
   * and reads it from there, so a recalled offline session deliberately
   * has none. Absent when the server is not configured for replication.
   */
  sync?: { url: string; key: string };
  /**
   * What the person may change in the space, as the server derives it from
   * the role verbs its write policies use. A hint for the interface; absent
   * when the server did not state one, or stated one this build cannot read.
   */
  writeScope?: WriteScope;
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
    !(value.spaceName === null || typeof value.spaceName === 'string') ||
    !('sync' in value ? isSyncTarget(value.sync) : true)
  ) {
    throw new Error('Invalid session response');
  }
  // The scope is a hint: one this build cannot read is dropped rather than
  // trusted, and it never fails the session it rides on.
  const { writeScope, ...session } = value as WorkbenchSession & {
    writeScope?: unknown;
  };
  const scope = parseWriteScope(writeScope);
  return scope ? { ...session, writeScope: scope } : session;
}

function isSyncTarget(value: unknown): value is { url: string; key: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    'url' in value &&
    typeof value.url === 'string' &&
    value.url.length > 0 &&
    'key' in value &&
    typeof value.key === 'string' &&
    value.key.length > 0
  );
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
 * How long a confirmation is good for offline, measured from the last time
 * the server answered — not from when the user signed in, so an account in
 * daily use is never cut off mid-outage.
 *
 * Offline needs no hard wall, but a door that never closes is a different
 * thing: signing out on another device cannot reach this one, so without a
 * limit the local copy would stay openable forever on a device the account
 * has already left. A day is long enough to cover an outage, a flight or a
 * weekend offline, and short enough that the window has an end. It is
 * policy, not taste — hence a constant here rather than a setting.
 */
export const CONFIRMATION_GOOD_FOR_MS = 24 * 60 * 60 * 1000;

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
 * including signing the user out — and until then the record is only good
 * for as long as the confirmation it holds.
 *
 * Every successful check calls this again, so the window slides with use
 * rather than counting down from the first sign-in.
 */
export function rememberSession(session: WorkbenchSession): void {
  try {
    window.localStorage.setItem(
      REMEMBERED,
      JSON.stringify({
        // Without the replication target: it is kept as a local setting
        // instead, in the store the replica itself reads. Two copies of one
        // fact would be two things to keep current, and this one — unlike
        // the identity — is not what the record exists to remember.
        session: {
          userId: session.userId,
          email: session.email,
          spaceId: session.spaceId,
          spaceName: session.spaceName,
        },
        cookies: authCookieFingerprint(),
        confirmedAt: Date.now(),
      })
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
 * still present, and only while its confirmation is still fresh. A
 * different (or absent) account has to be verified by the server, which is
 * exactly what cannot be done offline — so it is turned away rather than
 * guessed at, and so is one the server has not confirmed in a day.
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
    !('confirmedAt' in value) ||
    typeof value.confirmedAt !== 'number' ||
    !Number.isFinite(value.confirmedAt) ||
    Date.now() - value.confirmedAt > CONFIRMATION_GOOD_FOR_MS ||
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
