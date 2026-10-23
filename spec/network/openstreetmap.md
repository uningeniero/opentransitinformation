<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# OpenStreetMap context snapshots

The library's OSM adapter uses read-only Overpass JSON (`out meta geom`). Polygon assembly, ring validation, hole association and route clipping belong in Rust/WASM. Browser/Node adapters handle transport, bounds validation and provenance, rather than duplicating geometry algorithms.

`fromOpenStreetMap(data, options)` returns an asynchronous snapshot containing `features`, `issues`, `statistics` and `provenance`. Ways and multipolygon relations retain original geographic coordinates. Invalid/incomplete source geometries are diagnosed; no artificial closure or replacement geography is permitted. Supported background classifications distinguish street hierarchy without changing transport geometry.

`loadOpenStreetMap({bounds, endpoint, fetch, signal, maxAgeMs})` requests a bounded latest-data excerpt. Bounds use `[west, south, east, north]`, span at most 0.2 degrees on each axis and do not cross the antimeridian. The endpoint is configurable. Each response is bounded in size and time, checked for Overpass runtime remarks, and passed to the core importer. A response's actual OSM base timestamp is required for a freshness assertion. Retrieval time and data time remain separate.

Provenance includes source URL, query/bounds, retrieval time, upstream `timestamp_osm_base`, SHA-256 and available object IDs/revisions/timestamps. No contributor names, user IDs or unrelated account details enter the product. The adapter retains the original ODbL data licence and visible `© OpenStreetMap contributors` attribution.

`withOpenStreetMap(network, snapshot)` returns a WGS84 network with these background features and explicit base-map metadata. OSM metadata does not replace the transport operator's source or licence. The SVG/HTML output exposes the base-map attribution and snapshot time. A frozen export is a dated snapshot; it is not described as a continuously live map.

Before a release, regenerate every city example from a refreshed snapshot. Expose a failed refresh while preserving the last successful export. Public tile services are not downloaded as an offline archive. This adapter imports OSM vector data for a bounded excerpt; it does not embed or redistribute OSMF tile-server caches.

`fromOpenStreetMapRoute(data, {relationId, selectedStops})` accepts a full OSM route-relation response plus an explicit mapping of product stop IDs to OSM `stop_position` node IDs. The core assembles ordered member ways by node identity, honours direction roles, excludes platform members and rejects missing objects, disconnected chains, repeated/ambiguous stop nodes or inconsistent stop order. It returns the exact source-node excerpt and route-specific stop anchors. No nearest-station inference or shortest-path replacement is performed. An editorial source match records author, reason and evidence separately. OSM geometry is not certified engineering tunnel alignment.

Selected anchors must be explicit node members of that relation, tagged `public_transport=stop_position`, with a supported stop role. Unknown track-way roles fail instead of silently removing track geometry. Explicit platform roles and platform geometries remain excluded. Bound relation members and decoded node references before assembly, and index source-node occurrences for stop matching.

`mountOpenStreetMapViewer(container, network, options)` displays a cached snapshot immediately, refreshes on opening by default and exposes an explicit update action. Set `openStreetMap.refreshOnLoad: false` for an intentionally frozen initial view. `refresh()` shares a concurrent request, validates a replacement before swapping it in, and preserves selection and viewport. An unsuccessful refresh leaves the previous map and its actual source date visible. `destroy()` aborts pending transport. This client behaviour does not establish a scheduled server refresh service.
