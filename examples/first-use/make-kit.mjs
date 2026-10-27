// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { checkVersion, root, save, sha256 } from './shared.mjs';

await checkVersion();
const repository = new URL('../../', root);
const exampleFiles = [
  '.gitignore', 'README.md', 'package.json', 'package-lock.json', 'shared.mjs', 'check.mjs', 'make-kit.mjs',
  '01-tiny/network.json', '01-tiny/build.mjs', '01-tiny/expected/map.svg', '01-tiny/expected/result.json', '01-tiny/expected/qa.json',
  '02-gtfs/build.mjs', '02-gtfs/feed.mjs', '02-gtfs/expected/map.svg', '02-gtfs/expected/result.json', '02-gtfs/expected/qa.json',
  '02-gtfs/feed/agency.txt', '02-gtfs/feed/stops.txt', '02-gtfs/feed/routes.txt', '02-gtfs/feed/trips.txt',
  '02-gtfs/feed/stop_times.txt', '02-gtfs/feed/calendar.txt', '02-gtfs/feed/shapes.txt', '02-gtfs/feed/feed_info.txt', '02-gtfs/feed/LICENSE.txt',
  '03-web/index.html', '03-web/app.mjs', '03-web/page.css', '03-web/prepare.mjs', '03-web/serve.mjs'
];
const paths = ['.gitattributes', 'LICENSE', 'NOTICE', 'docs/getting-started.md', ...exampleFiles.map((p) => `examples/first-use/${p}`)].sort();
const entries = {}, files = [], mtime = new Date(2000, 0, 1, 0, 0, 0);
for (const path of paths) {
  const bytes = new Uint8Array(await readFile(new URL(path, repository)));
  entries[path] = [bytes, { mtime }];
  files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
}
const manifest = { $comment: 'SPDX-License-Identifier: CC-BY-4.0', package: 'opentransitinformation@0.4.0', project: 'https://opentransitinformation.org', files };
entries['example-kit-manifest.json'] = [new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`), { mtime }];
const bytes = zipSync(entries, { level: 6 });
await save(new URL('out/first-use-kit.zip', root), bytes);
console.log(JSON.stringify({ output: 'out/first-use-kit.zip', sourceFiles: files.length, bytes: bytes.length, sha256: sha256(bytes) }));
