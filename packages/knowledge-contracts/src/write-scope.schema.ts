import { z } from 'zod';

/**
 * What the server lets one person change in one space, per action of the
 * workbench, as the server itself derives it from the same role verbs its
 * row-level policies use.
 *
 * Every write rule on the replicated tables has the shape "my row, or a
 * space verb", so one verdict per action is enough: `all` (any row the
 * person can see), `{ own: [...] }` (rows where one of the named columns is
 * the person — the column differs per table: a node's owner, an edge's
 * creator), or `none`. A rule of another shape would not fit here, and the
 * server's mirror test is what says so.
 *
 * It is a hint for the interface, never a fence: the policies stay the
 * authority, and a stale or wrong scope ends in the same refusal a write
 * gets today.
 */

export const writeActionSchema = z.enum([
  'node.create',
  'node.update',
  'node.move',
  'node.trash',
  'node.purge',
  'node.star',
  'body.write',
]);
export type WriteAction = z.infer<typeof writeActionSchema>;

export const writeVerdictSchema = z.union([
  z.literal('all'),
  z.literal('none'),
  z
    .object({
      own: z.array(z.string().min(1)).min(1),
      orUnset: z.array(z.string().min(1)).min(1).optional(),
    })
    .strict(),
]);
export type WriteVerdict = z.infer<typeof writeVerdictSchema>;

export const writeScopeSchema = z
  .object({
    'node.create': writeVerdictSchema,
    'node.update': writeVerdictSchema,
    'node.move': writeVerdictSchema,
    'node.trash': writeVerdictSchema,
    'node.purge': writeVerdictSchema,
    'node.star': writeVerdictSchema,
    'body.write': writeVerdictSchema,
  })
  .strict();
export type WriteScope = z.infer<typeof writeScopeSchema>;

/** A scope as the server stated it, or null when it does not parse. Never throws. */
export function parseWriteScope(value: unknown): WriteScope | null {
  const parsed = writeScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether the person may take `action` on `row` (the row's own server
 * column names). No scope at all means no hint: yes, as before the scope
 * existed.
 */
export function allowed(
  scope: WriteScope | null,
  action: WriteAction,
  row: Readonly<Record<string, unknown>>,
  me: string
): boolean {
  if (scope === null) return true;
  const verdict = scope[action];
  if (verdict === 'all') return true;
  if (verdict === 'none') return false;
  if (verdict.own.some((column) => row[column] === me)) return true;
  // Empty is not the same as missing: a row that carries the column with no
  // value has nothing there to take away; a row that lacks it says nothing.
  return (verdict.orUnset ?? []).some((column) => row[column] === null);
}
