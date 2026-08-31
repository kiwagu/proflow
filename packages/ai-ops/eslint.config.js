import { config } from '@workspace/eslint-config/base';

/**
 * Vendored tree: the sources are kept close to their origin so upstream
 * fixes stay portable, so we don't restyle them to satisfy stylistic
 * type-level rules. Only rules the origin code genuinely trips are relaxed;
 * everything else in the shared config still applies.
 *
 * @type {import("eslint").Linter.Config}
 */
export default [
  ...config,
  {
    linterOptions: {
      // Vendored files carry their origin's inline disables; with rules
      // relaxed here some become unused — don't flag them.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
    },
  },
];
