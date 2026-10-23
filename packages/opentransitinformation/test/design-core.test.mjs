// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagram } from '../dist/index.mjs';
import { toHtml } from '../dist/node.mjs';
import { fixture } from './fixtures.mjs';
const options = {
  width: 1200,
  height: 760,
  autoExpand: false,
  generatedAt: '2026-10-23T00:00:00Z'
};

test('a straight trunk stays straight through entering and departing branches', async () => {
  const d = await createDiagram(fixture(), options);
  const p = d.layout.paths.find((p) => p.routeId === 'west-east');
  assert.ok(
    Math.max(...p.points.map((p) => p[1])) -
      Math.min(...p.points.map((p) => p[1])) <
      1e-8
  );
  assert.ok(p.offsets.every((v) => v === p.offsets[0]));
  assert.equal(d.layout.labels.find((l) => l.stopId === 's3').leader, null);
});

test('reversing route sequences and route order keeps the same physical corridor', async () => {
  const n = fixture(),
    reversed = structuredClone(n);
  reversed.routes.reverse();
  for (const r of reversed.routes) for (const p of r.paths) p.stopIds.reverse();
  const a = await createDiagram(n, options),
    b = await createDiagram(reversed, options);
  for (const pa of a.layout.paths) {
    const pb = b.layout.paths.find(
      (p) => p.routeId === pa.routeId && p.part === pa.part
    );
    const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    for (const p of pa.points)
      assert.ok(
        Math.min(...pb.points.map((q) => distance(p, q))) < 0.001,
        pa.routeId
      );
  }
});

test('non-overlapping local branches reuse one lane instead of creating empty slots', async () => {
  const n = fixture();
  n.stops = [];
  n.routes = [];
  const trunk = [];
  for (let i = 0; i < 16; i++) {
    const id = 't' + i;
    trunk.push(id);
    n.stops.push({ id, name: 'Stop ' + i, position: [i, 0] });
    if (i > 0 && i < 15) {
      const branch = 'b' + i;
      n.stops.push({
        id: branch,
        name: 'Branch ' + i,
        position: [i, i % 2 ? 3 : -3]
      });
      n.routes.push({
        id: 'branch' + i,
        shortName: String(i + 1),
        color: '#005B96',
        paths: [{ stopIds: [branch, id, 't' + (i + 1)] }]
      });
    }
  }
  n.routes.push({
    id: 'main',
    shortName: 'T',
    color: '#A91642',
    paths: [{ stopIds: trunk }]
  });
  const d = await createDiagram(n, { ...options, strict: false });
  assert.ok(d.layout.statistics.maximumCorridorLanes <= 2);
  assert.ok(d.layout.statistics.maxLaneOffset <= d.style.lineSpacing);
});

test('accessibility belongs to the measured label and does not inflate station markers', async () => {
  const n = fixture(),
    unknown = structuredClone(n);
  for (const s of unknown.stops) s.accessible = null;
  const a = await createDiagram(n, options),
    b = await createDiagram(unknown, options);
  for (const s of a.layout.stops)
    assert.equal(s.radius, b.layout.stops.find((t) => t.id === s.id).radius);
  assert.equal(a.metrics.s3.accessWidth, 22);
  assert.equal(b.metrics.s3.accessWidth, 0);
  assert.match(a.svg, /oti-accessibility/);
});

test('a closed loop rounds every corner and has no artificial passenger terminus', async () => {
  const n = fixture();
  n.routes = [
    {
      id: 'loop',
      shortName: 'C',
      color: '#005B96',
      paths: [{ stopIds: ['s0', 's6', 's11', 's12', 's0'] }]
    }
  ];
  n.stops = n.stops.filter((s) => ['s0', 's6', 's11', 's12'].includes(s.id));
  const d = await createDiagram(n, options),
    p = d.layout.paths[0];
  assert.ok(d.layout.stops.every((s) => !s.terminal));
  assert.ok(Object.values(d.metrics).every((m) => m.codes.length === 0));
  assert.ok((p.d.match(/ A/g) || []).length >= 4);
  assert.deepEqual(p.points[0], p.points.at(-1));
  assert.ok(p.d.endsWith(' Z'));
});

test('station capsules follow a consistent eight-direction axis', async () => {
  const d = await createDiagram(fixture(), options);
  for (const s of d.layout.stops.filter((s) => s.symbolKind === 'capsule')) {
    const [[ax, ay], [bx, by]] = s.endpoints;
    const dx = Math.abs(ax - bx),
      dy = Math.abs(ay - by);
    assert.ok(dx < 0.001 || dy < 0.001 || Math.abs(dx - dy) < 0.001, s.id);
  }
});

test('distinct nearby stations fail strict QA rather than being visually merged', async () => {
  const n = {
    id: 'crowded',
    name: 'Crowded',
    coordinateSystem: 'planar',
    stops: [
      { id: 'a', name: 'A', position: [0, 0] },
      { id: 'b', name: 'B', position: [0.0001, 0] },
      { id: 'c', name: 'C', position: [10, 0] }
    ],
    routes: [{ id: 'r', shortName: 'R', paths: [{ stopIds: ['a', 'b', 'c'] }] }]
  };
  await assert.rejects(
    createDiagram(n, options),
    (e) =>
      e.code === 'QUALITY_GATE_FAILED' &&
      e.details.issues.some((i) => i.code === 'STOP_SYMBOL_OVERLAP')
  );
  const draft = await createDiagram(n, { ...options, strict: false });
  assert.equal(draft.qa.passed, false);
  assert.equal(draft.layout.stops.length, 3);
});

test('reserved object property names remain valid measured stop identifiers', async () => {
  const n = {
    id: 'reserved',
    name: 'Reserved',
    coordinateSystem: 'planar',
    stops: [
      { id: '__proto__', name: 'Origin', position: [0, 0] },
      { id: 'constructor', name: 'Destination', position: [5, 0] }
    ],
    routes: [
      {
        id: 'r',
        shortName: 'R',
        paths: [{ stopIds: ['__proto__', 'constructor'] }]
      }
    ]
  };
  const d = await createDiagram(n, options);
  assert.equal(d.layout.labels.length, 2);
  assert.ok(d.metrics.__proto__.width > 0);
  assert.ok(d.metrics.constructor.width > 0);
});

test('a route casing responds to actual context colours rather than the page alone', async () => {
  const n = fixture();
  for (const r of n.routes) r.color = '#6A6A6A';
  n.background = [
    {
      kind: 'urban',
      coordinates: [
        [
          [-20, -20],
          [20, -20],
          [20, 20],
          [-20, 20],
          [-20, -20]
        ]
      ]
    }
  ];
  const d = await createDiagram(n, { ...options, style: { urban: '#B0B0B0' } });
  assert.match(d.svg, /<path class="casing"[^>]+stroke="#162536"/);
  assert.ok(d.qa.checks.minimumGraphicContrast >= 3);
});

test('dual casings protect mixed context surfaces and reject insufficient lane spacing', async () => {
  const n = fixture();
  for (const r of n.routes) r.color = '#777777';
  n.background = [
    {
      kind: 'urban',
      coordinates: [
        [
          [-20, -20],
          [20, -20],
          [20, 20],
          [-20, 20],
          [-20, -20]
        ]
      ]
    },
    {
      kind: 'water',
      coordinates: [
        [
          [-8, 1],
          [8, 1],
          [8, 6],
          [-8, 6],
          [-8, 1]
        ]
      ]
    }
  ];
  const style = { urban: '#777777', water: '#000000', casing: '#777777' };
  const d = await createDiagram(n, { ...options, style });
  assert.match(d.svg, /<path class="casing"[^>]+stroke="#FFFFFF"/);
  assert.match(d.svg, /<path class="casing"[^>]+stroke="#000000"/);
  assert.ok(d.qa.checks.minimumGraphicContrast >= 3);
  await assert.rejects(
    createDiagram(n, { ...options, style: { ...style, lineSpacing: 8 } }),
    (e) =>
      e.code === 'QUALITY_GATE_FAILED' &&
      e.details.issues.some((i) => i.code === 'BACKGROUND_CASING_SPACE')
  );
});

test('product copy defaults to English while Spanish remains an explicit locale', async () => {
  const n = fixture();
  const en = await toHtml(n, options),
    es = await toHtml(n, { ...options, locale: 'es' });
  assert.match(en, /<html lang="en">/);
  assert.match(es, /<html lang="es">/);
  const a = await createDiagram(n, options),
    b = await createDiagram(n, { ...options, locale: 'es' });
  assert.match(a.svg, /Routes/);
  assert.match(b.svg, /Líneas/);
  assert.deepEqual(a.layout.paths, b.layout.paths);
  assert.deepEqual(a.layout.labels, b.layout.labels);
  await assert.rejects(
    createDiagram(n, { locale: 'unknown' }),
    /Unsupported locale/
  );
});

test('thin subordinate rail strokes do not add a dark outline to the whole route', async () => {
  const n = fixture();
  n.background = [
    {
      kind: 'rail',
      geometry: 'line',
      coordinates: [
        [
          [-10, 6],
          [10, 6]
        ]
      ]
    }
  ];
  const d = await createDiagram(n, { ...options, style: { rail: '#20754A' } });
  const group = d.svg.split('data-route-id="airport"')[1].split('</g>')[0];
  assert.match(group, /<path class="casing"[^>]+stroke="#FFFFFF"/);
  assert.doesNotMatch(group, /<path class="casing"[^>]+stroke="#162536"/);
});
