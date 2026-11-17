# rowdiff — repository notes for future sessions

Commercial product. Read `BUSINESS.md` first for the strategy and `LAUNCH.md` for the go-to-market
copy. This file is the practical "how it is built" note.

## Architecture

```
src/csv.js      RFC4180 parser, delimiter sniffing, BOM/UTF-16 decode. Browser-safe.
src/diff.js     Pure diff engine: key matching, tolerances, locale numbers. Browser-safe.
src/detect.js   Key-column scoring for --detect and the web dropdown. Browser-safe.
src/report.js   Report writers. md/html/junit/sarif are the paid surface.
src/license.js  Offline Ed25519 verification. Public key is baked in; private key stays local.
src/cli.js      Argument parsing, config merge, policy gating, exit codes. Node-only.
bin/rowdiff.mjs Entry point.
web/template.html  Source for the landing page + tool. web/index.html is GENERATED.
tools/build-web.mjs  Bundles src into web/index.html as one classic script.
tools/license.mjs    keygen / issue / verify. Requires .license-keys/private.pem.
```

## Rules that matter

- **Never edit `web/index.html` by hand.** It is generated: edit `web/template.html`, then
  `npm run build:web`.
- **Keep `src/csv.js`, `src/diff.js`, `src/detect.js`, `src/report.js` free of Node APIs.** The web
  build fails if `Buffer`, `process`, `require(` or `node:` appear in the output — that guard exists
  because a stray `fs` import once silently killed the whole browser app.
- **Do not import from `src/cli.js` in browser-bound code.** It pulls in `fs`/`process`. Shared
  logic goes in its own module (that is why `detect.js` exists).
- **Exit codes are the public contract:** 0 = no diff, 1 = diff found, 2 = usage/IO/parse error.
  Tests assert these; do not change them casually.
- **`.license-keys/private.pem` must never be committed or published.** It is gitignored and the
  web build scans for private-key patterns. Losing it means no new licences can be minted.
- Licensing is an honest convenience gate, not DRM. Do not add obfuscation or phone-home checks.

## Testing

```bash
npm test           # 41 tests: engine (test/engine.test.js) + CLI e2e (test/cli.test.js)
npm run build:web  # also asserts no Node APIs / no secrets in the bundle
```

CLI tests shell out to the real binary and mint real licensed keys using the local private key
(skipped if the key is absent). Fixtures in `test/fixtures/` are realistic exports, including a
German-formatted bank export used for the currency reconciliation test.

There is no browser automation available in this environment. Verify web changes by serving
`web/` and clicking through, or by `eval`-ing the bundled engine in Node (it is DOM-free).

## Known gaps (deliberate, do not half-build)

- No fuzzy key matching. `Acme Inc` vs `ACME INC PAYMENT` will not match. Normalise keys upstream.
- No streaming; both files are in memory. No XLSX, no database sources.
- The web app has no ARIA live region for results and no keyboard-only file picker verification.

## Product decisions already made

- One-time €29 Pro, not a subscription. Reasoning in `BUSINESS.md` §4.
- Free tier stays genuinely usable; only team-shaped glue (CI report formats, explain output) is paid.
- Zero infrastructure on purpose: no server, no account, no telemetry, works offline.
