// SPDX-License-Identifier: Apache-2.0
import { create } from 'fontkit';
import { readAsset } from './engine.mjs';
const fonts = new WeakMap();
export async function fontResource(custom) {
  const bytes = custom?.data || (await readAsset('SourceSans3-Semibold.ttf'));
  if (!fonts.has(bytes)) fonts.set(bytes, create(bytes));
  return { bytes, font: fonts.get(bytes) };
}
export function base64(bytes) {
  if (typeof Buffer !== 'undefined')
    return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export async function measureLabels(network, style, options = {}) {
  const {
    maxLabelWidth = 210,
    measureText,
    font: customFont,
    activeRoutes
  } = options;
  if (
    !Number.isFinite(maxLabelWidth) ||
    maxLabelWidth < 40 ||
    maxLabelWidth > 1000
  )
    throw new TypeError('maxLabelWidth must be 40..1000');
  if (
    customFont &&
    (!(customFont.data instanceof Uint8Array) ||
      typeof customFont.family !== 'string' ||
      /[^\p{L}\p{N} _-]/u.test(customFont.family) ||
      !customFont.family ||
      customFont.family.length > 80)
  )
    throw new TypeError('Invalid custom font');
  const { font, bytes } = await fontResource(customFont);
  const glyphIssues = [];
  const measure = (text, size = style.fontSize) => {
    const width = measureText
      ? (measureText(text) * size) / style.fontSize
      : (font.layout(text).positions.reduce((s, p) => s + p.xAdvance, 0) *
          size) /
        font.unitsPerEm;
    if (!Number.isFinite(width) || width < 0)
      throw new TypeError('Invalid measured text width');
    return width;
  };
  const wrap = (text, maxWidth, size = style.fontSize) => {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate, size) > maxWidth) {
        lines.push(line);
        line = '';
      }
      if (measure(word, size) > maxWidth) {
        for (const char of word) {
          if (line && measure(line + char, size) > maxWidth) {
            lines.push(line);
            line = '';
          }
          line += char;
        }
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines;
  };
  const checkGlyphs = (id, text) => {
    for (const cp of new Set([...text]))
      if (!font.hasGlyphForCodePoint(cp.codePointAt(0)))
        glyphIssues.push({
          code: 'FONT_GLYPH_MISSING',
          targetId: id,
          character: cp,
          severity: 'error'
        });
  };
  const terminals = new Map();
  for (const r of network.routes.filter(
    (r) => !activeRoutes || activeRoutes.includes(r.id)
  )) {
    checkGlyphs(r.id, r.name + r.shortName);
    for (const p of r.paths.filter((p) => p.stopIds[0] !== p.stopIds.at(-1)))
      for (const id of [p.startTerminus === false ? null : p.stopIds[0], p.endTerminus === false ? null : p.stopIds.at(-1)].filter(Boolean)) {
        if (!terminals.has(id)) terminals.set(id, new Set());
        terminals.get(id).add(r.shortName);
      }
  }
  const metrics = Object.create(null);
  for (const stop of network.stops) {
    checkGlyphs(stop.id, stop.name);
    const lines = wrap(stop.name, maxLabelWidth);
    const codes = [...(terminals.get(stop.id) || [])];
    const codeWidths = codes.map((c) => measure(c) + 16);
    const codeWidth =
      codeWidths.reduce((s, n) => s + n, 0) + Math.max(0, codes.length - 1) * 4;
    const accessWidth = stop.accessible === true ? 22 : 0;
    const lineHeight = style.fontSize * 1.25;
    metrics[stop.id] = {
      width:
        Math.max(
          codeWidth,
          ...lines.map((line, i) => measure(line) + (i === 0 ? accessWidth : 0))
        ) + 6,
      height: lines.length * lineHeight + (codes.length ? lineHeight + 3 : 0),
      lines,
      lineHeight,
      codes,
      codeWidths,
      accessWidth
    };
  }
  checkGlyphs(network.id, network.name);
  const headerWidth = (options.width || 1200) - 60;
  const titleLines = wrap(network.name, headerWidth, 30);
  const subtitle = [network.metadata.subtitle, options.scenarioName]
    .filter(Boolean)
    .join(' - ');
  const subtitleLines = wrap(subtitle, headerWidth, 16);
  const topInset = Math.max(
    90,
    titleLines.length * 36 + subtitleLines.length * 22 + 24
  );
  const contextMetrics = Object.create(null);
  for (const f of network.background) {
    if (
      !f.name ||
      ![...f.name].every((c) => font.hasGlyphForCodePoint(c.codePointAt(0)))
    )
      continue;
    contextMetrics[f.id] = {
      width: measure(f.name, 16) + 12,
      height: 22,
      text: f.name
    };
  }
  return {
    metrics,
    contextMetrics,
    fontData: base64(bytes),
    issues: glyphIssues,
    measure,
    wrap,
    header: { titleLines, subtitleLines, topInset }
  };
}
