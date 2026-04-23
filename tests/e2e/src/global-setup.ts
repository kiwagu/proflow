import { clearRuntimeState } from './helpers/runtime-state.js';

async function globalSetup(): Promise<void> {
  await clearRuntimeState();
}

export default globalSetup;
