// SPDX-License-Identifier: Apache-2.0
import { runEngine } from './engine.mjs';
import { normalizeNetwork, OtiError } from './model.mjs';

const attribution = '© OpenStreetMap contributors';
const copyright = 'https://www.openstreetmap.org/copyright';
const defaultEndpoint = 'https://overpass-api.de/api/interpreter';
const fail = (code, message, details) => {
  throw new OtiError(code, message, details);
};
const iso = (value) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time))
    fail('INVALID_OSM_TIMESTAMP', 'Expected a valid source timestamp');
  return new Date(time).toISOString();
};
export function openStreetMapQuery(bounds) {
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite)
  )
    fail('INVALID_OSM_BOUNDS', 'Expected [west, south, east, north]');
  const [west, south, east, north] = bounds;
  if (
    west < -180 ||
    east > 180 ||
    south < -85 ||
    north > 85 ||
    west >= east ||
    south >= north ||
    east - west > 0.2 ||
    north - south > 0.2
  )
    fail(
      'INVALID_OSM_BOUNDS',
      'Expected a bounded city excerpt spanning at most 0.2 degrees per axis'
    );
  const b = [south, west, north, east].join(',');
  return `[out:json][timeout:45];(way[highway~"^(primary|secondary|tertiary|unclassified|residential|pedestrian|living_street)$"](${b});way[natural=water](${b});relation[type=multipolygon][natural=water](${b});way[leisure~"^(park|garden|recreation_ground)$"](${b});relation[type=multipolygon][leisure~"^(park|garden)$"](${b});way[landuse~"^(grass|recreation_ground|cemetery|forest)$"](${b});way[building][name](${b}););out meta geom;`;
}
function sourceUrl(value = defaultEndpoint) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('INVALID_OSM_ENDPOINT', 'Expected an HTTPS Overpass endpoint');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.hash
  )
    fail(
      'INVALID_OSM_ENDPOINT',
      'Expected an HTTPS endpoint without credentials or fragments'
    );
  return url.href;
}
async function digest(text) {
  const bytes = new TextEncoder().encode(text);
  return Array.from(
    new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0')
  ).join('');
}
async function importData(data, options = {}, rawText) {
  if (!data || !Array.isArray(data.elements))
    fail('INVALID_OSM_DATA', 'Expected Overpass JSON with elements');
  if (data.remark)
    fail('OSM_UPSTREAM_ERROR', String(data.remark).slice(0, 500));
  const retrievedAt = iso(options.retrievedAt || new Date().toISOString());
  const dataAsOf = data.osm3s?.timestamp_osm_base
    ? iso(data.osm3s.timestamp_osm_base)
    : null;
  const ageMs = dataAsOf
    ? Math.max(0, Date.parse(retrievedAt) - Date.parse(dataAsOf))
    : null;
  if (options.maxAgeMs !== undefined) {
    if (!Number.isFinite(options.maxAgeMs) || options.maxAgeMs < 0)
      fail(
        'INVALID_OSM_OPTIONS',
        'maxAgeMs must be a non-negative finite duration'
      );
    if (ageMs === null || ageMs > options.maxAgeMs)
      fail(
        'OSM_STALE_DATA',
        'The upstream OSM snapshot is missing its timestamp or is older than allowed',
        { dataAsOf, retrievedAt, ageMs }
      );
  }
  if (dataAsOf && Date.parse(dataAsOf) > Date.parse(retrievedAt) + 300000)
    fail(
      'INVALID_OSM_TIMESTAMP',
      'The upstream OSM timestamp is in the future'
    );
  const output = await runEngine({ operation: 'openstreetmap', data });
  const revisions = data.elements
    .filter(
      (e) =>
        ['node', 'way', 'relation'].includes(e.type) &&
        Number.isSafeInteger(e.id)
    )
    .map((e) => ({
      type: e.type,
      id: e.id,
      ...(Number.isSafeInteger(e.version) ? { version: e.version } : {}),
      ...(e.timestamp ? { timestamp: iso(e.timestamp) } : {})
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
  return {
    ...output,
    provenance: {
      source: 'OpenStreetMap',
      sourceUrl: sourceUrl(options.sourceUrl),
      attribution,
      license: 'ODbL-1.0',
      copyright,
      retrievedAt,
      dataAsOf,
      ageMs,
      sha256: await digest(rawText ?? JSON.stringify(data)),
      hashEncoding:
        rawText === undefined ? 'json-stringify-utf8' : 'response-utf8',
      ...(options.bounds ? { bounds: [...options.bounds] } : {}),
      revisions
    }
  };
}
export async function fromOpenStreetMap(data, options = {}) {
  return importData(data, options);
}
export async function fromOpenStreetMapRoute(
  data,
  { relationId, selectedStops, continuationVertices }
) {
  return runEngine({
    operation: 'openstreetmap-route',
    data,
    relationId,
    selectedStops,
    continuationVertices
  });
}
async function boundedText(response) {
  const max = 32 * 1024 * 1024;
  const declared = Number(response.headers?.get('content-length'));
  if (declared > max)
    fail('OSM_RESPONSE_TOO_LARGE', 'OSM response exceeds 32 MiB');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > max)
      fail('OSM_RESPONSE_TOO_LARGE', 'OSM response exceeds 32 MiB');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        fail('OSM_RESPONSE_TOO_LARGE', 'OSM response exceeds 32 MiB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function loadOpenStreetMap(options) {
  const query = openStreetMapQuery(options?.bounds);
  const endpoint = sourceUrl(options.endpoint);
  const controller = AbortSignal.timeout(60000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller])
    : controller;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (typeof process !== 'undefined' && process.versions?.node)
    headers['User-Agent'] =
      'OpenTransitInformation/0.3 (+https://opentransitinformation.org)';
  const response = await (options.fetch || globalThis.fetch)(endpoint, {
    method: 'POST',
    headers,
    credentials: 'omit',
    body: new URLSearchParams({ data: query }),
    signal
  });
  if (!response.ok)
    fail('OSM_HTTP_ERROR', `Unable to refresh OSM: HTTP ${response.status}`);
  const rawText = await boundedText(response);
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    fail('INVALID_OSM_DATA', 'Overpass returned invalid JSON');
  }
  const snapshot = await importData(
    data,
    {
      sourceUrl: endpoint,
      bounds: options.bounds,
      retrievedAt: new Date().toISOString(),
      maxAgeMs: options.maxAgeMs ?? 86400000
    },
    rawText
  );
  snapshot.provenance.query = query;
  return snapshot;
}
export function withOpenStreetMap(input, snapshot) {
  if (input.coordinateSystem !== 'wgs84')
    fail('INVALID_CRS', 'An OSM base requires WGS84 transport coordinates');
  if (
    snapshot?.provenance?.source !== 'OpenStreetMap' ||
    !Array.isArray(snapshot.features)
  )
    fail('INVALID_OSM_DATA', 'Expected an OpenStreetMap snapshot');
  return normalizeNetwork({
    ...input,
    background: snapshot.features,
    metadata: { ...input.metadata, baseMap: { ...snapshot.provenance } }
  });
}
