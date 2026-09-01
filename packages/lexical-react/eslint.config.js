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
      // Stylistic rules the ported sources trip. Rewriting them would mean
      // touching hundreds of lines that are otherwise a faithful translation,
      // which is exactly what makes later fixes hard to carry across. Rules
      // that catch real defects stay on.
      'no-var': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
];
