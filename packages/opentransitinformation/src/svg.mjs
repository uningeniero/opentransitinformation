// SPDX-License-Identifier: Apache-2.0
import { contrast, textColor } from './styles.mjs';
import { badgeColors } from './color.mjs';
import { serializeBackground, routePaint } from './background.mjs';
import { localeCopy, accessCopy } from './locale.mjs';
export const escapeXml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;'
      })[c]
  );
export const stableId = (value) =>
  'u' +
  Array.from(new TextEncoder().encode(String(value)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const n = (value) => Number(value.toFixed(3));
const pathData = (coords) =>
  coords.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join(' ');
export function serializeSvg(network, layout, style, measured, options = {}) {
  const copy = localeCopy(options.locale);
  const mode = options.mode || style.mode;
  const active = options.activeRoutes ? new Set(options.activeRoutes) : null;
  const routes = network.routes.filter((r) => !active || active.has(r.id));
  const routeMap = new Map(routes.map((r) => [r.id, r]));
  const stopMap = new Map(network.stops.map((s) => [s.id, s]));
  const suffix = stableId(`${network.id}-${options.idPrefix || ''}`),
    titleId = `oti-title-${suffix}`,
    descId = `oti-desc-${suffix}`;
  const entityId = (kind, value) => `${kind}-${suffix}-${stableId(value)}`;
  const routeTokens = (ids) => ids.map(encodeURIComponent).join(' ');
  const legendCols = Math.max(
    1,
    Math.min(routes.length, Math.floor((layout.width - 60) / 260))
  );
  const cellWidth = (layout.width - 60) / legendCols;
  const legend = [];
  let legendY = layout.height + 12;
  for (let i = 0; i < routes.length; i += legendCols) {
    const row = routes.slice(i, i + legendCols).map((route, j) => ({
      route,
      x: 30 + j * cellWidth,
      lines: measured.wrap(
        route.shortName === route.name
          ? route.shortName
          : `${route.shortName} - ${route.name}`,
        cellWidth - 48,
        16
      )
    }));
    const rowHeight =
      Math.max(1, ...row.map((item) => item.lines.length)) * 20 + 18;
    legend.push(
      ...row.map((item) => ({ ...item, y: legendY, height: rowHeight }))
    );
    legendY += rowHeight;
  }
  const footerY = legendY + 14;
  const fontFamily = `${options.font?.family || style.fontFamily} ${suffix}`;
  const metadata = {
    ...network.metadata,
    generator: 'opentransitinformation@0.3.2',
    profile: options.profile || style.mode,
    generatedAt: options.generatedAt || new Date().toISOString()
  };
  const source =
    typeof metadata.source === 'string'
      ? metadata.source
      : metadata.source?.name;
  const caption = [
    source,
    metadata.validFrom && `${copy.from} ${metadata.validFrom}`,
    metadata.validUntil && `${copy.until} ${metadata.validUntil}`,
    metadata.license
  ]
    .filter(Boolean)
    .join(' - ');
  const footerLines = [
    ...measured.wrap(caption, layout.width - 60, 14),
    ...measured.wrap(
      `${network.coordinateSystem === 'planar' || mode === 'schematic' ? copy.schematic : copy.geographic}${network.stops.some((s) => s.accessible === true) ? ' - ' + copy.accessKey : ''}`,
      layout.width - 60,
      14
    )
  ];
  if (metadata.excerptCaption)
    footerLines.push(
      ...measured.wrap(metadata.excerptCaption, layout.width - 60, 14)
    );
  const hasPlatformLinks =
    metadata.baseMap?.source === 'OpenStreetMap' &&
    layout.stops.some((stop) => stop.connections?.length);
  if (hasPlatformLinks)
    footerLines.push(
      ...measured.wrap(copy.platformLinks, layout.width - 60, 14)
    );
  const osmAttributionStart = footerLines.length;
  if (metadata.baseMap?.source === 'OpenStreetMap') {
    footerLines.push(
      ...measured.wrap(
        `© OpenStreetMap contributors - ODbL 1.0 - ${copy.baseMapDate}: ${metadata.baseMap.dataAsOf || copy.unknownDate} - openstreetmap.org/copyright`,
        layout.width - 60,
        14
      )
    );
  }
  const totalHeight = footerY + footerLines.length * 19 + 14;
  const content = [
    `<svg id="map-${suffix}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${totalHeight}" width="${layout.width}" height="${totalHeight}" data-oti="0.3" lang="${options.locale || 'en'}" role="group" aria-labelledby="${titleId} ${descId}" font-family="'${escapeXml(fontFamily)}'" font-size="${style.fontSize}" font-weight="600">`,
    `<title id="${titleId}">${escapeXml(network.name)}</title>`,
    `<desc id="${descId}">${escapeXml(copy.description(routes.length, layout.stops.length))}</desc>`,
    `<metadata>${escapeXml(JSON.stringify(metadata))}</metadata>`,
    `<style>@font-face{font-family:'${escapeXml(fontFamily)}';src:url(data:font/ttf;base64,${measured.fontData}) format('truetype');font-weight:600;font-style:normal} #map-${suffix} .oti-label{paint-order:stroke;stroke:${style.background};stroke-width:5;stroke-linejoin:round} #map-${suffix} [role=button]{cursor:pointer} #map-${suffix} [role=button]:focus{outline:3px solid #005B96;outline-offset:4px} #map-${suffix} .is-dimmed{opacity:.16} #map-${suffix} .is-selected{filter:drop-shadow(0 0 2px ${style.foreground})}@media(prefers-reduced-motion:reduce){#map-${suffix} *{transition:none!important}}</style>`,
    `<rect width="100%" height="100%" fill="${style.background}"/>`,
    ...measured.header.titleLines.map(
      (line, i) =>
        `<text x="30" y="${42 + i * 36}" font-size="30" fill="${style.foreground}">${escapeXml(line)}</text>`
    ),
    ...measured.header.subtitleLines.map(
      (line, i) =>
        `<text x="30" y="${measured.header.titleLines.length * 36 + 32 + i * 22}" font-size="16" fill="${style.muted}">${escapeXml(line)}</text>`
    )
  ];
  content.push(
    serializeBackground(layout, style, options, {
      escapeXml,
      n,
      pathData,
      clipId: `background-${suffix}`
    })
  );
  content.push('<g data-layer="routes">');
  for (const route of routes) {
    content.push(
      `<g id="${entityId('route', route.id)}" data-route-id="${escapeXml(route.id)}" data-route-short-name="${escapeXml(route.shortName)}" data-color="${route.color}" data-routes="${escapeXml(encodeURIComponent(route.id))}" role="button" tabindex="0" aria-label="${escapeXml(copy.route(route.shortName, route.name))}" aria-pressed="false"><title>${escapeXml(`${route.shortName} - ${route.name}`)}</title>`
    );
    const paint = routePaint(
      route.color,
      style,
      layout.background,
      options.backgroundStyle
    );
    for (const p of layout.paths.filter((p) => p.routeId === route.id)) {
      content.push(
        ...paint.casings.map(
          (c) =>
            `<path class="casing" d="${p.d}" fill="none" stroke="${c.color}" stroke-width="${n(c.width)}" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"/>`
        ),
        `<path d="${p.d}" fill="none" stroke="${route.color}" stroke-width="${style.lineWidth}" stroke-linejoin="round" stroke-linecap="round"${route.service === 'limited' ? ' stroke-dasharray="10 7"' : ''}/>`,
        `<path d="${p.d}" fill="none" stroke="transparent" stroke-width="24" pointer-events="stroke" aria-hidden="true"/>`
      );
      for (const continuation of p.continuations || []) {
        const d = pathData(continuation);
        content.push(
          `<path data-continuation="" d="${d}" fill="none" stroke="${style.background}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"/>`,
          `<path d="${d}" fill="none" stroke="${route.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"/>`
        );
      }
    }
    content.push('</g>');
  }
  content.push('</g>');
  content.push('<g data-layer="stops">');
  for (const s of layout.stops) {
    const raw = stopMap.get(s.id),
      [a, b] = s.endpoints;
    const access = accessCopy(raw.accessible, copy);
    const names = s.routes
      .map((id) => routeMap.get(id)?.shortName)
      .filter(Boolean);
    const attrs = `id="${entityId('stop', s.id)}" data-stop-ids="${escapeXml(s.id)}" data-name="${escapeXml(raw.name)}" data-routes="${escapeXml(routeTokens(s.routes))}" data-rank="${s.terminal ? 5 : Math.max(1, raw.priority)}" data-accessible="${raw.accessible === null ? 'unknown' : raw.accessible}" role="button" tabindex="0" aria-pressed="false" aria-label="${escapeXml(copy.stopInfo(raw.name, names.join(', '), access))}"`;
    content.push(
      `<g ${attrs}><title>${escapeXml(`${raw.name} - ${access}`)}</title>`
    );
    const hit = s.hitBounds;
    content.push(
      `<rect data-stop-hit="" x="${n(hit.x)}" y="${n(hit.y)}" width="${n(hit.width)}" height="${n(hit.height)}" fill="transparent" pointer-events="all"/>`
    );
    if (s.symbolKind === 'interchange') {
      for (const link of s.connections) {
        if (metadata.baseMap?.source === 'OpenStreetMap') {
          content.push(
            `<path data-transfer-link="schematic" d="${link.d}" fill="none" stroke="${style.background}" stroke-width="5" stroke-linecap="round"/>`,
            `<path d="${link.d}" fill="none" stroke="${style.foreground}" stroke-width="1.7" stroke-dasharray="4 4" stroke-linecap="round"/>`
          );
        } else
          content.push(
            `<path data-transfer-link="" d="${link.d}" fill="none" stroke="${style.foreground}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
            `<path d="${link.d}" fill="none" stroke="${style.background}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
          );
      }
      for (const marker of s.markers) {
        const [a, b] = marker.endpoints,
          radius = marker.radius;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01)
          content.push(
            `<circle cx="${n(a[0])}" cy="${n(a[1])}" r="${n(radius)}" fill="${style.background}" stroke="${style.foreground}" stroke-width="2"/>`
          );
        else
          content.push(
            `<path d="M${n(a[0])} ${n(a[1])} L${n(b[0])} ${n(b[1])}" fill="none" stroke="${style.foreground}" stroke-width="${n(radius * 2 + 2)}" stroke-linecap="round"/>`,
            `<path d="M${n(a[0])} ${n(a[1])} L${n(b[0])} ${n(b[1])}" fill="none" stroke="${style.background}" stroke-width="${n(radius * 2 - 2)}" stroke-linecap="round"/>`
          );
      }
    } else if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01)
      content.push(
        `<circle cx="${n(a[0])}" cy="${n(a[1])}" r="${s.radius}" fill="${style.background}" stroke="${style.foreground}" stroke-width="2"/>`
      );
    else
      content.push(
        `<path d="M${n(a[0])} ${n(a[1])} L${n(b[0])} ${n(b[1])}" fill="none" stroke="${style.foreground}" stroke-width="${s.radius * 2 + 2}" stroke-linecap="round"/>`,
        `<path d="M${n(a[0])} ${n(a[1])} L${n(b[0])} ${n(b[1])}" fill="none" stroke="${style.background}" stroke-width="${s.radius * 2 - 2}" stroke-linecap="round"/>`
      );
    content.push('</g>');
  }
  content.push('</g>');
  content.push('<g data-layer="labels" pointer-events="none">');
  for (const label of layout.labels) {
    const s = stopMap.get(label.stopId),
      m = measured.metrics[s.id],
      b = label.bounds;
    const symbol = layout.stops.find((v) => v.id === s.id);
    content.push(
      `<g id="${entityId('label-stop', s.id)}" data-for="${entityId('stop', s.id)}" data-routes="${escapeXml(routeTokens(symbol?.routes || []))}">`
    );
    if (label.leader)
      content.push(
        `<path d="${pathData(label.leader)}" fill="none" stroke="${style.background}" stroke-width="3"/>`,
        `<path d="${pathData(label.leader)}" fill="none" stroke="${style.muted}" stroke-width="1"/>`
      );
    let y = b.y;
    let x = b.x;
    if (m.codes.length) {
      for (let i = 0; i < m.codes.length; i++) {
        const r = routes.find((r) => r.shortName === m.codes[i]);
        const color = r?.color || style.foreground;
        const badge = badgeColors(color, style);
        content.push(
          `<rect x="${n(x)}" y="${n(y)}" width="${n(m.codeWidths[i])}" height="${n(m.lineHeight)}" rx="3" fill="${badge.background}" stroke="${badge.border}" stroke-width="1.5"/>`,
          `<text x="${n(x + 8)}" y="${n(y + style.fontSize * 0.93)}" fill="${badge.foreground}">${escapeXml(m.codes[i])}</text>`
        );
        x += m.codeWidths[i] + 4;
      }
      y += m.lineHeight + 3;
    }
    for (let i = 0; i < m.lines.length; i++) {
      const line = m.lines[i];
      if (i === 0 && m.accessWidth)
        content.push(
          `<rect x="${n(b.x + 2)}" y="${n(y)}" width="20" height="${n(m.lineHeight)}" rx="3" fill="${style.background}"/>`,
          `<g class="oti-accessibility" transform="translate(${n(b.x + 9)} ${n(y + style.fontSize * 0.55)}) scale(1.15)" fill="${style.foreground}" aria-hidden="true"><circle cx="1" cy="-4.5" r="1.4"/><path d="M0 -2.4 L0 1 L3.7 1 L5.1 4.4 L6.5 3.8 M0 -0.1 L3.7 -0.1 M-1.9 0 A3.6 3.6 0 1 0 2.1 5" fill="none" stroke="${style.foreground}" stroke-width="1.5" stroke-linejoin="round"/></g>`
        );
      content.push(
        `<text class="oti-label" x="${n(b.x + 3 + (i === 0 ? m.accessWidth : 0))}" y="${n(y + style.fontSize)}" fill="${style.foreground}">${escapeXml(line)}</text>`
      );
      y += m.lineHeight;
    }
    content.push('</g>');
  }
  content.push('</g>');
  content.push(`<g data-layer="legend" aria-label="${copy.routes}">`);
  for (const item of legend) {
    const r = item.route,
      x = item.x,
      y = item.y;
    content.push(
      `<g id="${entityId('legend', r.id)}" data-route-id="${escapeXml(r.id)}" role="button" tabindex="0" aria-pressed="false" aria-label="${escapeXml(copy.route(r.shortName, r.name))}"><rect x="${n(x)}" y="${n(y - 20)}" width="${n(cellWidth - 8)}" height="${item.height - 4}" fill="transparent"/><rect x="${n(x)}" y="${n(y - 15)}" width="28" height="6" rx="3" fill="${r.color}" stroke="${contrast(r.color, style.background) < 3 ? style.casing : r.color}" stroke-width="1"/>`
    );
    for (let i = 0; i < item.lines.length; i++)
      content.push(
        `<text x="${n(x + 38)}" y="${n(y - 7 + i * 20)}" font-size="16" fill="${style.foreground}">${escapeXml(item.lines[i])}</text>`
      );
    content.push('</g>');
  }
  content.push('</g>');
  for (let i = 0; i < footerLines.length; i++) {
    if (i >= osmAttributionStart)
      content.push(
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">'
      );
    content.push(
      `<text x="30" y="${footerY + i * 19}" font-size="14" fill="${style.muted}">${escapeXml(footerLines[i])}</text>`
    );
    if (i >= osmAttributionStart) content.push('</a>');
  }
  content.push('</svg>');
  return content.join('');
}
