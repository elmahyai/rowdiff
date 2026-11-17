// Core diff engine. Everything here is pure: input rows in, result object out.
// The CLI, the web app and the report writers all consume this single shape.

const NUMBER_RE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

export const DEFAULTS = {
  keys: null,
  compare: null,
  tolerance: 0,
  relativeTolerance: 0,
  ignoreCase: false,
  collapseWhitespace: false,
  trim: true,
  numericTolerance: true,
  stripCurrency: false,
};

const CURRENCY_RE = /^([-+]?)\s*([€$£¥])?\s*([\d.,\s']+)\s*([€$£¥])?$/;

// Both "1,234.50" and "1.234,50" are legitimate. When both separators appear the
// rightmost is the decimal point; when only one appears it is ambiguous, so it is
// read as a decimal point unless it is followed by exactly three digits.
function unformatNumber(digits) {
  const cleaned = digits.replace(/[\s']/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? /[.]/g : /[,]/g;
    return cleaned.replace(thousands, '').replace(decimal, '.');
  }
  const sep = lastComma !== -1 ? ',' : lastDot !== -1 ? '.' : null;
  if (sep === null) return cleaned;
  const tail = cleaned.slice(cleaned.lastIndexOf(sep) + 1);
  const occurrences = cleaned.split(sep).length - 1;
  if (tail.length === 3 && occurrences >= 1 && /^\d{3}$/.test(tail)) {
    return cleaned.split(sep).join('');
  }
  return cleaned.replace(sep, '.');
}

function normText(value, opts) {
  let v = value == null ? '' : String(value);
  if (opts.trim) v = v.trim();
  if (opts.collapseWhitespace) v = v.replace(/\s+/g, ' ');
  if (opts.ignoreCase) v = v.toLowerCase();
  return v;
}

function normKeyPart(value, opts) {
  return normText(value, { ...opts, trim: true });
}

export function parseNumber(raw, opts = {}) {
  let v = raw == null ? '' : String(raw);
  if (opts.trim !== false) v = v.trim();
  if (v === '') return null;

  if (opts.stripCurrency) {
    const m = v.match(CURRENCY_RE);
    if (m) {
      const [, sign, pre, digits, post] = m;
      if (pre && post) return null;
      const cleaned = unformatNumber(digits);
      const n = Number(cleaned);
      if (!Number.isFinite(n)) return null;
      return sign === '-' ? -n : n;
    }
  }
  // Thousands separators are deliberately not stripped by default: "1,234" is as
  // likely to be two columns as one number, and guessing wrong corrupts a diff.
  if (!NUMBER_RE.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Returns null when equivalent, otherwise a description of the difference.
export function compareCell(leftRaw, rightRaw, opts) {
  const left = leftRaw == null ? '' : String(leftRaw);
  const right = rightRaw == null ? '' : String(rightRaw);

  const leftEmpty = left.trim() === '';
  const rightEmpty = right.trim() === '';
  if (leftEmpty && rightEmpty) return null;
  if (leftEmpty || rightEmpty) {
    return { kind: 'empty', left, right };
  }

  if (opts.numericTolerance) {
    const ln = parseNumber(left, opts);
    const rn = parseNumber(right, opts);
    if (ln !== null && rn !== null) {
      // Both sides numeric. Treat integer-looking strings with significant leading
      // zeros as identifiers, not numbers, so "007" and "7" stay different.
      const looksLikeCode =
        (/^[-+]?0\d/.test(left.trim()) && !left.includes('.')) ||
        (/^[-+]?0\d/.test(right.trim()) && !right.includes('.'));
      if (!looksLikeCode) {
        const delta = Math.abs(ln - rn);
        // 1e-9 absorbs binary float representation error so "100.00" vs "100.01"
        // is not reported as a difference at tolerance 0.01.
        const allowed = Math.max(
          opts.tolerance,
          Math.abs(opts.relativeTolerance) * Math.max(Math.abs(ln), Math.abs(rn)),
        ) + 1e-9;
        if (delta <= allowed) return null;
        return { kind: 'number', left, right, delta: rn - ln };
      }
    }
  }

  if (normText(left, opts) === normText(right, opts)) return null;
  return { kind: 'text', left, right };
}

export function keyOf(row, keys, opts) {
  return keys.map((k) => normKeyPart(row[k], opts)).join('\u0000');
}

function describeKey(keyObj) {
  return keyObj;
}

// Group rows by key so duplicate keys (common in real exports) pair up in file order
// instead of collapsing into a last-one-wins map.
function groupByKey(rows, keys, opts, side, report) {
  const map = new Map();
  for (const row of rows) {
    const k = keyOf(row, keys, opts);
    if (!map.has(k)) map.set(k, []);
    else report.duplicateKeys.push({ side, key: pick(row, keys) });
    map.get(k).push(row);
  }
  return map;
}

export function pick(row, keys) {
  if (!keys) return row;
  const out = {};
  for (const k of keys) out[k] = row[k];
  return out;
}

export function diff(left, right, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const keys = opts.keys && opts.keys.length > 0 ? opts.keys : null;

  const columns = {
    left: left.header.slice(),
    right: right.header.slice(),
    onlyLeft: left.header.filter((h) => !right.header.includes(h)),
    onlyRight: right.header.filter((h) => !left.header.includes(h)),
  };
  columns.common = left.header.filter((h) => right.header.includes(h));

  const report = { duplicateKeys: [], warnings: [] };

  for (const h of left.duplicateHeaders || []) {
    report.warnings.push(`Left file has duplicate column name "${h}"; later values win.`);
  }
  for (const h of right.duplicateHeaders || []) {
    report.warnings.push(`Right file has duplicate column name "${h}"; later values win.`);
  }

  if (keys) {
    for (const k of keys) {
      if (!left.header.includes(k)) report.warnings.push(`Key column "${k}" missing from left file.`);
      if (!right.header.includes(k)) report.warnings.push(`Key column "${k}" missing from right file.`);
    }
  } else if (columns.onlyLeft.length || columns.onlyRight.length) {
    report.warnings.push(
      'No key column given and the files have different columns; rows are compared by position, so shifted rows will look changed.',
    );
  }

  const compareColumns = (opts.compare && opts.compare.length ? opts.compare : columns.common)
    .filter((c) => !keys || !keys.includes(c));

  for (const c of opts.compare || []) {
    if (!columns.common.includes(c)) {
      report.warnings.push(`Compare column "${c}" is not present in both files.`);
    }
  }

  const result = {
    meta: {
      keys,
      compareColumns,
      tolerance: opts.tolerance,
      relativeTolerance: opts.relativeTolerance,
      options: opts,
    },
    columns,
    summary: {
      leftRows: left.rows.length,
      rightRows: right.rows.length,
      matched: 0,
      added: 0,
      removed: 0,
      changed: 0,
      changedCells: 0,
      unchanged: 0,
    },
    added: [],
    removed: [],
    changed: [],
    duplicateKeys: report.duplicateKeys,
    warnings: report.warnings,
    rowCountMismatch: left.rows.length !== right.rows.length,
  };

  // Without a key column there is nothing to join on, so rows pair up by position:
  // that matches what people expect from "diff these two files".
  const leftGroups = keys
    ? groupByKey(left.rows, keys, opts, 'left', report)
    : new Map(left.rows.map((row, i) => [`#${i}`, [row]]));
  const rightGroups = keys
    ? groupByKey(right.rows, keys, opts, 'right', report)
    : new Map(right.rows.map((row, i) => [`#${i}`, [row]]));

  const allKeys = new Set([...leftGroups.keys(), ...rightGroups.keys()]);

  for (const k of allKeys) {
    const lRows = leftGroups.get(k) || [];
    const rRows = rightGroups.get(k) || [];
    const pairs = Math.min(lRows.length, rRows.length);

    for (let i = 0; i < pairs; i++) {
      const before = lRows[i];
      const after = rRows[i];
      const changes = [];
      for (const col of compareColumns) {
        const d = compareCell(before[col], after[col], opts);
        if (d) changes.push({ column: col, ...d });
      }
      if (changes.length === 0) {
        result.summary.unchanged++;
      } else {
        result.summary.changed++;
        result.summary.changedCells += changes.length;
        result.changed.push({
          key: keys ? describeKey(pick(before, keys)) : { row: Number(String(k).slice(1)) + 1 },
          before,
          after,
          changes,
        });
      }
      result.summary.matched++;
    }

    for (let i = pairs; i < lRows.length; i++) {
      result.removed.push({ key: keys ? pick(lRows[i], keys) : null, row: lRows[i] });
      result.summary.removed++;
    }
    for (let i = pairs; i < rRows.length; i++) {
      result.added.push({ key: keys ? pick(rRows[i], keys) : null, row: rRows[i] });
      result.summary.added++;
    }
  }

  // Stable, predictable ordering: added/removed in file order, changes by key text.
  if (keys) {
    result.changed.sort((a, b) =>
      String(JSON.stringify(a.key)).localeCompare(String(JSON.stringify(b.key))));
  }

  // Per-column churn, so reports can point at the column that actually broke.
  result.columnStats = {};
  for (const c of compareColumns) result.columnStats[c] = 0;
  for (const ch of result.changed) {
    for (const c of ch.changes) result.columnStats[c.column]++;
  }

  return result;
}

export function hasDifferences(result) {
  return result.summary.added + result.summary.removed + result.summary.changed > 0;
}
