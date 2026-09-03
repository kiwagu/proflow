/**
 * @file The extra code languages must survive a production bundle.
 *
 * The package advertises itself as side-effect free apart from CSS, so a
 * bundler is allowed to drop any module that is only imported for its effects.
 * The Prism grammars for the languages the picker adds are registered by
 * exactly such an effect, so this is the one guard that can see them being
 * dropped: a unit test cannot, because vitest does not tree-shake. The check
 * therefore runs the repo's own bundler over the code plugin and looks for the
 * grammars in the emitted chunk.
 */
import { build, type Rollup } from 'vite';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The suite runs in a jsdom environment, where `import.meta.url` is not a file
// URL; vitest runs each package from its own root, so resolve from there.
const entry = path.resolve('src/plugins/code/codePlugin.ts');

async function bundleCodePlugin(): Promise<string> {
  const result = (await build({
    logLevel: 'silent',
    configFile: false,
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: 'code-plugin' },
      rollupOptions: {
        // React and the workspace packages stay external — they are not what
        // is under test and pulling them in makes the build enormous. The
        // highlighter (`@lexical/code`) is deliberately NOT external: the
        // grammars it preloads are the control that proves the bundle is
        // complete, so a missing JSON/Bash grammar means ours was shaken out.
        external: (id: string) =>
          id === 'react' || id === 'react-dom' || id.startsWith('@workspace/'),
      },
    },
  })) as Rollup.RollupOutput[];

  return result
    .flatMap((bundle) => bundle.output)
    .filter((chunk) => chunk.type === 'chunk')
    .map((chunk) => chunk.code)
    .join('\n');
}

describe('code plugin bundle', () => {
  it('still registers the grammars for the languages the picker adds', async () => {
    const code = await bundleCodePlugin();

    // The markup grammar the highlighter preloads proves the bundle is
    // otherwise complete, so a missing JSON/Bash grammar means it was shaken
    // out rather than never pulled in.
    expect(code).toContain('doctype');
    expect(code).toContain('languages.json');
    expect(code).toContain('languages.bash');
  }, 120_000);
});
