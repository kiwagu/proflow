import {
  createEntityId,
  createEntityIdFor,
  derivePrefixFromSlug,
  ENTITY_PREFIXES,
  entityIdSchema,
  entityKindForPrefix,
  isEntityKind,
  normalizePrefix,
  parseEntityId,
} from './index.js';

function printHelp() {
  process.stdout.write(
    [
      'entity-id — canonical prefixed id tool (<prefix>_<rand16>.<ts10>)',
      '',
      'Usage:',
      '  entity-id gen [kind|prefix]   mint an id (kind resolves via the registry)',
      '  entity-id inspect <entityId>  parse an id → prefix/kind/ulid/timestamp',
      '  entity-id derive <slug>       derive a prefix from a slug',
      '  entity-id prefixes            list the static prefix registry',
      '',
      'Examples:',
      '  entity-id gen user            # -> usr_…',
      '  entity-id gen knr             # raw prefix also accepted',
      '  entity-id inspect usr_….…',
      '',
    ].join('\n') + '\n'
  );
}

function fatal(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function cmdGen(arg: string | undefined) {
  const raw = arg?.trim();
  // A registry kind (`user`) resolves to its prefix and mints a branded id;
  // otherwise treat the argument as a raw prefix (`knr`, `ent`), default `ent`.
  if (raw && isEntityKind(raw)) {
    process.stdout.write(`${createEntityIdFor(raw)}\n`);
    return;
  }
  const prefix = raw && raw.length > 0 ? raw : 'ent';
  try {
    process.stdout.write(`${createEntityId(normalizePrefix(prefix))}\n`);
  } catch (e) {
    fatal(
      `Invalid kind or prefix "${prefix}": ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

function cmdInspect(arg: string | undefined) {
  if (!arg) fatal('Missing <entityId>');
  const checked = entityIdSchema.safeParse(arg);
  if (!checked.success) fatal('Invalid entity id');

  const parsed = parseEntityId(checked.data);
  const out = {
    entityId: checked.data,
    prefix: parsed.prefix,
    kind: entityKindForPrefix(parsed.prefix) ?? null,
    rand: parsed.rand,
    ts: parsed.ts,
    ulid: parsed.ulid,
    timeMs: parsed.timeMs,
    iso: new Date(parsed.timeMs).toISOString(),
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

function cmdDerive(arg: string | undefined) {
  if (!arg) fatal('Missing <slug>');
  try {
    process.stdout.write(`${derivePrefixFromSlug(arg)}\n`);
  } catch (e) {
    fatal(e instanceof Error ? e.message : String(e));
  }
}

function cmdPrefixes() {
  const rows = Object.entries(ENTITY_PREFIXES).map(([kind, prefix]) => ({
    kind,
    prefix,
  }));
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
}

async function main() {
  const [command, arg] = process.argv.slice(2);

  if (!command || command === '-h' || command === '--help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'gen':
    case 'generate':
      return cmdGen(arg);
    case 'inspect':
      return cmdInspect(arg);
    case 'derive':
      return cmdDerive(arg);
    case 'prefixes':
    case 'list':
      return cmdPrefixes();
    default:
      fatal(`Unknown command: ${command}`);
  }
}

void main();
