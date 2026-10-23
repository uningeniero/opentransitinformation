// SPDX-License-Identifier: Apache-2.0
import { contrast, textColor, profiles } from './styles.mjs';
import { normalizeNetwork } from './model.mjs';
const matrices = {
  protan: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998
  ],
  deutan: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881
  ],
  tritan: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039
  ]
};
const decode = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const encode = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const channels = (color) => {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new TypeError('Expected #RRGGBB colour');
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
};
export function simulateColor(color, simulation = 'deutan') {
  const rgb = channels(color).map((x) => decode(x / 255));
  let output;
  if (simulation === 'grayscale') {
    const y = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    output = [y, y, y];
  } else {
    const m = matrices[simulation];
    if (!m) throw new TypeError('Unknown colour vision simulation');
    output = [0, 3, 6].map((i) => rgb.reduce((sum, v, j) => sum + m[i + j] * v, 0));
  }
  return (
    '#' +
    output
      .map((x) => Math.round(255 * encode(Math.max(0, Math.min(1, x)))))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}
export function badgeColors(color, style) {
  const foreground = textColor(color);
  return contrast(foreground, color) >= style.textContrast
    ? { background: color, foreground, border: color }
    : { background: style.background, foreground: style.foreground, border: color };
}
export function auditPalette(routes) {
  if (!Array.isArray(routes)) throw new TypeError('Expected routes');
  const simulations = ['protan', 'deutan', 'tritan', 'grayscale'];
  const palettes = Object.fromEntries(
    simulations.map((s) => [
      s,
      routes.map((r, i) =>
        simulateColor(
          r.color || profiles.schematic.palette[i % profiles.schematic.palette.length],
          s
        )
      )
    ])
  );
  const stops = routes.map((r) => new Set(r.paths.flatMap((p) => p.stopIds)));
  const issues = [];
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++) {
      if (![...stops[i]].some((id) => stops[j].has(id))) continue;
      for (const s of simulations) {
        const a = channels(palettes[s][i]),
          b = channels(palettes[s][j]);
        const distance = Math.hypot(...a.map((n, k) => n - b[k]));
        if (distance < 35)
          issues.push({
            code: 'PALETTE_SIMILAR',
            targetId: routes[i].id,
            relatedRouteId: routes[j].id,
            simulation: s,
            distance,
            severity: 'warning'
          });
      }
    }
  return { issues, simulations: palettes, heuristicDistance: 35 };
}
export function assignRouteColors(input, { palette } = {}) {
  const network = normalizeNetwork(input);
  const candidates = palette || [
    ...profiles.schematic.palette,
    '#C53D00',
    '#2D70AC',
    '#7A4D00',
    '#996B00',
    '#AA3377',
    '#227AA4',
    '#006C70',
    '#8D448B',
    '#D1495B',
    '#638A00',
    '#48639C',
    '#C15F15',
    '#754EA0',
    '#2A7F62',
    '#A65A55',
    '#5B6B8A'
  ];
  if (
    !Array.isArray(candidates) ||
    !candidates.length ||
    candidates.some((c) => !/^#[0-9a-f]{6}$/i.test(c))
  )
    throw new TypeError('Invalid adaptive palette');
  const stops = network.routes.map((r) => new Set(r.paths.flatMap((p) => p.stopIds)));
  const neighbours = network.routes.map((r, i) =>
    network.routes
      .map((_, j) => j)
      .filter((j) => i !== j && [...stops[i]].some((s) => stops[j].has(s)))
  );
  const sims = candidates.map((c) => [
    channels(c),
    ...['protan', 'deutan', 'tritan'].map((s) => channels(simulateColor(c, s)))
  ]);
  const assigned = new Map(),
    usage = candidates.map(() => 0),
    pending = new Set(network.routes.map((_, i) => i));
  while (pending.size) {
    const order = [...pending].sort((a, b) => {
      const saturation = (i) =>
        new Set(neighbours[i].filter((j) => assigned.has(j)).map((j) => assigned.get(j))).size;
      return (
        saturation(b) - saturation(a) ||
        neighbours[b].length - neighbours[a].length ||
        (network.routes[a].id < network.routes[b].id
          ? -1
          : network.routes[a].id > network.routes[b].id
            ? 1
            : 0)
      );
    });
    const i = order[0];
    let best = 0,
      bestScore = -Infinity;
    for (let c = 0; c < candidates.length; c++) {
      let score = 255;
      for (const j of neighbours[i])
        if (assigned.has(j)) {
          const other = assigned.get(j);
          const distance = Math.min(
            ...sims[c].map((rgb, k) => Math.hypot(...rgb.map((v, ch) => v - sims[other][k][ch])))
          );
          score = Math.min(score, distance);
        }
      score -= usage[c] * 2 + c * 0.001;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    assigned.set(i, best);
    usage[best]++;
    pending.delete(i);
  }
  const sourceColors =
    network.metadata.colorPolicy?.sourceColors ||
    Object.fromEntries(network.routes.map((r) => [r.id, r.color]));
  network.routes = network.routes.map((r, i) => ({
    ...r,
    color: candidates[assigned.get(i)].toUpperCase()
  }));
  network.metadata = { ...network.metadata, colorPolicy: { mode: 'adaptive', sourceColors } };
  return network;
}
