import 'dotenv/config';

import { createStagehandLocalSession } from './stagehand.runtime.js';

async function run(): Promise<void> {
  const stagehand = await createStagehandLocalSession();
  try {
    const page = stagehand.context.pages()[0];
    if (!page) {
      throw new Error('Stagehand did not expose a browser page');
    }
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';
    await page.goto(`${baseUrl.replace(/\/$/, '')}/platform`);
    const title = await page.title();
    console.log(JSON.stringify({ title }, null, 2));
  } finally {
    await stagehand.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
