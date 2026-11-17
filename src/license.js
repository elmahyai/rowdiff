// Offline license verification.
//
// A license key is: ROWDIFF.<base64url(payload)>.<base64url(ed25519 signature)>
// Dots, not dashes: base64url uses "-" as a character, so a dash separator would make
// every key containing one ambiguous to parse.
// The payload is JSON {v:1, id, email, plan, issued, expires?}. Only the private key
// can mint one; the public key below ships in the package, so verification works with
// no network call and no license server to keep alive.
//
// Pro is a convenience gate, not DRM: the source is readable, and someone determined
// can patch it. That is the correct trade for a 29 EUR tool - honest customers get a
// smooth experience, and we never have to run a licensing backend.

import { createPublicKey, verify } from 'node:crypto';

export const LICENSE_PREFIX = 'ROWDIFF';

// Replace with the output of `node tools/keygen.mjs` before publishing.
export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMGMB6UmIXF/oVdsI/t4m0FwGwmL7KyTGgUhgpdwHJ2k=
-----END PUBLIC KEY-----`;

const B64URL = /^[A-Za-z0-9_-]+$/;

function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function parseLicense(key) {
  if (typeof key !== 'string') return { valid: false, reason: 'no key' };
  const trimmed = key.trim().replace(/\s+/g, '');
  const parts = trimmed.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed key' };
  const [prefix, payloadPart, sigPart] = parts;
  if (prefix !== LICENSE_PREFIX) return { valid: false, reason: 'not a rowdiff key' };
  if (!B64URL.test(payloadPart) || !B64URL.test(sigPart)) {
    return { valid: false, reason: 'malformed key' };
  }
  return { valid: true, payloadPart, sigPart, key: trimmed };
}

export function verifyLicense(key, publicKeyPem = PUBLIC_KEY_PEM) {
  const parsed = parseLicense(key);
  if (!parsed.valid) return parsed;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(parsed.payloadPart).toString('utf8'));
  } catch {
    return { valid: false, reason: 'unreadable payload' };
  }

  let ok = false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    ok = verify(
      null,
      Buffer.from(parsed.payloadPart, 'utf8'),
      publicKey,
      b64urlDecode(parsed.sigPart),
    );
  } catch {
    return { valid: false, reason: 'signature check failed' };
  }
  if (!ok) return { valid: false, reason: 'signature does not match' };

  if (payload.expires) {
    const exp = Date.parse(payload.expires);
    if (Number.isFinite(exp) && Date.now() > exp) {
      return { valid: false, reason: `license expired on ${payload.expires}`, payload };
    }
  }

  return {
    valid: true,
    payload,
    plan: payload.plan || 'pro',
    email: payload.email,
    id: payload.id,
    key: parsed.key,
  };
}

// Resolution order matters: env var wins so CI can inject a key as a secret without
// writing to disk, then the config file, then a local .rowdiff-license file.
export function resolveLicense({ env = process.env, readFile = null } = {}) {
  const fromEnv = env.ROWDIFF_LICENSE;
  if (fromEnv) return verifyLicense(fromEnv);

  if (readFile) {
    for (const file of licenseSearchPaths(env)) {
      let contents;
      try {
        contents = readFile(file);
      } catch {
        continue;
      }
      if (!contents) continue;
      const result = verifyLicense(contents);
      if (result.valid) return { ...result, source: file };
      return { ...result, source: file };
    }
  }
  return { valid: false, reason: 'no license found' };
}

export function licenseSearchPaths(env = process.env) {
  const paths = [];
  const home = env.HOME || env.USERPROFILE;
  if (home) paths.push(`${home}/.rowdiff-license`);
  paths.push('.rowdiff-license');
  return paths;
}
