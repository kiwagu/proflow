import {
  ACTIVE_SPACE_COOKIE,
  ACTIVE_SPACE_COOKIE_MAX_AGE_SECONDS,
  ACTIVE_SPACE_COOKIE_PATH,
} from './active-space.constants';

type CookieGetter = {
  get(name: string): { value: string } | undefined;
};

type CookieSetter = {
  set(
    name: string,
    value: string,
    options?: {
      httpOnly?: boolean;
      path?: string;
      sameSite?: 'lax' | 'strict' | 'none';
      secure?: boolean;
      maxAge?: number;
    }
  ): void;
};

/** Read canonical active-space id from cookie store. */
export function readCanonicalActiveSpaceIdFromCookies(
  store: CookieGetter
): string | null {
  return store.get(ACTIVE_SPACE_COOKIE)?.value ?? null;
}

/** Set canonical active-space cookie with shared options. */
export function setCanonicalActiveSpaceCookie(
  store: CookieSetter,
  spaceId: string
): void {
  store.set(ACTIVE_SPACE_COOKIE, spaceId, {
    httpOnly: true,
    path: ACTIVE_SPACE_COOKIE_PATH,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ACTIVE_SPACE_COOKIE_MAX_AGE_SECONDS,
  });
}

/** Clear canonical active-space cookie. */
export function clearCanonicalActiveSpaceCookie(store: CookieSetter): void {
  store.set(ACTIVE_SPACE_COOKIE, '', {
    httpOnly: true,
    path: ACTIVE_SPACE_COOKIE_PATH,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
}
