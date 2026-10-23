// SPDX-License-Identifier: Apache-2.0
import { createDiagram } from './index.mjs';
import { OtiError } from './model.mjs';
import { stableId } from './svg.mjs';
import { badgeColors } from './color.mjs';
import { localeCopy, accessCopy } from './locale.mjs';
const css = `.oti-viewer{font:16px/1.45 system-ui,sans-serif;color:#162536;background:#fff;border:1px solid #d9dfe4;border-radius:14px;overflow:hidden;max-width:100%;color-scheme:light}.oti-viewer *{box-sizing:border-box}.oti-viewer button,.oti-viewer input{font:inherit;min-height:44px;color:#162536;background:#fff;border:1px solid #c0cbd4;border-radius:7px;padding:8px 12px}.oti-viewer button{cursor:pointer}.oti-viewer button:hover{background:#f0f5f8}.oti-viewer :focus-visible{outline:3px solid #005b96;outline-offset:3px}.oti-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:16px;border-bottom:1px solid #d9dfe4}.oti-search{flex:1;min-width:160px;display:flex;gap:8px;align-items:center}.oti-search input{width:100%;min-width:100px}.oti-content{display:grid;grid-template-columns:minmax(0,1fr) 260px}.oti-canvas{min-width:0;overflow:hidden;position:relative;touch-action:pan-y}.oti-canvas>svg{display:block;width:100%;height:auto;min-height:320px;max-height:85vh;touch-action:none;user-select:none}.oti-sidebar{padding:16px;border-left:1px solid #e2e7eb;max-height:760px;overflow:auto}.oti-sidebar h2{font-size:18px;margin:0 0 12px}.oti-route-list,.oti-results{list-style:none;padding:0;margin:0}.oti-route-list li{margin-bottom:7px}.oti-route-list button{width:100%;text-align:left;display:flex;align-items:center;gap:10px}.oti-route-list button[aria-pressed=true]{background:#e8f1f7;border-color:#005b96}.oti-route-code{display:inline-flex;align-items:center;justify-content:center;min-width:35px;padding:3px 7px;border-radius:5px;font-weight:700}.oti-info{padding:14px 16px;border-top:1px solid #d9dfe4;min-height:56px}.oti-results{max-height:260px;overflow:auto}.oti-results button{width:100%;text-align:left;margin:3px 0}.oti-text{border-top:1px solid #d9dfe4;padding:16px}.oti-text summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}.oti-text li{margin:4px 0}.oti-sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:700px){.oti-content{display:flex;flex-direction:column}.oti-sidebar{border-left:0;border-top:1px solid #e2e7eb;max-height:260px}.oti-route-list{display:flex;flex-wrap:wrap;gap:6px}.oti-route-list li{margin:0;flex:1 1 140px}.oti-toolbar{padding:10px}.oti-search{flex-basis:100%}.oti-canvas>svg{min-height:360px}.oti-text{padding:12px}}@media print{.oti-toolbar,.oti-sidebar,.oti-info,.oti-text{display:none}.oti-content{display:block}.oti-viewer{border:0}.oti-canvas>svg{max-height:none;width:100%;height:auto}}@media(prefers-reduced-motion:reduce){.oti-viewer *{scroll-behavior:auto!important;transition:none!important}}`;
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
function element(doc, tag, text, attrs = {}) {
  const e = doc.createElement(tag);
  if (text != null) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
export async function mountViewer(container, input, options = {}) {
  const copy = localeCopy(options.locale);
  if (!container || container.nodeType !== 1)
    throw new OtiError('INVALID_CONTAINER', 'Provide a DOM element');
  const diagram = await createDiagram(input, {
    ...options,
    idPrefix: options.idPrefix || Math.random().toString(36).slice(2)
  });
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const abort = new AbortController();
  const on = (el, event, fn, opts = {}) =>
    el.addEventListener(event, fn, { ...opts, signal: abort.signal });
  const root = element(doc, 'section', null, {
    class: 'oti-viewer',
    'aria-label': diagram.network.name
  });
  const style = element(doc, 'style', css);
  root.append(style);
  const toolbar = element(doc, 'div', null, {
    class: 'oti-toolbar',
    role: 'toolbar',
    'aria-label': copy.controls
  });
  const labelId = `oti-search-${stableId(diagram.network.id)}-${Math.random().toString(36).slice(2, 9)}`;
  const searchLabel = element(doc, 'label', copy.search, { for: labelId });
  const search = element(doc, 'input', null, {
    id: labelId,
    type: 'search',
    placeholder: copy.placeholder,
    autocomplete: 'off'
  });
  const searchBox = element(doc, 'div', null, { class: 'oti-search' });
  searchBox.append(searchLabel, search);
  toolbar.append(searchBox);
  const plus = element(doc, 'button', '+', {
      type: 'button',
      'aria-label': copy.zoomIn
    }),
    minus = element(doc, 'button', '−', {
      type: 'button',
      'aria-label': copy.zoomOut
    }),
    reset = element(doc, 'button', copy.reset, { type: 'button' });
  toolbar.append(plus, minus, reset);
  root.append(toolbar);
  const content = element(doc, 'div', null, { class: 'oti-content' });
  const canvas = element(doc, 'div', null, { class: 'oti-canvas' });
  canvas.innerHTML = diagram.svg;
  const svg = canvas.querySelector('svg');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', copy.map);
  const side = element(doc, 'aside', null, {
    class: 'oti-sidebar',
    'aria-label': copy.side
  });
  const heading = element(doc, 'h2', copy.routes);
  side.append(heading);
  const routeList = element(doc, 'ul', null, { class: 'oti-route-list' });
  const results = element(doc, 'ul', null, {
    class: 'oti-results',
    'aria-label': copy.searchResults
  });
  const routeButtons = new Map();
  for (const r of diagram.network.routes.filter(
    (r) => !options.activeRoutes || options.activeRoutes.includes(r.id)
  )) {
    const li = element(doc, 'li'),
      button = element(doc, 'button', null, {
        type: 'button',
        'aria-pressed': 'false',
        'aria-label': copy.selectRoute(r.shortName, r.name)
      });
    const badge = element(doc, 'span', r.shortName, {
      class: 'oti-route-code'
    });
    const colors = badgeColors(r.color, diagram.style);
    badge.style.backgroundColor = colors.background;
    badge.style.color = colors.foreground;
    badge.style.border = `2px solid ${colors.border}`;
    button.append(badge, element(doc, 'span', r.name));
    on(button, 'click', () => selectRoute(r.id));
    li.append(button);
    routeList.append(li);
    routeButtons.set(r.id, button);
  }
  side.append(routeList, results);
  content.append(canvas, side);
  root.append(content);
  const info = element(doc, 'div', copy.prompt, {
    class: 'oti-info',
    role: 'status',
    'aria-live': 'polite'
  });
  root.append(info);
  const details = element(doc, 'details', null, { class: 'oti-text' });
  details.append(element(doc, 'summary', copy.all));
  for (const r of diagram.text) {
    const section = element(doc, 'section'),
      h = element(doc, 'h3', `${r.code} - ${r.name}`);
    section.append(h);
    for (const path of r.paths) {
      const list = element(doc, 'ol');
      for (const s of path) {
        const li = element(doc, 'li');
        const accessible =
          s.accessible === true
            ? ' - ' + copy.confirmed
            : s.accessible === false
              ? ' - ' + copy.inaccessible
              : ' - ' + copy.unknown;
        const b = element(doc, 'button', s.name + accessible, {
          type: 'button'
        });
        on(b, 'click', () => selectStop(s.id));
        li.append(b);
        list.append(li);
      }
      section.append(list);
    }
    details.append(section);
  }
  root.append(details);
  container.replaceChildren(root);
  const original = svg.viewBox.baseVal;
  const geographicBase =
    diagram.network.metadata.baseMap?.source === 'OpenStreetMap';
  const full = geographicBase
    ? { ...diagram.layout.mapBounds }
    : {
        x: original.x,
        y: original.y,
        width: original.width,
        height: original.height
      };
  let fitMapFrame = () => {};
  if (geographicBase) {
    svg.setAttribute('width', String(full.width));
    svg.setAttribute('height', String(full.height));
    const credit = element(doc, 'p', null, { class: 'oti-attribution oti-map-credit' });
    credit.style.cssText =
      'margin:0;padding:7px 12px;border-top:1px solid #d9dfe4;font-size:14px;line-height:1.4;background:#fff;color:#162536';
    const link = element(doc, 'a', '© OpenStreetMap contributors', {
      href: 'https://www.openstreetmap.org/copyright',
      target: '_blank',
      rel: 'noopener'
    });
    link.style.color = '#162536';
    const rawDate = diagram.network.metadata.baseMap.dataAsOf;
    const sourceDate = typeof rawDate === 'string' && Number.isFinite(Date.parse(rawDate))
      ? new Date(rawDate).toISOString().slice(0,16).replace('T',' ') + ' UTC' : copy.unknownDate;
    credit.append(link, doc.createTextNode(' - ODbL 1.0'), element(doc,'br'),
      doc.createTextNode(`${copy.baseMapDate}: ${sourceDate}`));
    if (diagram.network.metadata.source?.name)
      credit.append(element(doc,'br'),doc.createTextNode(diagram.network.metadata.source.name));
    if (rawDate) credit.setAttribute('data-source-time', String(rawDate));
    if (diagram.network.metadata.excerptCaption) {
      const note = element(doc, 'p', diagram.network.metadata.excerptCaption, {
        class: 'oti-excerpt-note'
      });
      note.style.cssText =
        'margin:0;padding:8px 16px;border-bottom:1px solid #d9dfe4;font-size:14px;line-height:1.5';
      if (diagram.layout.stops.some((stop) => stop.connections?.length))
        note.append(doc.createTextNode(' - ' + copy.platformLinks));
      root.insertBefore(note, content);
    }
    canvas.append(credit);
    svg.style.maxHeight = 'none';
    svg.style.minHeight = '0';
    fitMapFrame = () => {
      const available = win.innerHeight - svg.getBoundingClientRect().top - credit.getBoundingClientRect().height - 16;
      const height = Math.floor(Math.max(260, Math.min(720, available)));
      if (svg.style.height !== height+'px') svg.style.height = height+'px';
    };
    fitMapFrame();
  }
  let view = { ...full };
  let state = { routeId: null, stopId: null };
  let drag, gesture;
  let suppressUntil = 0;
  const pointers = new Map();
  const updateView = () => {
    fitMapFrame();
    view.width = Math.max(full.width / 8, Math.min(full.width, view.width));
    view.height = (view.width * full.height) / full.width;
    view.x = Math.max(
      full.x,
      Math.min(full.x + full.width - view.width, view.x)
    );
    view.y = Math.max(
      full.y,
      Math.min(full.y + full.height - view.height, view.y)
    );
    svg.setAttribute(
      'viewBox',
      `${view.x} ${view.y} ${view.width} ${view.height}`
    );
    if (geographicBase) {
      const ctm = svg.getScreenCTM();
      const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 0;
      if (scale > 0) {
        for (const rect of svg.querySelectorAll('[data-stop-hit]')) {
          const id = rect
            .closest('[data-stop-ids]')
            .getAttribute('data-stop-ids');
          const bounds = diagram.layout.stops.find(
            (stop) => stop.id === id
          ).hitBounds;
          const width = Math.max(bounds.width, 24 / scale),
            height = Math.max(bounds.height, 24 / scale);
          rect.setAttribute('x', String(bounds.x + (bounds.width - width) / 2));
          rect.setAttribute(
            'y',
            String(bounds.y + (bounds.height - height) / 2)
          );
          rect.setAttribute('width', String(width));
          rect.setAttribute('height', String(height));
        }
        for (const path of svg.querySelectorAll('path[stroke="transparent"]'))
          path.setAttribute('vector-effect', 'non-scaling-stroke');
      }
    }
  };
  if (
    geographicBase &&
    container.clientWidth > 0 &&
    container.clientWidth <= 700
  ) {
    const factor = Math.min(
      1,
      (Math.min(svg.clientWidth/full.width,svg.clientHeight/full.height) * diagram.style.fontSize) / 14
    );
    view = {
      x: full.x + (full.width * (1 - factor)) / 2,
      y: full.y + (full.height * (1 - factor)) / 2,
      width: full.width * factor,
      height: full.height * factor
    };
  }
  updateView();
  if (geographicBase && win.ResizeObserver) {
    const observer = new win.ResizeObserver(updateView);
    observer.observe(canvas);
    abort.signal.addEventListener('abort', () => observer.disconnect(), {
      once: true
    });
  }
  function zoom(factor) {
    const w = view.width * factor,
      h = (w * full.height) / full.width;
    view = {
      x: view.x + (view.width - w) / 2,
      y: view.y + (view.height - h) / 2,
      width: w,
      height: h
    };
    updateView();
  }
  function apply() {
    const selected = new Set(
      state.routeId
        ? [state.routeId]
        : state.stopId
          ? diagram.layout.stops.find((s) => s.id === state.stopId)?.routes ||
            []
          : []
    );
    for (const e of svg.querySelectorAll('[data-routes]')) {
      const ids = (e.getAttribute('data-routes') || '')
        .split(' ')
        .map(decodeURIComponent);
      e.classList.toggle(
        'is-dimmed',
        selected.size > 0 && !ids.some((id) => selected.has(id))
      );
    }
    for (const [id, b] of routeButtons)
      b.setAttribute('aria-pressed', String(state.routeId === id));
    for (const e of svg.querySelectorAll('[data-route-id][role=button]'))
      e.setAttribute(
        'aria-pressed',
        String(e.getAttribute('data-route-id') === state.routeId)
      );
    for (const e of svg.querySelectorAll('[data-stop-ids]')) {
      const yes = e.getAttribute('data-stop-ids') === state.stopId;
      e.classList.toggle('is-selected', yes);
      e.setAttribute('aria-pressed', String(yes));
    }
    if (options.syncHash && win) {
      const url = new URL(win.location.href);
      url.hash = state.routeId
        ? `route=${encodeURIComponent(state.routeId)}`
        : state.stopId
          ? `stop=${encodeURIComponent(state.stopId)}`
          : '';
      win.history.replaceState(null, '', url);
    }
    options.onSelectionChange?.({ ...state });
  }
  function selectRoute(id) {
    const r = diagram.network.routes.find((r) => r.id === id);
    if (!r || !routeButtons.has(id))
      throw new OtiError('UNKNOWN_ROUTE', `Unknown route ${id}`);
    state = { routeId: id, stopId: null };
    info.textContent = copy.routeInfo(
      r.shortName,
      r.name,
      new Set(r.paths.flatMap((p) => p.stopIds)).size
    );
    apply();
    return { ...state };
  }
  function selectStop(id) {
    const s = diagram.network.stops.find((s) => s.id === id);
    const drawn = diagram.layout.stops.find((s) => s.id === id);
    if (!s || !drawn) throw new OtiError('UNKNOWN_STOP', `Unknown stop ${id}`);
    state = { routeId: null, stopId: id };
    const codes = drawn.routes.map(
      (id) => diagram.network.routes.find((r) => r.id === id).shortName
    );
    if (canvas.clientWidth < 700) {
      view.width = Math.min(
        view.width,
        Math.max(full.width / 8, canvas.clientWidth * 1.1)
      );
      view.height = (view.width * full.height) / full.width;
      view.x = drawn.position[0] - view.width / 2;
      view.y = drawn.position[1] - view.height / 2;
      updateView();
    } else if (
      drawn.position[0] < view.x ||
      drawn.position[0] > view.x + view.width ||
      drawn.position[1] < view.y ||
      drawn.position[1] > view.y + view.height
    ) {
      view.x = drawn.position[0] - view.width / 2;
      view.y = drawn.position[1] - view.height / 2;
      updateView();
    }
    info.textContent = copy.stopInfo(
      s.name,
      codes.join(', '),
      accessCopy(s.accessible, copy)
    );
    apply();
    return { ...state };
  }
  function clear() {
    state = { routeId: null, stopId: null };
    info.textContent = copy.prompt;
    apply();
  }
  const click = (e) => {
    if (performance.now() < suppressUntil) return;
    const target = e.target.closest(
      '[data-stop-ids][role=button],[data-route-id][role=button]'
    );
    if (!target) return;
    if (target.hasAttribute('data-stop-ids'))
      selectStop(target.getAttribute('data-stop-ids'));
    else selectRoute(target.getAttribute('data-route-id'));
  };
  on(svg, 'click', click);
  on(svg, 'keydown', (e) => {
    if (['Enter', ' '].includes(e.key) && e.target !== svg) {
      e.preventDefault();
      click(e);
    } else if (e.key === 'Escape') {
      clear();
    } else if (
      e.target === svg &&
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        '+',
        '-',
        '='
      ].includes(e.key)
    ) {
      e.preventDefault();
      if (e.key === '+' || e.key === '=') zoom(0.8);
      else if (e.key === '-') zoom(1.25);
      else {
        const step = view.width * 0.08;
        view.x +=
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        view.y +=
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        updateView();
      }
    }
  });
  on(plus, 'click', () => zoom(0.8));
  on(minus, 'click', () => zoom(1.25));
  on(reset, 'click', () => {
    view = { ...full };
    updateView();
    clear();
    search.value = '';
    results.replaceChildren();
    routeList.hidden = false;
    heading.textContent = copy.routes;
  });
  on(
    svg,
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.15 : 0.87);
    },
    { passive: false }
  );
  function beginGesture() {
    const list = [...pointers.values()];
    const matrix = svg.getScreenCTM();
    if (list.length === 2) {
      const [a, b] = list,
        cx = (a.x + b.x) / 2,
        cy = (a.y + b.y) / 2;
      const anchor = {
        x: (cx - matrix.e) / matrix.a,
        y: (cy - matrix.f) / matrix.d
      };
      gesture = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        cx,
        cy,
        anchor,
        fractionX: (anchor.x - view.x) / view.width,
        fractionY: (anchor.y - view.y) / view.height,
        scale: matrix.a,
        view: { ...view }
      };
      drag = null;
    } else if (list.length === 1) {
      drag = { x: list[0].x, y: list[0].y, scale: matrix.a, view: { ...view } };
      gesture = null;
    } else {
      drag = null;
      gesture = null;
    }
  }
  on(svg, 'pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!e.target.closest('[role=button]')) svg.setPointerCapture(e.pointerId);
    if (pointers.size === 2)
      for (const id of pointers.keys()) svg.setPointerCapture(id);
    beginGesture();
  });
  on(svg, 'pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture && pointers.size === 2) {
      const [a, b] = [...pointers.values()],
        distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < 4 || gesture.distance < 4) return;
      const width = Math.max(
        full.width / 8,
        Math.min(full.width, (gesture.view.width * gesture.distance) / distance)
      );
      const height = (width * full.height) / full.width,
        scale = (gesture.scale * gesture.view.width) / width;
      view = {
        x:
          gesture.anchor.x -
          gesture.fractionX * width -
          ((a.x + b.x) / 2 - gesture.cx) / scale,
        y:
          gesture.anchor.y -
          gesture.fractionY * height -
          ((a.y + b.y) / 2 - gesture.cy) / scale,
        width,
        height
      };
      suppressUntil = performance.now() + 500;
      updateView();
    } else if (drag) {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) < 4) return;
      if (!svg.hasPointerCapture(e.pointerId))
        svg.setPointerCapture(e.pointerId);
      view.x = drag.view.x - dx / drag.scale;
      view.y = drag.view.y - dy / drag.scale;
      suppressUntil = performance.now() + 500;
      updateView();
    }
  });
  const finishPointer = (e) => {
    pointers.delete(e.pointerId);
    beginGesture();
  };
  on(svg, 'pointerup', finishPointer);
  on(svg, 'pointercancel', finishPointer);

  on(search, 'input', () => {
    const q = norm(search.value.trim());
    results.replaceChildren();
    routeList.hidden = !!q;
    heading.textContent = q ? copy.results : copy.routes;
    if (!q) return;
    const matches = [
      ...diagram.network.routes
        .filter(
          (r) =>
            routeButtons.has(r.id) &&
            norm(`${r.shortName} ${r.name}`).includes(q)
        )
        .map((r) => ({
          text: copy.routeResult(r.shortName, r.name),
          action: () => selectRoute(r.id)
        })),
      ...diagram.network.stops
        .filter(
          (s) =>
            diagram.layout.stops.some((d) => d.id === s.id) &&
            norm(s.name).includes(q)
        )
        .map((s) => ({ text: s.name, action: () => selectStop(s.id) }))
    ].slice(0, 30);
    for (const item of matches) {
      const li = element(doc, 'li'),
        b = element(doc, 'button', item.text, { type: 'button' });
      on(b, 'click', () => {
        item.action();
        search.focus();
      });
      li.append(b);
      results.append(li);
    }
    if (!matches.length) results.append(element(doc, 'li', copy.noResults));
    info.textContent = copy.resultCount(matches.length);
  });
  on(search, 'keydown', (e) => {
    if (e.key === 'ArrowDown') {
      results.querySelector('button')?.focus();
      e.preventDefault();
    }
    if (e.key === 'Escape') {
      search.value = '';
      search.dispatchEvent(new win.Event('input'));
      clear();
    }
    if (e.key === 'Enter') {
      results.querySelector('button')?.click();
      e.preventDefault();
    }
  });
  on(results, 'keydown', (e) => {
    const list = [...results.querySelectorAll('button')],
      index = list.indexOf(doc.activeElement);
    if (e.key === 'ArrowDown') {
      list[(index + 1) % list.length]?.focus();
      e.preventDefault();
    }
    if (e.key === 'ArrowUp') {
      if (index <= 0) search.focus();
      else list[index - 1]?.focus();
      e.preventDefault();
    }
    if (e.key === 'Escape') search.focus();
  });
  if (options.syncHash && win?.location.hash) {
    const params = new URLSearchParams(win.location.hash.slice(1));
    if (params.has('route') && routeButtons.has(params.get('route')))
      selectRoute(params.get('route'));
    else if (
      params.has('stop') &&
      diagram.layout.stops.some((s) => s.id === params.get('stop'))
    )
      selectStop(params.get('stop'));
  }
  return {
    diagram,
    root,
    selectRoute,
    selectStop,
    clear,
    getState: () => ({ ...state }),
    getView: () => ({ ...view }),
    setView: (next) => {
      if (
        !next ||
        !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(next[k]))
      )
        throw new OtiError('INVALID_VIEW', 'View values must be finite');
      view = { ...next };
      updateView();
    },
    destroy: () => {
      abort.abort();
      if (root.parentNode === container) root.remove();
    }
  };
}
