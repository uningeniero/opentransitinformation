<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# opentransitinformation

**Project and attribution: [Open Transit Information](https://opentransitinformation.org).**

Rust/WebAssembly geometry with JavaScript adapters for transit diagrams, geographic maps and semantic SVG. Interactive HTML includes keyboard controls and a textual route alternative.

[npm](https://www.npmjs.com/package/opentransitinformation) - [Source](https://github.com/uningeniero/opentransitinformation) - [Releases](https://github.com/uningeniero/opentransitinformation/releases) - [Project](https://opentransitinformation.org)

```sh
npm install opentransitinformation
```

```js
import { fromText, createDiagram } from 'opentransitinformation';
import { toHtml } from 'opentransitinformation/node';
import { writeFile } from 'node:fs/promises';

const network = await fromText('1: Port > Central > Station');
await writeFile('map.svg', (await createDiagram(network)).svg);
await writeFile('map.html', await toHtml(network));
```

## Technical scope

GTFS ZIP, GeoJSON, ordered stops and explicit document extractors. One Rust geometry core computes corridors, lane continuity, stop symbols, label placement and geometry checks. Document/image extraction requires a supplied extractor and an explicit review. The default interface is English; Spanish is available with `locale: 'es'`.

```js
import { loadOpenStreetMap, withOpenStreetMap, createDiagram } from 'opentransitinformation';

const bounds = [-0.16, 51.49, -0.13, 51.52];
const snapshot = await loadOpenStreetMap({ bounds });
const city = withOpenStreetMap(yourWgs84Network, snapshot);
const diagram = await createDiagram(city, { backgroundStyle: 'atlas' });
```

OSM context retains its source timestamp, checksum, revisions and visible attribution. Source-aligned geographic output preserves route vertices and uses the same projection as the base. Frozen exports remain dated snapshots. `mountOpenStreetMapViewer` refreshes context on opening and on request while preserving the previous dated map after a failed update. OSM data is ODbL-1.0; transport sources retain their own terms. Automatic checks do not certify accessibility, service validity or surveyed positional accuracy.

```sh
npx oti network.geojson --out map.svg --background atlas --qa qa.json
npx oti feed.zip --out map.html
```

## Build and validate

Node.js 20+; Rust 1.99.1 with `wasm32-unknown-unknown`. Consumers of the npm package do not need Rust.

```sh
rustup target add wasm32-unknown-unknown
cd packages/opentransitinformation
npm ci
npm run build
npm test
npm run check:types
npm run check:package
npm run check:release
```

Native core tests: `cargo test --manifest-path core/oti-engine/Cargo.toml` from the repository root. Browser checks use Edge by default; set `OTI_BROWSER_CHANNEL=chromium` after installing Playwright Chromium to use that browser.

The package source is in `packages/opentransitinformation`, geometry in `core/oti-engine`, and technical contracts in `spec/network` and `spec/design`. See [contribution guide](https://github.com/uningeniero/opentransitinformation/blob/main/CONTRIBUTING.md).

## Version and attribution

The npm package version, Rust crate version and GitHub release/tag use the same numeric version. Release `X.Y.Z` corresponds to tag `vX.Y.Z`; published archives are immutable. Each release links its npm version and includes the verified package archive. See [release notes](https://github.com/uningeniero/opentransitinformation/releases).

Code: Apache-2.0. Documentation: CC-BY-4.0. Font: SIL OFL-1.1. Preserve the applicable licence and [NOTICE](https://github.com/uningeniero/opentransitinformation/blob/main/NOTICE) information, including **Open Transit Information - https://opentransitinformation.org**. Third-party assets and input datasets retain their own notices.
