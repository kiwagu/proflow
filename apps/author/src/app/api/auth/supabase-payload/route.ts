import { establishPayloadSessionFromAccessToken } from '@/lib/establish-payload-session-from-access-token';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    access_token?: unknown;
  } | null;
  const accessToken =
    typeof body?.access_token === 'string' ? body.access_token : null;
  if (!accessToken) {
    return Response.json({ message: 'Missing access_token' }, { status: 400 });
  }

  const result = await establishPayloadSessionFromAccessToken(
    accessToken,
    request
  );

  if (!result.ok) {
    return Response.json(
      { message: result.message },
      { status: result.status }
    );
  }

  return Response.json(
    {
      message: 'Authentication passed',
      exp: result.exp,
      user: result.user,
    },
    {
      headers: {
        'Set-Cookie': result.setCookieHeader,
      },
    }
  );
}
