// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { root } from '../shared.mjs';

export const serviceDate = '20261027';
export const tableNames = ['agency', 'stops', 'routes', 'trips', 'stop_times', 'calendar', 'shapes', 'feed_info'];

export async function feedTables() {
  return Object.fromEntries(await Promise.all(tableNames.map(async (name) => [name, await readFile(new URL(`02-gtfs/feed/${name}.txt`, root), 'utf8')])));
}

export async function feedZip() {
  const tables = await feedTables();
  const entries = {};
  // ZIP stores local calendar fields, without a timezone. Fix those fields.
  const mtime = new Date(2000, 0, 1, 0, 0, 0);
  for (const name of tableNames) entries[`${name}.txt`] = [new TextEncoder().encode(tables[name]), { mtime }];
  entries['LICENSE.txt'] = [new Uint8Array(await readFile(new URL('02-gtfs/feed/LICENSE.txt', root))), { mtime }];
  return zipSync(entries, { level: 0 });
}
