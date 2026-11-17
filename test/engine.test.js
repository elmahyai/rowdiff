import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, sniffDelimiter, CsvError } from '../src/csv.js';
import { diff, parseNumber, compareCell, DEFAULTS } from '../src/diff.js';

const P = (s, o) => parse(s, o);

test('parses quoted fields with embedded delimiter, quote and newline', () => {
  const csv = 'id,name,note\n1,"Smith, John","line1\nline2"\n2,Ann,"say ""hi"""\n';
  const { header, rows } = P(csv);
  assert.deepEqual(header, ['id', 'name', 'note']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Smith, John');
  assert.equal(rows[0].note, 'line1\nline2');
  assert.equal(rows[1].note, 'say "hi"');
});

test('sniffs semicolon and tab delimiters', () => {
  const semi = 'a;b;c\n1;2;3\n4;5;6\n';
  assert.equal(sniffDelimiter(semi), ';');
  const tab = 'a\tb\tc\n1\t2\t3\n';
  assert.equal(sniffDelimiter(tab), '\t');
  assert.equal(sniffDelimiter('a,b\n1,2\n'), ',');
});

test('strips BOM and decodes utf-16le', () => {
  const bom = Buffer.from('\ufeffid,v\n1,2\n', 'utf8');
  assert.equal(P(bom).header[0], 'id');

  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('id,v\n1,2\n', 'utf16le'),
  ]);
  const parsed = P(utf16);
  assert.deepEqual(parsed.header, ['id', 'v']);
  assert.equal(parsed.rows[0].v, '2');
});

test('handles CRLF, trailing newline and ragged rows', () => {
  const { rows } = P('a,b\r\n1,2\r\n3\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].a, '3');
  assert.equal(rows[1].b, '');
});

test('throws on unterminated quote instead of silently truncating', () => {
  assert.throws(() => P('a,b\n1,"oops\n'), CsvError);
});

test('parses numbers, currency and rejects text', () => {
  assert.equal(parseNumber('1,234.50', {}), null);
  assert.equal(parseNumber('1234.50', {}), 1234.5);
  assert.equal(parseNumber(' -42 ', {}), -42);
  assert.equal(parseNumber('1e3', {}), 1000);
  assert.equal(parseNumber('€1.234,50', { stripCurrency: true }), 1234.5);
  assert.equal(parseNumber('$1,234.50', { stripCurrency: true }), 1234.5);
  assert.equal(parseNumber('abc', {}), null);
});

test('tolerance makes small amount drift equal', () => {
  const opts = { ...DEFAULTS, tolerance: 0.01 };
  assert.equal(compareCell('100.00', '100.01', opts), null);
  assert.notEqual(compareCell('100.00', '100.02', opts), null);
});

test('relative tolerance scales with magnitude', () => {
  const opts = { ...DEFAULTS, relativeTolerance: 0.001 };
  assert.equal(compareCell('1000000', '1000500', opts), null);
  assert.notEqual(compareCell('1000', '1005', opts), null);
});

test('leading-zero codes are not treated as numbers', () => {
  const opts = { ...DEFAULTS, tolerance: 5 };
  assert.notEqual(compareCell('007', '7', opts), null);
  assert.notEqual(compareCell('0012', '12', opts), null);
});

test('whitespace, case and empty-vs-blank behaviour', () => {
  const opts = { ...DEFAULTS, ignoreCase: true, collapseWhitespace: true };
  assert.equal(compareCell('  Ann   Lee ', 'ann lee', opts), null);
  assert.equal(compareCell('', '   ', opts), null);
  assert.notEqual(compareCell('', 'x', opts), null);
  assert.notEqual(compareCell('Ann', 'ann', DEFAULTS), null);
});

test('diff classifies added, removed, changed and unchanged by key', () => {
  const left = P('id,name,amount\n1,Ann,10\n2,Bob,20\n3,Cid,30\n');
  const right = P('id,name,amount\n1,Ann,10\n2,Bob,25\n4,Dee,40\n');
  const r = diff(left, right, { keys: ['id'] });

  assert.equal(r.summary.added, 1);
  assert.equal(r.summary.removed, 1);
  assert.equal(r.summary.changed, 1);
  assert.equal(r.summary.unchanged, 1);
  assert.equal(r.summary.matched, 2);

  assert.deepEqual(r.added[0].key, { id: '4' });
  assert.deepEqual(r.removed[0].key, { id: '3' });
  assert.equal(r.changed[0].changes[0].column, 'amount');
  assert.equal(r.changed[0].changes[0].delta, 5);
});

test('diff without keys compares whole rows', () => {
  const left = P('a,b\n1,2\n');
  const right = P('a,b\n1,2\n');
  assert.equal(diff(left, right).summary.changed, 0);
  const changed = diff(left, P('a,b\n1,3\n'));
  assert.equal(changed.summary.changed, 1);
  assert.equal(changed.summary.added, 0);
});

test('duplicate keys pair in file order and are reported', () => {
  const left = P('id,v\n1,a\n1,b\n');
  const right = P('id,v\n1,a\n1,c\n');
  const r = diff(left, right, { keys: ['id'] });
  assert.equal(r.summary.changed, 1);
  assert.equal(r.duplicateKeys.length, 2);
  assert.equal(r.summary.added, 0);
  assert.equal(r.summary.removed, 0);
});

test('duplicate key surplus on one side becomes added/removed', () => {
  const r = diff(P('id,v\n1,a\n'), P('id,v\n1,a\n1,b\n'), { keys: ['id'] });
  assert.equal(r.summary.added, 1);
  assert.deepEqual(r.added[0].key, { id: '1' });
});

test('warns when key column is missing from a file', () => {
  const r = diff(P('id,v\n1,a\n'), P('v\n a\n'), { keys: ['id'] });
  assert.ok(r.warnings.some((w) => w.includes('missing from right')));
});

test('warns when compare column is absent from both files', () => {
  const r = diff(P('id,v\n1,a\n'), P('id,v\n1,a\n'), { keys: ['id'], compare: ['nope'] });
  assert.ok(r.warnings.some((w) => w.includes('"nope"')));
});

test('compare whitelist ignores unlisted column churn', () => {
  const r = diff(
    P('id,total,updated_at\n1,10,2024-01-01\n'),
    P('id,total,updated_at\n1,10,2024-02-02\n'),
    { keys: ['id'], compare: ['total'] },
  );
  assert.equal(r.summary.changed, 0);
  assert.deepEqual(r.meta.compareColumns, ['total']);
});

test('columnStats attributes churn per column', () => {
  const r = diff(
    P('id,a,b\n1,x,1\n'),
    P('id,a,b\n1,y,2\n'),
    { keys: ['id'] },
  );
  assert.deepEqual(r.columnStats, { a: 1, b: 1 });
});

test('different column sets are surfaced', () => {
  const r = diff(P('id,a\n1,1\n'), P('id,b\n1,1\n'), { keys: ['id'] });
  assert.deepEqual(r.columns.onlyLeft, ['a']);
  assert.deepEqual(r.columns.onlyRight, ['b']);
  assert.deepEqual(r.meta.compareColumns, []);
});

test('empty files do not crash', () => {
  const r = diff(P(''), P(''), {});
  assert.equal(r.summary.leftRows, 0);
  assert.equal(r.summary.added, 0);
});
