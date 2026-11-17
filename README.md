# rowdiff

Diff and reconcile CSV files **by a key column** — not by line number.

Line-based diff tools compare line 3 to line 3. Real exports don't work that way: rows are
inserted, deleted, re-sorted, and timestamps change. `rowdiff` joins both files on an ID
(`invoice_id`, `sku`, `email`) and tells you what actually changed per record, with numeric
tolerances so rounding never shows up as a fake difference.

```console
$ rowdiff ledger_jan.csv ledger_feb.csv --key invoice_id
rowdiff: 5 left rows vs 5 right rows
====================================
key: invoice_id
columns: customer, amount, currency, status, updated_at

CHANGED (3)
  ~ invoice_id=INV-1002
      status: "paid" -> "overdue"
      updated_at: "2026-01-05" -> "2026-01-12"
  ~ invoice_id=INV-1004
      amount: 2750.25 -> 2750.30  (+0.05)

ADDED (1)
  + invoice_id=INV-1006

REMOVED (1)
  - invoice_id=INV-1005

summary: 1 added, 1 removed, 3 changed, 1 unchanged
```

## Install

```bash
npm install -g rowdiff
```

Zero dependencies. Node 18+. There is also a browser version at https://rowdiff.dev — same
engine, files are never uploaded.

## Usage

```
rowdiff <before.csv> <after.csv> [options]
```

| Option | What it does |
|---|---|
| `-k, --key <cols>` | Columns that identify a row. Omit to compare by position. |
| `-c, --compare <cols>` | Only compare these columns (ignore `updated_at` churn). |
| `-t, --tolerance <n>` | Absolute tolerance for numeric cells, e.g. `0.01`. |
| `-r, --relative-tolerance <f>` | Relative tolerance, e.g. `0.001` for 0.1%. |
| `--strip-currency` | Parse `€1.234,50` and `$1,234.50` as numbers. |
| `-i, --ignore-case` | Case-insensitive text comparison. |
| `--strict-types` | Never treat two values as equal numbers (keeps `007` ≠ `7`). |
| `-f, --format <fmt>` | `text`, `json`, `csv`, `md`, `html`, `junit`, `sarif`. |
| `-o, --out <file>` | Write the report to a file. |
| `--fail-on <what>` | `all`, `added`, `removed`, `changed`, `none`. |
| `--max-changed <n>` | Tolerate up to *n* changed rows before failing. |
| `--detect` | Suggest the best key column for these two files. |
| `--columns` | Print a per-column churn table. |
| `--init` | Write a starter `.rowdiff.json`. |

Run `rowdiff --help` for the full list.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No differences (or differences allowed by your policy). |
| `1` | Differences found. |
| `2` | Bad arguments, unreadable file, or a CSV parse error. |

That split is what makes it usable as a pipeline gate.

## CI

```yaml
- name: Check the export didn't drift
  run: |
    npm install -g rowdiff
    rowdiff expected/export.csv actual/export.csv -k sku -t 0.01 -f junit -o junit.xml
  env:
    ROWDIFF_LICENSE: ${{ secrets.ROWDIFF_LICENSE }}
```

The `junit` report drops straight into any CI test summary; `sarif` uploads to GitHub code
scanning so every changed cell becomes an inline annotation.

## Project config

`rowdiff --init` writes a `.rowdiff.json` that is picked up from the current directory upward,
so a repo can pin its own rules:

```json
{
  "key": ["invoice_id"],
  "compare": ["customer", "amount", "status"],
  "tolerance": 0.01,
  "ignoreCase": true,
  "failOn": "changed"
}
```

Explicit CLI flags always override the config file.

## Free and Pro

The comparison engine, the CLI core and the browser tool are free — that is not going to
change. Pro (`€29`, one-time) unlocks the report formats a team needs: `md`, `html`, `junit`,
`sarif`, plus `--detect --explain`.

```bash
rowdiff --activate ROWDIFF.xxxxx.yyyyy
rowdiff --status
```

Licenses are Ed25519-signed and verified offline; there is no license server and no phone-home.
If Pro would not pay for itself for you, email and we will send a key anyway.

## Library use

```js
import { parse, diff, toMarkdown } from 'rowdiff';

const result = diff(parse(beforeBytes), parse(afterBytes), {
  keys: ['invoice_id'],
  tolerance: 0.01,
});

console.log(result.summary.changed, 'rows changed');
console.log(toMarkdown(result));
```

## Limits worth knowing

- Both files are held in memory. Fine into the low hundreds of thousands of rows; for more,
  split the input first.
- Rows are matched on exact key text (after optional trim/case folding). Fuzzy matching of
  near-identical names like `Acme Inc` vs `ACME INC PAYMENT` is not implemented — normalise
  the key column before diffing.
- No streaming, no XLSX, no database source. CSV only, which is the point.

## Development

```bash
npm test              # engine + CLI tests
npm run build:web     # rebuild web/index.html from web/template.html
```

## License

The comparison engine and CLI core are MIT-licensed — fork it, embed it, sell a service on top.
The Pro report formats and `--detect --explain` are licensed, not sold: a key unlocks them for
the licence holder's own use. See [LICENSE](LICENSE).
