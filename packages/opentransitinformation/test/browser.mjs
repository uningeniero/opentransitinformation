// SPDX-License-Identifier: Apache-2.0
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
import { toHtml } from '../dist/node.mjs';
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const out = path.join(repo, '.release');
await mkdir(out, { recursive: true });
const network = fixture();
await writeFile(
  path.join(out, 'demostracion.html'),
  await toHtml(network, { generatedAt: '2026-10-23T00:00:00Z', locale: 'es' })
);
const browser = await chromium.launch({ channel: process.env.OTI_BROWSER_CHANNEL || 'msedge', headless: true });
const report = {};
try {
  for (const [mode, width, height] of [
    ['desktop', 1440, 1100],
    ['mobile', 390, 844]
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      offline: true,
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    const errors = [],
      requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) requests.push(r.url());
    });
    await page.goto(pathToFileURL(path.join(out, 'demostracion.html')).href);
    await page.waitForFunction(() => window.otiViewer);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(requests.length, 0);
    assert.equal(
      await page.locator('svg [data-layer=labels]>g').count(),
      network.stops.length
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      ),
      'Horizontal overflow'
    );
    const textBounds = await page.evaluate(() =>
      [...document.querySelectorAll('svg text')]
        .map((t) => {
          const b = t.getBBox(),
            v = t.ownerSVGElement.viewBox.baseVal;
          return {
            text: t.textContent,
            overflow:
              b.x < 0 ||
              b.y < 0 ||
              b.x + b.width > v.width + 1 ||
              b.y + b.height > v.height + 1
          };
        })
        .filter((t) => t.overflow)
    );
    assert.deepEqual(textBounds, [], 'Clipped SVG text');
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    report[mode] = {
      errors,
      networkRequests: requests.length,
      axeViolations: axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target)
      }))
    };
    assert.deepEqual(report[mode].axeViolations, []);
    await page.locator('svg [data-stop-ids="s3"]').click();
    assert.equal(
      (await page.evaluate(() => window.otiViewer.getState())).stopId,
      's3'
    );
    await page
      .getByRole('button', { name: 'Ver toda la red', exact: true })
      .click();
    const route = page.getByRole('button', {
      name: 'Seleccionar línea 1: Puerto - Estación',
      exact: true
    });
    await route.click();
    assert.equal(
      (await page.evaluate(() => window.otiViewer.getState())).routeId,
      'west-east'
    );
    assert.equal(await route.getAttribute('aria-pressed'), 'true');
    const search = page.getByRole('searchbox');
    await search.fill('estacion del este');
    assert.ok(
      (await page.locator('.oti-results button').allTextContents()).some((t) =>
        t.includes('Estación')
      )
    );
    await search.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(
      (await page.evaluate(() => window.otiViewer.getState())).stopId,
      's6'
    );
    await page.getByRole('button', { name: 'Acercar', exact: true }).click();
    const view = await page.evaluate(() => window.otiViewer.getView());
    assert.ok(view.width < 1200);
    if (mode === 'mobile')
      await page.screenshot({
        path: path.join(out, 'demostracion-mobile-detalle.png'),
        fullPage: true
      });
    await page
      .getByRole('button', { name: 'Ver toda la red', exact: true })
      .click();
    assert.deepEqual(await page.evaluate(() => window.otiViewer.getState()), {
      routeId: null,
      stopId: null
    });
    await page.screenshot({
      path: path.join(out, `demostracion-${mode}.png`),
      fullPage: true
    });
    report[mode].interaction = true;
    await context.close();
  }
  await writeFile(
    path.join(out, 'browser-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
