// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createDiagram,
  fromOpenStreetMap,
  fromOpenStreetMapRoute,
  loadOpenStreetMap,
  openStreetMapQuery,
  withOpenStreetMap
} from '../dist/index.mjs';

function context() {
  return {
    osm3s: { timestamp_osm_base: '2026-10-23T09:00:00Z' },
    elements: [
      {
        type: 'way',
        id: 10,
        version: 4,
        timestamp: '2026-10-22T20:00:00Z',
        user: 'EXCLUDED-CONTRIBUTOR',
        uid: 123,
        changeset: 456,
        tags: { highway: 'primary', name: 'Main Street' },
        geometry: [
          { lon: -0.15, lat: 51.5 },
          { lon: -0.14, lat: 51.51 }
        ]
      },
      {
        type: 'way',
        id: 11,
        version: 2,
        tags: { leisure: 'park', name: 'Example Park' },
        geometry: [
          { lon: -0.15, lat: 51.5 },
          { lon: -0.14, lat: 51.5 },
          { lon: -0.14, lat: 51.51 },
          { lon: -0.15, lat: 51.51 },
          { lon: -0.15, lat: 51.5 }
        ]
      }
    ]
  };
}
function routeData() {
  return {
    elements: [
      ...[
        [1, 0, 0],
        [2, 0.003, 0.001],
        [3, 0.006, -0.001],
        [4, 0.01, 0]
      ].map(([id, x, y]) => ({
        type: 'node',
        id,
        lon: -0.15 + x,
        lat: 51.5 + y,
        tags: { public_transport: 'stop_position' }
      })),
      { type: 'way', id: 10, nodes: [2, 1] },
      { type: 'way', id: 11, nodes: [2, 3, 4] },
      {
        type: 'way',
        id: 12,
        tags: { public_transport: 'platform' },
        nodes: [999, 998]
      },
      {
        type: 'relation',
        id: 20,
        version: 3,
        timestamp: '2026-10-23T08:00:00Z',
        tags: { type: 'route', route: 'subway' },
        members: [
          { type: 'node', ref: 2, role: 'stop' },
          { type: 'node', ref: 3, role: 'stop' },
          { type: 'way', ref: 12, role: 'platform' },
          { type: 'way', ref: 10, role: '' },
          { type: 'way', ref: 11, role: '' }
        ]
      }
    ]
  };
}

test('OSM import retains geographic context and revision evidence without contributor accounts', async () => {
  const data = context();
  const snapshot = await fromOpenStreetMap(data, {
    retrievedAt: '2026-10-23T09:01:00Z'
  });
  assert.equal(snapshot.features.length, 2);
  assert.equal(snapshot.issues.length, 0);
  assert.equal(
    snapshot.features.find((f) => f.kind === 'street').classification,
    'primary'
  );
  assert.equal(snapshot.provenance.dataAsOf, '2026-10-23T09:00:00.000Z');
  assert.equal(snapshot.provenance.ageMs, 60000);
  assert.equal(
    snapshot.provenance.revisions.find((r) => r.id === 10).version,
    4
  );
  assert.equal(
    JSON.stringify(snapshot).includes('EXCLUDED-CONTRIBUTOR'),
    false
  );
  assert.equal(
    snapshot.provenance.revisions.some((r) => 'uid' in r || 'changeset' in r),
    false
  );
});

test('freshness gates distinguish stale or missing upstream time from retrieval time', async () => {
  await assert.rejects(
    fromOpenStreetMap(context(), {
      retrievedAt: '2026-10-23T10:00:00Z',
      maxAgeMs: 60000
    }),
    { code: 'OSM_STALE_DATA' }
  );
  const missing = context();
  delete missing.osm3s;
  await assert.rejects(fromOpenStreetMap(missing, { maxAgeMs: 60000 }), {
    code: 'OSM_STALE_DATA'
  });
  const snapshot = await fromOpenStreetMap(missing);
  assert.equal(snapshot.provenance.dataAsOf, null);
  await assert.rejects(
    fromOpenStreetMap({ ...context(), remark: 'runtime timeout' }),
    { code: 'OSM_UPSTREAM_ERROR' }
  );
});

test('a bounded refresh uses actual response bytes and upstream timestamp', async () => {
  const data = context();
  data.osm3s.timestamp_osm_base = new Date(Date.now() - 5000).toISOString();
  const raw = JSON.stringify(data, null, 2);
  let calls = 0;
  const snapshot = await loadOpenStreetMap({
    bounds: [-0.16, 51.49, -0.13, 51.52],
    fetch: async (url, request) => {
      calls++;
      assert.equal(request.credentials, 'omit');
      assert.equal(request.method, 'POST');
      assert.ok(String(request.body).includes('out'));
      return new Response(raw, {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  assert.equal(calls, 1);
  assert.equal(
    snapshot.provenance.sha256,
    createHash('sha256').update(raw).digest('hex')
  );
  assert.equal(snapshot.provenance.hashEncoding, 'response-utf8');
  assert.ok(snapshot.provenance.ageMs >= 5000);
  assert.throws(() => openStreetMapQuery([-180, -80, 180, 80]), {
    code: 'INVALID_OSM_BOUNDS'
  });
  await assert.rejects(
    loadOpenStreetMap({
      bounds: [0, 0, 1, 1],
      fetch: () => {
        throw Error('must not fetch');
      }
    }),
    { code: 'INVALID_OSM_BOUNDS' }
  );
});

test('ordered OSM route ways retain exact nodes and exclude platform geometry', async () => {
  const source = routeData();
  const result = await fromOpenStreetMapRoute(source, {
    relationId: 20,
    selectedStops: [
      { id: 'a', nodeId: 2 },
      { id: 'b', nodeId: 3 }
    ],
    continuationVertices: 1
  });
  assert.deepEqual(result.sourceNodeIds, [1, 2, 3, 4]);
  assert.deepEqual(result.stopPositions.a, [-0.147, 51.501]);
  assert.equal(result.memberWayIds.includes(12), false);
  const reversed = await fromOpenStreetMapRoute(source, {
    relationId: 20,
    selectedStops: [
      { id: 'b', nodeId: 3 },
      { id: 'a', nodeId: 2 }
    ]
  });
  assert.deepEqual(reversed.sourceNodeIds, [3, 2]);
  const broken = routeData();
  broken.elements.find((e) => e.type === 'way' && e.id === 11).nodes = [3, 4];
  await assert.rejects(
    fromOpenStreetMapRoute(broken, {
      relationId: 20,
      selectedStops: [
        { id: 'a', nodeId: 1 },
        { id: 'b', nodeId: 4 }
      ]
    }),
    /disconnected/
  );
  await assert.rejects(
    fromOpenStreetMapRoute(source, {
      relationId: 20,
      selectedStops: [
        { id: 'a', nodeId: 999 },
        { id: 'b', nodeId: 4 }
      ]
    }),
    /explicit stop_position/
  );
});

test('selected OSM anchors must be tagged stop positions with explicit relation stop membership', async () => {
  const options = {
    relationId: 20,
    selectedStops: [
      { id: 'a', nodeId: 2 },
      { id: 'b', nodeId: 3 }
    ]
  };
  const missingMembership = routeData();
  missingMembership.elements.find((e) => e.type === 'relation').members.shift();
  await assert.rejects(
    fromOpenStreetMapRoute(missingMembership, options),
    /explicit stop_position/
  );
  const missingTag = routeData();
  delete missingTag.elements.find((e) => e.type === 'node' && e.id === 2).tags;
  await assert.rejects(
    fromOpenStreetMapRoute(missingTag, options),
    /explicit stop_position/
  );
  for (const role of ['', 'via', 'platform', 'platform_entry_only', 'platform_exit_only']) {
    const wrongRole = routeData();
    wrongRole.elements.find((e) => e.type === 'relation').members[0].role = role;
    await assert.rejects(
      fromOpenStreetMapRoute(wrongRole, options),
      /supported stop roles/
    );
  }
  const directional = routeData();
  const members = directional.elements.find((e) => e.type === 'relation').members;
  members[0].role = 'stop_entry_only';
  members[1].role = 'stop_exit_only';
  assert.deepEqual(
    (await fromOpenStreetMapRoute(directional, options)).sourceNodeIds,
    [2, 3]
  );
});

test('unknown OSM way roles fail while explicit platforms and directional track roles remain supported', async () => {
  const options = {
    relationId: 20,
    selectedStops: [
      { id: 'a', nodeId: 2 },
      { id: 'b', nodeId: 3 }
    ]
  };
  for (const index of [2, 3]) {
    const unknown = routeData();
    unknown.elements.find((e) => e.type === 'relation').members[index].role = 'unrecognised';
    await assert.rejects(
      fromOpenStreetMapRoute(unknown, options),
      /Unsupported OSM route way role/
    );
  }
  for (const role of ['platform', 'platform_entry_only', 'platform_exit_only', '']) {
    const platforms = routeData();
    const members = platforms.elements.find((e) => e.type === 'relation').members;
    members[2].role = role;
    members.splice(3, 0,
      { type: 'relation', ref: 999, role: 'platform' },
      { type: 'relation', ref: 998, role: 'platform_entry_only' },
      { type: 'relation', ref: 997, role: 'platform_exit_only' }
    );
    assert.deepEqual(
      (await fromOpenStreetMapRoute(platforms, options)).memberWayIds,
      [10, 11]
    );
  }
  const directional = routeData();
  const members = directional.elements.find((e) => e.type === 'relation').members;
  members[3].role = 'backward';
  members[4].role = 'forward';
  assert.deepEqual(
    (await fromOpenStreetMapRoute(directional, options)).sourceNodeIds,
    [2, 3]
  );
  members[3].role = 'forward';
  await assert.rejects(fromOpenStreetMapRoute(directional, options), /direction roles/);
});

test('repeated OSM stop nodes remain ambiguous after occurrence indexing', async () => {
  const source = routeData();
  source.elements.find((e) => e.type === 'way' && e.id === 11).nodes = [2, 3, 2, 4];
  await assert.rejects(
    fromOpenStreetMapRoute(source, {
      relationId: 20,
      selectedStops: [
        { id: 'a', nodeId: 2 },
        { id: 'b', nodeId: 3 }
      ]
    }),
    /one unique node/
  );
});

test('OSM route reference and member budgets fail before chain assembly', async () => {
  const options = {
    relationId: 20,
    selectedStops: [
      { id: 'a', nodeId: 2 },
      { id: 'b', nodeId: 3 }
    ]
  };
  for (const id of [10, 12]) {
    const oversized = routeData();
    oversized.elements.find((e) => e.type === 'way' && e.id === id).nodes = Array(100001).fill(1);
    await assert.rejects(
      fromOpenStreetMapRoute(oversized, options),
      /100000 source node references/
    );
  }
  const repeated = routeData();
  repeated.elements.find((e) => e.type === 'way' && e.id === 10).nodes = Array(1001).fill(1);
  repeated.elements.find((e) => e.type === 'relation').members = Array.from(
    { length: 100 }, () => ({ type: 'way', ref: 10, role: '' })
  );
  await assert.rejects(
    fromOpenStreetMapRoute(repeated, options),
    /100000 member-way node references/
  );
  const manyPlatforms = routeData();
  manyPlatforms.elements.find((e) => e.type === 'relation').members = Array.from(
    { length: 10001 }, () => ({ type: 'relation', ref: 999, role: 'platform' })
  );
  await assert.rejects(
    fromOpenStreetMapRoute(manyPlatforms, options),
    /10000 relation members/
  );
});

test('OSM-backed output preserves source bends, explicit anchors and excerpt semantics', async () => {
  const geometry = await fromOpenStreetMapRoute(routeData(), {
    relationId: 20,
    selectedStops: [
      { id: 'a', nodeId: 2 },
      { id: 'b', nodeId: 3 }
    ],
    continuationVertices: 1
  });
  const snapshot = await fromOpenStreetMap(context(), {
    retrievedAt: '2026-10-23T09:01:00Z'
  });
  const raw = {
    id: 'osm-test',
    name: 'Source map',
    coordinateSystem: 'wgs84',
    stops: [
      { id: 'a', name: 'A', position: [-0.148, 51.5] },
      { id: 'b', name: 'B', position: [-0.143, 51.5] }
    ],
    routes: [
      {
        id: 'r',
        shortName: 'R',
        color: '#005B96',
        paths: [
          {
            stopIds: ['a', 'b'],
            coordinates: geometry.coordinates,
            stopPositions: geometry.stopPositions,
            startTerminus: false,
            endTerminus: false
          }
        ]
      }
    ]
  };
  const network = withOpenStreetMap(raw, snapshot);
  const diagram = await createDiagram(network, {
    width: 1200,
    height: 900,
    backgroundStyle: 'atlas',
    autoExpand: false
  });
  assert.equal(diagram.qa.passed, true);
  assert.equal(diagram.layout.paths[0].points.length, 4);
  assert.equal(diagram.layout.paths[0].d.includes('C'), false);
  assert.ok(diagram.layout.paths[0].offsets.every((offset) => offset === 0));
  assert.deepEqual(
    diagram.layout.stops.find((s) => s.id === 'a').anchors[0],
    diagram.layout.paths[0].points[1]
  );
  assert.ok(diagram.layout.stops.every((s) => s.terminal === false));
  assert.equal(diagram.layout.paths[0].continuations.length, 2);
  assert.ok(diagram.svg.includes('© OpenStreetMap contributors'));
  assert.ok(diagram.svg.includes('https://www.openstreetmap.org/copyright'));
  await assert.rejects(createDiagram(network, { profile: 'schematic' }), {
    code: 'OSM_PROJECTION_MISMATCH'
  });
  assert.equal(raw.background, undefined);
  assert.throws(
    () => withOpenStreetMap({ ...raw, coordinateSystem: 'planar' }, snapshot),
    { code: 'INVALID_CRS' }
  );
});

test('separated geographic platforms use compact markers and schematic links', async () => {
  const snapshot = await fromOpenStreetMap(context());
  const input = {
    id: 'platforms',
    name: 'Platform groups',
    coordinateSystem: 'wgs84',
    stops: [
      { id: 'a', name: 'A', position: [-0.149, 51.5] },
      { id: 'b', name: 'B', position: [-0.149, 51.51] }
    ],
    routes: [-0.15, -0.148].map((x, i) => ({
      id: 'r' + i,
      shortName: String(i + 1),
      color: i ? '#A91642' : '#005B96',
      paths: [
        {
          stopIds: ['a', 'b'],
          coordinates: [
            [x, 51.5],
            [x, 51.51]
          ],
          stopPositions: { a: [x, 51.5], b: [x, 51.51] },
          startTerminus: false,
          endTerminus: false
        }
      ]
    }))
  };
  const diagram = await createDiagram(withOpenStreetMap(input, snapshot), {
    backgroundStyle: 'atlas',
    width: 1200,
    height: 900
  });
  assert.equal(diagram.qa.passed, true);
  for (const stop of diagram.layout.stops) {
    assert.equal(stop.markers.length, 2);
    assert.equal(stop.connections.length, 1);
    assert.ok(
      stop.markers.every(
        (m) => JSON.stringify(m.endpoints[0]) === JSON.stringify(m.endpoints[1])
      )
    );
  }
  assert.ok(diagram.svg.includes('data-transfer-link="schematic"'));
});
