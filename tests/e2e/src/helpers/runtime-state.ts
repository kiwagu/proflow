import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SeededUser } from './test-user.js';

const runtimeDir = path.resolve(process.cwd(), '.runtime');
const seededUserFile = path.join(runtimeDir, 'seeded-user.json');

export async function persistSeededUser(user: SeededUser): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(seededUserFile, JSON.stringify(user, null, 2), 'utf8');
}

export async function readSeededUser(): Promise<SeededUser> {
  const raw = await readFile(seededUserFile, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('id' in parsed) ||
    !('email' in parsed) ||
    !('password' in parsed) ||
    typeof parsed.id !== 'string' ||
    typeof parsed.email !== 'string' ||
    typeof parsed.password !== 'string'
  ) {
    throw new Error('Invalid seeded user runtime payload');
  }
  return {
    id: parsed.id,
    email: parsed.email,
    password: parsed.password,
  };
}

export async function readSeededUserIfExists(): Promise<SeededUser | null> {
  try {
    return await readSeededUser();
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

export async function clearRuntimeState(): Promise<void> {
  await rm(runtimeDir, { recursive: true, force: true });
}
