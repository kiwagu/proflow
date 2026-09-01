import { config } from '@workspace/eslint-config/react-internal';

/**
 * Ported tree: the sources stay close to their origin in the local-first
 * editor stack so upstream fixes remain portable; only rules the origin
 * code genuinely trips are relaxed, everything else still applies.
 *
 * @type {import("eslint").Linter.Config}
 */
export default [
  ...config,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];
