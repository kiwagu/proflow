import type { Payload, PayloadRequest, TypedUser } from 'payload';

import type { Config } from '@/payload-types';

type AuthSlug = keyof Config['auth'];
import {
  commitTransaction,
  getFieldsToSign,
  initTransaction,
  jwtSign,
  killTransaction,
} from 'payload';
import { addSessionToUser } from 'payload/shared';

type IssueSessionArgs = {
  payload: Payload;
  req: PayloadRequest;
  collectionSlug: AuthSlug;
  user: TypedUser;
  email: string;
};

/**
 * Creates a Payload session + signed JWT (same shape as password login).
 */
export async function issuePayloadSession({
  payload,
  req,
  collectionSlug,
  user,
  email,
}: IssueSessionArgs): Promise<{ exp: number; token: string; user: TypedUser }> {
  const collection = payload.collections[collectionSlug];
  if (!collection) {
    throw new Error(`Collection ${collectionSlug} not found`);
  }
  const collectionConfig = collection.config;
  const secret = payload.secret;

  const shouldCommit = await initTransaction(req);
  let sid: string | undefined;

  try {
    const fieldsToSignArgs: {
      collectionConfig: typeof collectionConfig;
      email: string;
      user: TypedUser;
      sid?: string;
    } = {
      collectionConfig,
      email: email.toLowerCase().trim(),
      user,
    };

    const session = await addSessionToUser({
      collectionConfig,
      payload,
      req,
      user,
    });
    sid = session.sid;
    if (sid) {
      fieldsToSignArgs.sid = sid;
    }

    const fieldsToSign = getFieldsToSign(fieldsToSignArgs);
    const { exp, token } = await jwtSign({
      fieldsToSign,
      secret,
      tokenExpiration: collectionConfig.auth.tokenExpiration,
    });

    req.user = user;

    const nextUser = await payload.findByID({
      collection: collectionSlug,
      depth: collectionConfig.auth.depth,
      id: user.id,
      overrideAccess: true,
      req,
    });

    if (shouldCommit) {
      await commitTransaction(req);
    }

    return { exp, token, user: nextUser as TypedUser };
  } catch (err) {
    await killTransaction(req);
    throw err;
  }
}
