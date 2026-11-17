# Launch kit

Copy-paste ready. Replace `YOURNAME`, `YOUR-CHECKOUT-URL`, and `hello@rowdiff.dev` before using.

---

## 1. npm package description (already in package.json)

> Diff and reconcile CSV files by key column: added, removed and changed rows, with tolerances, CI
> reports and a local-first web app.

First sentence matters most — it is what shows in `npm search`.

---

## 2. Hacker News — Show HN

**Title** (80 char limit; this one is 68):

```
Show HN: Rowdiff – compare two CSVs by a key column, not by line number
```

**Body:**

```
I kept hitting the same wall: a line-based diff of two CSV exports is useless. One
inserted row and every line below it looks changed. What I actually wanted to know was
"for invoice INV-1004, what changed?".

rowdiff joins both files on a key column and reports per-field changes. Numeric columns
get a tolerance, so 2750.25 -> 2750.30 is a 0.05 drift you can allow rather than three
"changed" rows.

A few details that took more work than I expected:
- RFC4180 quoting, CRLF, BOM, UTF-16, and delimiter sniffing (semicolon exports are common
  in Europe).
- Duplicate keys pair up in file order instead of collapsing to last-one-wins.
- Leading-zero codes stay text: "007" and "7" are different, even with a numeric tolerance.
- "€1.234,50" and "$1,234.50" both parse to 1234.5, disambiguated by which separator is
  rightmost.

Two ways to use it: a browser tool at the link (single HTML file, no upload, works offline)
and a zero-dependency CLI. Exit codes are 0/1/2 so it works as a CI gate, with JUnit and
SARIF output.

The engine is MIT. The CI report formats are the paid part (€29 once) — that is the whole
business model, no subscription. If it is not worth €29 to you, the free tool is not
crippled, and I will send a key to anyone who genuinely cannot afford it.

Would especially like to hear where the key matching breaks on your data — fuzzy matching of
"Acme Inc" vs "ACME INC PAYMENT" is the obvious next thing and I have not built it.
```

**Why this framing:** it leads with the problem, admits a limitation, and asks a real question.
Flagging the missing feature up front is what keeps the thread constructive instead of hostile.

---

## 3. Reddit — r/dataengineering

**Title:**

```
I built a CSV diff that matches rows by key instead of line number (free browser tool + CLI)
```

**Body:**

```
Posting because I assume others here have also been asked "did anything change in the
nightly export?" and had no good answer.

[diff tool] — joins two CSVs on a key column, reports added/removed/changed per field.

The bits aimed at this sub specifically:
- exit codes 0/1/2, so `--fail-on changed` works as a pipeline gate
- `-f junit` for a test summary, `-f sarif` for inline annotations in the GitHub diff view
- `-c` to whitelist columns, so `updated_at` churn does not fail the build
- `-t 0.01` for float/rounding noise
- `--detect` to guess the key column and print the command to run

Zero dependencies, Node 18+. Engine is MIT. CI report formats are the paid bit (€29 once).
No account, no telemetry, and the browser version does not upload anything — you can check
the network tab.

Genuine question for people running this in CI: is JUnit or SARIF more useful in practice? I
defaulted to JUnit because it shows up in every CI UI, but SARIF is better for review.
```

**For r/Accounting** — different angle, no CLI talk:

```
Reconciling two exports without Excel gymnastics

If you ever need to prove what changed between two exports (bank statement vs ledger, this
month's supplier list vs last month's), this does it in the browser: pick the column that
identifies a row, and it shows which records were added, removed, or had a field changed.

It handles European amounts (1.234,50) and has an amount tolerance, so a 1-cent rounding
difference does not show up as a discrepancy.

Free, nothing is uploaded, no account. Not trying to sell anything here — the paid version
is aimed at developers doing this in CI, not at accountants.
```

---

## 4. Checkout product description (Lemon Squeezy / Paddle)

**Product name:** rowdiff Pro

**Short description:**

> Unlock the report formats a team needs: JUnit and SARIF for CI, HTML and Markdown for humans.
> One payment, yours to keep.

**Long description:**

```
rowdiff Pro is a one-time licence for the parts of rowdiff that a team needs.

You get:
  • JUnit XML reports      — shows up in GitHub Actions, GitLab, Jenkins, Buildkite
  • SARIF reports          — inline annotations in GitHub code scanning
  • HTML reports           — one self-contained file you can email to someone who does not
                             use a terminal
  • Markdown reports       — paste straight into a PR comment or a ticket
  • --detect --explain     — why a column was scored as the best key

You keep:
  • the free tier, unchanged and free forever
  • offline verification — no licence server, no phone-home, no data collected
  • use on any number of machines in your organisation

€29, once. No subscription. No seat counting beyond your organisation.

Cannot afford it? Email hello@rowdiff.dev and I will send you a key. That is a standing
offer, not a marketing line.
```

**Delivery email template:**

```
Thanks for buying rowdiff Pro.

Your licence key:

  YOUR-KEY-HERE

To activate it on a machine:

  npm install -g rowdiff
  rowdiff --activate YOUR-KEY-HERE

Or set it in CI:

  ROWDIFF_LICENSE=YOUR-KEY-HERE rowdiff before.csv after.csv -k id -f junit -o junit.xml

The key is verified offline — it does not contact any server, and it does not expire in a way
that will break a build. Any number of machines in your organisation is fine.

If anything does not work, reply to this email. It goes to a person.
```

---

## 5. Search terms the free tool should rank for

Long-tail, low-competition, and each maps to a real person's query. The landing page already
targets the first three in its title, H1, and FAQ.

- compare two csv files by column
- csv diff by id / csv diff key column
- reconcile bank statement with ledger csv
- compare two erp exports
- csv diff tolerance
- csv diff ci pipeline
- junit report csv comparison
- sarif csv

One sentence of advice: do not add a blog with thin AI-written posts. It will not rank, and it
looks like what it is. The free tool ranking is the whole strategy.

---

## 6. Before you post anywhere

- [ ] `npm test` passes (41 tests)
- [ ] Free browser tool deployed and tested on your own CSV files
- [ ] Package published, `npm install -g rowdiff` works on a clean machine
- [ ] Checkout link live, and you have tested a real €29 purchase end-to-end
- [ ] You can mint and deliver a key in under two minutes
- [ ] `.license-keys/private.pem` backed up, **not** in the repo
- [ ] `hello@rowdiff.dev` (or your address) actually receives mail
- [ ] You have personally used it on a file that matters to you — you cannot answer questions
      about a tool you have not used
