import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const parts = [];
for (let i = 0; i < 5; i++) {
  const path = new URL(`./bundle.part.0${i}`, import.meta.url);
  parts.push(fs.readFileSync(path, 'utf8').trim());
}
const encoded = parts.join('');
const digest = crypto.createHash('sha256').update(encoded).digest('hex');
const expected = '5d14f03c858a5f0dfdbddb846a52e0a385872d95866a428a1070a4237fab82a6';
if (digest !== expected) throw new Error(`Bundle checksum mismatch: ${digest}`);
fs.writeFileSync('runtime.tgz', Buffer.from(encoded, 'base64'));
execFileSync('tar', ['-xzf', 'runtime.tgz', '-C', '.'], { stdio: 'inherit' });
fs.unlinkSync('runtime.tgz');
console.log('LEGAT_RUNTIME_BOOTSTRAP_OK', digest);
