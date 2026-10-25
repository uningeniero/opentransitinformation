// SPDX-License-Identifier: Apache-2.0
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fromOpenStreetMap, withOpenStreetMap } from '../dist/index.mjs';
import { toHtml } from '../dist/node.mjs';

const out = fileURLToPath(new URL('../../../.release/osm/', import.meta.url));
await mkdir(out, { recursive: true });
const payload = {
  osm3s: { timestamp_osm_base: new Date(Date.now() - 60000).toISOString() },
  elements: [
    {
      type: 'way',
      id: 1,
      version: 1,
      tags: { highway: 'primary' },
      geometry: [
        { lon: -0.15, lat: 51.5 },
        { lon: -0.14, lat: 51.51 }
      ]
    }
  ]
};
const snapshot = await fromOpenStreetMap(payload);
const network = withOpenStreetMap(
  {
    id: 'osm-refresh',
    name: 'OSM refresh regression',
    coordinateSystem: 'wgs84',
    routes: [
      {
        id: 'line',
        shortName: 'L',
        name: 'Line',
        color: '#005a8c',
        paths: [
          {
            stopIds: ['a', 'b'],
            coordinates: [
              [-0.15, 51.5],
              [-0.14, 51.51]
            ]
          }
        ]
      }
    ],
    stops: [
      { id: 'a', name: 'Alpha', position: [-0.15, 51.5] },
      { id: 'b', name: 'Beta', position: [-0.14, 51.51] }
    ]
  },
  snapshot
);
const settings = { bounds: [-0.16, 51.49, -0.13, 51.52], refreshOnLoad: false };
const htmlPath = fileURLToPath(
  new URL('osm-refresh.html', pathToFileURL(out + '/'))
);
await writeFile(
  htmlPath,
  await toHtml(network, {
    backgroundStyle: 'atlas',
    openStreetMap: settings,
    motion: { mode: 'demo' }
  })
);
const browser = await chromium.launch({
  channel: process.env.OTI_BROWSER_CHANNEL || 'msedge',
  headless: true
});
const report = { checks: [] };
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 950 }
  });
  const errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.addInitScript(
    ({ payload }) => {
      window.osmTest = { mode: 'success', calls: 0, aborted: 0, payload };
      window.fetch = async (_url, options) => {
        window.osmTest.calls++;
        if (window.osmTest.mode === 'abort')
          return new Promise((_, reject) => {
            options.signal.addEventListener(
              'abort',
              () => {
                window.osmTest.aborted++;
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          });
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (window.osmTest.mode === 'failure')
          return new Response('Unavailable', { status: 503 });
        return new Response(JSON.stringify(window.osmTest.payload), {
          status: 200
        });
      };
    },
    { payload }
  );
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => window.otiViewer);
  assert.equal(await page.evaluate(() => window.osmTest.calls), 0);
  report.checks.push(
    'Cached snapshot with refreshOnLoad=false makes no request'
  );
  const result = await page.evaluate(async () => {
    const viewer = window.otiViewer;
    viewer.motion.seek(1400);
    viewer.motion.pause();
    const motionBefore = viewer.motion.getState();
    viewer.selectStop('a');
    viewer.setView({
      ...viewer.getView(),
      width: viewer.getView().width * 0.9,
      height: viewer.getView().height * 0.9
    });
    const before = viewer.getView();
    const nextTime = new Date(Date.now() - 1000).toISOString();
    window.osmTest.payload.osm3s.timestamp_osm_base = nextTime;
    const first = viewer.refresh(),
      second = viewer.refresh();
    const samePromise = first === second;
    const refresh = await first;
    return {
      samePromise,
      updated: refresh.updated,
      before,
      after: viewer.getView(),
      state: viewer.getState(),
      calls: window.osmTest.calls,
      date: viewer.diagram.network.metadata.baseMap.dataAsOf,
      nextTime,
      controls: document.querySelectorAll('.oti-osm-tools').length,
      motionBefore,
      motionAfter: viewer.motion.getState()
    };
  });
  assert.equal(result.samePromise, true);
  assert.equal(result.updated, true);
  assert.equal(result.calls, 1);
  assert.equal(result.state.stopId, 'a');
  assert.deepEqual(result.after, result.before);
  assert.equal(result.date, result.nextTime);
  assert.equal(result.controls, 1);
  assert.equal(result.motionAfter.elapsedMs, result.motionBefore.elapsedMs);
  assert.equal(result.motionAfter.requestedPlaying, false);
  report.checks.push(
    'Successful concurrent refresh fetches once and preserves selection and view'
  );
  report.checks.push(
    'Refreshing context preserves paused motion and elapsed time'
  );
  const failed = await page.evaluate(async () => {
    window.osmTest.mode = 'failure';
    const old = document.querySelector('svg'),
      date = window.otiViewer.diagram.network.metadata.baseMap.dataAsOf;
    const result = await window.otiViewer.refresh();
    return {
      updated: result.updated,
      code: result.error.code,
      sameSvg: document.querySelector('svg') === old,
      sameDate:
        window.otiViewer.diagram.network.metadata.baseMap.dataAsOf === date,
      message: document.querySelector('.oti-osm-tools [role=status]')
        .textContent
    };
  });
  assert.equal(failed.updated, false);
  assert.equal(failed.code, 'OSM_HTTP_ERROR');
  assert.equal(failed.sameSvg, true);
  assert.equal(failed.sameDate, true);
  assert.match(failed.message, /failed|unable|could not|unavailable/i);
  report.checks.push(
    'Failed update keeps the last SVG and source date and exposes failure'
  );
  const destroyed = await page.evaluate(async () => {
    window.osmTest.mode = 'abort';
    const pending = window.otiViewer.refresh();
    window.otiViewer.destroy();
    await pending;
    const subsequent = await window.otiViewer.refresh();
    return {
      aborted: window.osmTest.aborted,
      roots: document.querySelectorAll('.oti-viewer').length,
      code: subsequent.error.code
    };
  });
  assert.equal(destroyed.aborted, 1);
  assert.equal(destroyed.roots, 0);
  assert.equal(destroyed.code, 'VIEWER_DESTROYED');
  report.checks.push('Destroy aborts a pending update and removes the viewer');
  const initialLoads = await page.evaluate(async () => {
    const original = window.otiViewer.diagram.network;
    window.osmTest.mode = 'success';
    const container = document.getElementById('oti-map');
    const bounds = [-0.16, 51.49, -0.13, 51.52];
    const before = window.osmTest.calls;
    const cached = await OTI.mountOpenStreetMapViewer(container, original, {
      backgroundStyle: 'atlas',
      openStreetMap: { bounds }
    });
    const cachedResult = await cached.whenRefreshed;
    cached.destroy();
    const withoutCache = structuredClone(original);
    delete withoutCache.metadata.baseMap;
    withoutCache.background = [];
    const fresh = await OTI.mountOpenStreetMapViewer(container, withoutCache, {
      backgroundStyle: 'atlas',
      openStreetMap: { bounds }
    });
    const freshResult = await fresh.whenRefreshed;
    const result = {
      calls: window.osmTest.calls - before,
      cached: cachedResult.updated,
      fresh: freshResult.updated,
      date: fresh.diagram.network.metadata.baseMap.dataAsOf
    };
    fresh.destroy();
    return result;
  });
  assert.equal(initialLoads.calls, 2);
  assert.equal(initialLoads.cached, true);
  assert.equal(initialLoads.fresh, true);
  assert.ok(initialLoads.date);
  report.checks.push(
    'Opening refreshes a cached map; an uncached map fetches once before mounting'
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  report.passed = true;
  report.errors = errors;
  report.networkRequests = requests.length;
} finally {
  await browser.close();
  await writeFile(
    out + '/osm-browser-report.json',
    JSON.stringify(report, null, 2) + '\n'
  );
}
console.log(JSON.stringify(report));
