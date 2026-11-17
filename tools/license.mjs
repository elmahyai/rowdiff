#!/usr/bin/env node
// License minting tool. Run this on YOUR machine only, never in CI, never commit the
// private key. Usage:
//   node tools/license.mjs keygen
//   node tools/license.mjs issue --email buyer@example.com --plan pro --days 365
//   node tools/license.mjs verify ROWDIFF.xxxxx.yyyyy

import { generateKeyPairSync, sign, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifyLicense, LICENSE_PREFIX } from '../src/license.js';

const here = dirname(fileURLToPath(import.meta.url));
const KEY_DIR = join(here, '..', '.license-keys');

const PRIVATE_KEY_PATH = join(KEY_DIR, 'private.pem');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function keygen() {
  if (existsSync(PRIVATE_KEY_PATH)) {
    console.error(`Refusing to overwrite existing key at ${PRIVATE_KEY_PATH}`);
    process.exit(1);
  }
  mkdirSync(KEY_DIR, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

  writeFileSync(PRIVATE_KEY_PATH, privPem, { mode: 0o600 });
  writeFileSync(join(KEY_DIR, 'public.pem'), pubPem, { mode: 0o644 });

  console.log(`wrote ${PRIVATE_KEY_PATH} (chmod 600, NEVER commit)`);
  console.log(`wrote ${join(KEY_DIR, 'public.pem')}\n`);
  console.log('Paste this into PUBLIC_KEY_PEM in src/license.js:\n');
  console.log(pubPem);
}

function getArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const name = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[name] = true;
      else {
        out[name] = next;
        i++;
      }
    }
  }
  return out;
}

function issue(args) {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error(`No private key at ${PRIVATE_KEY_PATH}. Run: node tools/license.mjs keygen`);
    process.exit(1);
  }
  const email = args.email;
  if (!email || email === true) {
    console.error('--email is required');
    process.exit(1);
  }
  const plan = args.plan && args.plan !== true ? args.plan : 'pro';
  const days = args.days && args.days !== true ? Number(args.days) : 365;

  const issued = new Date();
  const payload = {
    v: 1,
    id: `rd_${issued.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    email: String(email),
    plan,
    issued: issued.toISOString().slice(0, 10),
  };
  if (Number.isFinite(days) && days > 0) {
    payload.expires = new Date(issued.getTime() + days * 86400_000).toISOString().slice(0, 10);
  }

  const payloadPart = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const privateKey = createPrivateKey(readFileSync(PRIVATE_KEY_PATH));
  const sigPart = b64url(sign(null, Buffer.from(payloadPart, 'utf8'), privateKey));
  const key = `${LICENSE_PREFIX}.${payloadPart}.${sigPart}`;

  const publicPem = readFileSync(join(KEY_DIR, 'public.pem'), 'utf8');
  const check = verifyLicense(key, publicPem);
  if (!check.valid) {
    console.error('Self-check failed, not issuing:', check.reason);
    process.exit(1);
  }

  console.log(key);
  console.error(`\n${plan} · ${email} · expires ${payload.expires || 'never'} · id ${payload.id}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = getArgs(rest);

if (cmd === 'keygen') keygen();
else if (cmd === 'issue') issue(args);
else if (cmd === 'verify') {
  const result = verifyLicense(rest[0]);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
} else {
  console.log(`Usage:
  node tools/license.mjs keygen
  node tools/license.mjs issue --email buyer@example.com [--plan pro] [--days 365]
  node tools/license.mjs verify <KEY>`);
  process.exit(cmd ? 1 : 0);
}
