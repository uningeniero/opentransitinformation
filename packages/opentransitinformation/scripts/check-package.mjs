// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run with npm run check:package');
const p = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8'
});
if (p.status !== 0) throw new Error(p.stderr);
const pack = JSON.parse(p.stdout)[0];
const expected = new Set([
  'LICENSE',
  'NOTICE',
  'README.md',
  'package.json',
  'dist/index.mjs',
  'dist/browser.mjs',
  'dist/node.mjs',
  'dist/cli.mjs',
  'dist/viewer.global.js',
  'dist/index.d.mts',
  'dist/node.d.mts',
  'dist/oti_engine.wasm',
  'dist/SourceSans3-Semibold.ttf',
  'dist/OFL.txt',
  'dist/THIRD_PARTY_LICENSES.txt'
]);
for (const file of pack.files) {
  if (!expected.delete(file.path)) throw new Error(`Unexpected public file: ${file.path}`);
  if (/\.(mjs|js|mts|json|md)$/.test(file.path)) {
    const text = await readFile(path.join(root, file.path), 'utf8');
    for (const pattern of [
      /C:[/\\]Users[/\\]/i,
      /npm_[A-Za-z0-9]{30,}/,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      /\bAKIA[A-Z0-9]{16}\b/
    ])
      if (pattern.test(text)) throw new Error(`Private information pattern in ${file.path}`);
  }
}
if (expected.size) throw new Error(`Missing public files: ${[...expected].join(', ')}`);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'opentransitinformation' || pkg.private || pkg.publishConfig.access !== 'public')
  throw new Error('Invalid package identity or visibility');
const license = (await readFile(path.join(root, 'LICENSE'), 'utf8')).replace(/\r\n/g, '\n');
const licenseHash = createHash('sha256').update(license).digest('hex');
if (licenseHash !== 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30')
  throw new Error('The Apache-2.0 licence must retain its unmodified official text');
console.log(
  JSON.stringify({
    name: pack.name,
    version: pack.version,
    files: pack.files.map((f) => f.path),
    size: pack.size,
    unpackedSize: pack.unpackedSize,
    integrity: pack.integrity,
    checked: true
  })
);
