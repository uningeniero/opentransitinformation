// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagram, fromGeoJSON, resolveStyle } from '../dist/index.mjs';
import { backgroundPaint } from '../src/background.mjs';

const options = {
  generatedAt: '2026-10-23T00:00:00Z',
  width: 1200,
  height: 900,
  autoExpand: false
};
function network() {
  return {
    id: 'context-test',
    name: 'Context map',
    coordinateSystem: 'planar',
    stops: [
      { id: 'a', name: 'North West', position: [0, 0] },
      { id: 'b', name: 'North East', position: [10, 0] },
      { id: 'c', name: 'South East', position: [10, 10] },
      { id: 'd', name: 'South West', position: [0, 10] }
    ],
    routes: [
      {
        id: 'perimeter',
        shortName: 'P',
        color: '#005B96',
        paths: [{ stopIds: ['a', 'b', 'c', 'd'] }]
      }
    ],
    background: [],
    metadata: {
      source: 'Synthetic context test',
      license: 'CC0-1.0',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31'
    }
  };
}
const square = (x, y, width, height) => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height],
  [x, y]
];
const overlaps = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

test('background paint profiles adapt to dark surfaces without changing network style', () => {
  const style = resolveStyle('schematic');
  const before = JSON.stringify(style);
  const atlas = backgroundPaint(style, 'atlas');
  const subtle = backgroundPaint(style, 'subtle');
  assert.notEqual(atlas.colors.water, subtle.colors.water);
  const dark = resolveStyle('schematic', {
    background: '#101C28',
    foreground: '#FFFFFF',
    muted: '#CAD4DE',
    casing: '#FFFFFF'
  });
  assert.notEqual(
    backgroundPaint(dark, 'atlas').colors.water,
    atlas.colors.water
  );
  assert.equal(JSON.stringify(style), before);
  assert.throws(() => backgroundPaint(style, 'unknown'), /backgroundStyle/);
});

test('large optional backgrounds preserve every transport coordinate and label', async () => {
  const n = network();
  const base = await createDiagram(n, options);
  n.background = [
    {
      id: 'remote-land',
      kind: 'land',
      geometry: 'polygon',
      coordinates: [square(-100, -100, 200, 200)]
    }
  ];
  const contextual = await createDiagram(n, {
    ...options,
    backgroundStyle: 'atlas'
  });
  assert.deepEqual(contextual.layout.paths, base.layout.paths);
  assert.deepEqual(contextual.layout.stops, base.layout.stops);
  assert.deepEqual(contextual.layout.labels, base.layout.labels);
  assert.deepEqual(contextual.layout.mapBounds, base.layout.mapBounds);
  assert.match(contextual.svg, /<clipPath[^>]+clipPathUnits="userSpaceOnUse"/);
  assert.match(contextual.svg, /data-layer="background"[^>]+clip-path="url\(#/);
  const none = await createDiagram(n, { ...options, backgroundStyle: 'none' });
  assert.deepEqual(none.layout.contextLabels, []);
  assert.doesNotMatch(none.svg, /data-layer="background"/);
  assert.deepEqual(none.layout.labels, base.layout.labels);
});

test('water polygons preserve holes and context names never occupy an island or transit label', async () => {
  const n = network();
  n.background = [
    {
      id: 'water',
      kind: 'water',
      geometry: 'polygon',
      name: 'Estuary',
      coordinates: [square(2, 2, 6, 6), square(4, 4, 2, 2)]
    }
  ];
  const d = await createDiagram(n, { ...options, backgroundStyle: 'atlas' });
  assert.equal(d.layout.background[0].coordinates.length, 2);
  assert.match(d.svg, /fill-rule="evenodd"/);
  assert.equal(d.layout.contextLabels.length, 1);
  const hole = d.layout.background[0].coordinates[1];
  const xs = hole.map((p) => p[0]),
    ys = hole.map((p) => p[1]);
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
  const label = d.layout.contextLabels[0].bounds;
  assert.equal(overlaps(label, box), false);
  assert.ok(d.layout.labels.every((other) => !overlaps(label, other.bounds)));
});

test('horizontal river lines remain open and may receive a secondary context name', async () => {
  const n = network();
  n.background = [
    {
      id: 'river',
      kind: 'water',
      geometry: 'line',
      name: 'River',
      coordinates: [
        [
          [1, 5],
          [4, 5.001],
          [7, 5],
          [9, 5]
        ]
      ]
    }
  ];
  const original = structuredClone(n);
  const d = await createDiagram(n, {
    ...options,
    backgroundStyle: 'atlas',
    backgroundSimplification: 1
  });
  assert.deepEqual(n, original);
  assert.equal(d.layout.background[0].geometry, 'line');
  assert.equal(d.layout.background[0].coordinates[0].length, 2);
  assert.equal(d.layout.contextLabels.length, 1);
  const layer = d.svg.match(/data-layer="water">([\s\S]*?)<\/g>/)?.[1];
  assert.ok(layer);
  assert.doesNotMatch(layer, / Z/);
  assert.match(layer, /fill="none"/);
});

test('degenerate polygon areas fail before publication-quality output', async () => {
  const n = network();
  n.background = [
    {
      kind: 'water',
      geometry: 'polygon',
      coordinates: [
        [
          [1, 1],
          [2, 2],
          [3, 3],
          [1, 1]
        ]
      ]
    }
  ];
  await assert.rejects(createDiagram(n, options), /Invalid polygon ring/);
});

test('context names are escaped, secondary and never interpreted as markup', async () => {
  const n = network();
  n.background = [
    {
      id: 'park',
      kind: 'park',
      geometry: 'polygon',
      name: '<script>park</script>',
      coordinates: [square(1, 1, 8, 8)]
    }
  ];
  const d = await createDiagram(n, options);
  assert.doesNotMatch(d.svg, /<script>/);
  assert.match(d.svg, /&lt;script&gt;park&lt;\/script&gt;/);
});

test('GeoJSON MultiPolygon keeps one feature per polygon and its inner rings', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { stop_id: 'a', stop_name: 'A' },
        geometry: { type: 'Point', coordinates: [0, 0] }
      },
      {
        type: 'Feature',
        properties: { stop_id: 'b', stop_name: 'B' },
        geometry: { type: 'Point', coordinates: [10, 10] }
      },
      {
        type: 'Feature',
        properties: {
          route_id: 'r',
          route_short_name: 'R',
          stop_ids: ['a', 'b']
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [10, 10]
          ]
        }
      },
      {
        type: 'Feature',
        id: 'archipelago',
        properties: { kind: 'park', name: 'Island Park' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [square(1, 1, 3, 3), square(2, 2, 1, 1)],
            [square(6, 6, 2, 2)]
          ]
        }
      }
    ]
  };
  const n = fromGeoJSON(collection, { coordinateSystem: 'planar' });
  assert.equal(n.background.length, 2);
  assert.deepEqual(
    n.background.map((f) => f.geometry),
    ['polygon', 'polygon']
  );
  assert.deepEqual(
    n.background.map((f) => f.coordinates.length),
    [2, 1]
  );
  assert.equal(new Set(n.background.map((f) => f.id)).size, 2);
});
