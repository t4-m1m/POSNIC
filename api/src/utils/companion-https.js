'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const net = require('net');

function derLength(length) {
  if (length < 128) return Buffer.from([length]);
  const bytes = [];
  for (let n = length; n; n = Math.floor(n / 256)) bytes.unshift(n & 255);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag, value) { return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]); }
function sequence(...values) { return tlv(0x30, Buffer.concat(values)); }
function setOf(...values) { return tlv(0x31, Buffer.concat(values)); }
function objectIdentifier(value) {
  const parts = value.split('.').map(Number), bytes = [40 * parts[0] + parts[1]];
  parts.slice(2).forEach(part => {
    const encoded = [part & 0x7f];
    for (let n = Math.floor(part / 128); n; n = Math.floor(n / 128)) encoded.unshift((n & 0x7f) | 0x80);
    bytes.push(...encoded);
  });
  return tlv(0x06, Buffer.from(bytes));
}
function integer(value) {
  let bytes = Buffer.isBuffer(value) ? value : Buffer.from([value]);
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}
function bitString(value, unusedBits = 0) { return tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), value])); }
function octetString(value) { return tlv(0x04, value); }
function ascii(tag, value) { return tlv(tag, Buffer.from(value, 'ascii')); }
function extension(oid, value, critical = false) {
  return sequence(objectIdentifier(oid), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), octetString(value));
}
function ipBytes(address) {
  if (net.isIP(address) === 4) return Buffer.from(address.split('.').map(Number));
  if (net.isIP(address) !== 6) return null;
  let value = address.toLowerCase().split('%')[0];
  const halves = value.split('::');
  const parse = side => side ? side.split(':').filter(Boolean).flatMap(part => {
    if (part.includes('.')) {
      const b = part.split('.').map(Number);
      return [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
    }
    return [parseInt(part, 16)];
  }) : [];
  const left = parse(halves[0]), right = parse(halves[1] || '');
  const words = halves.length === 2 ? left.concat(new Array(Math.max(0, 8 - left.length - right.length)).fill(0), right) : left;
  if (words.length !== 8 || words.some(n => !Number.isFinite(n))) return null;
  const bytes = Buffer.alloc(16);
  words.forEach((word, index) => bytes.writeUInt16BE(word, index * 2));
  return bytes;
}
function certificateNames() {
  const names = new Set(['DNS:localhost', 'DNS:samarina-posnic.local', 'IP:127.0.0.1']);
  const host = String(os.hostname() || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (host) names.add('DNS:' + host + '.local');
  Object.values(os.networkInterfaces()).flat().filter(Boolean).forEach(entry => {
    if (entry.internal) return;
    if (net.isIP(entry.address) === 4) names.add('IP:' + entry.address);
    else if (net.isIP(entry.address) === 6 && !entry.address.toLowerCase().startsWith('fe80:')) names.add('IP:' + entry.address.split('%')[0]);
  });
  return [...names].sort();
}
function sanValue(names) {
  return sequence(...names.map(name => {
    const [kind, value] = name.split(':', 2);
    return kind === 'IP' ? tlv(0x87, ipBytes(value)) : tlv(0x82, Buffer.from(value, 'ascii'));
  }));
}
function distinguishedName(commonName) {
  return sequence(setOf(sequence(objectIdentifier('2.5.4.3'), tlv(0x0c, Buffer.from(commonName, 'utf8')))));
}
function pem(label, der) {
  return '-----BEGIN ' + label + '-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END ' + label + '-----\n';
}
function createCertificate(names) {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' });
  const signatureAlgorithm = sequence(objectIdentifier('1.2.840.113549.1.1.11'), tlv(0x05, Buffer.alloc(0)));
  const time = date => ascii(0x17, date.toISOString().slice(2, 19).replace(/[-:T]/g, '') + 'Z');
  const now = Date.now(), subject = distinguishedName('Samarina POSNIC Companion');
  const extensions = sequence(
    extension('2.5.29.19', sequence(tlv(0x01, Buffer.from([0xff]))), true),
    extension('2.5.29.15', bitString(Buffer.from([0xa6]), 1), true),
    extension('2.5.29.37', sequence(objectIdentifier('1.3.6.1.5.5.7.3.1'))),
    extension('2.5.29.17', sanValue(names)),
    extension('2.5.29.14', octetString(crypto.createHash('sha1').update(publicKey).digest()))
  );
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f;
  const tbs = sequence(
    tlv(0xa0, integer(2)), integer(serial), signatureAlgorithm, subject,
    sequence(time(new Date(now - 86400000)), time(new Date(now + 5 * 365 * 86400000))),
    subject, publicKey, tlv(0xa3, extensions)
  );
  const signature = crypto.sign('sha256', tbs, keys.privateKey);
  return { key: privateKey, cert: pem('CERTIFICATE', sequence(tbs, signatureAlgorithm, bitString(signature))) };
}
function certificatePath(userDataPath) {
  return path.join(userDataPath || process.env.POSNIC_USER_DATA_PATH || os.tmpdir(), 'samarina-companion', 'https-cert.pem');
}
function loadOrCreateCertificate(userDataPath) {
  const folder = path.dirname(certificatePath(userDataPath));
  const certPath = certificatePath(userDataPath), keyPath = path.join(folder, 'https-key.pem'), metaPath = path.join(folder, 'https-san.json');
  const names = certificateNames();
  try {
    const previous = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
    if (Array.isArray(previous.names) && names.every(name => previous.names.includes(name)) && Date.parse(cert.validTo) > Date.now() + 30 * 86400000) {
      return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath), certPath };
    }
  } catch (_) {}
  fs.mkdirSync(folder, { recursive: true });
  const generated = createCertificate(names);
  fs.writeFileSync(keyPath, generated.key, { mode: 0o600 });
  fs.writeFileSync(certPath, generated.cert, { mode: 0o644 });
  fs.writeFileSync(metaPath, JSON.stringify({ names, generatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return { cert: generated.cert, key: generated.key, certPath };
}
async function start(app, options = {}) {
  const userDataPath = options.userDataPath || process.env.POSNIC_USER_DATA_PATH;
  const material = loadOrCreateCertificate(userDataPath);
  const preferred = Number(options.preferredPort || process.env.POSNIC_COMPANION_HTTPS_PORT || (Number(process.env.PORT || 5555) + 1));
  let lastError;
  for (let offset = 0; offset < 8; offset++) {
    const port = preferred + offset;
    const server = https.createServer({ key: material.key, cert: material.cert }, app);
    server.requestTimeout = 30000;
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.removeListener('listening', resolve); reject(error); };
        server.once('error', onError);
        server.once('listening', () => { server.removeListener('error', onError); resolve(); });
        server.listen(port, '0.0.0.0');
      });
      process.env.POSNIC_COMPANION_HTTPS_PORT = String(port);
      server.companionHttpsPort = port;
      server.companionCertificatePath = material.certPath;
      return server;
    } catch (error) {
      lastError = error;
      try { server.close(); } catch (_) {}
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw lastError || new Error('No free local HTTPS port for Samarina Companion.');
}
module.exports = { start, certificatePath, certificateNames, loadOrCreateCertificate };
