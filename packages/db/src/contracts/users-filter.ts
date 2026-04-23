import { z } from 'zod';

const nonEmptyStringSchema = z.string().trim().min(1).max(320);
const nonEmptyStringArraySchema = z.array(nonEmptyStringSchema).min(1).max(50);

export const usersFilterLogicSchema = z.enum(['and', 'or']);

export const usersTextFilterFieldSchema = z.enum([
  'email',
  'display_name',
  'entity_id',
  'role_key',
]);

export const usersScopeFilterFieldSchema = z.enum([
  'organization_id',
  'space_id',
]);

export const usersBooleanFilterFieldSchema = z.enum(['is_super_admin']);

export const usersNullableFilterFieldSchema = z.enum([
  'display_name',
  'organization_id',
  'space_id',
  'role_key',
]);

const textConditionSchema = z
  .object({
    field: usersTextFilterFieldSchema,
    operator: z.enum(['eq', 'neq', 'contains', 'starts_with']),
    value: nonEmptyStringSchema,
  })
  .strict();

const scopeScalarConditionSchema = z
  .object({
    field: usersScopeFilterFieldSchema,
    operator: z.enum(['eq', 'neq']),
    value: nonEmptyStringSchema,
  })
  .strict();

const scopeSetConditionSchema = z
  .object({
    field: usersScopeFilterFieldSchema,
    operator: z.enum(['in', 'not_in']),
    value: nonEmptyStringArraySchema,
  })
  .strict();

const booleanConditionSchema = z
  .object({
    field: usersBooleanFilterFieldSchema,
    operator: z.literal('eq'),
    value: z.boolean(),
  })
  .strict();

const nullableConditionSchema = z
  .object({
    field: usersNullableFilterFieldSchema,
    operator: z.enum(['is_null', 'not_null']),
  })
  .strict();

export const usersFilterConditionSchema = z.union([
  textConditionSchema,
  scopeScalarConditionSchema,
  scopeSetConditionSchema,
  booleanConditionSchema,
  nullableConditionSchema,
]);

export const usersFilterSchema = z
  .object({
    logic: usersFilterLogicSchema.default('and'),
    conditions: z.array(usersFilterConditionSchema).min(1).max(25),
  })
  .strict();

export type UsersFilter = z.infer<typeof usersFilterSchema>;
export type UsersFilterCondition = z.infer<typeof usersFilterConditionSchema>;

export function parseUsersFilter(input: unknown) {
  return usersFilterSchema.safeParse(input);
}

export const USERS_FILTER_SUPPORTED_FIELDS = {
  text: usersTextFilterFieldSchema.options,
  scope: usersScopeFilterFieldSchema.options,
  boolean: usersBooleanFilterFieldSchema.options,
  nullable: usersNullableFilterFieldSchema.options,
} as const;

export const USERS_FILTER_SUPPORTED_OPERATORS = {
  text: ['eq', 'neq', 'contains', 'starts_with'],
  scopeScalar: ['eq', 'neq'],
  scopeSet: ['in', 'not_in'],
  boolean: ['eq'],
  nullable: ['is_null', 'not_null'],
} as const;
