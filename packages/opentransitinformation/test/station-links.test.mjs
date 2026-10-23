// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagram } from '../dist/index.mjs';

const options = {
  width: 1200,
  height: 760,
  autoExpand: false,
  generatedAt: '2026-10-23T00:00:00Z'
};
function interchangeNetwork() {
  const points = [
    ['a', 'West', -6, 0],
    ['b', 'Market', -4, 0],
    ['c', 'Gardens', -2, 0],
    ['d', 'Central', 0, 0],
    ['e', 'University', 2, 0],
    ['f', 'Museum', 4, 0],
    ['g', 'East', 6, 0],
    ['n', 'North', 0, -4],
    ['s', 'South', -2, 4],
    ['ne', 'Northeast', 4, -3]
  ];
  const routes = [
    ['blue', '1', '#005B96', ['a', 'b', 'c', 'd', 'e', 'f', 'g']],
    ['red', '2', '#A91642', ['n', 'd', 'e', 'f', 'ne']],
    ['green', 'A', '#20754A', ['s', 'c', 'd', 'n']],
    ['purple', 'C', '#6D3E91', ['b', 'n', 'd', 'c', 'b']]
  ];
  return {
    id: 'station-link-regression',
    name: 'Complex interchange regression',
    coordinateSystem: 'planar',
    stops: points.map(([id, name, x, y]) => ({ id, name, position: [x, y] })),
    routes: routes.map(([id, shortName, color, stopIds]) => ({
      id,
      shortName,
      name: `Route ${shortName}`,
      color,
      paths: [{ stopIds }]
    })),
    metadata: {
      source: 'Synthetic station-link regression fixture',
      license: 'CC0-1.0',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31'
    }
  };
}

// This oracle measures the final primitives; it never constructs a route or station layout.
function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const denominator = dx * dx + dy * dy;
  const t =
    denominator === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denominator)
        );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function segmentDistance(a, b, c, d) {
  const cross = (x, y) => x[0] * y[1] - x[1] * y[0];
  const subtract = (x, y) => [x[0] - y[0], x[1] - y[1]];
  const ab = subtract(b, a),
    cd = subtract(d, c),
    determinant = cross(ab, cd);
  if (Math.abs(determinant) > 1e-12) {
    const t = cross(subtract(c, a), cd) / determinant;
    const u = cross(subtract(c, a), ab) / determinant;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b)
  );
}

test('a transfer crossing an unserved route is diagnosed and rejected in strict output', async () => {
  const network = interchangeNetwork();
  network.stops.push(
    { id: 'independent-west', name: 'Independent West', position: [-1, -3.7] },
    { id: 'independent-east', name: 'Independent East', position: [1, -3.7] }
  );
  network.routes.push({
    id: 'independent',
    shortName: 'X',
    name: 'Independent route',
    color: '#9C4C00',
    paths: [{ stopIds: ['independent-west', 'independent-east'] }]
  });
  const draft = await createDiagram(network, { ...options, strict: false });
  const hasCrossing = (qa) =>
    qa.issues.some(
      (issue) =>
        issue.code === 'STATION_CROSSES_UNSERVED_ROUTE' &&
        issue.targetId === 'n' &&
        issue.severity === 'error'
    );
  assert.equal(draft.qa.passed, false);
  assert.ok(
    hasCrossing(draft.qa),
    'The crossing must identify the affected interchange'
  );
  assert.ok(
    !draft.layout.stops
      .find((stop) => stop.id === 'n')
      .routes.includes('independent'),
    'A geometric crossing must never invent route membership'
  );
  await assert.rejects(
    createDiagram(network, options),
    (error) =>
      error.code === 'QUALITY_GATE_FAILED' && hasCrossing(error.details)
  );
});

test('markers within one interchange have non-overlapping visible outlines', async () => {
  const diagram = await createDiagram(interchangeNetwork(), options);
  let measuredPairs = 0;
  for (const stop of diagram.layout.stops) {
    assert.ok(
      stop.markers.length > 0,
      `Missing marker geometry for ${stop.id}`
    );
    for (let i = 0; i < stop.markers.length; i++) {
      for (let j = i + 1; j < stop.markers.length; j++) {
        const a = stop.markers[i],
          b = stop.markers[j];
        const centerlineDistance = segmentDistance(
          ...a.endpoints,
          ...b.endpoints
        );
        // Each SVG marker has a 2px outline, extending 1px beyond its fill radius.
        const inkClearance = centerlineDistance - a.radius - b.radius - 2;
        assert.ok(
          inkClearance >= -1e-5,
          `Visible marker outlines overlap by ${(-inkClearance).toFixed(4)}px at ${stop.id}`
        );
        measuredPairs++;
      }
    }
  }
  assert.ok(
    measuredPairs > 0,
    'The fixture must exercise separated markers inside a shared station'
  );
});
