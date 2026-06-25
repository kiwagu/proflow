import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

import {
  materializeScenario,
  validateCatalog,
  type MaterializeDeps,
  type MaterializedScenario,
} from './catalog/index.js';
import {
  actorCookieHeader,
  addActor,
  bootstrapEphemeralTenant,
  fetchFetcher,
  makeSeedClient,
  provisionDemoTenant,
  resetSpaceContent,
  resolveBaseUrl,
  teardownTenant,
  DEMO_ADMIN_EMAIL,
  DEMO_VIEWER_EMAIL,
  type SeedActor,
  type SeedTenant,
} from './engine/index.js';
import {
  PRESET_DESCRIPTIONS,
  presetNames,
  scenariosForPreset,
} from './presets.js';

// Load secrets from seed/.env then fall back to the e2e env (shared Supabase
// keys), without overriding anything already set in the shell.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
loadEnv({ path: resolve(repoRoot, 'seed/.env') });
loadEnv({ path: resolve(repoRoot, 'tests/e2e/.env') });

type Flags = {
  preset: string;
  mode: 'demo' | 'fresh';
  list: boolean;
  reset: boolean;
  /** Write the seeded `ref → id` map to this JSON path (the machine-readable dictionary). */
  manifest?: string;
};

function parseFlags(argv: string[]): Flags {
  let preset = 'all';
  let mode: 'demo' | 'fresh' = 'demo';
  let list = false;
  let reset = false;
  let manifest: string | undefined;
  for (const arg of argv) {
    if (arg === '--list') list = true;
    else if (arg === '--reset') reset = true;
    else if (arg === '--demo') mode = 'demo';
    else if (arg === '--fresh') mode = 'fresh';
    else if (arg.startsWith('--preset='))
      preset = arg.slice('--preset='.length);
    else if (arg.startsWith('--manifest='))
      manifest = arg.slice('--manifest='.length);
    else if (arg === '--help' || arg === '-h') list = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { preset, mode, list, reset, manifest };
}

function printList(): void {
  console.log('\nProFlow seed — presets (default: all)\n');
  for (const name of presetNames()) {
    const desc = PRESET_DESCRIPTIONS[name] ?? '';
    console.log(`  --preset=${name.padEnd(16)} ${desc}`);
  }
  console.log('\nScenarios in the dictionary:\n');
  for (const s of scenariosForPreset('all')) {
    console.log(`  ${s.id.padEnd(18)} ${s.summary}`);
  }
  console.log(
    '\nUsage:\n' +
      '  bun run seed                       # all presets into the stable demo tenant\n' +
      '  bun run seed --preset=drive        # just the Drive scenarios\n' +
      '  bun run seed --fresh --preset=drive# ephemeral tenant, torn down after\n' +
      '  bun run seed --reset               # zero the demo space content (no re-seed)\n' +
      '  bun run seed --manifest=seed.json  # also dump the seeded ref→id map to JSON\n'
  );
}

/** Disable TLS verification for local self-signed hosts (dev/demo only). */
function relaxLocalTls(baseUrl: string): void {
  const host = new URL(baseUrl).hostname;
  if (host.endsWith('.local') || process.env.SEED_INSECURE_TLS === '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    console.warn(`! TLS verification disabled for local host ${host}`);
  }
}

/**
 * Write the seeded `ref → id` map to JSON — the machine-readable dictionary that
 * names every demo node by its stable `ref` (for LLM ↔ human feedback and demo
 * verification), keyed by scenario. Path is resolved against the current cwd.
 */
function writeManifest(
  flags: Flags,
  tenant: SeedTenant,
  materialized: MaterializedScenario[]
): void {
  const manifest = {
    mode: flags.mode,
    preset: flags.preset,
    spaceId: tenant.spaceId,
    scenarios: Object.fromEntries(
      materialized.map((m) => [m.scenarioId, Object.fromEntries(m.refs)])
    ),
  };
  const path = resolve(process.cwd(), flags.manifest!);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n  Manifest written → ${path}`);
}

async function run(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.list) {
    printList();
    return;
  }

  const baseUrl = resolveBaseUrl();
  relaxLocalTls(baseUrl);

  // --reset: zero the demo space's content (no re-seed) and exit.
  if (flags.reset) {
    const tenant = await provisionDemoTenant();
    await resetSpaceContent(tenant.service, tenant.spaceId);
    console.log(
      `\nCleared all content from the demo space (${tenant.spaceId}).`
    );
    return;
  }

  const scenarios = scenariosForPreset(flags.preset);

  // Fail-first: validate the catalog offline before touching the stack.
  const problems = validateCatalog(scenarios);
  if (problems.length > 0) {
    console.error('\nCatalog validation failed:');
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nSeeding preset "${flags.preset}" (${scenarios.length} scenario(s)) ` +
      `into a ${flags.mode} tenant at ${baseUrl}\n`
  );

  const tenant: SeedTenant =
    flags.mode === 'fresh'
      ? await bootstrapEphemeralTenant()
      : await provisionDemoTenant();

  if (flags.mode === 'demo') {
    // Idempotent rebuild: clear prior demo content so the end state is deterministic.
    await resetSpaceContent(tenant.service, tenant.spaceId);
  }

  const clientFor = async (actor: SeedActor) =>
    makeSeedClient(
      fetchFetcher({ baseUrl, cookie: await actorCookieHeader(actor) })
    );

  const materialized: MaterializedScenario[] = [];
  try {
    for (const scenario of scenarios) {
      const deps: MaterializeDeps = {
        tenant,
        clientFor,
        mintActor: (ref, roleKey) =>
          addActor(tenant, {
            label: `${scenario.id}-${ref}`,
            roleKey,
            stable: flags.mode === 'demo',
          }),
      };
      const result = await materializeScenario(scenario, deps);
      materialized.push(result);
      console.log(
        `  ✓ ${scenario.id.padEnd(18)} ${result.refs.size} ref(s) — ${scenario.summary}`
      );
    }
    if (flags.manifest) writeManifest(flags, tenant, materialized);
  } finally {
    if (flags.mode === 'fresh') {
      await teardownTenant(tenant);
      console.log('\n  (ephemeral tenant torn down)');
    }
  }

  if (flags.mode === 'demo') {
    console.log(
      `\nDemo tenant ready (space ${tenant.spaceId}).\n` +
        `  Admin:  ${DEMO_ADMIN_EMAIL} (password ProflowDemo!1)\n` +
        `  Viewer: ${DEMO_VIEWER_EMAIL} (password ProflowDemo!1)\n`
    );
  }
}

run().catch((err) => {
  console.error('\nSeed failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
