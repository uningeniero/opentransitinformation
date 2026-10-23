// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDiagram } from '../dist/index.mjs';
import { fixture } from './fixtures.mjs';

const network = {
  id: 'render-mode-fixture',
  name: 'Synthetic network',
  coordinateSystem: 'wgs84',
  stops: [
    { id: 'a', name: 'Alpha', position: [-0.15, 51.5], accessible: null },
    { id: 'b', name: 'Beta', position: [-0.13, 51.51], accessible: null }
  ],
  routes: [{
    id: 'one', shortName: '1', color: '#005B96',
    paths: [{ stopIds: ['a', 'b'], coordinates: [[-0.15, 51.5], [-0.142, 51.506], [-0.13, 51.51]] }]
  }],
  metadata: {
    source: 'Synthetic test fixture', license: 'CC0-1.0',
    validFrom: '2026-01-01', validUntil: '2026-12-31'
  }
};
const cases = [
  { name: 'default geographic output', options: {}, geographic: true },
  { name: 'source geographic output', options: { geographicFidelity: 'source' }, geographic: true },
  { name: 'geographic mode overrides a schematic profile', options: { profile: 'schematic', mode: 'geographic', geographicFidelity: 'source' }, geographic: true },
  { name: 'schematic mode overrides a geographic profile', options: { profile: 'geographic', mode: 'schematic' }, geographic: false },
  { name: 'print profile uses schematic mode', options: { profile: 'print' }, geographic: false },
  { name: 'geographic mode overrides a high-contrast profile', options: { profile: 'highContrast', mode: 'geographic', geographicFidelity: 'source' }, geographic: true },
  { name: 'planar coordinates retain a not-to-scale caption', options: { profile: 'geographic' }, coordinateSystem: 'planar', geographic: false }
];
for (const locale of ['en', 'es']) {
  for (const item of cases) {
    test(`${locale}: ${item.name}`, async () => {
      const result = await createDiagram({ ...network, coordinateSystem: item.coordinateSystem || network.coordinateSystem }, {
        ...item.options, locale, backgroundStyle: 'none', strict: false,
        generatedAt: '2026-10-23T00:00:00Z'
      });
      const labels = [...result.svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]);
      const geographic = locale === 'en' ? 'Geographic map' : 'Mapa geográfico';
      const schematic = locale === 'en' ? 'Diagram not to scale' : 'Esquema sin escala';
      assert.ok(labels.includes(item.geographic ? geographic : schematic));
      assert.ok(!labels.includes(item.geographic ? schematic : geographic));
      assert.ok(result.svg.includes(locale === 'en' ? '>1 route and 2 stops.' : '>1 línea y 2 paradas.'));
      if (item.options.geographicFidelity === 'source') {
        assert.equal(result.layout.paths[0].points.length, 3);
        assert.equal((result.layout.paths[0].d.match(/ L/g) || []).length, 2);
        assert.ok(!result.layout.paths[0].d.includes(' A'));
      }
    });
  }
}

test('map descriptions report multiple routes and stops', async () => {
  for (const locale of ['en', 'es']) {
    const result = await createDiagram(fixture(), { locale, generatedAt: '2026-10-23T00:00:00Z' });
    assert.ok(result.svg.includes(locale === 'en' ? '>4 routes and 16 stops.' : '>4 líneas y 16 paradas.'));
  }
});

test('CLI help lists implemented size and colour options', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/cli.mjs', import.meta.url)), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const option of ['[--width number]', '[--height number]', '[--colors source|adaptive]']) {
    assert.ok(result.stdout.includes(option));
  }
});
