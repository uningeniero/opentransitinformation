// SPDX-License-Identifier: Apache-2.0
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { toHtml } from '../dist/node.mjs';
import { fixture } from './fixtures.mjs';

const out = fileURLToPath(
  new URL('../../../.release/motion/', import.meta.url)
);
await mkdir(out, { recursive: true });
const html = await toHtml(fixture(), {
  generatedAt: '2026-10-23T00:00:00Z',
  motion: {
    mode: 'demo',
    durationMs: 8000,
    fps: 60,
    dwellMs: 100,
    autoplay: true,
    vehicles: [{ id: 'demo-vehicle', routeId: 'west-east', phase: 0.2 }]
  }
});
const target = path.join(out, 'motion.html');
await writeFile(target, html);
const browser = await chromium.launch({
  channel: process.env.OTI_BROWSER_CHANNEL || 'msedge',
  headless: true
});
const report = { checks: [], errors: [], networkRequests: [] };
try {
  for (const [label, width, height] of [
    ['desktop', 1440, 1100],
    ['tablet', 768, 1024],
    ['mobile', 390, 844]
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      offline: true,
      reducedMotion: 'no-preference'
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => report.errors.push(e.message));
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) report.networkRequests.push(r.url());
    });
    await page.goto(pathToFileURL(target).href);
    await page.waitForFunction(() => window.otiViewer?.motion);
    await page.evaluate(() => document.fonts.ready);
    const pose = () =>
      page.locator('[data-motion-vehicle]').getAttribute('transform');
    const before = await pose();
    await page.waitForTimeout(250);
    assert.notEqual(await pose(), before);
    const button = page.locator('.oti-motion-controls button');
    await button.focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await page.evaluate(() => otiViewer.motion.getState().requestedPlaying),
      false
    );
    const paused = await pose();
    await page.waitForTimeout(220);
    assert.equal(await pose(), paused);
    await page.locator('.oti-canvas svg').hover();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    assert.equal(await pose(), paused);
    await button.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    assert.notEqual(await pose(), paused);
    await page.locator('.oti-canvas svg').hover();
    await page.waitForTimeout(60);
    assert.equal(
      await page.evaluate(() => otiViewer.motion.getState().state),
      'suspended'
    );
    const hover = await pose();
    await page.waitForTimeout(120);
    assert.equal(await pose(), hover);
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      document.querySelector('svg [data-route-id][role="button"]').focus();
    });
    await page.waitForTimeout(60);
    const focus = await pose();
    await page.waitForTimeout(120);
    assert.equal(await pose(), focus);
    await button.focus();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(80);
    assert.equal(
      await page.evaluate(() => otiViewer.motion.getState().requestedPlaying),
      false
    );
    const reduced = await pose();
    await page.waitForTimeout(120);
    assert.equal(await pose(), reduced);
    const rect = await button.boundingBox();
    assert.ok(rect.height >= 44 && rect.width >= 44);
    const marker = await page
      .locator('[data-motion-vehicle] rect')
      .first()
      .boundingBox();
    assert.ok(marker.width <= 25 && marker.height <= 25);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    );
    const axe = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(
      axe.violations.map((v) => v.id),
      []
    );
    await page.evaluate(() => otiViewer.selectRoute('north-south'));
    assert.equal(
      await page
        .locator('[data-motion-vehicle] [data-routes]')
        .evaluate((e) => e.classList.contains('is-dimmed')),
      true
    );
    await page.evaluate(() => otiViewer.clear());
    await page.emulateMedia({ media: 'print' });
    assert.equal(
      await page.locator('[data-layer="motion"]').isVisible(),
      false
    );
    await page.emulateMedia({ media: 'screen' });
    await page.screenshot({
      path: path.join(out, `${label}-paused.png`),
      fullPage: true
    });
    await page.evaluate(() => otiViewer.destroy());
    assert.equal(await page.locator('[data-motion-vehicle]').count(), 0);
    report.checks.push({
      label,
      width,
      height,
      clockMoves: true,
      keyboardPauseResume: true,
      userPausePersistsAfterHover: true,
      hoverAndFocusSuspend: true,
      reducedMotionPauses: true,
      target44: true,
      markerWithin24: true,
      axeViolations: 0,
      destroyRemovesOwnedElements: true
    });
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    offline: true,
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(target).href);
  await page.waitForFunction(() => window.otiViewer?.motion);
  assert.equal(
    await page.evaluate(() => otiViewer.motion.getState().playing),
    false
  );
  await page.locator('.oti-motion-controls button').click();
  await page.waitForFunction(() => otiViewer.motion.getState().playing);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => !otiViewer.motion.getState().reducedMotion);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(
    () => !otiViewer.motion.getState().requestedPlaying
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(
    await page.evaluate(() => otiViewer.motion.getState().requestedPlaying),
    false
  );
  await page.evaluate(() => {
    window.savedSvg = document.querySelector('.oti-canvas svg');
    window.savedPlan = otiViewer.motion.plan;
    otiViewer.destroy();
    document.body.replaceChildren();
    const host = document.createElement('div');
    document.body.append(host);
    host.append(savedSvg);
    window.component = OTI.mountVehicleMotion(savedSvg, savedPlan, {
      autoplay: true
    });
  });
  await page.waitForTimeout(100);
  await page.locator('svg').hover();
  await page.evaluate(() => {
    component.destroy();
    window.component = OTI.mountVehicleMotion(savedSvg, savedPlan, {
      autoplay: true
    });
  });
  assert.equal(
    await page.evaluate(() => component.getState().state),
    'suspended'
  );
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => component.getState().elapsedMs), 0);
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => component.getState().state === 'playing');
  await page.locator('svg').focus();
  await page.evaluate(() => {
    component.destroy();
    window.component = OTI.mountVehicleMotion(savedSvg, savedPlan, {
      autoplay: true
    });
  });
  assert.equal(
    await page.evaluate(() => component.getState().state),
    'suspended'
  );
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => component.getState().elapsedMs), 0);
  await page.evaluate(() => savedSvg.blur());
  await page.waitForFunction(() => component.getState().state === 'playing');
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.body.prepend(spacer);
  });
  await page.waitForFunction(() => component.getState().state === 'suspended');
  const offscreen = await page
    .locator('[data-motion-vehicle]')
    .getAttribute('transform');
  await page.waitForTimeout(120);
  assert.equal(
    await page.locator('[data-motion-vehicle]').getAttribute('transform'),
    offscreen
  );
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => component.getState().state === 'playing');
  await page.evaluate(() => component.pause());
  const elapsed = await page.evaluate(() => component.getState().elapsedMs);
  await page.waitForTimeout(120);
  assert.equal(
    await page.evaluate(() => component.getState().elapsedMs),
    elapsed
  );
  await page.evaluate(() => {
    window.hidden = true;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => window.hidden
    });
    component.play();
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(
    await page.evaluate(() => component.getState().state),
    'suspended'
  );
  const hidden = await page.evaluate(() => component.getState().elapsedMs);
  await page.waitForTimeout(120);
  assert.equal(
    await page.evaluate(() => component.getState().elapsedMs),
    hidden
  );
  await page.evaluate(() => {
    window.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(120);
  assert.ok(
    (await page.evaluate(() => component.getState().elapsedMs)) > hidden
  );
  await page.evaluate(() => component.destroy());
  await page.evaluate(async () => {
    document.body.replaceChildren();
    const host = document.createElement('div');
    host.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" style="display:block;width:100%;height:auto"><g data-layer="routes"><g data-route-id="a" data-color="#005b96"><path d="M100 200H1100" stroke="#005b96" stroke-width="8" fill="none"/></g><g data-route-id="b" data-color="#a91642"><path d="M100 212H1100" stroke="#a91642" stroke-width="8" fill="none"/></g></g></svg>';
    document.body.append(host);
    const diagram = {
      network: { id: 'parallel-lanes' },
      layout: {
        width: 1200,
        height: 800,
        paths: [
          {
            routeId: 'a',
            part: 0,
            points: [
              [100, 200],
              [1100, 200]
            ]
          }
        ]
      }
    };
    const plan = await OTI.createMotionPlan(diagram, {
      mode: 'demo',
      durationMs: 4000,
      fps: 10,
      dwellMs: 0,
      vehicles: [{ id: 'parallel-test', routeId: 'a', phase: 0.5 }]
    });
    window.component = OTI.mountVehicleMotion(host, plan);
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(() => component.resize());
    const neighborCovered = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      const body = svg.querySelector('[data-motion-vehicle] rect');
      const point = svg.createSVGPoint();
      point.x = 600;
      point.y = 212;
      const local = point
        .matrixTransform(svg.getScreenCTM())
        .matrixTransform(body.getScreenCTM().inverse());
      return body.isPointInFill(local);
    });
    assert.equal(
      neighborCovered,
      false,
      `Vehicle must not cover its parallel neighbour at ${width}px`
    );
  }
  await page.evaluate(() => component.destroy());
  report.checks.push({
    reducedAutoplaySuppressed: true,
    noAutomaticRestartAfterPreferenceChange: true,
    standaloneComponent: true,
    alreadyHoveredMountSuspends: true,
    alreadyFocusedMountSuspends: true,
    parallelLaneUnobscuredAt390And1440: true,
    repeatedReducedMotionPreferencePausesExplicitPlayback: true,
    offscreenClockSuspends: true,
    hiddenClockSuspends: true,
    userPauseFreezesElapsed: true
  });
  await context.close();
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.networkRequests, []);
  report.passed = true;
  await writeFile(
    path.join(out, 'motion-browser-report.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
