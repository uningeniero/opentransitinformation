// SPDX-License-Identifier: Apache-2.0
import { unzipSync, strFromU8 } from 'fflate';
import { normalizeNetwork, OtiError } from './model.mjs';
import { runEngine } from './engine.mjs';
const fail = (c, m) => {
  throw new OtiError(c, m);
};
export function parseCsv(text, { delimiter = ',' } = {}) {
  if (typeof text !== 'string' || text.length > 128 * 1024 * 1024)
    fail('INVALID_CSV', 'Expected CSV text up to 128 MiB');
  if (![',', ';', '\t'].includes(delimiter))
    fail('INVALID_CSV', 'Unsupported delimiter');
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [],
    field = '',
    quoted = false,
    after = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === undefined) fail('INVALID_CSV', 'Unterminated quoted field');
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          after = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"' && !field && !after) {
      quoted = true;
      continue;
    }
    if (c === delimiter || c === '\n' || c === '\r' || c === undefined) {
      row.push(field);
      field = '';
      after = false;
      if (c !== delimiter) {
        if (row.some((v) => v !== '')) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
      continue;
    }
    if (after && c !== ' ' && c !== '\t')
      fail('INVALID_CSV', 'Unexpected text after quoted field');
    if (!after) field += c;
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
    fail('INVALID_CSV', 'CSV headers must be non-empty and unique');
  return rows.map((r, index) => {
    if (r.length !== headers.length)
      fail(
        'INVALID_CSV',
        `CSV row ${index + 2} has ${r.length} fields; expected ${headers.length}`
      );
    const o = Object.create(null);
    headers.forEach((h, i) => (o[h] = r[i]));
    return o;
  });
}
const number = (s, field) => {
  if (s === '' || s == null || !Number.isFinite(Number(s)))
    fail('INVALID_DATA', `Invalid number: ${field}`);
  return Number(s);
};
export function fromGeoJSON(
  collection,
  {
    id = 'geojson',
    name = 'Transit network',
    coordinateSystem = 'wgs84',
    properties = {}
  } = {}
) {
  if (
    collection?.type !== 'FeatureCollection' ||
    !Array.isArray(collection.features)
  )
    fail('INVALID_GEOJSON', 'Expected a GeoJSON FeatureCollection');
  const p = {
    stopId: 'stop_id',
    stopName: 'stop_name',
    routeId: 'route_id',
    routeName: 'route_short_name',
    routeLongName: 'route_long_name',
    routeColor: 'route_color',
    stopIds: 'stop_ids',
    routeIds: 'route_ids',
    sequence: 'sequence',
    ...properties
  };
  const stops = [],
    routes = new Map(),
    background = [];
  for (const f of collection.features) {
    const g = f.geometry,
      a = f.properties || {};
    if (!g) continue;
    if (g.type === 'Point') {
      const sid = String(a[p.stopId] ?? f.id ?? '');
      if (!sid)
        fail('INVALID_GEOJSON', 'Point features require a stop identifier');
      stops.push({
        id: sid,
        name: String(a[p.stopName] ?? a.name ?? sid),
        position: g.coordinates.slice(0, 2),
        accessible: typeof a.accessible === 'boolean' ? a.accessible : null,
        _routeIds: a[p.routeIds],
        _sequence: a[p.sequence]
      });
    } else if (
      ['LineString', 'MultiLineString'].includes(g.type) &&
      a[p.routeId] != null
    ) {
      const rid = String(a[p.routeId]);
      if (!routes.has(rid))
        routes.set(rid, {
          id: rid,
          shortName: String(a[p.routeName] ?? rid),
          name: String(a[p.routeLongName] ?? a[p.routeName] ?? rid),
          color: a[p.routeColor]
            ? String(a[p.routeColor]).startsWith('#')
              ? a[p.routeColor]
              : `#${a[p.routeColor]}`
            : undefined,
          paths: []
        });
      let stopIds = a[p.stopIds];
      if (typeof stopIds === 'string') {
        try {
          stopIds = JSON.parse(stopIds);
        } catch {
          stopIds = stopIds.split(',').map((s) => s.trim());
        }
      }
      const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
      for (let li = 0; li < lines.length; li++)
        routes.get(rid).paths.push({
          stopIds: Array.isArray(stopIds?.[0])
            ? stopIds[li]?.map(String)
            : stopIds?.map(String),
          coordinates: lines[li].map((c) => c.slice(0, 2))
        });
    } else if (
      ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(
        g.type
      ) &&
      [
        'water',
        'land',
        'park',
        'urban',
        'building',
        'district',
        'street',
        'rail'
      ].includes(a.kind)
    ) {
      const context = {
        kind: a.kind,
        geometry: g.type.includes('Polygon') ? 'polygon' : 'line',
        ...(a.name ? { name: String(a.name) } : {})
      };
      if (g.type === 'MultiPolygon')
        for (const [part, poly] of g.coordinates.entries())
          background.push({
            ...context,
            id: `${f.id ?? background.length}-${part}`,
            coordinates: poly
          });
      else
        background.push({
          ...context,
          ...(f.id != null ? { id: String(f.id) } : {}),
          coordinates: ['Polygon', 'MultiLineString'].includes(g.type)
            ? g.coordinates
            : [g.coordinates]
        });
    }
  }
  for (const r of routes.values())
    for (const path of r.paths)
      if (!path.stopIds) {
        const candidates = stops.filter((s) => {
          const ids = Array.isArray(s._routeIds)
            ? s._routeIds
            : String(s._routeIds ?? '').split(',');
          return ids.map(String).includes(r.id);
        });
        if (
          candidates.length < 2 ||
          candidates.some((s) => s._sequence == null)
        )
          fail(
            'STOP_SEQUENCE_REQUIRED',
            `Route ${r.id} requires stop_ids or Point route_ids and sequence`
          );
        path.stopIds = candidates
          .sort(
            (a, b) =>
              number(a._sequence, 'sequence') - number(b._sequence, 'sequence')
          )
          .map((s) => s.id);
      }
  return normalizeNetwork({
    id,
    name,
    coordinateSystem,
    stops: stops.map(({ _routeIds, _sequence, ...s }) => s),
    routes: [...routes.values()],
    background,
    metadata: collection.metadata || {}
  });
}
function gtfsTables(input) {
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > 128 * 1024 * 1024)
      fail('GTFS_TOO_LARGE', 'Compressed GTFS exceeds 128 MiB');
    let total = 0;
    const allowed = new Set([
      'stops.txt',
      'routes.txt',
      'trips.txt',
      'stop_times.txt',
      'shapes.txt',
      'calendar.txt',
      'calendar_dates.txt',
      'feed_info.txt'
    ]);
    const files = unzipSync(bytes, {
      filter: (file) => {
        const name = file.name.split('/').at(-1);
        if (!allowed.has(name)) return false;
        total += file.originalSize;
        if (total > 256 * 1024 * 1024 || file.originalSize > 128 * 1024 * 1024)
          fail('GTFS_TOO_LARGE', 'Expanded GTFS exceeds limits');
        return true;
      }
    });
    const result = Object.create(null);
    for (const [k, v] of Object.entries(files)) {
      const name = k.split('/').at(-1).replace('.txt', '');
      if (result[name])
        fail('INVALID_GTFS', `Ambiguous ${name}.txt in archive`);
      result[name] = parseCsv(strFromU8(v));
    }
    return result;
  }
  if (!input || typeof input !== 'object')
    fail('INVALID_GTFS', 'Expected GTFS ZIP bytes or table object');
  const result = {};
  for (const [k, v] of Object.entries(input))
    result[k.replace('.txt', '')] = typeof v === 'string' ? parseCsv(v) : v;
  return result;
}
export function fromGtfs(
  input,
  {
    id = 'gtfs',
    name = 'Transit network',
    routeIds,
    serviceIds,
    date,
    groupPlatforms = true,
    metadata = {}
  } = {}
) {
  const t = gtfsTables(input);
  for (const k of ['stops', 'routes', 'trips', 'stop_times'])
    if (!Array.isArray(t[k]) || !t[k].length)
      fail('INVALID_GTFS', `Missing ${k}.txt`);
  let active = serviceIds ? new Set(serviceIds.map(String)) : null;
  if (date) {
    if (!/^\d{8}$/.test(date)) fail('INVALID_GTFS', 'date must be YYYYMMDD');
    const d = new Date(
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00Z`
    );
    if (
      Number.isNaN(+d) ||
      d.toISOString().slice(0, 10).replaceAll('-', '') !== date
    )
      fail('INVALID_GTFS', 'Invalid service date');
    const days = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday'
    ];
    const dated = new Set(
      (t.calendar || [])
        .filter(
          (c) =>
            c.start_date <= date &&
            c.end_date >= date &&
            String(c[days[d.getUTCDay()]]) === '1'
        )
        .map((c) => String(c.service_id))
    );
    for (const c of t.calendar_dates || [])
      if (c.date === date) {
        if (String(c.exception_type) === '1') dated.add(String(c.service_id));
        else if (String(c.exception_type) === '2')
          dated.delete(String(c.service_id));
      }
    active = active ? new Set([...active].filter((x) => dated.has(x))) : dated;
  }
  const selected = new Set(
    (routeIds || t.routes.map((r) => r.route_id)).map(String)
  );
  const rawStops = new Map(t.stops.map((s) => [String(s.stop_id), s]));
  if (rawStops.size !== t.stops.length)
    fail('INVALID_GTFS', 'Duplicate stop_id');
  const stopId = (s) => {
    const row = rawStops.get(String(s));
    if (!row) fail('INVALID_GTFS', `Unknown stop ${s}`);
    return groupPlatforms &&
      row.parent_station &&
      rawStops.has(String(row.parent_station))
      ? String(row.parent_station)
      : String(s);
  };
  const trips = new Map();
  for (const trip of t.trips) {
    const tid = String(trip.trip_id);
    if (trips.has(tid)) fail('INVALID_GTFS', 'Duplicate trip_id');
    trips.set(tid, trip);
  }
  const times = new Map();
  for (const s of t.stop_times) {
    const trip = trips.get(String(s.trip_id));
    if (!trip) fail('INVALID_GTFS', `Unknown trip ${s.trip_id}`);
    if (
      !selected.has(String(trip.route_id)) ||
      (active && !active.has(String(trip.service_id)))
    )
      continue;
    if (String(s.pickup_type) === '1' && String(s.drop_off_type) === '1')
      continue;
    if (!times.has(String(s.trip_id))) times.set(String(s.trip_id), []);
    times.get(String(s.trip_id)).push(s);
  }
  const shapes = new Map();
  for (const s of t.shapes || []) {
    const sid = String(s.shape_id);
    if (!shapes.has(sid)) shapes.set(sid, []);
    shapes.get(sid).push(s);
  }
  for (const list of shapes.values())
    list.sort(
      (a, b) =>
        number(a.shape_pt_sequence, 'shape_pt_sequence') -
        number(b.shape_pt_sequence, 'shape_pt_sequence')
    );
  const byRoute = new Map(),
    used = new Set();
  for (const [tid, list] of times) {
    const trip = trips.get(tid);
    list.sort(
      (a, b) =>
        number(a.stop_sequence, 'stop_sequence') -
        number(b.stop_sequence, 'stop_sequence')
    );
    const seq = [];
    const seen = new Set();
    for (const s of list) {
      if (seen.has(s.stop_sequence))
        fail('INVALID_GTFS', `Duplicate stop_sequence on trip ${tid}`);
      seen.add(s.stop_sequence);
      const sid = stopId(s.stop_id);
      if (sid !== seq.at(-1)) seq.push(sid);
    }
    if (seq.length < 2) continue;
    seq.forEach((s) => used.add(s));
    const rid = String(trip.route_id);
    if (!byRoute.has(rid)) byRoute.set(rid, new Map());
    const signature = JSON.stringify([
      seq,
      String(trip.direction_id ?? ''),
      String(trip.shape_id ?? '')
    ]);
    if (byRoute.get(rid).has(signature)) continue;
    const shape = shapes.get(String(trip.shape_id));
    byRoute.get(rid).set(signature, {
      stopIds: seq,
      direction: String(trip.direction_id ?? ''),
      ...(shape?.length >= 2
        ? {
            coordinates: shape.map((s) => [
              number(s.shape_pt_lon, 'shape_pt_lon'),
              number(s.shape_pt_lat, 'shape_pt_lat')
            ])
          }
        : {})
    });
  }
  const stops = [...used].sort().map((sid) => {
    const s = rawStops.get(sid);
    return {
      id: sid,
      name: s.stop_name,
      position: [
        number(s.stop_lon, 'stop_lon'),
        number(s.stop_lat, 'stop_lat')
      ],
      accessible:
        String(s.wheelchair_boarding) === '1'
          ? true
          : String(s.wheelchair_boarding) === '2'
            ? false
            : null
    };
  });
  const routes = t.routes
    .filter(
      (r) => selected.has(String(r.route_id)) && byRoute.has(String(r.route_id))
    )
    .map((r) => ({
      id: String(r.route_id),
      shortName: r.route_short_name || r.route_long_name || String(r.route_id),
      name: r.route_long_name || r.route_short_name || String(r.route_id),
      ...(r.route_color
        ? { color: `#${String(r.route_color).replace(/^#/, '')}` }
        : {}),
      mode: String(r.route_type ?? 'transit'),
      paths: [...byRoute.get(String(r.route_id)).values()]
    }));
  return normalizeNetwork({
    id,
    name,
    coordinateSystem: 'wgs84',
    stops,
    routes,
    metadata: {
      ...metadata,
      importer: 'GTFS',
      ...(date ? { serviceDate: date } : {}),
      ...(t.feed_info?.[0]
        ? {
            feedVersion: t.feed_info[0].feed_version,
            validFrom: t.feed_info[0].feed_start_date,
            validUntil: t.feed_info[0].feed_end_date
          }
        : {})
    }
  });
}
export async function fromText(
  text,
  { id = 'text', name = 'Transit network', metadata = {} } = {}
) {
  if (typeof text !== 'string' || text.length > 1e6)
    fail('INVALID_TEXT_INPUT', 'Expected route text under 1 MiB');
  const stops = new Map(),
    routes = [];
  for (const line of text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const match = /^([^:]+):\s*(.+)$/.exec(line);
    if (!match) fail('INVALID_TEXT_INPUT', 'Use route: stop > stop > stop');
    const code = match[1].trim();
    const names = match[2]
      .split(/\s*(?:>|→|↔|->)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length < 2)
      fail('INVALID_TEXT_INPUT', 'Each route needs at least two stop names');
    const stopIds = names.map((n) => {
      if (!stops.has(n)) stops.set(n, { id: `s${stops.size + 1}`, name: n });
      return stops.get(n).id;
    });
    routes.push({
      id: `r${routes.length + 1}`,
      shortName: code,
      name: code,
      paths: [{ stopIds }]
    });
  }
  if (!routes.length) fail('INVALID_TEXT_INPUT', 'No routes found');
  const network = {
    id,
    name,
    coordinateSystem: 'planar',
    stops: [...stops.values()],
    routes,
    metadata
  };
  const result = await runEngine({ operation: 'topology', network });
  return normalizeNetwork({
    ...network,
    stops: network.stops.map((s) => ({
      ...s,
      position: result.positions[s.id]
    }))
  });
}
