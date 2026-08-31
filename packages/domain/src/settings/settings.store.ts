import type { Result } from 'neverthrow';

/**
 * Port: user settings, as plain key/value pairs.
 *
 * Values are strings on purpose: every consumer knows the shape of its own
 * keys, and a typed bag here would make this port change every time any
 * feature grows a preference.
 */
export interface ISettingsStore {
  get(key: string): Promise<Result<string | null, string>>;
  set(key: string, value: string): Promise<Result<void, string>>;
  remove(key: string): Promise<Result<void, string>>;
}
