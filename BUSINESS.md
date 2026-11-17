# Business plan: rowdiff

Written by the agent, for the owner. Read this first — including the parts you may not want to hear.

---

## 1. The honest constraint

You asked for a system that earns 20–100 EUR/month completely independently, where you do nothing.
That request contains a contradiction I need to state plainly, because pretending otherwise would be
worse than useless.

**What an agent can do unsupervised, forever:**

- Design and build the product. (Done — see below.)
- Write and run the test suite. (Done — 41 tests.)
- Fix bugs it finds.
- Draft every piece of copy, docs, changelog, and release note.
- Prepare the whole launch, so each remaining step is one click.

**What an agent fundamentally cannot do:**

| Thing | Why not |
|---|---|
| Receive money | Stripe / Lemon Squeezy / Paddle require identity verification (ID, address, bank account, tax ID). That is a legal person, not a program. |
| Publish to npm | `npm publish` needs an account token tied to a verified email; the first publish also needs email confirmation. |
| Register a domain | Needs a payment method and ICANN registrant contact. |
| Post to a community | Needs an account, and posting promotional content from a bot gets banned — correctly. |
| Provide support to a paying customer | Someone must answer within a day, or the product earns refunds and a bad name. |

So the truthful shape is: **I build and maintain the asset; you spend about 90 minutes once on the
irreducible human steps, and about 15 minutes a month afterwards.** Everything else in this repo is
already done. Section 6 is that checklist.

A bot that quietly claims it is making money while no money arrives would be lying to you. This
document exists so that doesn't happen.

---

## 2. What was built and why this product

**`rowdiff` — diff and reconcile CSV files by a key column.**

I chose it against the obvious alternatives deliberately:

| Candidate | Why rejected |
|---|---|
| AI SaaS wrapper | Needs an API key with ongoing cost, a server, and a signup flow. Every unit sold costs money and can be abused. |
| Habit/tracker app | Crowded to the point of invisibility; monetisation is ads, which needs traffic, which needs marketing. |
| Niche B2B web app | Needs hosting, database, auth, GDPR posture, and sales. On-call duty for a one-person op is a liability. |
| **CSV diff tool** | **Zero marginal cost. Zero servers. Works offline. Distributed free through npm search and organic search. Two distinct buyer groups. Boring, durable demand.** |

The key property: **it earns money without running infrastructure**. No server means no bills, no
outages, no breach, no on-call. A €29 sale is €29 minus ~5% payment fees — not a subsidy.

Why anyone pays, honestly: the free tier is genuinely sufficient for a hobbyist. The paid tier
targets two groups with money and a specific pain:

1. **Data engineers** — they need a diff in CI, as JUnit or SARIF, gating a pipeline. They are not
   price-sensitive at €29 and they expense it without thinking.
2. **Finance / ops / bookkeeping** — reconciling a bank export against a ledger, or two ERP exports.
   High-value, low-volume, non-technical, and the one-off price fits how they buy software.

## 3. What's in the box

| Piece | State |
|---|---|
| CSV parser (RFC4180, quoting, CRLF, BOM, UTF-16, delimiter sniffing) | Done, tested |
| Diff engine (key matching, duplicate keys, per-cell change, tolerances, locale numbers) | Done, tested |
| Key-column detection (`--detect`) | Done, tested |
| Report writers: text, JSON, CSV (free); Markdown, HTML, JUnit, SARIF (Pro) | Done, tested |
| CLI with exit codes 0/1/2, config file, policy gating, 30+ flags | Done, tested |
| Offline Ed25519 licence system (keygen, issue, verify, activate) | Done, tested |
| Static browser app, single file, no network requests | Done, verified in a real browser |
| 41 automated tests | Passing |
| README, LICENCE, launch copy | Done |

Deliberately **not** built, because each would have been a distraction from shipping something
that works: fuzzy key matching, XLSX support, a hosted service, accounts, analytics.

---

## 4. Revenue maths, without optimism

Target: 20–100 EUR/month.

| Scenario | Sales/month | Price | Revenue | Verdict |
|---|---|---|---|---|
| Floor (one blog mention) | 1 | €29 | €29 | **Hits the lower target** |
| Modest (npm listing + a few search hits) | 2–3 | €29 | €58–87 | **Hits target** |
| Bad (nobody finds it) | 0 | — | €0 | Requires section 6 to be done |

One-time pricing means revenue decays unless new people arrive — that is a real weakness, and it is
the correct trade for this product: subscriptions for a small CLI generate churn and support load
that a solo operator cannot service.

**Break-even against my cost:** at €29 net of ~5% fees, roughly one sale a month covers a €20–30
subscription. Two sales a month does what you asked for.

**Honest probability:** with the launch steps in section 6 done, I estimate a decent chance of
20–100 EUR/month within a few months, mostly from search traffic to the free browser tool. Without
those steps, the chance is close to zero — a package nobody can find earns nothing. I cannot
honestly promise the revenue; I can promise the product is real, tested, and priced correctly.

---

## 5. The funnel, and why the free tier is generous on purpose

```
someone searches "compare two csv files by column"
        ↓   (free browser tool, no signup, no upload)
   it works, they bookmark it
        ↓   (they hit something the free tier won't do: a CI report, an HTML report)
   npm install -g rowdiff
        ↓   (Pro report format refused with a one-line message)
   €29
```

The free tier is not crippled, because a crippled free tool does not spread. What is behind the
paywall is exactly the awkward glue that a team needs and a hobbyist does not: report formats for CI
and email, and key-detection explanations.

Critically: the refusal message is helpful, not hostile. It names the free alternatives and gives a
working path. A blocked developer who gets a clear error message converts; one who hits a nag screen
uninstalls.

---

## 6. What only you can do (≈90 minutes, once)

Ordered so that if you stop after step 2, the free tool is still live and valuable.

**Step 1 — check it yourself (5 min).**
```bash
cd /projects/money
npm test                     # should print: pass 41
npm run build:web
node bin/rowdiff.mjs test/fixtures/ledger_before.csv test/fixtures/ledger_after.csv -k invoice_id
```

**Step 2 — put the free web tool online (15 min, €0).**
1. Create a GitHub repo named `rowdiff` under your account.
2. Push this directory to it.
3. Repo → Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/web`.
4. The tool is live at `https://<username>.github.io/rowdiff/` — free forever, no server.

**Step 3 — publish the CLI (10 min, €0).**
1. `npm login` (create a free npm account if needed).
2. `npm publish` — the name `rowdiff` was confirmed free at time of writing.
3. Optional: buy `rowdiff.dev` (~€12/yr) and point it at the Pages site for the polish.

**Step 4 — turn on payments (20 min).**
1. Create a Lemon Squeezy or Paddle account (they act as merchant of record, so they handle EU VAT
   and sales tax for you — do not try to do this with raw Stripe unless you want VAT filings).
2. Create a product: "rowdiff Pro", **one-time**, €29.
3. Note the checkout URL; send it to me and I will wire it into every message and page.
4. When a sale happens, mint the key:
   ```bash
   node tools/license.mjs issue --email buyer@example.com --days 3650
   ```
   Paste the output into the buyer's delivery email. **Keep `.license-keys/private.pem` backed up
   and off GitHub** — without it you cannot issue keys, and with it leaked anyone can mint them.

**Step 5 — the part I cannot do for you (20 min).** Three honest posts, written by a human, not
spam: a Show HN, a relevant subreddit (`r/dataengineering`, `r/Accounting`, `r/excel`), and a short
note wherever your own network is. Lead with the free browser tool, mention Pro once, and never
mass-post. This is the single highest-leverage step and the only one that must be a person.

**Ongoing, ~15 min/month:** answer support email, mint keys for sales, and tell me about the bugs.

---

## 7. What happens on your subscription ending

The asset is not dependent on me. It is a zero-dependency Node package plus one HTML file, both
readable, with a test suite that documents the intended behaviour. Any developer — or a future
session — can maintain it. The licence keypair is the only thing you must not lose.

The honest risk is not technical failure. It is that nobody finds the tool. That is why step 5 is in
this document rather than quietly omitted.
