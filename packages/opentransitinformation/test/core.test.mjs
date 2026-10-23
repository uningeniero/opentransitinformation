// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import {
  createDiagram,
  renderSvg,
  fromText,
  fromGeoJSON,
  fromGtfs,
  parseCsv,
  normalizeNetwork,
  validateNetwork,
  extractDocument,
  confirmExtraction,
  contrast,
  textColor,
  resolveStyle,
  createScenarios
} from '../dist/index.mjs';
import { toHtml } from '../dist/node.mjs';
import { fixture, smallGtfs } from './fixtures.mjs';
import {
  simulateColor,
  auditPalette,
  badgeColors,
  assignRouteColors
} from '../dist/index.mjs';
const opts = { generatedAt: '2026-10-23T00:00:00Z' };
test('shared corridors have stable lanes and complete stop and label coverage', async () => {
  const n = fixture(),
    d = await createDiagram(n, opts);
  assert.equal(d.qa.passed, true);
  assert.equal(d.layout.stops.length, n.stops.length);
  assert.equal(d.layout.labels.length, n.stops.length);
  assert.ok(d.layout.statistics.sharedEdges >= 4);
  assert.ok(d.layout.statistics.maxLaneOffset > 0);
  assert.ok(d.layout.paths.every((p) => p.d && !/NaN|Infinity/.test(p.d)));
  assert.ok(d.layout.paths.some((p) => p.d.includes(' A')));
});
test('output is reproducible with declared generation time', async () => {
  const [a, b] = await Promise.all([
    createDiagram(fixture(), opts),
    createDiagram(fixture(), opts)
  ]);
  assert.equal(a.svg, b.svg);
  assert.deepEqual(a.layout, b.layout);
});
test('labels do not overlap other labels', async () => {
  const d = await createDiagram(fixture(), opts);
  for (let i = 0; i < d.layout.labels.length; i++)
    for (let j = i + 1; j < d.layout.labels.length; j++) {
      const a = d.layout.labels[i].bounds,
        b = d.layout.labels[j].bounds;
      assert.ok(
        !(
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y
        )
      );
    }
});
test('opposite directions keep each route on the same physical lane', async () => {
  const n = fixture();
  n.routes = n.routes.slice(0, 2);
  n.routes[1].paths = [
    { stopIds: [...n.routes[0].paths[0].stopIds].reverse() }
  ];
  n.stops = n.stops.slice(0, 7);
  const d = await createDiagram(n, opts);
  const paths = d.layout.paths;
  assert.equal(paths.length, 2);
  assert.ok(paths[0].offsets.every((v) => v === paths[0].offsets[0]));
  assert.ok(paths[1].offsets.every((v) => v === paths[1].offsets[0]));
  assert.ok(Math.abs(paths[0].points[0][1] - paths[1].points.at(-1)[1]) >= 9.9);
});
test('geometric crossing does not invent a transfer', async () => {
  const n = {
    id: 'cross',
    name: 'Crossing',
    coordinateSystem: 'planar',
    stops: [
      { id: 'a', name: 'A', position: [0, 1] },
      { id: 'b', name: 'B', position: [2, 1] },
      { id: 'c', name: 'C', position: [1, 0] },
      { id: 'd', name: 'D', position: [1, 2] }
    ],
    routes: [
      { id: 'h', shortName: 'H', paths: [{ stopIds: ['a', 'b'] }] },
      { id: 'v', shortName: 'V', paths: [{ stopIds: ['c', 'd'] }] }
    ]
  };
  const d = await createDiagram(n, opts);
  assert.equal(d.layout.stops.length, 4);
  assert.ok(d.layout.stops.every((s) => s.routes.length === 1));
  assert.ok(d.layout.statistics.crossings > 0);
});
test('closed paths and geographic detail are retained', async () => {
  const n = fixture();
  n.routes = [n.routes[3]];
  const d = await createDiagram(n, { ...opts, profile: 'geographic' });
  assert.deepEqual(
    d.layout.paths[0].points[0],
    d.layout.paths[0].points.at(-1)
  );
  assert.ok(
    d.layout.paths[0].points.length >= n.routes[0].paths[0].stopIds.length
  );
});
test('styles check exact contrast and reject reduced readability', () => {
  assert.equal(contrast('#FFFFFF', '#000000'), 21);
  assert.equal(textColor('#FFFF00'), '#000000');
  assert.throws(() => resolveStyle('schematic', { fontSize: 8 }));
  assert.throws(() => resolveStyle('schematic', { lineSpacing: 3 }));
  assert.throws(() => resolveStyle('schematic', { foreground: '#eeeeee' }));
});
test('metadata stays machine readable and all text is escaped', async () => {
  const n = fixture();
  n.name = 'Red <script>alert(1)</script>';
  n.stops[0].name = 'Puerto & "Mar" <>';
  n.metadata.source = 'https://example.test/?x=1&y=2';
  const svg = await renderSvg(n, opts);
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('Puerto &amp;'));
  assert.ok(svg.includes('<metadata>'));
  assert.ok(svg.includes('data-route-id="west-east"'));
});
test('duplicate identifiers and unknown stop references fail before rendering', () => {
  const n = fixture();
  n.stops[1].id = n.stops[0].id;
  assert.equal(validateNetwork(n).valid, false);
  const b = fixture();
  b.routes[0].paths[0].stopIds.push('absent');
  assert.throws(
    () => normalizeNetwork(b),
    (e) => e.code === 'UNKNOWN_STOP'
  );
});
test('non-finite and invalid geographic positions are rejected', () => {
  const n = fixture();
  n.stops[0].position = [NaN, 0];
  assert.throws(() => normalizeNetwork(n));
  n.stops[0].position = [181, 40];
  n.coordinateSystem = 'wgs84';
  assert.throws(() => normalizeNetwork(n));
});
test('editorial label changes require provenance', () => {
  const n = fixture();
  n.constraints = [{ kind: 'label-side', targetId: 's0', value: 'left' }];
  assert.throws(() => normalizeNetwork(n));
  n.constraints[0].author = 'Reviewer';
  n.constraints[0].reason = 'Avoid landmark';
  assert.equal(normalizeNetwork(n).constraints.length, 1);
});
test('CSV parser handles BOM, quoted separators, escaped quotes and multiline values', () => {
  const rows = parseCsv(
    '\uFEFFid,name\r\n1,"A, B"\r\n2,"A ""quote""\nnext"\r\n'
  );
  assert.equal(rows[0].name, 'A, B');
  assert.equal(rows[1].name, 'A "quote"\nnext');
  assert.throws(() => parseCsv('a,b\n1'));
  assert.throws(() => parseCsv('a,a\n1,2'));
  assert.throws(() => parseCsv('a\n"broken'));
});
test('CSV __proto__ is data rather than prototype mutation', () => {
  const [row] = parseCsv('__proto__,value\nhello,world');
  assert.equal(Object.getPrototypeOf(row), null);
  assert.equal(row.__proto__, 'hello');
});
test('GTFS orders stop times and shape points and preserves accessibility unknown', () => {
  const n = fromGtfs(smallGtfs(), { date: '20261023' });
  assert.deepEqual(n.routes[0].paths[0].stopIds, ['a', 'b', 'c']);
  assert.deepEqual(n.routes[0].paths[0].coordinates[0], [-1.8, 43.3]);
  assert.equal(n.routes[0].paths.length, 1);
  assert.equal(n.stops.find((s) => s.id === 'a').accessible, true);
  assert.equal(n.stops.find((s) => s.id === 'b').accessible, null);
  assert.equal(n.stops.find((s) => s.id === 'c').accessible, false);
});
test('GTFS service exceptions override calendar and exclude inactive trips', () => {
  const t = smallGtfs();
  t.calendar_dates = [
    { service_id: 'weekday', date: '20261023', exception_type: '2' },
    { service_id: 'weekend', date: '20261023', exception_type: '1' }
  ];
  const n = fromGtfs(t, { date: '20261023' });
  assert.deepEqual(n.routes[0].paths[0].stopIds, ['c', 'b', 'a']);
  assert.throws(() => fromGtfs(t, { date: '20260230' }));
});
test('GTFS ZIP content can be installed and imported without extraction to disk', () => {
  const t = smallGtfs();
  const files = {};
  for (const [k, rows] of Object.entries(t)) {
    const headers = Object.keys(rows[0]);
    files[`${k}.txt`] = strToU8(
      headers.join(',') +
        '\n' +
        rows.map((r) => headers.map((h) => r[h] ?? '').join(',')).join('\n')
    );
  }
  const n = fromGtfs(zipSync(files));
  assert.equal(n.routes.length, 1);
  assert.equal(n.routes[0].paths.length, 2);
});
test('GTFS rejects duplicate trip ids and missing stop identifiers', () => {
  const t = smallGtfs();
  t.trips.push({ ...t.trips[0] });
  assert.throws(() => fromGtfs(t));
  const b = smallGtfs();
  b.stop_times[0].stop_id = 'missing';
  assert.throws(() => fromGtfs(b));
});
test('GeoJSON requires explicit stop order and preserves context layers', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-1.8, 43.3] },
        properties: { stop_id: 'a', stop_name: 'A' }
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-1.7, 43.4] },
        properties: { stop_id: 'b', stop_name: 'B' }
      },
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-1.8, 43.3],
            [-1.7, 43.4]
          ]
        },
        properties: {
          route_id: 'r',
          route_short_name: '1',
          stop_ids: ['a', 'b']
        }
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-1.9, 43.2],
              [-1.6, 43.2],
              [-1.6, 43.25],
              [-1.9, 43.2]
            ]
          ]
        },
        properties: { kind: 'water' }
      }
    ]
  };
  const n = fromGeoJSON(collection);
  assert.equal(n.background[0].kind, 'water');
  delete collection.features[2].properties.stop_ids;
  assert.throws(
    () => fromGeoJSON(collection),
    (e) => e.code === 'STOP_SEQUENCE_REQUIRED'
  );
});
test('text import provides a schematic graph without inventing WGS84 coordinates', async () => {
  const n = await fromText('1: A > B > C\n2: D -> B -> E');
  assert.equal(n.coordinateSystem, 'planar');
  assert.equal(n.stops.length, 5);
  assert.equal(n.routes.length, 2);
  assert.ok(n.stops.every((s) => s.position.every(Number.isFinite)));
  assert.equal((await createDiagram(n, opts)).qa.passed, true);
});
test('document extraction stays blocked until an explicit review', async () => {
  const draft = await extractDocument(new Uint8Array([1]), {
    mimeType: 'image/png',
    extractor: async () => ({
      network: fixture(),
      confidence: 0.8,
      evidence: [{ page: 1 }],
      issues: ['Check stop spelling']
    })
  });
  assert.equal(draft.reviewed, false);
  await assert.rejects(
    () => createDiagram(draft),
    (e) => e.code === 'REVIEW_REQUIRED'
  );
  assert.throws(() => confirmExtraction(draft, {}));
  const n = confirmExtraction(draft, {
    author: 'Reviewer',
    reason: 'Compared to source'
  });
  assert.equal(n.metadata.extraction.review.author, 'Reviewer');
  await assert.rejects(
    () => extractDocument('x', { mimeType: 'image/png' }),
    (e) => e.code === 'EXTRACTOR_REQUIRED'
  );
});
test('scenarios use the same frame and preserve the lane of a route', async () => {
  const n = fixture();
  const result = await createScenarios(
    n,
    [
      { id: 'all', name: 'Todas', routeIds: n.routes.map((r) => r.id) },
      { id: 'one', name: 'Solo 1', routeIds: ['west-east'] }
    ],
    opts
  );
  assert.equal(result[0].diagram.layout.width, result[1].diagram.layout.width);
  const a = result[0].diagram.layout.paths.find(
      (p) => p.routeId === 'west-east'
    ),
    b = result[1].diagram.layout.paths[0];
  assert.equal(a.d, b.d);
  assert.deepEqual(a.offsets, b.offsets);
});
test('offline HTML has embedded engine, font and safe script data', async () => {
  const n = fixture();
  n.name = '</script><script>alert(1)</script>';
  const html = await toHtml(n, opts);
  assert.ok(html.includes('OTI.configureAssets'));
  assert.ok(!html.includes('src="https://'));
  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes('<html lang="en">'));
});
test('unsupported glyphs fail strict rendering instead of silent substitution', async () => {
  const n = fixture();
  n.stops[0].name = '東京';
  await assert.rejects(
    () => createDiagram(n, opts),
    (e) =>
      e.code === 'QUALITY_GATE_FAILED' &&
      e.details.issues.some((i) => i.code === 'FONT_GLYPH_MISSING')
  );
  const d = await createDiagram(n, { ...opts, strict: false });
  assert.equal(d.qa.passed, false);
});
test('invalid dimensions fail without a malformed output', async () => {
  await assert.rejects(
    () => createDiagram(fixture(), { width: 100 }),
    (e) => e.code === 'ENGINE_ERROR'
  );
  await assert.rejects(
    () => createDiagram(fixture(), { activeRoutes: ['not-found'] }),
    (e) => e.code === 'INVALID_SCENARIO'
  );
});
test('all four public design profiles pass their default quality gate', async () => {
  for (const profile of ['schematic', 'geographic', 'print', 'highContrast']) {
    const d = await createDiagram(fixture(), { ...opts, profile });
    assert.equal(d.qa.passed, true);
    for (const r of d.network.routes) {
      const badge = badgeColors(r.color, d.style);
      assert.ok(
        contrast(badge.background, badge.foreground) >= d.style.textContrast
      );
    }
  }
});
test('colour vision diagnostics retain neutral endpoints and flag shared identical colours', () => {
  for (const simulation of ['protan', 'deutan', 'tritan', 'grayscale']) {
    assert.equal(simulateColor('#000000', simulation), '#000000');
    assert.equal(simulateColor('#FFFFFF', simulation), '#FFFFFF');
  }
  assert.equal(simulateColor('#FF0000', 'deutan'), '#A39000');
  const routes = fixture().routes.slice(0, 2);
  routes[1].color = routes[0].color;
  assert.ok(auditPalette(routes).issues.some((i) => i.simulation === 'deutan'));
  assert.throws(() => simulateColor('#invalid'));
});
test('contrast thresholds and font family cannot bypass safeguards', () => {
  assert.throws(() => resolveStyle('highContrast', { textContrast: 1 }));
  assert.throws(() => resolveStyle('schematic', { graphicContrast: 0 }));
  assert.throws(() =>
    resolveStyle('schematic', { fontFamily: "x';}body{color:red}" })
  );
});
test('non-finite render options fail before entering the engine', async () => {
  await assert.rejects(
    () => createDiagram(fixture(), { width: NaN }),
    (e) => e.code === 'INVALID_OPTIONS'
  );
  await assert.rejects(
    () => createDiagram(fixture(), { bounds: [0, NaN, 1, 2] }),
    (e) => e.code === 'INVALID_OPTIONS'
  );
});
test('conflation aligns differently sampled shared routes within its declared bound', async () => {
  const n = {
    id: 'conflation',
    name: 'Shared corridor',
    coordinateSystem: 'planar',
    stops: [
      { id: 'a', name: 'A', position: [0, 0] },
      { id: 'b', name: 'B', position: [100, 0] },
      { id: 'c', name: 'C', position: [200, 0] }
    ],
    routes: [
      {
        id: 'one',
        shortName: '1',
        paths: [
          {
            stopIds: ['a', 'b', 'c'],
            coordinates: [
              [0, 0],
              [100, 0],
              [200, 0]
            ]
          }
        ]
      },
      {
        id: 'two',
        shortName: '2',
        paths: [
          {
            stopIds: ['a', 'b', 'c'],
            coordinates: [
              [0, 0.1],
              [40, 0.1],
              [90, 0.1],
              [160, 0.1],
              [200, 0.1]
            ]
          }
        ]
      }
    ]
  };
  const d = await createDiagram(n, {
    ...opts,
    profile: 'geographic',
    corridorTolerance: 2
  });
  assert.ok(d.layout.statistics.sharedEdges > 0);
  assert.ok(d.layout.statistics.matchedCorridorSamples > 0);
  assert.ok(d.layout.statistics.maxCorridorDisplacement <= 2);
});
test('source identifiers with spaces and percent signs survive XML and token encoding', async () => {
  const n = fixture();
  n.routes[0].id = 'route 1%';
  const d = await createDiagram(n, opts);
  assert.ok(d.svg.includes('data-route-id="route 1%"'));
  assert.ok(d.svg.includes('route%201%25'));
  const ids = [...d.svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size);
});
test('published WASM has no profiling or external host imports', async () => {
  const bytes = await readFile(
    new URL('../dist/oti_engine.wasm', import.meta.url)
  );
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.deepEqual(
    WebAssembly.Module.exports(module)
      .filter((e) => e.kind === 'function')
      .map((e) => e.name)
      .sort(),
    ['oti_alloc', 'oti_free', 'oti_run']
  );
});
test('adaptive colours are deterministic, preserve routes and retain source assignments', () => {
  const n = fixture();
  n.routes.forEach((r) => (r.color = '#FFFFFF'));
  const a = assignRouteColors(n),
    b = assignRouteColors(n);
  assert.deepEqual(a, b);
  assert.ok(new Set(a.routes.map((r) => r.color)).size > 1);
  assert.ok(n.routes.every((r) => r.color === '#FFFFFF'));
  assert.deepEqual(
    a.routes.map((r) => r.paths),
    n.routes.map((r) => r.paths)
  );
  assert.ok(
    Object.values(assignRouteColors(a).metadata.colorPolicy.sourceColors).every(
      (c) => c === '#FFFFFF'
    )
  );
});
test('strict output rejects unsupported glyphs with an explicit draft available', async () => {
  const n = fixture();
  n.name = '東京';
  await assert.rejects(
    () => createDiagram(n, opts),
    (e) => e.code === 'QUALITY_GATE_FAILED'
  );
  assert.equal(
    (await createDiagram(n, { ...opts, strict: false })).qa.passed,
    false
  );
});
test('WASM interface rejects malformed JSON and handles Unicode surrogate pairs', async () => {
  const bytes = await readFile(
    new URL('../dist/oti_engine.wasm', import.meta.url)
  );
  const { instance } = await WebAssembly.instantiate(bytes);
  const e = instance.exports;
  for (const raw of [
    '{"network": [}',
    '{"x":1,"x":2}',
    '{"a":"\\ud800"}',
    '{"a":1e999}'
  ]) {
    const b = new TextEncoder().encode(raw),
      ptr = e.oti_alloc(b.length);
    new Uint8Array(e.memory.buffer, ptr, b.length).set(b);
    const out = e.oti_run(ptr, b.length),
      size = new DataView(e.memory.buffer).getUint32(out, true),
      value = JSON.parse(
        new TextDecoder().decode(new Uint8Array(e.memory.buffer, out + 4, size))
      );
    assert.ok(value.error);
    e.oti_free(ptr, b.length);
    e.oti_free(out, size + 4);
  }
});
