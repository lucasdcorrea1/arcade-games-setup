'use strict';

// Purchase codes for "Turbine seu fliperama". The private key lives only on
// the seller's PC (%USERPROFILE%\.arcade-do-zero), never in this repository;
// the app carries the public key (src/license.js) and can check a code but
// never make one.
//   node scripts/license-tool.js init          make the key pair (once)
//   node scripts/license-tool.js new "Nome"    a new code for a customer
//   node scripts/license-tool.js check <code>  is this code ours?

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const license = require('../src/license');

const DIR = path.join(os.homedir(), '.arcade-do-zero');
const PRIVATE = path.join(DIR, 'license-private.pem');
const LOG = path.join(DIR, 'codigos-vendidos.csv');

function init() {
  if (fs.existsSync(PRIVATE)) {
    console.log('Já existe uma chave em', PRIVATE, '(não sobrescrevi).');
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(PRIVATE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  console.log('Chave criada em', PRIVATE);
  console.log('Chave pública (vai em src/license.js):', raw);
}

function make(name) {
  const key = crypto.createPrivateKey(fs.readFileSync(PRIVATE));
  const code = license.issue(key);
  const info = license.verify(code);
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, 'data;cliente;serie;codigo\n');
  fs.appendFileSync(LOG, `${new Date().toISOString().slice(0, 10)};${String(name || '').replace(/;/g, ',')};${info.serial};${code}\n`);
  return code;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'init') init();
else if (cmd === 'new') console.log(make(arg));
else if (cmd === 'check') console.log(JSON.stringify(license.verify(arg || '')));
else console.log('uso: init | new "Nome do cliente" | check <codigo>');
