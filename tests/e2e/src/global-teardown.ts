import {
  clearRuntimeState,
  readSeededUserIfExists,
} from './helpers/runtime-state.js';
import { cleanupTestUser } from './helpers/test-user.js';
import {
  sweepE2EArtifacts,
  sweepE2EMongoArtifacts,
} from './helpers/e2e-artifact-sweep.js';

async function globalTeardown(): Promise<void> {
  try {
    // Best-effort cleanup of the primary seeded user.
    const seededUser = await readSeededUserIfExists();
    if (seededUser) {
      await cleanupTestUser(seededUser.id);
    }

    // Sweep any remaining @example.test artifacts (isolation users, orgs, etc.)
    // created by individual tests that may have left residue on failure.
    const sweep = await sweepE2EArtifacts();
    if (sweep.errors.length > 0) {
      console.warn('[e2e teardown] sweep warnings:', sweep.errors);
    } else if (sweep.usersDeleted + sweep.orgsDeleted > 0) {
      console.log(
        `[e2e teardown] swept ${sweep.usersDeleted} users, ${sweep.orgsDeleted} orgs, ${sweep.invitesDeleted} invites`
      );
    }

    // MongoDB (Payload Author mirror) — optional, only when configured.
    const mongoUrl = process.env.E2E_AUTHOR_MONGO_URL;
    if (mongoUrl) {
      const mongo = await sweepE2EMongoArtifacts(mongoUrl);
      if (mongo.errors.length > 0) {
        console.warn('[e2e teardown] mongo sweep warnings:', mongo.errors);
      } else if (
        mongo.orgsDeleted + mongo.spacesDeleted + mongo.usersDeleted >
        0
      ) {
        console.log(
          `[e2e teardown] mongo swept ${mongo.usersDeleted} users, ${mongo.orgsDeleted} orgs, ${mongo.spacesDeleted} spaces`
        );
      }
    }
  } finally {
    await clearRuntimeState();
  }
}

export default globalTeardown;
