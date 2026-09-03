/**
 * Prism must exist as a global BEFORE the editor node vocabulary is loaded:
 * the code node pulls in a Prism language definition (`prism-json`) that
 * assumes the browser-style global, and in a Node process there is none.
 *
 * Importing this module first — and only for its side effect — is what makes
 * the headless editor loadable outside a browser. Keep it as the FIRST import
 * of any module that touches the editor vocabulary; ES module evaluation is
 * ordered, so the assignment lands before the vocabulary is evaluated.
 */
import Prism from 'prismjs';

(globalThis as { Prism?: unknown }).Prism ??= Prism;
