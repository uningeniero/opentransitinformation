// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createDiagram } from '../dist/index.mjs';
import { toHtml } from '../dist/node.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const out = path.join(root, '.release', 'design-browser');
await mkdir(out, { recursive: true });
const network = {
  id: 'design-regression',
  name: 'Transit design regression',
  coordinateSystem: 'planar',
  stops: [
    { id: 'west', name: 'West Harbour', position: [-4, 0], accessible: null },
    { id: 'market', name: 'Market', position: [-2, 0], accessible: null },
    { id: 'central', name: 'Central', position: [0, 0], accessible: true },
    { id: 'east', name: 'East Station', position: [4, 0], accessible: null },
    { id: 'north', name: 'North Park', position: [0, -3], accessible: null }
  ],
  routes: [
    {
      id: 'cross-town',
      shortName: '1',
      name: 'Cross-town',
      color: '#005B96',
      paths: [{ stopIds: ['west', 'market', 'central', 'east'] }]
    },
    {
      id: 'park',
      shortName: '2',
      name: 'Park service',
      color: '#A91642',
      paths: [{ stopIds: ['north', 'central', 'east'] }]
    }
  ],
  metadata: {
    source: 'Synthetic design regression fixture',
    license: 'CC0-1.0',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31'
  },
  background: []
};
const options = {
  width: 1200,
  height: 760,
  generatedAt: '2026-10-23T00:00:00Z'
};
const report = { checks: [], errors: [], networkRequests: [] };
const browser = await chromium.launch({ channel: process.env.OTI_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({
  offline: true,
  viewport: { width: 1440, height: 1100 }
});
const page = await context.newPage();
page.on('pageerror', (e) => report.errors.push(e.message));
page.on('request', (request) => {
  if (/^https?:/.test(request.url()))
    report.networkRequests.push(request.url());
});
const check = async (name, run) => {
  try {
    const details = await run();
    report.checks.push({ name, passed: true, ...details });
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.message });
  }
};
const loadSvg = async (svg) => {
  await page.setContent(
    `<html><head><style>body{margin:0}svg{display:block}</style></head><body>${svg}</body></html>`
  );
  await page.evaluate(() => document.fonts.ready.then(() => null));
};
const checkFontMetrics = async (diagram) => {
  const text = await page.evaluate(() =>
    [...document.querySelectorAll('svg .oti-label')].map((node) => ({
      text: node.textContent,
      advance: node.getComputedTextLength(),
      family: getComputedStyle(node).fontFamily,
      loaded: document.fonts.check(
        `${getComputedStyle(node).fontWeight} ${getComputedStyle(node).fontSize} ${getComputedStyle(node).fontFamily}`
      )
    }))
  );
  let maximumAdvanceError = 0;
  for (const stop of network.stops) {
    const actual = text.find((entry) => entry.text === stop.name);
    assert.ok(actual, `Missing stop label: ${stop.id}`);
    assert.ok(
      actual.family.includes('OTI Source Sans 3'),
      `Unexpected rendered family for ${stop.id}: ${actual.family}`
    );
    assert.equal(actual.loaded, true, `Unloaded font for ${stop.id}`);
    const metric = diagram.metrics[stop.id];
    assert.equal(
      metric.lines.length,
      1,
      'This fixture must exercise single-line advances'
    );
    const expected = metric.width - 6 - (metric.accessWidth || 0);
    const delta = Math.abs(actual.advance - expected);
    maximumAdvanceError = Math.max(maximumAdvanceError, delta);
    assert.ok(
      delta <= 0.5,
      `Measured/rendered advance differs by ${delta.toFixed(3)} px for ${stop.id}`
    );
  }
  return { labels: text.length, maximumAdvanceError };
};

try {
  const diagram = await createDiagram(network, {
    ...options,
    idPrefix: 'standalone'
  });
  await check('standalone SVG uses the measured font', async () => {
    await loadSvg(diagram.svg);
    const details = await checkFontMetrics(diagram);
    await page.screenshot({
      path: path.join(out, 'standalone.png'),
      fullPage: true
    });
    return details;
  });

  await check(
    'offline viewer preserves measured fonts and requested UI language',
    async () => {
      const locales = [];
      for (const [locale, language, zoomLabel, searchLabel] of [
        [undefined, 'en', 'Zoom in', 'Search routes or stops'],
        ['es', 'es', 'Acercar', 'Buscar línea o parada']
      ]) {
        const htmlPath = path.join(out, `viewer-${language}.html`);
        await writeFile(
          htmlPath,
          await toHtml(network, {
            ...options,
            idPrefix: 'viewer',
            ...(locale ? { locale } : {})
          })
        );
        await page.goto(pathToFileURL(htmlPath).href);
        await page.waitForFunction(() => window.otiViewer);
        await page.evaluate(() => document.fonts.ready.then(() => null));
        assert.equal(
          await page.evaluate(() => document.documentElement.lang),
          language
        );
        assert.equal(
          await page
            .getByRole('searchbox', { name: searchLabel, exact: true })
            .count(),
          1
        );
        assert.equal(
          await page.evaluate(
            () =>
              window.otiViewer.diagram.network.stops.find(
                (stop) => stop.id === 'central'
              ).name
          ),
          'Central',
          'Changing UI locale must not translate source names'
        );
        const details = await checkFontMetrics(diagram);
        const before = await page.evaluate(
          () => window.otiViewer.getView().width
        );
        await page
          .getByRole('button', { name: zoomLabel, exact: true })
          .click();
        assert.ok(
          (await page.evaluate(() => window.otiViewer.getView().width)) < before
        );
        await page.screenshot({
          path: path.join(out, `viewer-${language}.png`),
          fullPage: true
        });
        locales.push({ language, ...details, zoomAction: true });
      }
      return { locales };
    }
  );

  await check(
    'two SVG instances retain their own font and label halo',
    async () => {
      const withContext = {
        ...network,
        background: [
          {
            id: 'shared-context-id',
            kind: 'water',
            geometry: 'polygon',
            coordinates: [
              [
                [-6, -5],
                [6, -5],
                [6, 2],
                [-6, 2],
                [-6, -5]
              ]
            ]
          }
        ]
      };
      const light = await createDiagram(withContext, {
        ...options,
        idPrefix: 'light',
        backgroundStyle: 'atlas'
      });
      const dark = await createDiagram(withContext, {
        ...options,
        idPrefix: 'dark',
        backgroundStyle: 'atlas',
        style: {
          background: '#162536',
          foreground: '#FFFFFF',
          casing: '#FFFFFF',
          muted: '#D5DFE8'
        }
      });
      await page.setContent(
        `<html><body><div id="light">${light.svg}</div><div id="dark">${dark.svg}</div></body></html>`
      );
      await page.evaluate(() => document.fonts.ready.then(() => null));
      const styles = await page.evaluate(() =>
        ['light', 'dark'].map((id) => {
          const label = document.querySelector(`#${id} .oti-label`);
          const style = getComputedStyle(label);
          return { family: style.fontFamily, halo: style.stroke };
        })
      );
      assert.equal(styles[0].halo, 'rgb(255, 255, 255)');
      assert.equal(styles[1].halo, 'rgb(22, 37, 54)');
      assert.notEqual(
        styles[0].family,
        styles[1].family,
        'Instances must not replace one another’s font face'
      );
      for (const style of styles)
        assert.ok(style.family.includes('OTI Source Sans 3'));
      const duplicateIds = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map(
          (element) => element.id
        );
        return ids.filter((id, index) => ids.indexOf(id) !== index);
      });
      assert.deepEqual(duplicateIds, []);
      const clipScopes = await page.evaluate(() =>
        [...document.querySelectorAll('svg')].map((svg) => {
          const group = svg.querySelector('[data-layer="background"]');
          const clipId = group
            ?.getAttribute('clip-path')
            ?.match(/^url\(#(.+)\)$/)?.[1];
          return {
            clipId,
            local:
              !!clipId &&
              [...svg.querySelectorAll('clipPath')].some(
                (clip) => clip.id === clipId
              )
          };
        })
      );
      assert.ok(
        clipScopes.every((entry) => entry.local),
        'Each background must reference its own clip path'
      );
      assert.equal(new Set(clipScopes.map((entry) => entry.clipId)).size, 2);
      return { instances: styles };
    }
  );

  await check(
    'large context polygons cannot paint the title or legend area',
    async () => {
      const withContext = {
        ...network,
        background: [
          {
            id: 'large-water',
            kind: 'water',
            geometry: 'polygon',
            coordinates: [
              [
                [-100, -100],
                [100, -100],
                [100, 100],
                [-100, 100],
                [-100, -100]
              ]
            ]
          }
        ]
      };
      const background = await createDiagram(withContext, {
        ...options,
        backgroundStyle: 'atlas',
        idPrefix: 'clipped'
      });
      await loadSvg(background.svg);
      const pixels = await page.evaluate(
        async ({ height }) => {
          const svg = document.querySelector('svg');
          const xml = new XMLSerializer().serializeToString(svg);
          const url = URL.createObjectURL(
            new Blob([xml], { type: 'image/svg+xml' })
          );
          try {
            const image = new Image();
            await new Promise((resolve, reject) => {
              image.onload = resolve;
              image.onerror = reject;
              image.src = url;
            });
            const canvas = document.createElement('canvas');
            canvas.width = svg.viewBox.baseVal.width;
            canvas.height = svg.viewBox.baseVal.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
            return {
              titleMargin: at(10, 10),
              legendMargin: at(10, height + 10),
              map: at(700, height - 70)
            };
          } finally {
            URL.revokeObjectURL(url);
          }
        },
        { height: background.layout.height }
      );
      const base = background.style.background;
      const expected = [1, 3, 5]
        .map((offset) => Number.parseInt(base.slice(offset, offset + 2), 16))
        .concat(255);
      assert.deepEqual(
        pixels.titleMargin,
        expected,
        'Context overlaps the title margin'
      );
      assert.deepEqual(
        pixels.legendMargin,
        expected,
        'Context overlaps the legend margin'
      );
      assert.notDeepEqual(
        pixels.map,
        expected,
        'The context must actually be rendered inside the map'
      );
      await page.screenshot({
        path: path.join(out, 'clipped-context.png'),
        fullPage: true
      });
      return { pixels };
    }
  );
  await check(
    'italic water-label ink stays within its measured context bounds',
    async () => {
      const withContext = {
        ...network,
        background: [
          {
            id: 'named-water',
            kind: 'water',
            geometry: 'polygon',
            name: 'The Harbour Estuary',
            coordinates: [
              [
                [-100, -100],
                [100, -100],
                [100, 100],
                [-100, 100],
                [-100, -100]
              ]
            ]
          }
        ]
      };
      const background = await createDiagram(withContext, {
        ...options,
        backgroundStyle: 'atlas',
        idPrefix: 'italic-water'
      });
      const label = background.layout.contextLabels.find(
        (entry) => entry.featureId === 'named-water'
      );
      assert.ok(
        label,
        'The isolated water name must fit this spacious context fixture'
      );
      await loadSvg(background.svg);
      const actual = await page
        .locator('[data-context-id="named-water"]')
        .evaluate((node) => {
          const style = getComputedStyle(node);
          const canvas = document.createElement('canvas').getContext('2d');
          canvas.font = [
            style.fontStyle,
            style.fontWeight,
            style.fontSize,
            style.fontFamily
          ].join(' ');
          const ink = canvas.measureText(node.textContent);
          const x = node.x.baseVal[0].value;
          const y = node.y.baseVal[0].value;
          return {
            x: x - ink.actualBoundingBoxLeft,
            y: y - ink.actualBoundingBoxAscent,
            width: ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight,
            height: ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent,
            fontStyle: style.fontStyle,
            halo: Number.parseFloat(style.strokeWidth) / 2
          };
        });
      assert.equal(actual.fontStyle, 'italic');
      const b = label.bounds;
      const epsilon = 0.5;
      assert.ok(
        actual.x - actual.halo >= b.x - epsilon,
        'Italic ink or halo escapes the left bound'
      );
      assert.ok(
        actual.y - actual.halo >= b.y - epsilon,
        'Italic ink or halo escapes the top bound'
      );
      assert.ok(
        actual.x + actual.width + actual.halo <= b.x + b.width + epsilon,
        'Italic ink or halo escapes the right bound'
      );
      assert.ok(
        actual.y + actual.height + actual.halo <= b.y + b.height + epsilon,
        'Italic ink or halo escapes the bottom bound'
      );
      return { measured: b, actual };
    }
  );
} finally {
  await browser.close();
}
assert.deepEqual(report.errors, [], 'Unexpected browser errors');
assert.deepEqual(
  report.networkRequests,
  [],
  'The regression pages must work offline'
);
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
assert.ok(
  report.checks.every((entry) => entry.passed),
  'Visual design browser regressions failed'
);
