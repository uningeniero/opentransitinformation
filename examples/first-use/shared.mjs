// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const root = new URL('./', import.meta.url);
export const generatedAt = '2026-10-27T00:00:00Z';
export const version = '0.4.0';
export const options = { generatedAt, width: 1000, height: 640 };
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));
export const require = createRequire(import.meta.url);

export async function checkVersion() {
  const installed = JSON.parse(await readFile(require.resolve('opentransitinformation/package.json'), 'utf8'));
  assert.equal(installed.version, version, 'Install opentransitinformation@0.4.0 in this example directory.');
  return installed.version;
}

export async function save(url, data) {
  await mkdir(dirname(fileURLToPath(url)), { recursive: true });
  await writeFile(url, data);
}

export async function saveJson(url, value) {
  await save(url, `${JSON.stringify(value, null, 2)}\n`);
}

export function summary(diagram) {
  return {
    package: `opentransitinformation@${version}`,
    network: diagram.network.id,
    stops: diagram.network.stops.length,
    routes: diagram.network.routes.length,
    paths: diagram.network.routes.reduce((n, r) => n + r.paths.length, 0),
    renderedStops: diagram.layout.stops.length,
    renderedLabels: diagram.layout.labels.length,
    qaPassed: diagram.qa.passed,
    issueCodes: diagram.qa.issues.map((i) => i.code),
    generatedAt,
    svgSha256: sha256(diagram.svg)
  };
}
