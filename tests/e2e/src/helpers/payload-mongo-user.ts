import { MongoClient, type Document } from 'mongodb';

/** Database segment of a mongodb:// or mongodb+srv:// URI (default payload). */
export function mongoDatabaseNameFromUri(connectionUri: string): string {
  const normalized = connectionUri.replace(/^mongodb\+srv:/i, 'mongodb://');
  let pathname: string;
  try {
    pathname = new URL(normalized).pathname;
  } catch {
    return 'payload';
  }
  const seg = pathname.replace(/^\//, '').split('/')[0]?.trim();
  return seg && seg.length > 0 ? seg : 'payload';
}

export async function connectPayloadMongo(
  connectionUri: string
): Promise<MongoClient> {
  return MongoClient.connect(connectionUri);
}

/**
 * Payload `users` collection (mongoose slug `users`) — doc includes `supabaseSub` after identity sync.
 */
export async function findPayloadUserBySupabaseSub(
  client: MongoClient,
  connectionUri: string,
  supabaseSub: string
): Promise<Document | null> {
  const dbName = mongoDatabaseNameFromUri(connectionUri);
  return client.db(dbName).collection('users').findOne({ supabaseSub });
}
