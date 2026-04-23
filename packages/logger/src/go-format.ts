import { getProcessId } from './pid.js';

const LEVEL_FROM_PINO: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

function formatGoValue(key: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `${key}=${String(value)}`;
  }
  if (typeof value === 'string') {
    if (/[\s"=]/.test(value) || value === '') {
      return `${key}=${JSON.stringify(value)}`;
    }
    return `${key}=${value}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${key}=${value}`;
  }
  if (typeof value === 'boolean') {
    return `${key}=${value}`;
  }
  if (value instanceof Error) {
    return `${key}=${JSON.stringify(value.message)}`;
  }
  try {
    return `${key}=${JSON.stringify(value)}`;
  } catch {
    return `${key}="<unserializable>"`;
  }
}

function normalizeTime(rec: Record<string, unknown>): string {
  const t = rec.time;
  if (typeof t === 'string') {
    return t;
  }
  if (typeof t === 'number' && Number.isFinite(t)) {
    return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

function levelLabel(rec: Record<string, unknown>): string {
  const lv = rec.level;
  if (typeof lv === 'number' && LEVEL_FROM_PINO[lv]) {
    return LEVEL_FROM_PINO[lv] ?? 'INFO';
  }
  if (typeof rec.level === 'string') {
    return String(rec.level).toUpperCase();
  }
  return 'INFO';
}

/** Fields emitted in the fixed prefix; remainder go to the tail (sorted, requestId first). */
const FIXED_PREFIX_KEYS = new Set([
  'time',
  'pid',
  'level',
  'name',
  'status',
  'msg',
  'hostname',
  'v',
]);

function shouldEmitStatus(status: unknown): boolean {
  if (status === undefined || status === null) {
    return false;
  }
  if (typeof status === 'string' && status === '') {
    return false;
  }
  return true;
}

/**
 * Fixed order: time → pid → level → name → status → msg → (requestId first in tail) → other keys → err last.
 */
export function formatGoLikeLine(record: Record<string, unknown>): string {
  const time = normalizeTime(record);
  const pid = record.pid ?? getProcessId();
  const level = levelLabel(record);
  const msg = typeof record.msg === 'string' ? record.msg : '';
  const name =
    typeof record.name === 'string' && record.name !== ''
      ? record.name
      : undefined;
  const status = record.status;

  const parts: string[] = [
    `time=${time}`,
    formatGoValue('pid', pid),
    `level=${level}`,
  ];

  if (name !== undefined) {
    parts.push(formatGoValue('name', name));
  }
  if (shouldEmitStatus(status)) {
    parts.push(formatGoValue('status', status));
  }

  parts.push(`msg=${JSON.stringify(msg)}`);

  const restKeys = Object.keys(record)
    .filter(
      (k) => !FIXED_PREFIX_KEYS.has(k) && k !== 'err' && k !== 'requestId'
    )
    .sort((a, b) => a.localeCompare(b));

  if (
    record.requestId !== undefined &&
    record.requestId !== null &&
    record.requestId !== ''
  ) {
    parts.push(formatGoValue('requestId', record.requestId));
  }

  for (const k of restKeys) {
    parts.push(formatGoValue(k, record[k]));
  }

  if (record.err !== undefined && record.err !== null) {
    parts.push(formatGoValue('err', record.err));
  }

  return parts.join(' ');
}

export function formatGoLikeFromBrowserRecord(
  record: Record<string, unknown>
): string {
  return formatGoLikeLine(record);
}
