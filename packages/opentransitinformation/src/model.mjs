// SPDX-License-Identifier: Apache-2.0
import { profiles } from './styles.mjs';
export class OtiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'OtiError';
    this.code = code;
    this.details = details;
  }
}
const fail = (code, message, details) => {
  throw new OtiError(code, message, details);
};
const text = (v, key, max = 512) => {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.length > max ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v)
  )
    fail('INVALID_TEXT', `Invalid ${key}`);
  return v.trim();
};
function position(p, system) {
  if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
    fail('INVALID_COORDINATES', 'Coordinates must be two finite numbers');
  if (
    system === 'wgs84' &&
    (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 85.051129)
  )
    fail(
      'INVALID_COORDINATES',
      'WGS84 coordinates exceed supported longitude or latitude'
    );
  if (p.some((v) => Math.abs(v) > 1e12))
    fail('INVALID_COORDINATES', 'Coordinate magnitude exceeds limit');
  return [...p];
}
export function normalizeNetwork(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('INVALID_NETWORK', 'Expected a network object');
  if (input.reviewed === false || input.kind === 'extraction-draft')
    fail('REVIEW_REQUIRED', 'Document extraction requires explicit review');
  const system = input.coordinateSystem;
  if (!['wgs84', 'planar'].includes(system))
    fail('INVALID_CRS', 'coordinateSystem must be wgs84 or planar');
  if (
    !Array.isArray(input.stops) ||
    input.stops.length < 2 ||
    input.stops.length > 5000
  )
    fail('INVALID_STOPS', 'A network needs 2..5000 stops');
  if (
    !Array.isArray(input.routes) ||
    input.routes.length < 1 ||
    input.routes.length > 300
  )
    fail('INVALID_ROUTES', 'A network needs 1..300 routes');
  const ids = new Set();
  const stops = input.stops.map((s) => {
    const id = text(s.id, 'stop id', 256);
    if (ids.has(id)) fail('DUPLICATE_ID', `Duplicate stop id: ${id}`);
    ids.add(id);
    if (s.accessible != null && typeof s.accessible !== 'boolean')
      fail('INVALID_ACCESSIBILITY', `Invalid accessibility for ${id}`);
    return {
      id,
      name: text(s.name, 'stop name'),
      position: position(s.position, system),
      accessible: s.accessible ?? null,
      priority: Math.max(
        0,
        Math.min(5, Number.isFinite(s.priority) ? s.priority : 1)
      ),
      ...(s.parentId ? { parentId: text(s.parentId, 'parent id') } : {}),
      ...(s.names ? { names: { ...s.names } } : {})
    };
  });
  const routeIds = new Set();
  let vertices = 0;
  const routes = input.routes.map((r, i) => {
    const id = text(r.id, 'route id', 256);
    if (routeIds.has(id)) fail('DUPLICATE_ID', `Duplicate route id: ${id}`);
    routeIds.add(id);
    const color =
      r.color ||
      profiles.schematic.palette[i % profiles.schematic.palette.length];
    if (!/^#[0-9A-Fa-f]{6}$/.test(color))
      fail('INVALID_COLOR', `Invalid route colour: ${id}`);
    if (!Array.isArray(r.paths) || !r.paths.length || r.paths.length > 100)
      fail('INVALID_PATH', `Route ${id} requires 1..100 paths`);
    return {
      id,
      shortName: text(r.shortName, 'route short name', 32),
      name: r.name
        ? text(r.name, 'route name')
        : text(r.shortName, 'route short name', 32),
      color: color.toUpperCase(),
      mode: r.mode ? text(r.mode, 'mode', 64) : 'transit',
      service: r.service || 'regular',
      paths: r.paths.map((p) => {
        if (
          !Array.isArray(p.stopIds) ||
          p.stopIds.length < 2 ||
          p.stopIds.length > 10000
        )
          fail('INVALID_PATH', `Invalid stop sequence for ${id}`);
        const stopIds = p.stopIds.map((s) => {
          if (!ids.has(s))
            fail('UNKNOWN_STOP', `Route ${id} references unknown stop ${s}`);
          return s;
        });
        if (new Set(stopIds).size < 2)
          fail('DEGENERATE_PATH', `Route ${id} needs two distinct stops`);
        let coordinates;
        if (p.coordinates !== undefined) {
          if (!Array.isArray(p.coordinates) || p.coordinates.length < 2)
            fail('INVALID_PATH', 'Geometry needs at least two positions');
          vertices += p.coordinates.length;
          if (vertices > 100000)
            fail('NETWORK_TOO_LARGE', 'Network exceeds 100000 route vertices');
          coordinates = p.coordinates.map((c) => position(c, system));
          if (
            coordinates.every(
              (c) => c[0] === coordinates[0][0] && c[1] === coordinates[0][1]
            )
          )
            fail('DEGENERATE_PATH', `Degenerate geometry for ${id}`);
        }
        for (const key of ['startTerminus', 'endTerminus'])
          if (p[key] !== undefined && typeof p[key] !== 'boolean')
            fail('INVALID_PATH', `${key} must be boolean`);
        const stopPositions = Object.create(null);
        for (const [stopId, value] of Object.entries(p.stopPositions || {})) {
          if (!stopIds.includes(stopId))
            fail(
              'INVALID_PATH',
              'A route-specific anchor must reference a stop on the path'
            );
          stopPositions[stopId] = position(value, system);
        }
        return {
          stopIds,
          ...(Object.keys(stopPositions).length ? { stopPositions } : {}),
          ...(p.startTerminus !== undefined
            ? { startTerminus: p.startTerminus }
            : {}),
          ...(p.endTerminus !== undefined
            ? { endTerminus: p.endTerminus }
            : {}),
          ...(coordinates ? { coordinates } : {}),
          ...(p.direction != null ? { direction: String(p.direction) } : {})
        };
      })
    };
  });
  const constraints = (input.constraints || []).map((c) => {
    if (!['label-side', 'pin', 'route-order'].includes(c.kind))
      fail('INVALID_CONSTRAINT', 'Unsupported editorial constraint');
    const targetId = text(c.targetId, 'constraint target');
    if (!ids.has(targetId) && !routeIds.has(targetId))
      fail('INVALID_CONSTRAINT', 'Unknown constraint target');
    if (c.kind !== 'label-side')
      fail(
        'UNSUPPORTED_CONSTRAINT',
        `${c.kind} constraints are not supported`
      );
    if (
      ![
        'right',
        'left',
        'top-right',
        'top-left',
        'bottom-right',
        'bottom-left',
        'top',
        'bottom'
      ].includes(c.value)
    )
      fail('INVALID_CONSTRAINT', 'Invalid label-side');
    return {
      kind: c.kind,
      targetId,
      author: text(c.author, 'constraint author'),
      reason: text(c.reason, 'constraint reason', 2000),
      value: c.value
    };
  });
  if (
    input.background &&
    (!Array.isArray(input.background) || input.background.length > 20000)
  )
    fail('INVALID_BACKGROUND', 'Expected at most 20000 context features');
  const contextIds = new Set();
  const background = (input.background || []).map((f, i) => {
    if (
      ![
        'water',
        'land',
        'park',
        'urban',
        'building',
        'district',
        'street',
        'rail'
      ].includes(f.kind)
    )
      fail('INVALID_BACKGROUND', 'Unsupported background kind');
    const id = f.id == null ? `context-${i}` : text(f.id, 'context id', 256);
    if (contextIds.has(id)) fail('DUPLICATE_ID', `Duplicate context id: ${id}`);
    contextIds.add(id);
    const geometry =
      f.geometry || (['street', 'rail'].includes(f.kind) ? 'line' : 'polygon');
    if (!['line', 'polygon'].includes(geometry))
      fail('INVALID_BACKGROUND', 'Expected line or polygon context geometry');
    if (!Array.isArray(f.coordinates) || !f.coordinates.length)
      fail(
        'INVALID_BACKGROUND',
        'Background coordinates must contain rings or lines'
      );
    return {
      id,
      kind: f.kind,
      geometry,
      ...(f.classification
        ? {
            classification: text(f.classification, 'context classification', 40)
          }
        : {}),
      ...(f.name ? { name: text(f.name, 'context name') } : {}),
      coordinates: f.coordinates.map((r) => {
        if (!Array.isArray(r) || r.length < (geometry === 'polygon' ? 4 : 2))
          fail('INVALID_BACKGROUND', 'Invalid background geometry');
        if (
          geometry === 'polygon' &&
          (r[0]?.[0] !== r.at(-1)?.[0] || r[0]?.[1] !== r.at(-1)?.[1])
        )
          fail('INVALID_BACKGROUND', 'Polygon rings must be closed');
        vertices += r.length;
        return r.map((p) => position(p, system));
      })
    };
  });
  if (vertices > 150000)
    fail('NETWORK_TOO_LARGE', 'Network exceeds vertex limit');
  const metadata =
    input.metadata && typeof input.metadata === 'object'
      ? JSON.parse(JSON.stringify(input.metadata))
      : {};
  return {
    id: text(input.id, 'network id'),
    name: text(input.name, 'network name'),
    coordinateSystem: system,
    stops,
    routes,
    constraints,
    background,
    metadata
  };
}
export function validateNetwork(input) {
  try {
    return { valid: true, network: normalizeNetwork(input), issues: [] };
  } catch (e) {
    return {
      valid: false,
      issues: [
        {
          code: e.code || 'INVALID_NETWORK',
          message: e.message,
          severity: 'error'
        }
      ]
    };
  }
}
export async function extractDocument(
  source,
  { extractor, mimeType, name = 'document', signal } = {}
) {
  if (typeof extractor !== 'function')
    fail('EXTRACTOR_REQUIRED', 'Supply an explicit document extractor');
  if (!mimeType || !/(image\/|application\/pdf|text\/)/.test(mimeType))
    fail(
      'INVALID_DOCUMENT_TYPE',
      'An explicit supported MIME type is required'
    );
  const result = await extractor({ source, mimeType, name, signal });
  if (!result || !result.network)
    fail(
      'INVALID_EXTRACTION',
      'Extractor must return a network'
    );
  if (
    !Number.isFinite(result.confidence) ||
    result.confidence < 0 ||
    result.confidence > 1
  )
    fail('INVALID_EXTRACTION', 'Extraction confidence must be between 0 and 1');
  const network = normalizeNetwork(result.network);
  return {
    kind: 'extraction-draft',
    reviewed: false,
    network,
    confidence: result.confidence,
    issues: Array.isArray(result.issues) ? result.issues : [],
    source: { name, mimeType },
    evidence: result.evidence ?? []
  };
}
export function confirmExtraction(draft, { author, reason } = {}) {
  if (draft?.kind !== 'extraction-draft' || draft.reviewed !== false)
    fail('INVALID_EXTRACTION', 'Expected an unreviewed extraction draft');
  const network = normalizeNetwork(draft.network);
  network.metadata = {
    ...network.metadata,
    extraction: {
      source: draft.source,
      confidence: draft.confidence,
      evidence: draft.evidence,
      issues: draft.issues,
      review: {
        author: text(author, 'review author'),
        reason: text(reason, 'review reason', 2000)
      }
    }
  };
  return network;
}
