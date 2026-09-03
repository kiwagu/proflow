/**
 * @file The languages the product offers on top of the highlighter's own
 * registry, together with the grammars they need.
 *
 * The official code package preloads a fixed set of Prism grammars; a language
 * the picker offers but Prism has no grammar for renders as unhighlighted
 * plain text. Importing a Prism component registers it on the shared Prism
 * instance the highlighter reads, which is why the grammars come in as
 * side-effect imports. (SVG needs none: Prism aliases it to the preloaded
 * markup grammar.)
 *
 * The extra languages are declared HERE, in the same module as the grammars,
 * and the picker imports them from here as a value. That binding is what keeps
 * the registration alive in a bundle: the package advertises itself as
 * side-effect free (`sideEffects: ["**\/*.css"]`), so a bundler is licensed to
 * drop a module that is only imported for its side effects — a value import
 * cannot be dropped while the picker uses it, and the picker cannot lose the
 * languages without the picker spec failing.
 */
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-bash.js';

/**
 * Keys are what the highlighter understands, labels are what the UI shows.
 * A language the highlighter itself gains needs no entry here.
 */
export const EXTRA_PICKER_LANGUAGES: ReadonlyArray<
  [key: string, label: string]
> = [
  ['json', 'JSON'],
  ['bash', 'Bash'],
  ['svg', 'SVG'],
];
