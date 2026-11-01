'use strict';

// Purchase codes for "Turbine seu fliperama": 8 bytes (format, product, day
// issued, serial) signed with Ed25519, written in base32 groups so they
// survive WhatsApp. The app only holds the public key: it checks a code and
// never makes one (scripts/license-tool.js does, on the seller's PC).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_KEY_RAW = 'fAhRPUXya2m8nbllan4+cNuai0c0IuTk5M+N82MZZFk=';
const FORMAT = 1;
const PRODUCT_TURBINAR = 1;
const EPOCH = Date.UTC(2026, 0, 1);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no I, O, 0, 1: nothing to misread

function publicKey() {
  // raw 32-byte Ed25519 key -> SPKI DER (fixed 12-byte prefix)
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(PUBLIC_KEY_RAW, 'base64')]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decode(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function clean(code) {
  // people paste with spaces, line breaks, lowercase, the ADZ- prefix or not
  return String(code || '').toUpperCase().replace(/^\s*ADZ[-\s]*/, '').replace(/[^A-Z0-9]/g, '');
}

function format(raw) {
  return 'ADZ-' + raw.match(/.{1,6}/g).join('-');
}

// Made only by license-tool.js, with the private key.
function issue(privateKey) {
  const body = Buffer.alloc(8);
  body[0] = FORMAT;
  body[1] = PRODUCT_TURBINAR;
  body.writeUInt16BE(Math.floor((Date.now() - EPOCH) / 86400000), 2);
  crypto.randomBytes(4).copy(body, 4);
  const sig = crypto.sign(null, body, privateKey);
  return format(encode(Buffer.concat([body, sig])));
}

// { ok, serial, issued } or { ok: false, reason }
function verify(code) {
  const buf = decode(clean(code));
  if (!buf || buf.length < 72) return { ok: false, reason: 'Código incompleto. Copie a mensagem inteira que você recebeu.' };
  const body = buf.subarray(0, 8), sig = buf.subarray(8, 72);
  let good = false;
  try { good = crypto.verify(null, body, publicKey(), sig); } catch { good = false; }
  if (!good || body[0] !== FORMAT || body[1] !== PRODUCT_TURBINAR) {
    return { ok: false, reason: 'Esse código não é válido. Confira se copiou certinho.' };
  }
  const issued = new Date(EPOCH + body.readUInt16BE(2) * 86400000).toISOString().slice(0, 10);
  return { ok: true, serial: body.subarray(4, 8).toString('hex'), issued };
}

// The activated code is kept in the app's data folder.
function store(dir) {
  const file = path.join(dir, 'turbinar-license.json');
  return {
    get() {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        const v = verify(saved.code);
        return v.ok ? { ...v, code: saved.code } : null;
      } catch { return null; }
    },
    set(code) {
      const v = verify(code);
      if (!v.ok) return v;
      const tidy = format(clean(code));
      fs.writeFileSync(file, JSON.stringify({ code: tidy, activatedAt: new Date().toISOString() }));
      return { ...v, code: tidy };
    }
  };
}

module.exports = { issue, verify, store };
