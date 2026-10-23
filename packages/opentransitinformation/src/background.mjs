// SPDX-License-Identifier: Apache-2.0
import { contrast, textColor } from './styles.mjs';
export function routePaint(color, style, features, profile) {
  const paint = backgroundPaint(style, profile);
  const surfaces = [
    ...new Set([
      style.background,
      ...(paint.profile === 'none'
        ? []
        : features
            .filter(
              (f) =>
                f.kind !== 'district' &&
                (f.geometry === 'polygon' || f.kind === 'water')
            )
            .map((f) => paint.colors[f.kind]))
    ])
  ];
  const width = Math.min(style.lineSpacing - 0.5, style.lineWidth + 3.5);
  let casings;
  if (surfaces.every((c) => contrast(color, c) >= style.graphicContrast))
    casings = [
      { color: style.background, width: Math.min(width, style.lineWidth + 2.5) }
    ];
  else if (
    surfaces.every((c) => contrast(style.casing, c) >= style.graphicContrast)
  )
    casings = [{ color: style.casing, width }];
  else {
    const inner = textColor(color),
      outer = inner === '#FFFFFF' ? '#000000' : '#FFFFFF';
    casings = [
      { color: outer, width },
      { color: inner, width: style.lineWidth + (width - style.lineWidth) / 2 }
    ];
  }
  const minimumContrast = Math.min(
    ...surfaces.map((c) =>
      Math.max(contrast(color, c), ...casings.map((s) => contrast(s.color, c)))
    )
  );
  return {
    casings,
    minimumContrast,
    insufficientSpace:
      casings.length > 1 && style.lineSpacing - style.lineWidth < 3
  };
}
const atlas = {
  land: '#FAF8F2',
  water: '#D8EBF1',
  park: '#DFEBD9',
  urban: '#F0ECE2',
  building: '#DFDCD3',
  district: '#A7B6B5',
  street: '#FFFFFF',
  rail: '#9BA9AF'
};
const mono = {
  land: '#F8F8F6',
  water: '#E4E9EC',
  park: '#ECF0EA',
  urban: '#F0F0ED',
  building: '#E1E3E0',
  district: '#B4BDBC',
  street: '#FFFFFF',
  rail: '#A0AAAF'
};
const mix = (a, b, t) =>
  '#' +
  [1, 3, 5]
    .map((i) =>
      Math.round(
        parseInt(a.slice(i, i + 2), 16) * (1 - t) +
          parseInt(b.slice(i, i + 2), 16) * t
      )
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
export function backgroundPaint(style, profile = 'subtle') {
  if (!['none', 'subtle', 'atlas', 'mono'].includes(profile))
    throw new TypeError('Unknown backgroundStyle');
  const colors = Object.fromEntries(
    Object.keys(atlas).map((k) => [
      k,
      profile === 'atlas' ? atlas[k] : profile === 'mono' ? mono[k] : style[k]
    ])
  );
  if (
    contrast('#FFFFFF', style.background) >
    contrast('#000000', style.background)
  ) {
    for (const k of Object.keys(colors))
      colors[k] = mix(
        style.background,
        colors[k],
        ['rail', 'district'].includes(k) ? 0.34 : 0.13
      );
  }
  return { profile, colors };
}

export function serializeBackground(
  layout,
  style,
  options = {},
  { escapeXml, n, pathData, clipId }
) {
  const { profile, colors } = backgroundPaint(style, options.backgroundStyle);
  if (profile === 'none' || !layout.background.length) return '';
  const bounds = layout.mapBounds;
  const out = [
    `<defs><clipPath id="${escapeXml(clipId)}" clipPathUnits="userSpaceOnUse"><rect x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.width)}" height="${n(bounds.height)}"/></clipPath></defs>`,
    `<g data-layer="background" data-background-style="${profile}" clip-path="url(#${escapeXml(clipId)})" pointer-events="none" aria-hidden="true">`
  ];
  if (profile === 'atlas' || profile === 'mono')
    out.push(
      `<rect x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.width)}" height="${n(bounds.height)}" fill="${colors.land}"/>`
    );
  for (const kind of [
    'land',
    'urban',
    'park',
    'water',
    'building',
    'district',
    'street',
    'rail'
  ]) {
    const features = layout.background.filter((f) => f.kind === kind);
    if (!features.length) continue;
    out.push(`<g id="${escapeXml(clipId)}-${kind}" data-layer="${kind}">`);
    for (const feature of features) {
      const polygon = feature.geometry === 'polygon';
      const d = feature.coordinates
        .map((r) => pathData(r) + (polygon ? ' Z' : ''))
        .join(' ');
      const attrs = `d="${d}" stroke-linejoin="round" stroke-linecap="round"`;
      if (kind === 'street') {
        const major = ['motorway', 'trunk', 'primary'].includes(
          feature.classification
        );
        const secondary = feature.classification === 'secondary';
        const tertiary = feature.classification === 'tertiary';
        const width =
          profile === 'atlas'
            ? major
              ? 8
              : secondary
                ? 6.5
                : tertiary
                  ? 5
                  : 3
            : major
              ? 5
              : secondary
                ? 4
                : 2.5;
        out.push(
          `<path ${attrs} fill="none" stroke="${mix(colors.street, colors.rail, 0.32)}" stroke-width="${width + 1.3}"/>`
        );
        out.push(
          `<path ${attrs} fill="none" stroke="${colors.street}" stroke-width="${width}"/>`
        );
      } else if (kind === 'district') {
        out.push(
          `<path ${attrs} fill="none" stroke="${colors.district}" stroke-width="1.2" stroke-dasharray="7 5"/>`
        );
      } else if (kind === 'rail') {
        out.push(
          `<path ${attrs} fill="none" stroke="${colors.rail}" stroke-width="1.7" stroke-dasharray="7 4"/>`
        );
      } else if (!polygon) {
        out.push(
          `<path ${attrs} fill="none" stroke="${colors[kind]}" stroke-width="${kind === 'water' ? (profile === 'atlas' ? 12 : 9) : 2}"/>`
        );
      } else {
        const border =
          kind === 'building' || kind === 'park' || kind === 'water';
        out.push(
          `<path ${attrs} fill="${colors[kind]}" fill-rule="evenodd" stroke="${border ? mix(colors[kind], colors.rail, 0.14) : 'none'}" stroke-width=".6"/>`
        );
      }
    }
    out.push('</g>');
  }
  out.push('<g data-layer="context-labels">');
  for (const label of layout.contextLabels || []) {
    const b = label.bounds;
    out.push(
      `<text data-context-id="${escapeXml(label.featureId)}" x="${n(b.x + 6)}" y="${n(b.y + 16)}" font-size="16"${label.kind === 'water' ? ' font-style="italic"' : ''} fill="${style.muted}" stroke="${style.background}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${escapeXml(label.name)}</text>`
    );
  }
  out.push('</g></g>');
  return out.join('');
}
