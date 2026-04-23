import { Stagehand } from '@browserbasehq/stagehand';

export async function createStagehandLocalSession() {
  const stagehand = new Stagehand({
    env: 'LOCAL',
    verbose: 1,
  });

  await stagehand.init();
  return stagehand;
}
