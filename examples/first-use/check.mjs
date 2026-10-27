// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagram, fromGtfs, fromText, parseCsv } from 'opentransitinformation';
import { unzipSync } from 'fflate';
import { checkVersion, options, readJson, root, sha256 } from './shared.mjs';
import { feedTables, feedZip, serviceDate } from './02-gtfs/feed.mjs';

await checkVersion();
const checks = [];
for (const [name, stops, routes] of [['01-tiny', 3, 1], ['02-gtfs', 4, 2]]) {
  const actual = await readJson(new URL(`out/${name}/result.json`, root));
  const expected = await readJson(new URL(`${name}/expected/result.json`, root));
  assert.deepEqual(actual, expected);
  assert.equal(actual.stops, stops); assert.equal(actual.routes, routes);
  assert.equal(actual.renderedStops, stops); assert.equal(actual.renderedLabels, stops); assert.equal(actual.qaPassed, true);
  assert.equal(sha256(await readFile(new URL(`out/${name}/map.svg`, root))), actual.svgSha256);
  checks.push(`${name}: expected counts, QA and SVG digest`);
}
const zip = await feedZip(); assert.deepEqual(zip, await feedZip());
assert.equal(Object.keys(unzipSync(zip)).length, 9);
const tables = await feedTables();
const rows = Object.fromEntries(Object.entries(tables).map(([name, csv]) => [name, parseCsv(csv)]));
assert.equal(rows.agency.length, 1); assert.equal(rows.stops.length, 4);
assert.equal(rows.routes.length, 2); assert.equal(rows.trips.length, 2);
assert.equal(rows.stop_times.length, 6); assert.equal(rows.shapes.length, 6);
const ids = (name, key) => new Set(rows[name].map((r) => r[key]));
for (const r of rows.routes) assert.ok(ids('agency', 'agency_id').has(r.agency_id));
for (const t of rows.trips) {
  assert.ok(ids('routes', 'route_id').has(t.route_id));
  assert.ok(ids('calendar', 'service_id').has(t.service_id));
  assert.ok(ids('shapes', 'shape_id').has(t.shape_id));
  assert.deepEqual(rows.stop_times.filter((s) => s.trip_id === t.trip_id).map((s) => s.stop_sequence), ['1', '2', '3']);
}
for (const s of rows.stop_times) {
  assert.ok(ids('trips', 'trip_id').has(s.trip_id));
  assert.ok(ids('stops', 'stop_id').has(s.stop_id));
}
checks.push('GTFS fixture relationships and table counts');
const negative = async (name, run, code, message) => {
  await assert.rejects(async () => run(), (error) => error.code === code && error.message === message);
  checks.push(`${name}: ${code}`);
};
await negative('Route text without a colon', () => fromText('Depot > Library'), 'INVALID_TEXT_INPUT', 'Use route: stop > stop > stop');
await negative('GTFS path passed instead of bytes', () => fromGtfs('out/02-gtfs/feed.zip'), 'INVALID_GTFS', 'Expected GTFS ZIP bytes or table object');
await negative('GTFS required table missing', () => fromGtfs({ ...tables, stops: [] }, { date: serviceDate }), 'INVALID_GTFS', 'Expected a non-empty stops.txt table');
await negative('GTFS date format', () => fromGtfs(tables, { date: '2026-10-27' }), 'INVALID_GTFS', 'date must be YYYYMMDD');
await negative('GTFS inactive teaching service', () => fromGtfs(tables, { date: '20261028' }), 'INVALID_STOPS', 'A network needs 2..5000 stops');
const invalid = await readJson(new URL('01-tiny/network.json', root));
invalid.stops[0].position = [0];
await negative('Invalid coordinates', () => createDiagram(invalid, options), 'INVALID_COORDINATES', 'Coordinates must be two finite numbers');
console.log(JSON.stringify({ passed: true, package: 'opentransitinformation@0.4.0', checks }));
