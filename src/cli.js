// CLI entry point. Exit codes are the contract for CI:
//   0 = no differences (or differences allowed by policy)
//   1 = differences found
//   2 = usage / IO / parse error
// That three-way split is what makes `rowdiff` usable as a pipeline gate.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parse as parseCsv, CsvError, decode } from './csv.js';
import { diff, hasDifferences } from './diff.js';
import { render, FREE_FORMATS, PRO_FORMATS } from './report.js';
import { resolveLicense, verifyLicense } from './license.js';
import { detectKeys } from './detect.js';

const VERSION = '0.1.0';

const HELP = `rowdiff ${VERSION} - diff and reconcile CSV files by key

USAGE
  rowdiff <left.csv> <right.csv> [options]

DISCOVERY
  --detect                     Sniff the best key column and print a suggested command
  --detect --explain           Show why each candidate key was scored the way it was (Pro)

COMPARISON
  -k, --key <col[,col]>        Key column(s) used to match rows. Default: match by position
  -c, --compare <col[,col]>    Only compare these columns (default: all shared columns)
  -i, --ignore-case            Case-insensitive text comparison
  -w, --collapse-whitespace    Treat runs of whitespace as a single space
  --no-trim                    Do not trim surrounding whitespace
  -t, --tolerance <n>          Allowed absolute difference for numeric cells (default 0)
  -r, --relative-tolerance <f> Allowed relative difference, e.g. 0.001 for 0.1%
  --strip-currency             Parse "€1.234,50" / "$1,234.50" as numbers
  --strict-types               Never treat two values as equal numbers (codes, IDs)

OUTPUT
  -f, --format <fmt>           text (default), json, csv | md, html, junit, sarif (Pro)
  -o, --out <file>             Write the report to a file instead of stdout
  --color / --no-color         Force or disable ANSI colour (auto by default)
  --quiet                      Print nothing but the exit code
  --columns                    Print a per-column churn table only

GATING
  --fail-on <what>             all (default), added, removed, changed, none
  --max-changed <n>            Fail only when more than n rows changed
  --max-rows-added <n>         Fail only when more than n rows were added
  --max-rows-removed <n>       Fail only when more than n rows were removed

PROJECT CONFIG
  --config <file>              Use a specific .rowdiff.json (default: search upward)
  --init                       Write a starter .rowdiff.json in the current directory
  --no-config                  Ignore config files

LICENSE
  --license <key>              Verify a license key and print the result
  --activate <key>             Save a license key to ~/.rowdiff-license
  --status                     Show the active license and which formats are unlocked

OTHER
  -h, --help                   Show this help
  -v, --version                Print the version
`;

const FLAG_SPECS = {
  '--detect': 'boolean',
  '--explain': 'boolean',
  '--ignore-case': 'boolean',
  '--collapse-whitespace': 'boolean',
  '--no-trim': 'boolean',
  '--strip-currency': 'boolean',
  '--strict-types': 'boolean',
  '--color': 'boolean',
  '--no-color': 'boolean',
  '--quiet': 'boolean',
  '--columns': 'boolean',
  '--init': 'boolean',
  '--no-config': 'boolean',
  '--status': 'boolean',
  '--help': 'boolean',
  '--version': 'boolean',
  '--key': 'string',
  '--compare': 'string',
  '--tolerance': 'string',
  '--relative-tolerance': 'string',
  '--format': 'string',
  '--out': 'string',
  '--fail-on': 'string',
  '--max-changed': 'string',
  '--max-rows-added': 'string',
  '--max-rows-removed': 'string',
  '--config': 'string',
  '--license': 'string',
  '--activate': 'string',
};

const SHORT = {
  k: '--key',
  c: '--compare',
  i: '--ignore-case',
  w: '--collapse-whitespace',
  t: '--tolerance',
  r: '--relative-tolerance',
  f: '--format',
  o: '--out',
  h: '--help',
  v: '--version',
};

class UsageError extends Error {}
class RuntimeError extends Error {}

function parseArgv(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      let name = arg;
      let inlineValue = null;
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        name = arg.slice(0, eq);
        inlineValue = arg.slice(eq + 1);
      }
      const spec = FLAG_SPECS[name];
      if (!spec) throw new UsageError(`Unknown option ${name}. Run rowdiff --help.`);
      if (spec === 'boolean') {
        if (inlineValue !== null) throw new UsageError(`${name} does not take a value.`);
        flags[name] = true;
      } else {
        const value = inlineValue !== null ? inlineValue : argv[++i];
        if (value === undefined || (value.startsWith('-') && value.length > 1 && !/^-\d/.test(value))) {
          throw new UsageError(`${name} needs a value.`);
        }
        flags[name] = value;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && arg !== '-') {
      for (const ch of arg.slice(1)) {
        const long = SHORT[ch];
        if (!long) throw new UsageError(`Unknown option -${ch}. Run rowdiff --help.`);
        if (FLAG_SPECS[long] === 'boolean') flags[long] = true;
        else {
          const value = argv[++i];
          if (value === undefined) throw new UsageError(`-${ch} needs a value.`);
          flags[long] = value;
        }
      }
      continue;
    }
    positional.push(arg);
  }

  return { flags, positional };
}

function toBool(v, name) {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  if (v === '') return true; // bare "--strict-types" style keys in config
  if (typeof v === 'string') {
    if (/^(true|yes|on|1)$/i.test(v)) return true;
    if (/^(false|no|off|0)$/i.test(v)) return false;
  }
  throw new UsageError(`Config value for "${name}" must be a boolean, got ${JSON.stringify(v)}.`);
}

function toNumber(v, name) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`"${name}" must be a non-negative number, got ${JSON.stringify(v)}.`);
  }
  return n;
}

export const CONFIG_FILENAME = '.rowdiff.json';

export function findConfig(startDir = process.cwd()) {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

const CONFIG_KEYS = {
  key: 'key',
  compare: 'compare',
  ignoreCase: 'ignore-case',
  collapseWhitespace: 'collapse-whitespace',
  trim: 'no-trim',
  tolerance: 'tolerance',
  relativeTolerance: 'relative-tolerance',
  stripCurrency: 'strip-currency',
  strictTypes: 'strict-types',
  format: 'format',
  out: 'out',
  failOn: 'fail-on',
  maxChanged: 'max-changed',
  maxRowsAdded: 'max-rows-added',
  maxRowsRemoved: 'max-rows-removed',
  color: 'color',
  quiet: 'quiet',
};

export function configToFlags(config) {
  const flags = {};
  const unknown = [];
  for (const [k, v] of Object.entries(config)) {
    if (k === '$schema' || k.startsWith('//')) continue;
    const flag = CONFIG_KEYS[k];
    if (!flag) {
      unknown.push(k);
      continue;
    }
    if (flag === 'no-trim') {
      const trim = toBool(v, k);
      if (trim !== undefined) flags['--no-trim'] = trim === false;
      continue;
    }
    if (['ignore-case', 'collapse-whitespace', 'strip-currency', 'strict-types', 'color', 'quiet'].includes(flag)) {
      const b = toBool(v, k);
      if (b !== undefined) flags[`--${flag}`] = b;
      continue;
    }
    if (flag === 'key' || flag === 'compare') {
      flags[`--${flag}`] = Array.isArray(v) ? v.join(',') : String(v);
      continue;
    }
    flags[`--${flag}`] = v;
  }
  return { flags, unknown };
}

const STARTER_CONFIG = {
  $schema: 'https://raw.githubusercontent.com/rowdiff/rowdiff/main/schema.json',
  key: ['id'],
  tolerance: 0.01,
  ignoreCase: true,
  collapseWhitespace: true,
  format: 'text',
  failOn: 'all',
};

function splitList(value) {
  if (value == null || value === true) return null;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function readInput(path) {
  if (!existsSync(path)) throw new RuntimeError(`File not found: ${path}`);
  const st = statSync(path);
  if (st.isDirectory()) throw new RuntimeError(`Expected a file, got a directory: ${path}`);
  if (st.size === 0) return '';
  return readFileSync(path);
}

function useColor(flags) {
  if (flags['--no-color']) return false;
  if (flags['--color']) return true;
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stdout.isTTY);
}

const C = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m',
  green: '\u001b[32m', red: '\u001b[31m', yellow: '\u001b[33m', cyan: '\u001b[36m',
};

function paint(enabled, color, text) {
  return enabled ? `${C[color]}${text}${C.reset}` : text;
}

// --- render helpers ------------------------------------------------------------

function colorizeText(text, enabled) {
  if (!enabled) return text;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s+~/.test(line)) return paint(true, 'yellow', line);
      if (/^\s+\+/.test(line)) return paint(true, 'green', line);
      if (/^\s+-/.test(line)) return paint(true, 'red', line);
      if (/^(ADDED|REMOVED|CHANGED)/.test(line)) return paint(true, 'bold', line);
      if (/^warning:/.test(line)) return paint(true, 'yellow', line);
      return line;
    })
    .join('\n');
}

function printSummary(result, flags, { quiet }) {
  if (quiet) return;
  const color = useColor(flags);
  const s = result.summary;
  const parts = [];
  if (s.added) parts.push(paint(color, 'green', `+${s.added}`));
  if (s.removed) parts.push(paint(color, 'red', `-${s.removed}`));
  if (s.changed) parts.push(paint(color, 'yellow', `~${s.changed}`));
  const diffCount = s.added + s.removed + s.changed;
  const label = diffCount === 0
    ? paint(color, 'green', 'identical')
    : `${diffCount} differing row${diffCount === 1 ? '' : 's'}`;
  process.stderr.write(`${label}${parts.length ? ` (${parts.join(' ')})` : ''}\n`);
}

function columnsTable(result) {
  const entries = Object.entries(result.columnStats).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const width = Math.max(6, ...entries.map(([c]) => c.length));
  const lines = ['column'.padEnd(width) + '  changed cells', '-'.repeat(width) + '  -------------'];
  const total = entries.reduce((n, [, v]) => n + v, 0);
  for (const [c, n] of entries) {
    lines.push(c.padEnd(width) + '  ' + String(n).padStart(13));
  }
  lines.push('-'.repeat(width) + '  -------------');
  lines.push('total'.padEnd(width) + '  ' + String(total).padStart(13));
  return lines.join('\n') + '\n';
}

// --- policy --------------------------------------------------------------------

export function evaluatePolicy(result, flags) {
  const failOn = (flags['--fail-on'] || 'all').toLowerCase();
  const valid = ['all', 'added', 'removed', 'changed', 'none'];
  if (!valid.includes(failOn)) {
    throw new UsageError(`--fail-on must be one of: ${valid.join(', ')}`);
  }

  const s = result.summary;
  const maxChanged = toNumber(flags['--max-changed'], '--max-changed');
  const maxAdded = toNumber(flags['--max-rows-added'], '--max-rows-added');
  const maxRemoved = toNumber(flags['--max-rows-removed'], '--max-rows-removed');

  if (maxChanged !== undefined) return s.changed > maxChanged ? { fail: true, reason: `${s.changed} changed > ${maxChanged}` } : { fail: false };
  if (maxAdded !== undefined) return s.added > maxAdded ? { fail: true, reason: `${s.added} added > ${maxAdded}` } : { fail: false };
  if (maxRemoved !== undefined) return s.removed > maxRemoved ? { fail: true, reason: `${s.removed} removed > ${maxRemoved}` } : { fail: false };

  if (failOn === 'none') return { fail: false };
  if (failOn === 'added') return s.added > 0 ? { fail: true, reason: `${s.added} added` } : { fail: false };
  if (failOn === 'removed') return s.removed > 0 ? { fail: true, reason: `${s.removed} removed` } : { fail: false };
  if (failOn === 'changed') return s.changed > 0 ? { fail: true, reason: `${s.changed} changed` } : { fail: false };
  return hasDifferences(result) ? { fail: true, reason: 'differences found' } : { fail: false };
}

// --- main ----------------------------------------------------------------------

export function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const { flags, positional } = parseArgv(argv);

  if (flags['--help']) {
    stdout.write(HELP);
    return 0;
  }
  if (flags['--version']) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  // --- license commands ---
  if (flags['--license'] || flags['--status'] || flags['--activate']) {
    return handleLicense(flags, { stdout, stderr });
  }

  if (flags['--init']) {
    const path = resolve(process.cwd(), CONFIG_FILENAME);
    if (existsSync(path)) throw new RuntimeError(`${CONFIG_FILENAME} already exists at ${path}`);
    writeFileSync(path, JSON.stringify(STARTER_CONFIG, null, 2) + '\n');
    stdout.write(`Wrote ${path}\nEdit "key" to the column that identifies a row, then run:\n  rowdiff before.csv after.csv\n`);
    return 0;
  }

  // --- config merge: explicit flags always win over the config file ---
  let configFlags = {};
  if (!flags['--no-config']) {
    const configPath = flags['--config'] ? resolve(String(flags['--config'])) : findConfig();
    if (flags['--config'] && !configPath) throw new RuntimeError(`Config not found: ${flags['--config']}`);
    if (configPath && existsSync(configPath)) {
      let config;
      try {
        config = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch (err) {
        throw new RuntimeError(`Cannot read ${configPath}: ${err.message}`);
      }
      const converted = configToFlags(config);
      for (const u of converted.unknown) {
        stderr.write(`warning: unknown key "${u}" in ${configPath} (ignored)\n`);
      }
      configFlags = converted.flags;
    } else if (flags['--config']) {
      throw new RuntimeError(`Config not found: ${flags['--config']}`);
    }
  }
  const effective = { ...configFlags, ...flags };

  if (positional.length < 2) {
    throw new UsageError('Two files are required. Run rowdiff --help for usage.');
  }
  if (positional.length > 2) {
    throw new UsageError(`Expected 2 files, got ${positional.length}: ${positional.join(' ')}`);
  }

  const [leftPath, rightPath] = positional;

  const license = resolveLicense({ readFile: (p) => readFileSync(p, 'utf8') });

  let left;
  let right;
  try {
    left = parseCsv(readInput(leftPath), { delimiter: 'auto' });
    right = parseCsv(readInput(rightPath), { delimiter: 'auto' });
  } catch (err) {
    if (err instanceof CsvError) throw new RuntimeError(`CSV parse error: ${err.message}`);
    throw err;
  }

  // --- detect mode ---
  if (flags['--detect']) {
    const { candidates, best } = detectKeys(left, right);
    if (!best) {
      stderr.write('No shared columns found; cannot suggest a key.\n');
      return 2;
    }
    const explain = flags['--explain'];
    if (explain && !license.valid) {
      stderr.write(
        '--explain is a Pro feature.\n' +
        'Get a key at https://rowdiff.dev/pricing, then: rowdiff --activate <key>\n',
      );
      return 2;
    }

    stdout.write(`Files: ${leftPath} (${left.rows.length} rows) vs ${rightPath} (${right.rows.length} rows)\n\n`);
    const w = Math.max(6, ...candidates.map((c) => c.column.length));
    stdout.write(`${'column'.padEnd(w)}  score  overlap  unique  blanks\n`);
    stdout.write(`${'-'.repeat(w)}  -----  -------  ------  ------\n`);
    for (const c of candidates.slice(0, explain ? 50 : 5)) {
      stdout.write(
        `${c.column.padEnd(w)}  ${String(c.score.toFixed(2)).padStart(5)}  ` +
        `${String((c.overlap * 100).toFixed(0) + '%').padStart(7)}  ` +
        `${String((c.uniqueness * 100).toFixed(0) + '%').padStart(6)}  ` +
        `${String((c.blankRatio * 100).toFixed(0) + '%').padStart(6)}\n`,
      );
    }
    if (explain) {
      stdout.write('\nScoring detail (Pro)\n');
      for (const c of candidates) {
        stdout.write(
          `\n${c.column}\n` +
          `  overlap×3        ${(c.reasons.overlap * 3).toFixed(2)}\n` +
          `  uniqueness×2     ${(c.reasons.uniqueness * 2).toFixed(2)}\n` +
          `  name match       ${c.reasons.nameBonus.toFixed(2)}\n` +
          `  cardinality×0.5  ${(Math.min(1, c.reasons.cardinality) * 0.5).toFixed(2)}\n` +
          `  blanks×-2        ${(-c.reasons.blankRatio * 2).toFixed(2)}\n` +
          `  churn penalty    ${(-c.reasons.churnPenalty).toFixed(2)}\n` +
          `  duplicate values ${c.duplicateValues}\n` +
          `  = ${c.score}\n`,
        );
      }
    }
    stdout.write(`\nSuggested command:\n  rowdiff ${quote(leftPath)} ${quote(rightPath)} --key ${best.column}\n`);
    return 0;
  }

  const format = String(effective['--format'] || 'text').toLowerCase();
  const known = [...FREE_FORMATS, ...PRO_FORMATS];
  if (!known.includes(format)) {
    throw new UsageError(`Unknown --format "${format}". Known: ${known.join(', ')}`);
  }
  if (PRO_FORMATS.includes(format)) {
    if (!license.valid) {
      throw new RuntimeError(
        `The "${format}" report is a Pro feature${license.reason ? ` (${license.reason})` : ''}.\n` +
        `Unlock it: https://rowdiff.dev/pricing then "rowdiff --activate <key>"\n` +
        `Free formats: ${FREE_FORMATS.join(', ')}.`,
      );
    }
  }

  const keys = splitList(effective['--key']);
  if (keys) {
    for (const k of keys) {
      if (!left.header.includes(k) && !right.header.includes(k)) {
        throw new RuntimeError(
          `Key column "${k}" is in neither file. Columns: ${[...new Set([...left.header, ...right.header])].join(', ')}`,
        );
      }
    }
  }

  const compare = splitList(effective['--compare']);

  const result = diff(left, right, {
    keys,
    compare,
    ignoreCase: Boolean(effective['--ignore-case']),
    collapseWhitespace: Boolean(effective['--collapse-whitespace']),
    trim: !effective['--no-trim'],
    tolerance: toNumber(effective['--tolerance'], '--tolerance') ?? 0,
    relativeTolerance: toNumber(effective['--relative-tolerance'], '--relative-tolerance') ?? 0,
    stripCurrency: Boolean(effective['--strip-currency']),
    numericTolerance: !effective['--strict-types'],
  });

  const quiet = Boolean(effective['--quiet']);

  if (flags['--columns']) {
    stdout.write(columnsTable(result));
    printSummary(result, effective, { quiet });
    return 0;
  }

  const out = format === 'text'
    ? (useColor(effective) ? colorizeText(render('text', result), true) : render('text', result))
    : render(format, result, { title: `CSV diff: ${leftPath} → ${rightPath}`, uri: leftPath });

  const outPath = effective['--out'];
  if (outPath) {
    writeFileSync(resolve(String(outPath)), out);
    if (!quiet) stderr.write(`wrote ${outPath}\n`);
  } else if (!quiet || format !== 'text') {
    stdout.write(out);
  }

  printSummary(result, effective, { quiet });

  const policy = evaluatePolicy(result, effective);
  if (policy.fail) {
    if (!quiet) stderr.write(`policy: failing (${policy.reason})\n`);
    return 1;
  }
  return 0;
}

function quote(p) {
  return /[\s"'$`\\]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p;
}

function handleLicense(flags, { stdout, stderr }) {
  if (flags['--activate']) {
    const key = String(flags['--activate']);
    const check = verifyLicense(key);
    if (!check.valid) {
      stderr.write(`Invalid license: ${check.reason}\n`);
      return 2;
    }
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    const path = resolve(home, '.rowdiff-license');
    writeFileSync(path, key.trim() + '\n', { mode: 0o600 });
    stdout.write(`License activated for ${check.email || 'unknown'} (${check.plan}), saved to ${path}\n`);
    return 0;
  }

  if (flags['--license']) {
    const check = verifyLicense(String(flags['--license']));
    stdout.write(JSON.stringify(check, null, 2) + '\n');
    return check.valid ? 0 : 1;
  }

  // --status
  const current = resolveLicense({ readFile: (p) => readFileSync(p, 'utf8') });
  if (current.valid) {
    stdout.write(`License: ${current.plan} · ${current.email || 'unknown'} · ${current.payload?.expires || 'no expiry'}\n`);
    stdout.write(`Source: ${current.source || 'ROWDIFF_LICENSE env var'}\n`);
    stdout.write(`Unlocked formats: ${PRO_FORMATS.join(', ')}\n`);
  } else {
    stdout.write(`License: none (${current.reason})\n`);
    stdout.write(`Free formats: ${FREE_FORMATS.join(', ')}\n`);
    stdout.write(`Pro formats: ${PRO_FORMATS.join(', ')} — https://rowdiff.dev/pricing\n`);
    stdout.write(`Free for anyone who cannot afford it: email hello@rowdiff.dev.\n`);
  }
  return 0;
}

export function main(argv = process.argv.slice(2)) {
  try {
    return run(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    if (err instanceof RuntimeError) {
      process.stderr.write(`rowdiff: ${err.message}\n`);
      return 2;
    }
    process.stderr.write(`rowdiff: unexpected error: ${err?.stack || err}\n`);
    return 2;
  }
}
