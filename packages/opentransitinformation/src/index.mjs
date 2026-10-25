// SPDX-License-Identifier: Apache-2.0
import { normalizeNetwork, OtiError } from './model.mjs';
import { resolveStyle, contrast, textColor } from './styles.mjs';
import { measureLabels } from './measure.mjs';
import { runEngine, configureAssets } from './engine.mjs';
import { serializeSvg } from './svg.mjs';
import { auditPalette, badgeColors, assignRouteColors } from './color.mjs';
import { backgroundPaint, routePaint } from './background.mjs';
import { localeCopy } from './locale.mjs';
import { createMotionPlan } from './motion.mjs';
export {
  createMotionPlan,
  motionFrame,
  mountVehicleMotion
} from './motion.mjs';
export {
  auditPalette,
  simulateColor,
  badgeColors,
  assignRouteColors
} from './color.mjs';
export {
  normalizeNetwork,
  validateNetwork,
  OtiError,
  extractDocument,
  confirmExtraction
} from './model.mjs';
export { profiles, resolveStyle, contrast, textColor } from './styles.mjs';
export { fromGeoJSON, fromGtfs, fromText, parseCsv } from './imports.mjs';
export {
  fromOpenStreetMap,
  fromOpenStreetMapRoute,
  loadOpenStreetMap,
  withOpenStreetMap,
  openStreetMapQuery
} from './osm.mjs';
export { mountViewer } from './viewer.mjs';
export { mountOpenStreetMapViewer } from './osm-viewer.mjs';
export { configureAssets };
export async function createDiagram(input, options = {}) {
  localeCopy(options.locale);
  let network = normalizeNetwork(input);
  if (options.colorMode === 'adaptive') network = assignRouteColors(network);
  else if (options.colorMode && options.colorMode !== 'source')
    throw new OtiError('INVALID_OPTIONS', 'Unknown colorMode');
  for (const key of [
    'width',
    'height',
    'padding',
    'corridorTolerance',
    'backgroundSimplification'
  ])
    if (options[key] !== undefined && !Number.isFinite(options[key]))
      throw new OtiError('INVALID_OPTIONS', `${key} must be finite`);
  if (options.mode && !['schematic', 'geographic'].includes(options.mode))
    throw new OtiError('INVALID_OPTIONS', 'Unknown layout mode');
  if (
    options.bounds &&
    (!Array.isArray(options.bounds) ||
      options.bounds.length !== 4 ||
      !options.bounds.every(Number.isFinite))
  )
    throw new OtiError(
      'INVALID_OPTIONS',
      'bounds must contain four finite numbers'
    );
  const profile =
    options.profile ||
    (network.coordinateSystem === 'wgs84' ? 'geographic' : 'schematic');
  const style = resolveStyle(profile, options.style);
  if (
    options.geographicFidelity &&
    !['source', 'generalized'].includes(options.geographicFidelity)
  )
    throw new OtiError('INVALID_OPTIONS', 'Unknown geographicFidelity');
  const sourceGeometry =
    options.geographicFidelity === 'source' ||
    (network.metadata.baseMap?.source === 'OpenStreetMap' &&
      options.backgroundStyle !== 'none');
  if (
    sourceGeometry &&
    options.corridorTolerance !== undefined &&
    options.corridorTolerance !== 0
  )
    throw new OtiError(
      'OSM_PROJECTION_MISMATCH',
      'Source geometry requires zero corridor displacement'
    );
  if (
    network.metadata.baseMap?.source === 'OpenStreetMap' &&
    options.backgroundStyle !== 'none' &&
    options.geographicFidelity === 'generalized'
  )
    throw new OtiError(
      'OSM_PROJECTION_MISMATCH',
      'A visible OSM base requires source geographic fidelity'
    );
  if (sourceGeometry && options.mode === 'schematic')
    throw new OtiError(
      'OSM_PROJECTION_MISMATCH',
      'Source geometry cannot be schematized'
    );
  if (
    network.metadata.baseMap?.source === 'OpenStreetMap' &&
    (options.mode || style.mode) === 'schematic' &&
    options.backgroundStyle !== 'none'
  )
    throw new OtiError(
      'OSM_PROJECTION_MISMATCH',
      'An OpenStreetMap base requires geographic transport geometry'
    );
  backgroundPaint(style, options.backgroundStyle);
  if (
    options.backgroundSimplification !== undefined &&
    (options.backgroundSimplification < 0 ||
      options.backgroundSimplification > 3)
  )
    throw new OtiError(
      'INVALID_OPTIONS',
      'backgroundSimplification must be 0..3 pixels'
    );
  const measured = await measureLabels(network, style, options);
  if (options.activeRoutes) {
    if (
      !Array.isArray(options.activeRoutes) ||
      !options.activeRoutes.length ||
      options.activeRoutes.some(
        (id) => !network.routes.some((r) => r.id === id)
      )
    )
      throw new OtiError(
        'INVALID_SCENARIO',
        'activeRoutes must contain existing routes'
      );
  }
  let layout;
  const attempts = options.autoExpand === false ? 1 : 3;
  let width = options.width ?? 1200,
    height = options.height ?? 760;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      layout = await runEngine({
        network,
        options: {
          width,
          height,
          topInset: measured.header.topInset,
          padding: options.padding,
          bounds: options.bounds,
          activeRoutes: options.activeRoutes,
          corridorTolerance: options.corridorTolerance,
          backgroundStyle: options.backgroundStyle,
          backgroundSimplification: options.backgroundSimplification,
          mode: options.mode || style.mode,
          sourceGeometry
        },
        style,
        metrics: measured.metrics,
        contextMetrics: measured.contextMetrics
      });
    } catch (error) {
      if (!layout) throw error;
      layout.issues.push({
        code: 'EXPANSION_LIMIT',
        severity: 'warning',
        targetId: network.id
      });
      break;
    }
    if (!layout.issues.some((i) => i.severity === 'error')) break;
    width = Math.min(12000, width * 1.3);
    height = Math.min(12000, height * 1.3);
  }
  const colorAudit = auditPalette(network.routes);
  const issues = [...measured.issues, ...layout.issues, ...colorAudit.issues];
  const seen = new Map();
  let minimumGraphicContrast = Infinity;
  for (const route of network.routes) {
    if (seen.has(route.shortName))
      issues.push({
        code: 'DUPLICATE_ROUTE_CODE',
        severity: 'warning',
        targetId: route.id
      });
    seen.set(route.shortName, route.id);
    const badge = badgeColors(route.color, style);
    const paint = routePaint(
      route.color,
      style,
      layout.background,
      options.backgroundStyle
    );
    minimumGraphicContrast = Math.min(
      minimumGraphicContrast,
      paint.minimumContrast
    );
    if (paint.insufficientSpace)
      issues.push({
        code: 'BACKGROUND_CASING_SPACE',
        severity: 'error',
        targetId: route.id
      });
    if (contrast(badge.foreground, badge.background) < style.textContrast)
      issues.push({
        code: 'BADGE_CONTRAST',
        severity: 'error',
        targetId: route.id
      });
  }
  const allStops = new Set(
    network.routes
      .filter(
        (r) => !options.activeRoutes || options.activeRoutes.includes(r.id)
      )
      .flatMap((r) => r.paths.flatMap((p) => p.stopIds))
  );
  const rendered = new Set(layout.stops.map((s) => s.id));
  for (const id of allStops)
    if (!rendered.has(id))
      issues.push({ code: 'STOP_MISSING', targetId: id, severity: 'error' });
  for (const key of ['source', 'license', 'validFrom', 'validUntil'])
    if (!network.metadata[key])
      issues.push({
        code: 'METADATA_MISSING',
        field: key,
        severity: 'warning',
        targetId: network.id
      });
  const qa = {
    passed: !issues.some((i) => i.severity === 'error'),
    issues,
    statistics: layout.statistics,
    checks: {
      stopCoverage: [...allStops].every((id) => rendered.has(id)),
      labelCoverage: layout.labels.length === layout.stops.length,
      textContrast: contrast(style.foreground, style.background),
      minimumTextContrast: style.textContrast,
      minimumGraphicContrast,
      routeCodes: true
    },
    scope: 'Automated checks only'
  };
  if (options.strict !== false && !qa.passed)
    throw new OtiError(
      'QUALITY_GATE_FAILED',
      'Diagram failed the quality gate',
      qa
    );
  const svg = serializeSvg(network, layout, style, measured, {
    ...options,
    profile
  });
  const diagram = {
    svg,
    layout,
    network,
    style,
    qa,
    metrics: measured.metrics,
    text: network.routes
      .filter(
        (r) => !options.activeRoutes || options.activeRoutes.includes(r.id)
      )
      .map((r) => ({
        id: r.id,
        code: r.shortName,
        name: r.name,
        paths: r.paths.map((p) =>
          p.stopIds.map((id) => network.stops.find((s) => s.id === id))
        )
      }))
  };
  if (options.motion)
    diagram.motion = await createMotionPlan(diagram, options.motion);
  return diagram;
}
export async function renderSvg(input, options) {
  return (await createDiagram(input, options)).svg;
}
export async function createScenarios(network, scenarios, options = {}) {
  if (!Array.isArray(scenarios) || !scenarios.length)
    throw new OtiError('INVALID_SCENARIO', 'Provide scenarios');
  const results = [];
  for (const scenario of scenarios) {
    if (!scenario.id || !scenario.name)
      throw new OtiError('INVALID_SCENARIO', 'Scenarios need id and name');
    results.push({
      ...scenario,
      diagram: await createDiagram(network, {
        ...options,
        activeRoutes: scenario.routeIds,
        scenarioName: scenario.name,
        idPrefix: scenario.id,
        autoExpand: false
      })
    });
  }
  return results;
}
