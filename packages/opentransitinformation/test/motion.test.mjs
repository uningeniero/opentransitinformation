// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiagram,
  createMotionPlan,
  motionFrame
} from '../dist/index.mjs';
import { fixture } from './fixtures.mjs';

const common = { generatedAt: '2026-10-23T00:00:00Z' };
test('motion uses the same static geometry and deterministic actual route frames', async () => {
  const base = await createDiagram(fixture(), common);
  const options = {
    mode: 'demo',
    durationMs: 8000,
    fps: 30,
    dwellMs: 100,
    vehicles: [{ id: 'one', routeId: 'west-east', phase: 0.15 }]
  };
  const withMotion = await createDiagram(fixture(), {
    ...common,
    motion: options
  });
  assert.equal(withMotion.svg, base.svg);
  assert.deepEqual(withMotion.layout, base.layout);
  assert.deepEqual(withMotion.motion, await createMotionPlan(base, options));
  assert.equal(withMotion.motion.vehicles[0].routeId, 'west-east');
  const a = motionFrame(withMotion.motion, 0),
    b = motionFrame(withMotion.motion, 1000);
  assert.notDeepEqual(a.vehicles[0].position, b.vehicles[0].position);
  assert.deepEqual(motionFrame(withMotion.motion, 8000), a);
  assert.ok(withMotion.layout.paths[0].motionStops.length);
});
test('frames remain on their chosen part, use distance and dwell only at declared stops', async () => {
  const diagram = {
    network: { id: 'synthetic' },
    layout: {
      width: 200,
      height: 100,
      paths: [
        {
          routeId: 'line',
          part: 0,
          points: [
            [0, 0],
            [90, 0],
            [90, 10]
          ],
          motionStops: [{ id: 'real-stop', fraction: 0.5 }]
        },
        {
          routeId: 'line',
          part: 1,
          points: [
            [500, 0],
            [600, 0]
          ]
        }
      ]
    }
  };
  const plan = await createMotionPlan(diagram, {
    mode: 'demo',
    durationMs: 4000,
    fps: 10,
    dwellMs: 200,
    vehicles: [{ id: 'v', routeId: 'line', part: 0, phase: 0 }]
  });
  assert.deepEqual(motionFrame(plan, 1900).vehicles[0].position, [50, 0]);
  assert.equal(motionFrame(plan, 1900).vehicles[0].stopId, 'real-stop');
  assert.deepEqual(motionFrame(plan, 2000).vehicles[0].position, [50, 0]);
  assert.ok(plan.vehicles[0].frames.every((f) => f[0] <= 90 && f[1] <= 10));
  assert.equal(plan.vehicles[0].frames[0][4], 0);
  await assert.rejects(
    createMotionPlan(diagram, {
      mode: 'demo',
      vehicles: [{ id: 'v', routeId: 'line', part: 2 }]
    }),
    /unavailable/
  );
  assert.throws(() => motionFrame(plan, -1), /non-negative/);
});
test('invalid mode, duplicate identities, geometry and frame budgets are rejected', async () => {
  const diagram = {
    network: { id: 's' },
    layout: {
      width: 100,
      height: 100,
      paths: [
        {
          routeId: 'a',
          part: 0,
          points: [
            [0, 0],
            [1, 1]
          ]
        }
      ]
    }
  };
  await assert.rejects(createMotionPlan(diagram, {}), /demo/);
  await assert.rejects(
    createMotionPlan(diagram, {
      mode: 'demo',
      vehicles: [
        { id: 'x', routeId: 'a' },
        { id: 'x', routeId: 'a' }
      ]
    }),
    /unique/
  );
  await assert.rejects(
    createMotionPlan(diagram, {
      mode: 'demo',
      durationMs: 120000,
      fps: 60,
      vehicles: Array.from({ length: 16 }, (_, i) => ({
        id: String(i),
        routeId: 'a'
      }))
    }),
    /budget/
  );
  await assert.rejects(
    createMotionPlan(
      {
        ...diagram,
        layout: {
          ...diagram.layout,
          paths: [
            {
              routeId: 'a',
              part: 0,
              points: [
                [0, 0],
                [NaN, 0]
              ]
            }
          ]
        }
      },
      { mode: 'demo' }
    ),
    /coordinate/
  );
});
