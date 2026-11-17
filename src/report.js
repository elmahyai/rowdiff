// Report writers. Each one takes the result object from src/diff.js and returns a string.
// Free formats: text, json, csv. Pro formats: md, html, junit, sarif.

const esc = {
  html: (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;'),
  xml: (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0 cannot carry most control characters; drop them rather than emit invalid XML.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''),
};

export function keyLabel(entry, keys) {
  if (!keys) return `row ${entry.key?.row ?? '?'}`;
  return keys.map((k) => `${k}=${entry.key?.[k] ?? ''}`).join(' ');
}

function fmtDelta(d) {
  if (d == null) return '';
  const sign = d > 0 ? '+' : '';
  const rounded = Math.abs(d) < 1e-9 ? 0 : d;
  return `${sign}${Number(rounded.toFixed(6))}`;
}

export function toText(result) {
  const s = result.summary;
  const lines = [];
  const head = `rowdiff: ${s.leftRows} left rows vs ${s.rightRows} right rows`;
  lines.push(head, '='.repeat(Math.min(head.length, 72)));

  if (result.meta.keys) lines.push(`key: ${result.meta.keys.join(', ')}`);
  else lines.push('key: none (rows compared by position)');
  if (result.meta.compareColumns.length) {
    lines.push(`columns: ${result.meta.compareColumns.join(', ')}`);
  }
  if (result.meta.tolerance || result.meta.relativeTolerance) {
    lines.push(
      `tolerance: ${result.meta.tolerance}` +
      (result.meta.relativeTolerance ? ` (+${result.meta.relativeTolerance * 100}% relative)` : ''),
    );
  }
  lines.push('');

  for (const w of result.warnings) lines.push(`warning: ${w}`);
  if (result.warnings.length) lines.push('');

  if (result.duplicateKeys.length) {
    const n = result.duplicateKeys.length;
    lines.push(`note: ${n} duplicate key value(s); rows were paired in file order.`);
    lines.push('');
  }

  if (result.changed.length) {
    lines.push(`CHANGED (${result.changed.length})`);
    for (const ch of result.changed) {
      lines.push(`  ~ ${keyLabel(ch, result.meta.keys)}`);
      for (const c of ch.changes) {
        if (c.kind === 'number') {
          lines.push(`      ${c.column}: ${c.left} -> ${c.right}  (${fmtDelta(c.delta)})`);
        } else if (c.kind === 'empty') {
          lines.push(`      ${c.column}: ${JSON.stringify(c.left)} -> ${JSON.stringify(c.right)}`);
        } else {
          lines.push(`      ${c.column}: ${JSON.stringify(c.left)} -> ${JSON.stringify(c.right)}`);
        }
      }
    }
    lines.push('');
  }

  if (result.added.length) {
    lines.push(`ADDED (${result.added.length})`);
    for (const a of result.added.slice(0, 50)) lines.push(`  + ${keyLabel(a, result.meta.keys)}`);
    if (result.added.length > 50) lines.push(`  ... ${result.added.length - 50} more`);
    lines.push('');
  }

  if (result.removed.length) {
    lines.push(`REMOVED (${result.removed.length})`);
    for (const r of result.removed.slice(0, 50)) lines.push(`  - ${keyLabel(r, result.meta.keys)}`);
    if (result.removed.length > 50) lines.push(`  ... ${result.removed.length - 50} more`);
    lines.push('');
  }

  lines.push(
    `summary: ${s.added} added, ${s.removed} removed, ${s.changed} changed, ${s.unchanged} unchanged`,
  );
  return lines.join('\n') + '\n';
}

export function toJson(result) {
  return JSON.stringify(
    {
      summary: result.summary,
      columns: result.columns,
      meta: {
        keys: result.meta.keys,
        compareColumns: result.meta.compareColumns,
        tolerance: result.meta.tolerance,
        relativeTolerance: result.meta.relativeTolerance,
      },
      columnStats: result.columnStats,
      added: result.added,
      removed: result.removed,
      changed: result.changed,
      warnings: result.warnings,
      duplicateKeys: result.duplicateKeys,
    },
    null,
    2,
  ) + '\n';
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(result) {
  const rows = [['change', 'key', 'column', 'before', 'after', 'delta']];
  const keys = result.meta.keys;
  const keyStr = (entry) => (keys ? keys.map((k) => entry.key?.[k] ?? '').join('|') : String(entry.key?.row ?? ''));

  for (const ch of result.changed) {
    for (const c of ch.changes) {
      rows.push(['changed', keyStr(ch), c.column, c.left, c.right, c.kind === 'number' ? fmtDelta(c.delta) : '']);
    }
  }
  for (const a of result.added) rows.push(['added', keyStr(a), '', '', '', '']);
  for (const r of result.removed) rows.push(['removed', keyStr(r), '', '', '', '']);

  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function toMarkdown(result) {
  const s = result.summary;
  const out = [];
  out.push('## CSV diff report', '');
  out.push('| | count |', '|---|---:|');
  out.push(`| left rows | ${s.leftRows} |`);
  out.push(`| right rows | ${s.rightRows} |`);
  out.push(`| **added** | **${s.added}** |`);
  out.push(`| **removed** | **${s.removed}** |`);
  out.push(`| **changed** | **${s.changed}** |`);
  out.push(`| unchanged | ${s.unchanged} |`);
  out.push('');

  if (result.meta.keys) out.push(`Key: \`${result.meta.keys.join('`, `')}\``, '');
  else out.push('Key: none — rows compared by position', '');

  const churn = Object.entries(result.columnStats).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (churn.length) {
    out.push('### Churn by column', '', '| column | changed cells |', '|---|---:|');
    for (const [c, n] of churn) out.push(`| \`${c}\` | ${n} |`);
    out.push('');
  }

  if (result.changed.length) {
    out.push(`### Changed rows (${result.changed.length})`, '');
    const cols = result.meta.compareColumns;
    out.push(['key', ...cols].map((c) => `\`${c}\``).join(' | ').replace(/^/, '| ').concat(' |'));
    out.push(['---', ...cols.map(() => '---')].join(' | ').replace(/^/, '| ').concat(' |'));
    const cap = 200;
    for (const ch of result.changed.slice(0, cap)) {
      const cells = cols.map((c) => {
        const change = ch.changes.find((x) => x.column === c);
        if (!change) return ch.after[c] ?? '';
        const was = change.left === '' ? '*(empty)*' : change.left;
        const now = change.right === '' ? '*(empty)*' : change.right;
        return `${was} → **${now}**`;
      });
      const keyStr = result.meta.keys
        ? result.meta.keys.map((k) => ch.key?.[k] ?? '').join(' / ')
        : `row ${ch.key?.row}`;
      out.push(`| ${keyStr} | ${cells.join(' | ')} |`);
    }
    if (result.changed.length > cap) out.push('', `_…and ${result.changed.length - cap} more rows (see JSON/CSV report)._`);
    out.push('');
  }

  if (result.added.length) {
    out.push(`### Added (${result.added.length})`, '');
    for (const a of result.added.slice(0, 100)) {
      out.push(`- \`${result.meta.keys ? result.meta.keys.map((k) => a.key?.[k]).join('|') : 'row ' + a.key?.row}\``);
    }
    if (result.added.length > 100) out.push(`- _…and ${result.added.length - 100} more_`);
    out.push('');
  }

  if (result.removed.length) {
    out.push(`### Removed (${result.removed.length})`, '');
    for (const r of result.removed.slice(0, 100)) {
      out.push(`- \`${result.meta.keys ? result.meta.keys.map((k) => r.key?.[k]).join('|') : 'row ' + r.key?.row}\``);
    }
    if (result.removed.length > 100) out.push(`- _…and ${result.removed.length - 100} more_`);
    out.push('');
  }

  if (result.warnings.length) {
    out.push('### Warnings', '');
    for (const w of result.warnings) out.push(`> ⚠️ ${w}`);
    out.push('');
  }

  out.push('_Generated by rowdiff._');
  return out.join('\n') + '\n';
}

export function toHtml(result, { title = 'CSV diff report' } = {}) {
  const s = result.summary;
  const churn = Object.entries(result.columnStats).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  const rows = result.changed.map((ch) => {
    const cells = result.meta.compareColumns.map((c) => {
      const change = ch.changes.find((x) => x.column === c);
      if (!change) return `<td class="same">${esc.html(ch.after[c])}</td>`;
      const delta = change.kind === 'number' ? ` <span class="delta">${esc.html(fmtDelta(change.delta))}</span>` : '';
      return `<td class="diff"><span class="was">${esc.html(change.left) || '<em>empty</em>'}</span>` +
             ` <span class="arrow">→</span> <span class="now">${esc.html(change.right) || '<em>empty</em>'}</span>${delta}</td>`;
    }).join('');
    const keyStr = result.meta.keys
      ? result.meta.keys.map((k) => esc.html(ch.key?.[k] ?? '')).join(' / ')
      : `row ${esc.html(ch.key?.row)}`;
    return `<tr><th>${keyStr}</th>${cells}</tr>`;
  }).join('\n');

  const list = (entries, cls) => entries.length
    ? `<ul class="keys">${entries.slice(0, 500).map((e) =>
        `<li><code>${esc.html(result.meta.keys ? result.meta.keys.map((k) => e.key?.[k] ?? '').join(' ') : 'row ' + e.key?.row)}</code></li>`,
      ).join('')}${entries.length > 500 ? `<li>…and ${entries.length - 500} more</li>` : ''}</ul>`
    : '<p class="none">None</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc.html(title)}</title>
<style>
  :root { color-scheme: light dark; --add:#0a7d33; --del:#b3261e; --chg:#8a5a00; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 2rem; max-width: 1100px; margin-inline: auto; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .sub { opacity: .65; margin-bottom: 1.5rem; font-size: .87rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); gap: .75rem; margin-bottom: 1.75rem; }
  .card { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 10px; padding: .7rem .9rem; }
  .card b { display: block; font-size: 1.55rem; line-height: 1.2; }
  .card span { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; opacity: .6; }
  .card.added b { color: var(--add); } .card.removed b { color: var(--del); } .card.changed b { color: var(--chg); }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; display: block; overflow-x: auto; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); vertical-align: top; }
  thead th { position: sticky; top: 0; background: Canvas; }
  td.diff .was { color: var(--del); text-decoration: line-through; text-decoration-thickness: 1px; }
  td.diff .now { color: var(--add); font-weight: 600; }
  .delta { font-size: .72rem; opacity: .7; font-variant-numeric: tabular-nums; }
  .keys { columns: 3; font-size: .8rem; padding-left: 1.1rem; }
  h2 { font-size: 1rem; margin: 2rem 0 .5rem; text-transform: uppercase; letter-spacing: .06em; opacity: .7; }
  .warn { border-left: 3px solid var(--chg); padding: .4rem .8rem; margin: .3rem 0; background: color-mix(in srgb, var(--chg) 8%, transparent); }
  .none { opacity: .5; font-style: italic; }
  footer { margin-top: 2.5rem; font-size: .75rem; opacity: .5; }
</style>
</head>
<body>
<h1>${esc.html(title)}</h1>
<div class="sub">${result.meta.keys ? `keyed on <code>${esc.html(result.meta.keys.join(', '))}</code>` : 'compared by row position'} · ${s.leftRows} → ${s.rightRows} rows${result.meta.tolerance ? ` · tolerance ${esc.html(result.meta.tolerance)}` : ''}</div>

<div class="cards">
  <div class="card"><b>${s.leftRows}</b><span>left rows</span></div>
  <div class="card"><b>${s.rightRows}</b><span>right rows</span></div>
  <div class="card added"><b>${s.added}</b><span>added</span></div>
  <div class="card removed"><b>${s.removed}</b><span>removed</span></div>
  <div class="card changed"><b>${s.changed}</b><span>changed</span></div>
  <div class="card"><b>${s.unchanged}</b><span>unchanged</span></div>
</div>

${result.warnings.map((w) => `<div class="warn">⚠️ ${esc.html(w)}</div>`).join('\n')}

${churn.length ? `<h2>Churn by column</h2><table><thead><tr><th>column</th><th>changed cells</th></tr></thead><tbody>${
  churn.map(([c, n]) => `<tr><td><code>${esc.html(c)}</code></td><td>${n}</td></tr>`).join('')
}</tbody></table>` : ''}

<h2>Changed rows (${result.changed.length})</h2>
${result.changed.length ? `<table><thead><tr><th>key</th>${result.meta.compareColumns.map((c) => `<th>${esc.html(c)}</th>`).join('')}</tr></thead><tbody>
${rows}
</tbody></table>` : '<p class="none">None</p>'}

<h2>Added (${result.added.length})</h2>
${list(result.added)}

<h2>Removed (${result.removed.length})</h2>
${list(result.removed)}

<footer>Generated by rowdiff · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC</footer>
</body>
</html>
`;
}

export function toJunit(result, { suiteName = 'csv-diff' } = {}) {
  const failures = result.summary.changed;
  const tests = Math.max(1, result.summary.matched + result.summary.added + result.summary.removed);
  const cases = [];

  for (const ch of result.changed) {
    const keyStr = result.meta.keys
      ? result.meta.keys.map((k) => `${k}=${ch.key?.[k]}`).join(' ')
      : `row ${ch.key?.row}`;
    const detail = ch.changes.map((c) => `${c.column}: ${JSON.stringify(c.left)} -> ${JSON.stringify(c.right)}`).join('\n');
    cases.push(
      `    <testcase classname="${esc.xml(suiteName)}" name="${esc.xml(`changed ${keyStr}`)}">\n` +
      `      <failure message="${esc.xml(detail.split('\n')[0])}">${esc.xml(detail)}</failure>\n` +
      `    </testcase>`,
    );
  }
  for (const a of result.added) {
    cases.push(`    <testcase classname="${esc.xml(suiteName)}" name="${esc.xml(`added ${keyLabel(a, result.meta.keys)}`)}"/>`);
  }
  for (const r of result.removed) {
    cases.push(`    <testcase classname="${esc.xml(suiteName)}" name="${esc.xml(`removed ${keyLabel(r, result.meta.keys)}`)}"/>`);
  }
  if (cases.length === 0) cases.push(`    <testcase classname="${esc.xml(suiteName)}" name="no differences"/>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="rowdiff" tests="${tests}" failures="${failures}">
  <testsuite name="${esc.xml(suiteName)}" tests="${tests}" failures="${failures}">
${cases.join('\n')}
  </testsuite>
</testsuites>
`;
}

const SARIF_LEVEL = { changed: 'error', removed: 'warning', added: 'note' };

export function toSarif(result, { uri = 'left.csv' } = {}) {
  const results = [];

  for (const ch of result.changed) {
    for (const c of ch.changes) {
      const keyStr = result.meta.keys
        ? result.meta.keys.map((k) => `${k}=${ch.key?.[k]}`).join(' ')
        : `row ${ch.key?.row}`;
      results.push({
        ruleId: 'changed-cell',
        level: 'error',
        message: {
          text: `${keyStr}: column "${c.column}" changed from ${JSON.stringify(c.left)} to ${JSON.stringify(c.right)}` +
            (c.kind === 'number' ? ` (delta ${fmtDelta(c.delta)})` : ''),
        },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri },
            region: { startLine: (Number(ch.key?.row) || 1) + 1 },
          },
        }],
        properties: { key: ch.key, column: c.column, before: c.left, after: c.right },
      });
    }
  }

  for (const [kind, entries] of [['removed', result.removed], ['added', result.added]]) {
    for (const e of entries) {
      results.push({
        ruleId: kind === 'removed' ? 'removed-row' : 'added-row',
        level: SARIF_LEVEL[kind],
        message: { text: `${kind} row: ${keyLabel(e, result.meta.keys)}` },
        locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }],
        properties: { key: e.key },
      });
    }
  }

  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'rowdiff',
          informationUri: 'https://github.com/rowdiff/rowdiff',
          rules: [
            { id: 'changed-cell', name: 'ChangedCell', shortDescription: { text: 'A cell changed between the two files' } },
            { id: 'added-row', name: 'AddedRow', shortDescription: { text: 'A row exists only in the right file' } },
            { id: 'removed-row', name: 'RemovedRow', shortDescription: { text: 'A row exists only in the left file' } },
          ],
        },
      },
      results,
    }],
  }, null, 2) + '\n';
}

export const FREE_FORMATS = ['text', 'json', 'csv'];
export const PRO_FORMATS = ['md', 'markdown', 'html', 'junit', 'sarif'];

export function render(format, result, opts = {}) {
  switch (format) {
    case 'text': return toText(result);
    case 'json': return toJson(result);
    case 'csv': return toCsv(result);
    case 'md':
    case 'markdown': return toMarkdown(result);
    case 'html': return toHtml(result, opts);
    case 'junit': return toJunit(result, opts);
    case 'sarif': return toSarif(result, opts);
    default: throw new Error(`Unknown report format "${format}". Known: ${[...FREE_FORMATS, ...PRO_FORMATS].join(', ')}`);
  }
}
