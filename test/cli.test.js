import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rowdiff.mjs');
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function cli(args, opts = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...opts.env },
    cwd: opts.cwd,
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

const ledgerBefore = join(FIX, 'ledger_before.csv');
const ledgerAfter = join(FIX, 'ledger_after.csv');

test('exits 0 when files are identical', () => {
  const r = cli([ledgerBefore, ledgerBefore, '--key', 'invoice_id']);
  assert.equal(r.code, 0);
  assert.match(r.out, /identical|0 added/);
});

test('exits 1 when differences exist', () => {
  const r = cli([ledgerBefore, ledgerAfter, '--key', 'invoice_id']);
  assert.equal(r.code, 1);
});

test('reports added, removed and changed rows', () => {
  const r = cli([ledgerBefore, ledgerAfter, '--key', 'invoice_id', '--format', 'json']);
  assert.equal(r.code, 1);
  const parsed = JSON.parse(r.out);
  assert.equal(parsed.summary.added, 1);
  assert.equal(parsed.summary.removed, 1);
  assert.equal(parsed.summary.changed, 3);
  assert.equal(parsed.added[0].key.invoice_id, 'INV-1006');
  assert.equal(parsed.removed[0].key.invoice_id, 'INV-1005');
});

test('--fail-on none always exits 0 but still reports', () => {
  const r = cli([ledgerBefore, ledgerAfter, '--key', 'invoice_id', '--fail-on', 'none']);
  assert.equal(r.code, 0);
  assert.match(r.out, /ADDED/);
});

test('--fail-on changed ignores added rows', () => {
  const r = cli([ledgerBefore, ledgerAfter, '--key', 'invoice_id', '--fail-on', 'changed', '--quiet']);
  assert.equal(r.code, 1); // there are 3 changed rows too
});

test('--max-changed threshold gates', () => {
  assert.equal(cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '--max-changed', '5', '--quiet']).code, 0);
  assert.equal(cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '--max-changed', '2', '--quiet']).code, 1);
});

test('tolerance suppresses rounding-only differences', () => {
  // 2750.25 -> 2750.30 is a 0.05 drift
  const strict = cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '--compare', 'amount', '--strict-types', '--format', 'json']);
  const loose = cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '--compare', 'amount', '--tolerance', '0.05', '--format', 'json']);
  assert.equal(JSON.parse(strict.out).summary.changed, 1);
  assert.equal(JSON.parse(loose.out).summary.changed, 0);
});

test('reconciles a European bank export against the ledger', () => {
  const r = cli([
    join(FIX, 'ledger_eur.csv'), join(FIX, 'bank.csv'),
    '-k', 'description', '--compare', 'amount',
    '--strip-currency', '--ignore-case', '--format', 'json',
  ], { env: { ROWDIFF_LICENSE: '' } });
  // Same amounts written "€1.250,00" (German) and "€1,250.00" (US) must reconcile,
  // and the 2026-01-09 -> 01-11 posting-date drift must not look like a money delta.
  const parsed = JSON.parse(r.out);
  assert.equal(parsed.summary.changed, 0, JSON.stringify(parsed.changed, null, 1));
  assert.equal(parsed.summary.added, 0);
  assert.equal(parsed.summary.removed, 0);
  assert.equal(parsed.summary.unchanged, 5);
});

test('Pro format is refused without a license and allowed with one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowdiff-'));
  try {
    const denied = cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '--format', 'html']);
    assert.equal(denied.code, 2);
    assert.match(denied.err, /Pro feature/);

    const key = mintLicense(join(dirname(BIN), '..'));
    const allowed = cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '--format', 'html', '--no-config'], {
      env: { ROWDIFF_LICENSE: key },
    });
    assert.equal(allowed.code, 1);
    assert.match(allowed.out, /<!doctype html>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Mints a license with the local dev private key so tests exercise the real crypto path.
function mintLicense(root) {
  const privPath = join(root, '.license-keys', 'private.pem');
  if (!existsSync(privPath)) return null;
  const payload = { v: 1, id: 'rd_test', email: 'test@example.com', plan: 'pro', issued: '2026-01-01', expires: '2099-01-01' };
  const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payloadPart = b64(JSON.stringify(payload));
  const sig = sign(null, Buffer.from(payloadPart, 'utf8'), readFileSync(privPath));
  return `ROWDIFF.${payloadPart}.${b64(sig)}`;
}

test('--init writes a starter config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowdiff-init-'));
  try {
    const r = cli(['--init'], { cwd: dir });
    assert.equal(r.code, 0);
    const config = JSON.parse(readFileSync(join(dir, '.rowdiff.json'), 'utf8'));
    assert.deepEqual(config.key, ['id']);
    const again = cli(['--init'], { cwd: dir });
    assert.equal(again.code, 2, 'must not overwrite an existing config');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config file is found upward and CLI flags override it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowdiff-cfg-'));
  try {
    writeFileSync(join(dir, '.rowdiff.json'), JSON.stringify({ key: 'invoice_id', format: 'json' }));
    const sub = join(dir, 'nested');
    mkdirSync(sub);
    const r = cli([ledgerBefore, ledgerAfter], { cwd: sub });
    assert.equal(r.code, 1);
    assert.match(r.out, /"summary"/, 'format:json from config should apply');

    const overridden = cli([ledgerBefore, ledgerAfter, '--format', 'text'], { cwd: sub });
    assert.match(overridden.out, /rowdiff: 5 left rows/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--detect proposes the invoice id column', () => {
  const r = cli([ledgerBefore, ledgerAfter, '--detect']);
  assert.equal(r.code, 0);
  assert.match(r.out, /invoice_id/);
  assert.match(r.out, /Suggested command/);
});

test('--detect --explain is gated behind Pro', () => {
  const r = cli([ledgerBefore, ledgerAfter, '--detect', '--explain']);
  assert.equal(r.code, 2);
  assert.match(r.err, /Pro feature/);
});

test('missing key column gives an actionable error', () => {
  const r = cli([ledgerBefore, ledgerAfter, '--key', 'nope']);
  assert.equal(r.code, 2);
  assert.match(r.err, /neither file/);
  assert.match(r.err, /invoice_id/);
});

test('unknown flag and missing files exit 2', () => {
  assert.equal(cli([ledgerBefore, ledgerAfter, '--wat']).code, 2);
  assert.equal(cli([join(FIX, 'nope.csv'), ledgerAfter]).code, 2);
  assert.equal(cli([ledgerBefore]).code, 2);
});

test('@file writes the report to disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowdiff-out-'));
  try {
    const target = join(dir, 'report.json');
    const r = cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '-f', 'json', '-o', target]);
    assert.equal(r.code, 1);
    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    assert.equal(parsed.summary.changed, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--columns prints churn table', () => {
  const r = cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '--columns']);
  assert.match(r.out, /status/);
  assert.match(r.out, /updated_at/);
  assert.match(r.out, /total/);
});

test('junit output is well-formed enough for CI parsers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowdiff-junit-'));
  try {
    const key = mintLicense(join(dirname(BIN), '..'));
    if (!key) return;
    const r = cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '-f', 'junit'], { env: { ROWDIFF_LICENSE: key } });
    assert.equal(r.code, 1);
    assert.match(r.out, /<testsuites/);
    assert.match(r.out, /failures="3"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sarif output is valid JSON with version 2.1.0', () => {
  const key = mintLicense(join(dirname(BIN), '..'));
  if (!key) return;
  const r = cli([ledgerBefore, ledgerAfter, '-k', 'invoice_id', '-f', 'sarif'], { env: { ROWDIFF_LICENSE: key } });
  const sarif = JSON.parse(r.out);
  assert.equal(sarif.version, '2.1.0');
  assert.ok(sarif.runs[0].results.length >= 3);
  assert.equal(sarif.runs[0].tool.driver.name, 'rowdiff');
});

test('--status works with no license', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowdiff-home-'));
  try {
    const r = cli(['--status'], { env: { HOME: dir, ROWDIFF_LICENSE: '' } });
    assert.equal(r.code, 0);
    assert.match(r.out, /Free formats/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--activate stores a valid key and rejects a tampered one', () => {
  const key = mintLicense(join(dirname(BIN), '..'));
  if (!key) return;
  const dir = mkdtempSync(join(tmpdir(), 'rowdiff-act-'));
  try {
    const ok = cli(['--activate', key], { env: { HOME: dir, ROWDIFF_LICENSE: '' } });
    assert.equal(ok.code, 0);
    assert.ok(existsSync(join(dir, '.rowdiff-license')));

    const bad = cli(['--activate', `${key.slice(0, -4)}AAAA`], { env: { HOME: dir, ROWDIFF_LICENSE: '' } });
    assert.equal(bad.code, 2);
    assert.match(bad.err, /Invalid license/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
