import {
  createEntityId,
  entityIdSchema,
  normalizePrefix,
  parseEntityId,
} from './index.js';

function printHelp() {
  process.stdout.write(
    [
      'entity-id',
      '',
      'Usage:',
      '  entity-id gen [prefix]',
      '  entity-id inspect <entityId>',
      '',
    ].join('\n') + '\n'
  );
}

function fatal(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main() {
  const [command, arg] = process.argv.slice(2);

  if (!command || command === '-h' || command === '--help') {
    printHelp();
    return;
  }

  if (command === 'gen' || command === 'generate') {
    const prefix = arg?.trim() ? arg : 'ent';
    try {
      process.stdout.write(`${createEntityId(normalizePrefix(prefix))}\n`);
    } catch (e) {
      fatal(
        `Invalid prefix "${String(prefix)}": ${e instanceof Error ? e.message : String(e)}`
      );
    }
    return;
  }

  if (command !== 'inspect') {
    fatal(`Unknown command: ${command}`);
  }

  if (!arg) {
    fatal('Missing <entityId>');
  }

  const checked = entityIdSchema.safeParse(arg);
  if (!checked.success) {
    fatal('Invalid entity id');
  }

  const parsed = parseEntityId(checked.data);
  const out = {
    entityId: checked.data,
    prefix: parsed.prefix,
    rand: parsed.rand,
    ts: parsed.ts,
    ulid: parsed.ulid,
    timeMs: parsed.timeMs,
    iso: new Date(parsed.timeMs).toISOString(),
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

void main();
