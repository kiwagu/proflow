import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import type { DocumentOp } from '@workspace/ai-ops/editor';
import { sandboxInit } from '@workspace/ai-ops/editor';
import { nanoid } from 'nanoid';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { SANDBOX_CODE } from './editor-sandbox-code';

/** Upper bound on inserts per snippet. The host mints the ids (QuickJS has no
 *  good entropy), pre-generating this many globally-unique ones per run. */
const REF_POOL_SIZE = 128;

// The single-file variant carries its WebAssembly inline, so it loads in a
// worker with no asset wiring.
let _qjs: Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>> | null =
  null;

async function qjs() {
  if (!_qjs) _qjs = await newQuickJSWASMModuleFromVariant(variant);
  return _qjs;
}

export async function runInSandbox(
  validIds: Set<string>,
  code: string,
  snippets?: Record<string, string>
): Promise<DocumentOp[]> {
  const QuickJS = await qjs();
  const ctx = QuickJS.newContext();
  try {
    const refs = Array.from({ length: REF_POOL_SIZE }, () => nanoid());
    const init = ctx.unwrapResult(
      ctx.evalCode(`${SANDBOX_CODE}\n${sandboxInit(validIds, refs, snippets)}`)
    );
    init.dispose();

    const run = ctx.unwrapResult(ctx.evalCode(code));
    run.dispose();

    const out = ctx.unwrapResult(
      ctx.evalCode('JSON.stringify(editor.drain())')
    );
    const json = ctx.dump(out) as string;
    out.dispose();
    return JSON.parse(json) as DocumentOp[];
  } finally {
    ctx.dispose();
  }
}
