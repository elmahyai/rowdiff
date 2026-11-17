// Key-column detection, shared by the CLI's --detect and the web app's key dropdown.
// Pure functions only: no fs, no process, so it runs in the browser too.

const ID_NAME_RE = /^(id|_id|.*_id|.*id|key|uuid|guid|sku|code|ref|reference|no|number|num|invoice|order|account|iban|ean|isbn)$/i;
const CHURN_NAME_RE = /(amount|total|balance|price|qty|quantity|sum|value|updated|modified|timestamp|date|status)/i;

export function detectKeys(left, right) {
  const shared = left.header.filter((h) => right.header.includes(h));
  if (shared.length === 0) return { candidates: [], best: null };

  const leftIndex = indexColumn(left.rows);
  const rightIndex = indexColumn(right.rows);

  const candidates = shared.map((col) => {
    const l = leftIndex.get(col);
    const r = rightIndex.get(col);
    const lNonNull = l.total - l.blank;
    const rNonNull = r.total - r.blank;

    // Fraction of rows on each side whose value also exists on the other side.
    let lFound = 0;
    for (const v of l.values) if (r.values.has(v)) lFound++;
    let rFound = 0;
    for (const v of r.values) if (l.values.has(v)) rFound++;
    const overlap = l.values.size && r.values.size
      ? (lFound / Math.max(1, l.values.size) + rFound / Math.max(1, r.values.size)) / 2
      : 0;

    const uniqueness = 1 - (l.duplicates + r.duplicates) / Math.max(1, lNonNull + rNonNull);
    const blankRatio = 1 - (lNonNull + rNonNull) / Math.max(1, l.total + r.total);
    const nameBonus = ID_NAME_RE.test(col) ? 1 : 0;
    const churnPenalty = CHURN_NAME_RE.test(col) ? 0.5 : 0;
    const cardinality = (l.values.size + r.values.size) / Math.max(2, l.total + r.total);

    const score =
      overlap * 3 +
      uniqueness * 2 +
      nameBonus +
      Math.min(1, cardinality) * 0.5 -
      blankRatio * 2 -
      churnPenalty;

    return {
      column: col,
      score: Number(score.toFixed(3)),
      overlap: Number(overlap.toFixed(3)),
      uniqueness: Number(uniqueness.toFixed(3)),
      blankRatio: Number(blankRatio.toFixed(3)),
      duplicateValues: l.duplicates + r.duplicates,
      cardinality: Number(cardinality.toFixed(3)),
      reasons: {
        overlap,
        uniqueness,
        nameBonus,
        churnPenalty,
        blankRatio,
        cardinality,
      },
    };
  });

  candidates.sort((a, b) => b.score - a.score || a.column.localeCompare(b.column));
  return { candidates, best: candidates[0] || null };
}

function indexColumn(rows) {
  const map = new Map();
  const touch = (col) => {
    if (!map.has(col)) map.set(col, { values: new Set(), total: 0, blank: 0, duplicates: 0, seen: new Set() });
    return map.get(col);
  };
  const allCols = rows.length ? Object.keys(rows[0]) : [];
  for (const col of allCols) touch(col);
  for (const row of rows) {
    for (const col of allCols) {
      const entry = touch(col);
      const raw = row[col];
      const v = raw == null ? '' : String(raw).trim();
      entry.total++;
      if (v === '') {
        entry.blank++;
        continue;
      }
      if (entry.values.has(v)) entry.duplicates++;
      else entry.values.add(v);
    }
  }
  return map;
}
