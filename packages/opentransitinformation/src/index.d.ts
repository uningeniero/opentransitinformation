// SPDX-License-Identifier: Apache-2.0
export type Position = [number, number];
export interface Stop {
  id: string;
  name: string;
  position: Position;
  accessible?: boolean | null;
  priority?: number;
  parentId?: string;
  names?: Record<string, string>;
}
export interface RoutePath {
  stopIds: string[];
  coordinates?: Position[];
  direction?: string | number;
  startTerminus?: boolean;
  endTerminus?: boolean;
  stopPositions?: Record<string, Position>;
}
export interface Route {
  id: string;
  shortName: string;
  name?: string;
  color?: string;
  mode?: string;
  service?: 'regular' | 'limited';
  paths: RoutePath[];
}
export interface EditorialConstraint {
  kind: 'label-side';
  targetId: string;
  author: string;
  reason: string;
  value:
    | 'right'
    | 'left'
    | 'top'
    | 'bottom'
    | 'top-right'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-left';
}
export interface Metadata {
  source?: string | { name: string; url?: string };
  license?: string;
  validFrom?: string;
  validUntil?: string;
  feedVersion?: string;
  subtitle?: string;
  [key: string]: unknown;
}
export interface BackgroundFeature {
  id?: string;
  name?: string;
  kind:
    | 'water'
    | 'land'
    | 'park'
    | 'urban'
    | 'building'
    | 'district'
    | 'street'
    | 'rail';
  geometry?: 'polygon' | 'line';
  classification?: string;
  coordinates: Position[][];
}
export interface OpenStreetMapProvenance {
  source: 'OpenStreetMap';
  sourceUrl: string;
  attribution: string;
  license: 'ODbL-1.0';
  copyright: string;
  retrievedAt: string;
  dataAsOf: string | null;
  ageMs: number | null;
  sha256: string;
  hashEncoding: 'json-stringify-utf8' | 'response-utf8';
  bounds?: [number, number, number, number];
  query?: string;
  revisions: Array<{
    type: string;
    id: number;
    version?: number;
    timestamp?: string;
  }>;
}
export interface OpenStreetMapSnapshot {
  features: BackgroundFeature[];
  issues: Issue[];
  statistics: Record<string, number | Record<string, number>>;
  provenance: OpenStreetMapProvenance;
}
export function openStreetMapQuery(
  bounds: [number, number, number, number]
): string;
export function fromOpenStreetMap(
  data: { elements: unknown[]; osm3s?: { timestamp_osm_base?: string } },
  options?: {
    sourceUrl?: string;
    retrievedAt?: string;
    maxAgeMs?: number;
    bounds?: [number, number, number, number];
  }
): Promise<OpenStreetMapSnapshot>;
export function fromOpenStreetMapRoute(
  data: { elements: unknown[] },
  options: {
    relationId: number;
    selectedStops: Array<{ id: string; nodeId: number }>;
    continuationVertices?: number;
  }
): Promise<{
  coordinates: Position[];
  stopPositions: Record<string, Position>;
  sourceNodeIds: number[];
  relationId: number;
  relationVersion: number;
  relationTimestamp: string;
  memberWayIds: number[];
  sourceVertices: number;
  excerptVertices: number;
}>;
export function loadOpenStreetMap(options: {
  bounds: [number, number, number, number];
  endpoint?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  maxAgeMs?: number;
}): Promise<OpenStreetMapSnapshot>;
export function withOpenStreetMap(
  network: Network,
  snapshot: OpenStreetMapSnapshot
): Network;
export interface Network {
  id: string;
  name: string;
  coordinateSystem: 'planar' | 'wgs84';
  stops: Stop[];
  routes: Route[];
  metadata?: Metadata;
  background?: BackgroundFeature[];
  constraints?: EditorialConstraint[];
}
export interface Issue {
  code: string;
  severity: 'error' | 'warning';
  targetId?: string;
  relatedRouteId?: string;
  simulation?: string;
  distance?: number;
  message?: string;
  field?: string;
  character?: string;
}
export interface DesignStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineWidth: number;
  lineSpacing: number;
  cornerRadius: number;
  stopRadius: number;
  labelGap: number;
  background: string;
  foreground: string;
  muted: string;
  water: string;
  land: string;
  urban: string;
  park: string;
  building: string;
  district: string;
  street: string;
  rail: string;
  casing: string;
  textContrast: number;
  graphicContrast: number;
  palette: readonly string[];
  mode: 'schematic' | 'geographic';
}
export type Profile = 'schematic' | 'geographic' | 'print' | 'highContrast';
export interface DiagramOptions {
  locale?: 'en' | 'es';
  profile?: Profile;
  colorMode?: 'source' | 'adaptive';
  style?: Partial<DesignStyle>;
  width?: number;
  height?: number;
  padding?: number;
  mode?: 'schematic' | 'geographic';
  bounds?: [number, number, number, number];
  corridorTolerance?: number;
  backgroundStyle?: 'none' | 'subtle' | 'atlas' | 'mono';
  backgroundSimplification?: number;
  geographicFidelity?: 'source' | 'generalized';
  openStreetMap?: OpenStreetMapViewerSettings;
  activeRoutes?: string[];
  strict?: boolean;
  autoExpand?: boolean;
  maxLabelWidth?: number;
  generatedAt?: string;
  idPrefix?: string;
  scenarioName?: string;
  font?: { data: Uint8Array; family: string };
  measureText?: (text: string) => number;
  syncHash?: boolean;
  onSelectionChange?: (state: SelectionState) => void;
}
export interface Statistics {
  routes: number;
  paths: number;
  stops: number;
  labels: number;
  crossings: number;
  sharedEdges: number;
  matchedCorridorSamples: number;
  maxCorridorDisplacement: number;
  maxLaneOffset: number;
  cornerRadius: number;
  labelLeaders: number;
  maximumCorridorLanes: number;
  contextLabels: number;
}
export interface QualityReport {
  passed: boolean;
  issues: Issue[];
  statistics: Statistics;
  checks: {
    stopCoverage: boolean;
    labelCoverage: boolean;
    textContrast: number;
    minimumTextContrast: number;
    minimumGraphicContrast: number;
    routeCodes: boolean;
  };
  scope: string;
}
export interface LayoutPath {
  routeId: string;
  part: number;
  d: string;
  points: Position[];
  offsets: number[];
  continuations?: Position[][];
}
export interface LayoutStop {
  hitBounds: { x: number; y: number; width: number; height: number };
  id: string;
  position: Position;
  endpoints: [Position, Position];
  radius: number;
  routes: string[];
  terminal: boolean;
  anchors: Position[];
  markers: { endpoints: [Position, Position]; radius: number }[];
  connections: { d: string }[];
  symbolKind: 'circle' | 'capsule' | 'interchange';
}
export interface LayoutLabel {
  stopId: string;
  bounds: { x: number; y: number; width: number; height: number };
  leader: [Position, Position] | null;
  terminal: boolean;
}
export interface DiagramLayout {
  mapBounds: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  paths: LayoutPath[];
  stops: LayoutStop[];
  labels: LayoutLabel[];
  background: BackgroundFeature[];
  contextLabels: {
    featureId: string;
    kind: BackgroundFeature['kind'];
    name: string;
    bounds: { x: number; y: number; width: number; height: number };
  }[];
  statistics: Statistics;
  issues: Issue[];
}
export interface Diagram {
  svg: string;
  network: Network;
  layout: DiagramLayout;
  style: DesignStyle;
  qa: QualityReport;
  metrics: Record<
    string,
    {
      width: number;
      height: number;
      lines: string[];
      lineHeight: number;
      codes: string[];
      codeWidths: number[];
      accessWidth: number;
    }
  >;
  text: { id: string; code: string; name: string; paths: Stop[][] }[];
}
export interface SelectionState {
  routeId: string | null;
  stopId: string | null;
}
export interface View {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Viewer {
  diagram: Diagram;
  root: HTMLElement;
  selectRoute(id: string): SelectionState;
  selectStop(id: string): SelectionState;
  clear(): void;
  getState(): SelectionState;
  getView(): View;
  setView(view: View): void;
  destroy(): void;
}
export interface OpenStreetMapRefreshResult {
  updated: boolean;
  provenance?: OpenStreetMapProvenance;
  error?: unknown;
}
export interface OpenStreetMapViewer extends Viewer {
  refresh(): Promise<OpenStreetMapRefreshResult>;
  whenRefreshed: Promise<OpenStreetMapRefreshResult>;
}
export interface OpenStreetMapViewerSettings {
  bounds: [number, number, number, number];
  endpoint?: string;
  fetch?: typeof fetch;
  maxAgeMs?: number;
  refreshOnLoad?: boolean;
}
export function mountOpenStreetMapViewer(
  container: HTMLElement,
  network: Network,
  options: DiagramOptions & { openStreetMap: OpenStreetMapViewerSettings }
): Promise<OpenStreetMapViewer>;
export class OtiError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown);
}
export const profiles: Readonly<Record<Profile, Readonly<DesignStyle>>>;
export function normalizeNetwork(input: Network): Network;
export function validateNetwork(input: unknown): {
  valid: boolean;
  network?: Network;
  issues: Issue[];
};
export function resolveStyle(
  profile?: Profile,
  overrides?: Partial<DesignStyle>
): Readonly<DesignStyle>;
export function contrast(a: string, b: string): number;
export function textColor(background: string): string;
export type ColorSimulation = 'protan' | 'deutan' | 'tritan' | 'grayscale';
export function simulateColor(
  color: string,
  simulation?: ColorSimulation
): string;
export function badgeColors(
  color: string,
  style: Pick<DesignStyle, 'textContrast' | 'background' | 'foreground'>
): { background: string; foreground: string; border: string };
export function auditPalette(routes: Route[]): {
  issues: Issue[];
  simulations: Record<ColorSimulation, string[]>;
  heuristicDistance: number;
};
export function assignRouteColors(
  network: Network,
  options?: { palette?: string[] }
): Network;
export function configureAssets(assets: {
  wasm?: Uint8Array;
  font?: Uint8Array;
}): void;
export function createDiagram(
  network: Network,
  options?: DiagramOptions
): Promise<Diagram>;
export function renderSvg(
  network: Network,
  options?: DiagramOptions
): Promise<string>;
export function mountViewer(
  container: Element,
  network: Network,
  options?: DiagramOptions
): Promise<Viewer>;
export function createScenarios(
  network: Network,
  scenarios: { id: string; name: string; routeIds: string[] }[],
  options?: DiagramOptions
): Promise<
  { id: string; name: string; routeIds: string[]; diagram: Diagram }[]
>;
export function parseCsv(
  text: string,
  options?: { delimiter?: ',' | ';' | '\t' }
): Record<string, string>[];
export function fromGeoJSON(
  collection: unknown,
  options?: {
    id?: string;
    name?: string;
    coordinateSystem?: 'planar' | 'wgs84';
    properties?: Record<string, string>;
  }
): Network;
export function fromGtfs(
  input:
    | Uint8Array
    | ArrayBuffer
    | Record<string, string | Record<string, string>[]>,
  options?: {
    id?: string;
    name?: string;
    routeIds?: string[];
    serviceIds?: string[];
    date?: string;
    groupPlatforms?: boolean;
    metadata?: Metadata;
  }
): Network;
export function fromText(
  text: string,
  options?: { id?: string; name?: string; metadata?: Metadata }
): Promise<Network>;
export interface ExtractionResult {
  network: Network;
  confidence: number;
  issues?: unknown[];
  evidence?: unknown;
}
export interface ExtractionDraft {
  kind: 'extraction-draft';
  reviewed: false;
  network: Network;
  confidence: number;
  issues: unknown[];
  source: { name: string; mimeType: string };
  evidence: unknown;
}
export function extractDocument(
  source: unknown,
  options: {
    extractor: (request: {
      source: unknown;
      mimeType: string;
      name: string;
      signal?: AbortSignal;
    }) => Promise<ExtractionResult>;
    mimeType: string;
    name?: string;
    signal?: AbortSignal;
  }
): Promise<ExtractionDraft>;
export function confirmExtraction(
  draft: ExtractionDraft,
  review: { author: string; reason: string }
): Network;
