// SPDX-License-Identifier: Apache-2.0
const base = {
  fontFamily: 'OTI Source Sans 3',
  fontSize: 17,
  fontWeight: 600,
  lineWidth: 6,
  lineSpacing: 10,
  cornerRadius: 26,
  stopRadius: 4.5,
  labelGap: 8,
  background: '#FFFFFF',
  foreground: '#162536',
  muted: '#526170',
  water: '#E5EFF4',
  land: '#F7F6F1',
  urban: '#EAECE8',
  park: '#EDF3E9',
  building: '#E3E5E1',
  district: '#BAC5C7',
  street: '#FFFFFF',
  rail: '#7A8590',
  casing: '#162536',
  textContrast: 4.5,
  graphicContrast: 3,
  palette: [
    '#005B96',
    '#A91642',
    '#20754A',
    '#6D3E91',
    '#9C4C00',
    '#007C82',
    '#4B5973',
    '#882C69'
  ]
};
export const profiles = Object.freeze(
  Object.fromEntries(
    Object.entries({
      schematic: { ...base, mode: 'schematic' },
      geographic: {
        ...base,
        mode: 'geographic',
        lineWidth: 5,
        lineSpacing: 8,
        cornerRadius: 22
      },
      print: {
        ...base,
        mode: 'schematic',
        fontSize: 18,
        lineWidth: 7,
        lineSpacing: 11,
        cornerRadius: 30
      },
      highContrast: {
        ...base,
        mode: 'schematic',
        foreground: '#000000',
        casing: '#000000',
        textContrast: 7,
        fontSize: 18,
        lineWidth: 7,
        lineSpacing: 12
      }
    }).map(([k, v]) => [
      k,
      Object.freeze({ ...v, palette: Object.freeze(v.palette) })
    ])
  )
);
export function contrast(a, b) {
  const lum = (c) => {
    if (!/^#[0-9a-f]{6}$/i.test(c))
      throw new TypeError('Expected #RRGGBB colour');
    const v = [1, 3, 5]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function textColor(background) {
  return contrast('#000000', background) >= contrast('#FFFFFF', background)
    ? '#000000'
    : '#FFFFFF';
}
export function resolveStyle(profile = 'schematic', overrides = {}) {
  if (!profiles[profile])
    throw new TypeError(`Unknown design profile: ${profile}`);
  const s = { ...profiles[profile], ...overrides };
  for (const k of [
    'fontSize',
    'lineWidth',
    'lineSpacing',
    'cornerRadius',
    'stopRadius',
    'labelGap'
  ])
    if (!Number.isFinite(s[k]) || s[k] <= 0 || s[k] > 200)
      throw new TypeError(`Invalid style ${k}`);
  if (s.fontSize < 16) throw new TypeError('fontSize must be at least 16');
  if (s.fontWeight !== 600)
    throw new TypeError('The bundled font has weight 600');
  if (
    typeof s.fontFamily !== 'string' ||
    s.fontFamily.length > 80 ||
    /[^\p{L}\p{N} _-]/u.test(s.fontFamily)
  )
    throw new TypeError('Invalid font family');
  if (
    !Number.isFinite(s.textContrast) ||
    s.textContrast < profiles[profile].textContrast ||
    !Number.isFinite(s.graphicContrast) ||
    s.graphicContrast < 3
  )
    throw new TypeError('Contrast thresholds cannot be reduced');
  if (s.lineSpacing < s.lineWidth + 2)
    throw new TypeError('lineSpacing must exceed lineWidth by at least 2');
  for (const k of [
    'background',
    'foreground',
    'muted',
    'water',
    'land',
    'urban',
    'park',
    'building',
    'district',
    'street',
    'rail',
    'casing'
  ])
    if (!/^#[0-9A-Fa-f]{6}$/.test(s[k]))
      throw new TypeError(`Invalid colour: ${k}`);
  if (
    !Array.isArray(s.palette) ||
    !s.palette.length ||
    s.palette.some((c) => !/^#[0-9A-Fa-f]{6}$/.test(c))
  )
    throw new TypeError('Invalid palette');
  if (contrast(s.foreground, s.background) < s.textContrast)
    throw new TypeError('Text contrast is below the profile threshold');
  if (contrast(s.muted, s.background) < 4.5)
    throw new TypeError('Secondary text contrast must be at least 4.5');
  if (contrast(s.casing, s.background) < 3)
    throw new TypeError('Route casing contrast must be at least 3');
  if (!['schematic', 'geographic'].includes(s.mode))
    throw new TypeError('Invalid layout mode');
  return Object.freeze({ ...s, palette: Object.freeze([...s.palette]) });
}
