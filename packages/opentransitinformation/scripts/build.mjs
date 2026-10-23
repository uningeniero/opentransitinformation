// SPDX-License-Identifier: Apache-2.0
import { build } from 'esbuild';
import { readFile, writeFile, copyFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const repo = path.resolve(root, '../..');
const tools = path.join(repo, '.tools');
const env = {
  ...process.env,
  RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(tools, 'rustup'),
  CARGO_HOME: process.env.CARGO_HOME || path.join(tools, 'cargo')
};
let cargo =
  process.env.OTI_CARGO ||
  path.join(env.CARGO_HOME, 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
try {
  await stat(cargo);
} catch {
  cargo = 'cargo';
  if (!process.env.RUSTUP_HOME) delete env.RUSTUP_HOME;
  if (!process.env.CARGO_HOME) delete env.CARGO_HOME;
}
env.RUSTFLAGS = ((process.env.RUSTFLAGS || '') + ' --remap-path-prefix=' + repo + '=oti').trim();
const result = spawnSync(
  cargo,
  [
    'build',
    '--manifest-path',
    path.join(repo, 'core/oti-engine/Cargo.toml'),
    '--release',
    '--target',
    'wasm32-unknown-unknown'
  ],
  { env, encoding: 'utf8', stdio: 'inherit' }
);
if (result.status !== 0) throw new Error('Rust/WASM build failed');
await mkdir(path.join(root, 'dist'), { recursive: true });
const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  target: 'es2022',
  logLevel: 'warning',
  external: ['node:fs/promises', 'node:worker_threads']
};
await build({
  ...common,
  entryPoints: [path.join(root, 'src/index.mjs')],
  outfile: path.join(root, 'dist/index.mjs'),
  format: 'esm',
  platform: 'node',
  packages: 'external'
});
await build({
  ...common,
  entryPoints: [path.join(root, 'src/node.mjs')],
  outfile: path.join(root, 'dist/node.mjs'),
  format: 'esm',
  platform: 'node',
  packages: 'external'
});
await build({
  ...common,
  entryPoints: [path.join(root, 'src/cli.mjs')],
  outfile: path.join(root, 'dist/cli.mjs'),
  format: 'esm',
  platform: 'node',
  packages: 'external'
});
await build({
  ...common,
  entryPoints: [path.join(root, 'src/index.mjs')],
  outfile: path.join(root, 'dist/browser.mjs'),
  format: 'esm',
  platform: 'browser'
});
await build({
  ...common,
  entryPoints: [path.join(root, 'src/index.mjs')],
  outfile: path.join(root, 'dist/viewer.global.js'),
  format: 'iife',
  globalName: 'OTI',
  platform: 'browser',
  logOverride: { 'empty-import-meta': 'silent' }
});
await copyFile(
  path.join(repo, 'core/oti-engine/target/wasm32-unknown-unknown/release/oti_engine.wasm'),
  path.join(root, 'dist/oti_engine.wasm')
);
await copyFile(
  path.join(root, 'assets/SourceSans3-Semibold.ttf'),
  path.join(root, 'dist/SourceSans3-Semibold.ttf')
);
await copyFile(path.join(root, 'assets/OFL.txt'), path.join(root, 'dist/OFL.txt'));
await copyFile(path.join(repo, 'LICENSES/Apache-2.0.txt'), path.join(root, 'LICENSE'));
await writeFile(
  path.join(root, 'dist/index.d.mts'),
  (await readFile(path.join(root, 'src/index.d.ts'), 'utf8')).replace(
    /^\/\/ SPDX-License-Identifier:[^\n]*\n/,
    ''
  )
);
await writeFile(
  path.join(root, 'dist/node.d.mts'),
  (await readFile(path.join(root, 'src/node.d.ts'), 'utf8'))
    .replace(/^\/\/ SPDX-License-Identifier:[^\n]*\n/, '')
    .replace("'./index.js'", "'./index.mjs'")
);
for (const name of ['index.d.ts', 'node.d.ts'])
  await rm(path.join(root, 'dist', name), { force: true });
const licensePaths = new Set();
const visited = new Set();
async function licenses(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const dir = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  if (/GPL|AGPL/.test(pkg.license || '')) throw new Error(`Incompatible bundled license: ${name}`);
  const files = await readdir(dir);
  for (const file of files.filter((f) => /^(license|copying|notice)(\.|$)/i.test(f)))
    if ((await stat(path.join(dir, file))).isFile()) licensePaths.add(path.join(dir, file));
  for (const child of Object.keys(pkg.dependencies || {})) await licenses(child);
}
for (const name of ['fflate', 'fontkit']) await licenses(name);
const texts = [await readFile(path.join(root, 'assets/COLOUR-LICENSE.txt'), 'utf8')];
for (const file of [...licensePaths].sort())
  texts.push(
    `${path.relative(path.join(root, 'node_modules'), file)}\n\n${await readFile(file, 'utf8')}`
  );
await writeFile(
  path.join(root, 'dist/THIRD_PARTY_LICENSES.txt'),
  texts.join('\n\n====================\n\n')
);
console.log(
  JSON.stringify({
    built: true,
    distribution: path.join(root, 'dist'),
    runtimeDependencies: visited.size
  })
);
