// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { createDiagram } from 'opentransitinformation';
import { checkVersion, options, readJson, require, root, save, saveJson, sha256 } from '../shared.mjs';
import { dirname, join } from 'node:path';

await checkVersion();
const network = await readJson(new URL('01-tiny/network.json', root));
const diagram = await createDiagram(network, options);
const output = new URL('out/web/', root);
const escape = (v) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const list = `<ul>${diagram.text.map((r) => `<li>${escape(r.code)}: ${r.paths.map((p) => p.map((s) => escape(s.name)).join(' → ')).join('; ')}</li>`).join('')}</ul>`;
const html = (await readFile(new URL('03-web/index.html', root), 'utf8')).replace('<!-- ROUTE_LIST -->', list);
await save(new URL('index.html', output), html);
for (const name of ['app.mjs', 'page.css']) await save(new URL(name, output), await readFile(new URL(`03-web/${name}`, root)));
await saveJson(new URL('network.json', output), network);
await save(new URL('map.svg', output), diagram.svg);
const installed = dirname(require.resolve('opentransitinformation/package.json'));
const files = ['browser.mjs', 'oti_engine.wasm', 'SourceSans3-Semibold.ttf', 'OFL.txt', 'THIRD_PARTY_LICENSES.txt'];
const assets = [];
for (const name of files) {
  const bytes = await readFile(join(installed, 'dist', name));
  await save(new URL(`vendor/${name}`, output), bytes);
  assets.push({ path: `vendor/${name}`, bytes: bytes.length, sha256: sha256(bytes) });
}
for (const name of ['LICENSE', 'NOTICE']) await save(new URL(`vendor/${name}`, output), await readFile(join(installed, name)));
await saveJson(new URL('assets.json', output), { package: 'opentransitinformation@0.4.0', assets });
console.log(JSON.stringify({ directory: 'out/web', package: 'opentransitinformation@0.4.0', expectedRoutes: 1, expectedStops: 3, assets }));
