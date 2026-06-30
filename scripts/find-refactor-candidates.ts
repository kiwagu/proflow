/**
 * Refactor-candidate scanner — the discovery tool for the refactoring agent.
 *
 * Primary signal: FILE SIZE (line count). Large files concentrate
 * responsibilities and resist change; they are the highest-yield refactoring
 * targets. We rank every tracked source file by size and classify it into
 * severity tiers, so a human (or the refactoring agent) gets a prioritised
 * work-list instead of a vague "the code is too big".
 *
 * Thresholds (industry-grounded, all overridable):
 *   warn      300  — ESLint `max-lines` default; readability upper bound.
 *   refactor  500  — classic "God Class" onset (500+ lines / 20+ methods).
 *   critical  800  — urgent; well past any single-responsibility budget.
 * A file's tier is the highest threshold its line count meets.
 *
 * Scope: only git-TRACKED files are scanned (via `git ls-files`), so
 * .gitignore is honoured for free — node_modules, build output, the gitignored
 * `refs/` tree, etc. never appear. Generated/vendored files are additionally
 * excluded by pattern so the list stays actionable (you can't refactor
 * database.types.ts).
 *
 * Output:
 *   default     — human-readable, colourless table sorted worst-first.
 *   --json      — machine-readable report for the agent (stable shape, below).
 *
 * Usage (from repo root):
 *   bun run scripts/find-refactor-candidates.ts                 # whole repo
 *   bun run scripts/find-refactor-candidates.ts apps/author     # scope to a path
 *   bun run scripts/find-refactor-candidates.ts --json          # agent mode
 *   bun run scripts/find-refactor-candidates.ts --limit 400     # set refactor gate
 *   bun run scripts/find-refactor-candidates.ts --warn 200 --critical 1000
 *   bun run scripts/find-refactor-candidates.ts --top 20        # only N worst
 *   bun run scripts/find-refactor-candidates.ts --all           # show every file, not just candidates
 *   bun run scripts/find-refactor-candidates.ts --include-tests # don't skip *.test/*.spec/e2e
 *   bun run scripts/find-refactor-candidates.ts --ext ts,tsx    # restrict extensions
 *
 * Exit code: 0 normally; 1 with `--ci` if any `critical` file exists (so this
 * can later gate CI). The scan itself never fails the build unless asked.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ── Tiers ───────────────────────────────────────────────────────────────────

type Severity = 'ok' | 'warn' | 'refactor' | 'critical';

interface Thresholds {
  warn: number;
  refactor: number;
  critical: number;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  warn: 300,
  refactor: 500,
  critical: 800,
};

function severityFor(lines: number, t: Thresholds): Severity {
  if (lines >= t.critical) return 'critical';
  if (lines >= t.refactor) return 'refactor';
  if (lines >= t.warn) return 'warn';
  return 'ok';
}

// ── What we scan ──────────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

/**
 * Paths excluded even when tracked: nothing actionable lives here, so listing
 * them would only dilute the work-list. Matched against the repo-relative path.
 */
const EXCLUDE_PATTERNS: RegExp[] = [
  /\.d\.ts$/, // type declarations — generated or hand-maintained ambient types
  /database\.types\.ts$/, // supabase-generated DB types
  /(^|\/)payload-types\.ts$/, // payload-generated collection types
  /\.gen\./, // *.gen.ts / *.gen.tsx codegen output
  /(^|\/)__generated__\//,
  /(^|\/)generated\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,
  /\.min\.(js|cjs|mjs)$/,
];

const TEST_PATTERN =
  /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)(__tests__|tests?\/e2e)\/)/;

// ── Line metrics ──────────────────────────────────────────────────────────────

interface FileMetrics {
  /** Repo-relative path. */
  path: string;
  /** Total physical lines. */
  lines: number;
  /** Non-blank, non-comment lines — the code that actually carries weight. */
  code: number;
  severity: Severity;
  isTest: boolean;
}

/**
 * Approximate code-line count: drops blank lines and whole-line comments
 * (`//` and `/* … *\/` blocks). A heuristic, not a parser — good enough to tell
 * "1000 lines of real code" from "1000 lines of mostly JSDoc/data".
 */
function measure(content: string): { lines: number; code: number } {
  const rows = content.split(/\r\n|\r|\n/);
  // A trailing newline yields a final empty element; don't count it as a line.
  if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();

  let code = 0;
  let inBlock = false;
  for (const raw of rows) {
    let line = raw.trim();
    if (line === '') continue;

    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) continue; // still inside the block comment
      line = line.slice(end + 2).trim();
      inBlock = false;
      if (line === '') continue;
    }

    if (line.startsWith('//')) continue;

    if (line.startsWith('/*')) {
      const end = line.indexOf('*/');
      if (end === -1) {
        inBlock = true;
        continue;
      }
      const rest = (line.slice(0, 0) + line.slice(end + 2)).trim();
      if (rest === '') continue;
    }

    code++;
  }
  return { lines: rows.length, code };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

interface Options {
  scope: string[];
  thresholds: Thresholds;
  extensions: string[];
  top: number | null;
  json: boolean;
  showAll: boolean;
  includeTests: boolean;
  ci: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    scope: [],
    thresholds: { ...DEFAULT_THRESHOLDS },
    extensions: DEFAULT_EXTENSIONS,
    top: null,
    json: false,
    showAll: false,
    includeTests: false,
    ci: false,
  };

  const numAfter = (i: number, name: string): number => {
    const v = Number.parseInt(argv[i + 1] ?? '', 10);
    if (!Number.isFinite(v) || v < 0) {
      console.error(`Expected a non-negative number after ${name}`);
      process.exit(2);
    }
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case '--json':
        opts.json = true;
        break;
      case '--all':
        opts.showAll = true;
        break;
      case '--include-tests':
        opts.includeTests = true;
        break;
      case '--ci':
        opts.ci = true;
        break;
      case '--limit': // alias for the refactor gate — matches the user-facing wording
      case '--refactor':
        opts.thresholds.refactor = numAfter(i, arg);
        i++;
        break;
      case '--warn':
        opts.thresholds.warn = numAfter(i, arg);
        i++;
        break;
      case '--critical':
        opts.thresholds.critical = numAfter(i, arg);
        i++;
        break;
      case '--top':
        opts.top = numAfter(i, arg);
        i++;
        break;
      case '--ext':
        opts.extensions = (argv[i + 1] ?? '')
          .split(',')
          .map((e) => e.trim().replace(/^\./, ''))
          .filter(Boolean);
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown flag: ${arg}`);
          process.exit(2);
        }
        opts.scope.push(arg);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(
    [
      'Refactor-candidate scanner — rank tracked source files by size.',
      '',
      'Usage: bun run scripts/find-refactor-candidates.ts [paths...] [flags]',
      '',
      'Flags:',
      '  --json              machine-readable report (agent mode)',
      '  --limit N           refactor gate, default 500 (alias: --refactor)',
      '  --warn N            warn tier, default 300',
      '  --critical N        critical tier, default 800',
      '  --top N             show only the N worst files',
      '  --all               list every file, not just candidates (>= warn)',
      '  --include-tests     include *.test / *.spec / e2e files',
      '  --ext ts,tsx        restrict to these extensions',
      '  --ci                exit 1 if any critical file exists',
      '  -h, --help          this help',
    ].join('\n')
  );
}

// ── Discovery ─────────────────────────────────────────────────────────────────

function listTrackedFiles(scope: string[]): string[] {
  // `git ls-files` honours .gitignore and lists only tracked files; pathspecs
  // restrict to the requested scope. `-z` keeps paths with odd chars intact.
  const args = ['ls-files', '-z', '--', ...(scope.length ? scope : ['.'])];
  const out = execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

function hasWantedExtension(file: string, extensions: string[]): boolean {
  const ext = path.extname(file).replace(/^\./, '').toLowerCase();
  return extensions.includes(ext);
}

function isExcluded(file: string): boolean {
  return EXCLUDE_PATTERNS.some((re) => re.test(file));
}

// ── Report ────────────────────────────────────────────────────────────────────

interface Report {
  generatedBy: 'find-refactor-candidates';
  thresholds: Thresholds;
  extensions: string[];
  scope: string[];
  totals: {
    scanned: number;
    candidates: number;
    warn: number;
    refactor: number;
    critical: number;
  };
  candidates: FileMetrics[];
}

function buildReport(opts: Options): Report {
  const files = listTrackedFiles(opts.scope)
    .filter((f) => hasWantedExtension(f, opts.extensions))
    .filter((f) => !isExcluded(f));

  const metrics: FileMetrics[] = [];
  for (const file of files) {
    const isTest = TEST_PATTERN.test(file);
    if (isTest && !opts.includeTests) continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; // submodule / deleted-but-tracked / binary mislabelled — skip
    }
    const { lines, code } = measure(content);
    metrics.push({
      path: file,
      lines,
      code,
      severity: severityFor(lines, opts.thresholds),
      isTest,
    });
  }

  metrics.sort((a, b) => b.lines - a.lines);

  const candidates = metrics.filter((m) => m.severity !== 'ok');
  const limited = opts.top != null ? candidates.slice(0, opts.top) : candidates;

  return {
    generatedBy: 'find-refactor-candidates',
    thresholds: opts.thresholds,
    extensions: opts.extensions,
    scope: opts.scope.length ? opts.scope : ['.'],
    totals: {
      scanned: metrics.length,
      candidates: candidates.length,
      warn: candidates.filter((m) => m.severity === 'warn').length,
      refactor: candidates.filter((m) => m.severity === 'refactor').length,
      critical: candidates.filter((m) => m.severity === 'critical').length,
    },
    candidates: opts.showAll
      ? opts.top != null
        ? metrics.slice(0, opts.top)
        : metrics
      : limited,
  };
}

// ── Human output ──────────────────────────────────────────────────────────────

const TAG: Record<Severity, string> = {
  critical: 'CRIT',
  refactor: 'REFAC',
  warn: 'warn',
  ok: 'ok',
};

function printTable(report: Report): void {
  const { thresholds: t, totals } = report;
  console.log(
    `Refactor scan — warn>=${t.warn}, refactor>=${t.refactor}, critical>=${t.critical} ` +
      `(scope: ${report.scope.join(', ')})`
  );
  console.log(
    `Scanned ${totals.scanned} files → ${totals.candidates} candidates ` +
      `(${totals.critical} critical, ${totals.refactor} refactor, ${totals.warn} warn)\n`
  );

  if (report.candidates.length === 0) {
    console.log('No files over the warn threshold. ✔');
    return;
  }

  const lineW = Math.max(
    5,
    ...report.candidates.map((c) => String(c.lines).length)
  );
  const codeW = Math.max(
    4,
    ...report.candidates.map((c) => String(c.code).length)
  );
  for (const c of report.candidates) {
    const tag = TAG[c.severity].padEnd(5);
    const lines = String(c.lines).padStart(lineW);
    const code = String(c.code).padStart(codeW);
    console.log(`${tag}  ${lines} ln  ${code} code  ${c.path}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildReport(opts);

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printTable(report);
  }

  if (opts.ci && report.totals.critical > 0) {
    process.exit(1);
  }
}

main();
