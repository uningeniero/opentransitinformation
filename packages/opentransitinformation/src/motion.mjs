// SPDX-License-Identifier: Apache-2.0
import { runEngine } from './engine.mjs';
import { OtiError } from './model.mjs';
import { localeCopy } from './locale.mjs';

const fail = (message) => {
  throw new OtiError('INVALID_MOTION', message);
};
const integer = (n, fallback, low, high, name) => {
  n ??= fallback;
  if (!Number.isInteger(n) || n < low || n > high)
    fail(`Invalid motion ${name}`);
  return n;
};

export async function createMotionPlan(diagram, options = {}) {
  if (options?.mode !== 'demo') fail('Motion mode must be demo');
  const layout = diagram?.layout;
  if (!Array.isArray(layout?.paths) || !layout.paths.length)
    fail('Provide an engine diagram layout');
  const durationMs = integer(
    options.durationMs,
    30000,
    4000,
    120000,
    'durationMs'
  );
  const fps = integer(options.fps, 60, 1, 60, 'fps');
  const dwellMs = integer(options.dwellMs, 450, 0, 5000, 'dwellMs');
  let vehicles = options.vehicles;
  if (vehicles === undefined) {
    const seen = new Set();
    vehicles = [...layout.paths]
      .sort((a, b) =>
        a.routeId < b.routeId ? -1 : a.routeId > b.routeId ? 1 : a.part - b.part
      )
      .filter((p) => !seen.has(p.routeId) && seen.add(p.routeId))
      .slice(0, 8)
      .map((p, i) => ({
        id: `vehicle-${i + 1}`,
        routeId: p.routeId,
        part: p.part,
        phase: (0.17 + i / 8) % 1
      }));
  }
  if (!Array.isArray(vehicles) || !vehicles.length || vehicles.length > 16)
    fail('Provide 1..16 motion vehicles');
  const ids = new Set();
  vehicles = vehicles.map((v) => {
    if (
      !v ||
      typeof v.id !== 'string' ||
      !v.id ||
      v.id.length > 256 ||
      ids.has(v.id) ||
      typeof v.routeId !== 'string'
    )
      fail('Motion vehicles require unique IDs and existing routes');
    ids.add(v.id);
    const part = integer(v.part, 0, 0, 100000, 'part');
    const phase = v.phase ?? 0.2;
    if (!Number.isFinite(phase) || phase < 0 || phase >= 1)
      fail('Motion phase must be in [0, 1)');
    if (!layout.paths.some((p) => p.routeId === v.routeId && p.part === part))
      fail('Motion vehicle references an unavailable route part');
    return { id: v.id, routeId: v.routeId, part, phase };
  });
  if (Math.ceil((durationMs * fps) / 1000) * vehicles.length > 60000)
    fail('Motion frame budget exceeded');
  const plan = await runEngine({
    operation: 'motion',
    layout: { paths: layout.paths },
    options: { mode: 'demo', durationMs, fps, dwellMs, vehicles }
  });
  return {
    ...plan,
    networkId: diagram.network?.id || '',
    width: layout.width,
    height: layout.height,
    mapBounds: layout.mapBounds
  };
}

export function motionFrame(plan, elapsedMs) {
  if (
    !plan ||
    plan.mode !== 'demo' ||
    !Number.isInteger(plan.frameCount) ||
    plan.frameCount < 1 ||
    plan.frameCount > 7200 ||
    !Number.isInteger(plan.durationMs) ||
    plan.durationMs < 4000 ||
    plan.durationMs > 120000 ||
    !Array.isArray(plan.vehicles) ||
    !plan.vehicles.length ||
    plan.vehicles.length > 16
  )
    fail('Invalid motion plan');
  if (
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs > Number.MAX_SAFE_INTEGER
  )
    fail('Motion time must be finite and non-negative');
  const timeMs = elapsedMs % plan.durationMs;
  const frame = Math.min(
    plan.frameCount - 1,
    Math.floor((timeMs / plan.durationMs) * plan.frameCount)
  );
  return {
    mode: 'demo',
    timeMs,
    frame,
    vehicles: plan.vehicles.map((v) => {
      const p = v.frames?.[frame];
      if (
        !Array.isArray(p) ||
        p.length !== 6 ||
        !p.slice(0, 5).every(Number.isFinite)
      )
        fail('Invalid prepared motion frame');
      return {
        id: v.id,
        routeId: v.routeId,
        part: v.part,
        position: [p[0], p[1]],
        heading: p[2],
        progress: p[3],
        opacity: p[4],
        stopId: p[5] === null ? null : (v.stops?.[p[5]]?.id ?? null)
      };
    })
  };
}

let nextId = 0;
export function mountVehicleMotion(container, plan, options = {}) {
  if (!container || container.nodeType !== 1)
    fail('Provide an SVG or a container holding one');
  const svg =
    container.tagName.toLowerCase() === 'svg'
      ? container
      : container.querySelector('svg');
  if (!svg || svg.namespaceURI !== 'http://www.w3.org/2000/svg')
    fail('Motion requires a rendered SVG');
  motionFrame(plan, 0);
  const doc = svg.ownerDocument,
    win = doc.defaultView,
    copy = localeCopy(options.locale);
  if (!win?.requestAnimationFrame)
    fail('Motion requires a browser animation clock');
  if (options.autoplay !== undefined && typeof options.autoplay !== 'boolean')
    fail('Motion autoplay must be boolean');
  if (
    options.onStateChange !== undefined &&
    typeof options.onStateChange !== 'function'
  )
    fail('Motion state callback must be a function');
  if (
    options.controlsContainer &&
    (options.controlsContainer.nodeType !== 1 ||
      options.controlsContainer.ownerDocument !== doc)
  )
    fail('Motion controls require a container in the same document');
  const abort = new win.AbortController();
  const on = (el, name, fn) =>
    el.addEventListener(name, fn, { signal: abort.signal });
  const ns = 'http://www.w3.org/2000/svg';
  const element = (name, attrs = {}) => {
    const e = doc.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const group = element('g', {
    'data-layer': 'motion',
    'aria-hidden': 'true',
    'pointer-events': 'none'
  });
  let componentId;
  do {
    componentId = `oti-motion-${++nextId}`;
  } while (
    doc.getElementById(`${componentId}-caption`) ||
    doc.getElementById(`${componentId}-clip`)
  );
  if (plan.mapBounds) {
    const { x, y, width, height } = plan.mapBounds;
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0
    )
      fail('Invalid motion map bounds');
    const defs = element('defs');
    const clip = element('clipPath', {
      id: `${componentId}-clip`,
      clipPathUnits: 'userSpaceOnUse'
    });
    clip.append(element('rect', { x, y, width, height }));
    defs.append(clip);
    group.append(defs);
    group.setAttribute('clip-path', `url(#${componentId}-clip)`);
  }
  const markers = new Map();
  const strokes = new Map();
  for (const route of svg.querySelectorAll(
    '[data-layer="routes"] [data-route-id]'
  )) {
    const color = route.getAttribute('data-color');
    const path = [...route.querySelectorAll('path')].find(
      (p) =>
        p.getAttribute('stroke') === color && !p.classList.contains('casing')
    );
    if (path) strokes.set(route.getAttribute('data-route-id'), path);
  }
  for (const v of plan.vehicles) {
    const stroke = strokes.get(v.routeId);
    if (
      !stroke ||
      !(Number.parseFloat(win.getComputedStyle(stroke).strokeWidth) > 0)
    )
      fail('Motion requires matching rendered route strokes');
    const marker = element('g', {
      'data-motion-vehicle': v.id,
      'data-motion-route': v.routeId
    });
    const glyph = element('g', {
      'data-routes': encodeURIComponent(v.routeId)
    });
    glyph.append(
      element('rect', {
        x: -9,
        y: -5,
        width: 18,
        height: 10,
        rx: 3,
        fill: '#111820',
        stroke: '#ffffff',
        'stroke-width': 2
      })
    );
    glyph.append(
      element('rect', {
        x: -5.5,
        y: -3,
        width: 3,
        height: 6,
        rx: 0.6,
        fill: '#ffffff'
      }),
      element('rect', {
        x: 2.5,
        y: -3,
        width: 3,
        height: 6,
        rx: 0.6,
        fill: '#ffffff'
      })
    );
    marker.append(glyph);
    group.append(marker);
    markers.set(v.id, { marker, glyph, stroke });
  }
  svg.insertBefore(group, svg.querySelector('[data-layer="labels"]'));
  const controls = doc.createElement('div');
  controls.className = 'oti-motion-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', copy.motionControls);
  controls.style.cssText =
    'display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 12px;font:14px/1.4 system-ui,sans-serif;color:#111820;background:#fff';
  const caption = doc.createElement('span');
  caption.id = `${componentId}-caption`;
  caption.textContent = copy.motionCaption;
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-describedby', caption.id);
  button.style.cssText =
    'min-width:44px;min-height:44px;padding:8px 12px;border:1px solid #111820;border-radius:6px;background:#fff;color:#111820;font:inherit;cursor:pointer';
  const style = doc.createElement('style');
  style.textContent =
    '.oti-motion-controls button:focus-visible{outline:3px solid #005b96;outline-offset:3px}@media print{.oti-motion-controls,[data-layer="motion"]{display:none}}';
  controls.append(caption, button, style);
  if (options.controlsContainer) options.controlsContainer.append(controls);
  else svg.insertAdjacentElement('afterend', controls);
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let wanted = false,
    started = false,
    destroyed = false,
    raf = 0,
    elapsed = 0,
    anchor = null,
    inView = true,
    hover = svg.matches(':hover'),
    focus = svg.contains(doc.activeElement),
    scale = 1;
  const suspended = () => doc.hidden || !inView || hover || focus;
  const now = () => win.performance.now();
  const total = () => elapsed + (anchor === null ? 0 : now() - anchor);
  const state = () => ({
    mode: 'demo',
    state: destroyed
      ? 'destroyed'
      : wanted
        ? suspended()
          ? 'suspended'
          : 'playing'
        : 'paused',
    playing: !destroyed && wanted && !suspended(),
    requestedPlaying: wanted,
    elapsedMs: total(),
    reducedMotion: !!reduced?.matches
  });
  const draw = () => {
    for (const pose of motionFrame(plan, total()).vehicles) {
      const { marker } = markers.get(pose.id);
      marker.setAttribute(
        'transform',
        `translate(${pose.position[0]} ${pose.position[1]}) rotate(${pose.heading})`
      );
      marker.setAttribute('opacity', String(pose.opacity));
      marker.setAttribute('data-motion-progress', String(pose.progress));
    }
  };
  const resize = () => {
    const matrix = svg.getScreenCTM();
    const units = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
    scale = units > 0 ? 1 / units : 1;
    for (const { glyph, stroke } of markers.values()) {
      const width = Number.parseFloat(win.getComputedStyle(stroke).strokeWidth);
      glyph.setAttribute(
        'transform',
        `scale(${Math.min(scale, Math.max(0, width) / 12)})`
      );
    }
  };
  const stopClock = () => {
    if (anchor !== null) {
      elapsed += now() - anchor;
      anchor = null;
    }
    if (raf) {
      win.cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const tick = () => {
    raf = 0;
    if (destroyed || !wanted || suspended()) {
      stopClock();
      return;
    }
    draw();
    raf = win.requestAnimationFrame(tick);
  };
  const update = () => {
    if (destroyed) return;
    if (wanted && !suspended()) {
      if (anchor === null) anchor = now();
      if (!raf) raf = win.requestAnimationFrame(tick);
    } else stopClock();
    button.textContent = wanted
      ? copy.motionPause
      : started
        ? copy.motionResume
        : copy.motionPlay;
    controls.setAttribute('data-motion-state', state().state);
    draw();
    options.onStateChange?.(state());
  };
  const play = () => {
    if (destroyed) return;
    wanted = true;
    started = true;
    update();
  };
  const pause = () => {
    if (destroyed) return;
    wanted = false;
    update();
  };
  on(button, 'click', () => (wanted ? pause() : play()));
  on(svg, 'mouseenter', () => {
    hover = true;
    update();
  });
  on(svg, 'mouseleave', () => {
    hover = false;
    update();
  });
  on(svg, 'focusin', () => {
    focus = true;
    update();
  });
  on(svg, 'focusout', (e) => {
    focus = !!e.relatedTarget && svg.contains(e.relatedTarget);
    update();
  });
  on(doc, 'visibilitychange', update);
  if (reduced)
    on(reduced, 'change', () => {
      if (reduced.matches) pause();
      else update();
    });
  const observer = win.IntersectionObserver
    ? new win.IntersectionObserver((entries) => {
        inView = entries[0]?.isIntersecting ?? true;
        update();
      })
    : null;
  observer?.observe(svg);
  const sizeObserver = win.ResizeObserver
    ? new win.ResizeObserver(resize)
    : null;
  sizeObserver?.observe(svg);
  const viewObserver = win.MutationObserver
    ? new win.MutationObserver(resize)
    : null;
  viewObserver?.observe(svg, {
    attributes: true,
    attributeFilter: ['viewBox']
  });
  resize();
  draw();
  if (options.autoplay && !reduced?.matches) play();
  else update();
  return {
    plan,
    root: controls,
    play,
    pause,
    seek(time) {
      motionFrame(plan, time);
      stopClock();
      elapsed = time;
      update();
      return state();
    },
    getState: state,
    resize,
    destroy() {
      if (destroyed) return;
      stopClock();
      wanted = false;
      destroyed = true;
      abort.abort();
      observer?.disconnect();
      sizeObserver?.disconnect();
      viewObserver?.disconnect();
      group.remove();
      controls.remove();
    }
  };
}
