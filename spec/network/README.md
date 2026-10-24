<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# TNM 0.3 - Transit network model

Publication edition: v1

The network declares `id`, `name`, `coordinateSystem` (`planar` or `wgs84`), `stops` and `routes`. Stops have unique IDs, names and positions. Routes have stable IDs, legible codes and one or more ordered stop sequences. Optional geometry preserves the complete route, loops and distinct directions. A shared location never creates a transfer: only explicit shared stop IDs define it.

Importers do not invent schedules, accessibility, services or geographic coordinates. Unknown accessibility remains unknown. Planar data is valid without pretending to be georeferenced. Store sources, licences, versions and validity in `metadata`; consumers supply rights and validity for their data.

Document/image extraction uses an explicitly injected provider and returns confidence, evidence, issues and `reviewed: false`. An explicit confirmation with author and reason converts the draft into a usable network. Confidence never replaces review.

## Vector context

`background` contains features with `kind` (`land`, `water`, `park`, `urban`, `building`, `district`, `street` or `rail`), `coordinates` (rings or lines), and optional `id`, `name` and `geometry` (`polygon` or `line`). For backwards compatibility, streets and railways default to lines and other kinds to polygons. The first polygon ring is the exterior; later rings are holes. A GeoJSON MultiPolygon becomes separate features retaining each polygon's holes. A line river must stay open. Polygon rings require at least four positions, closure and non-zero area; the Rust engine validates geometric degeneracy.

Context uses the network coordinate system and provenance. Names are optional orientation aids, never stops or services. The renderer may omit them when space is scarce. The explicit OpenStreetMap adapter requests bounded vector context and preserves source attribution; other importers do not infer reuse rights. Backgrounds cannot alter the network frame, geometry or transport-label placement.

City excerpts can set `startTerminus: false` and `endTerminus: false` on a route path. Omitted values retain the existing terminal convention. A closed loop has no artificial terminal. Route-specific `stopPositions` map displayed stop IDs to explicitly sourced WGS84 anchors on that route; each anchor must belong to its path. Preserve the original station coordinate and the matching evidence in metadata.

`geographicFidelity: 'source'` preserves route source vertices, disables corridor displacement and leaves route geometry unsmoothed. It is the default when a visible OpenStreetMap base is attached. `geographicFidelity: 'generalized'` retains the diagram generalisation mode when no geographic base is shown. The two layers must share the core transformation.
