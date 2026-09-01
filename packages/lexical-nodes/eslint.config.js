import { config } from '@workspace/eslint-config/base';

/**
 * Own tree: the shared config applies in full. The relaxations this file used
 * to carry existed for vendored sources that no longer exist here.
 *
 * @type {import("eslint").Linter.Config}
 */
export default config;
