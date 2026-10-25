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

OSM context retains its source timestamp, checksum, revisions and visible attribution. Source-aligned geographic output preserves route vertices and uses the same projection as the base. Frozen exports remain dated snapshots. `mountOpenStreetMapViewer` refreshes context on opening and on request while preserving the previous dated map after a failed update. OSM data is ODbL-1.0; transport sources retain their own terms.

```sh
npx oti network.geojson --out map.svg --background atlas --qa qa.json
npx oti feed.zip --out map.html
```

## Demonstrative motion

```js
const motion = { mode: 'demo', autoplay: true };
await writeFile('map-motion.html', await toHtml(network, { motion }));
```

Motion follows the core's rendered route parts. Its timing and vehicle positions are illustrative. It does not read a live vehicle feed or infer a timetable. Autoplay is opt-in and suppressed by reduced-motion preference. The viewer provides a visible Play/Pause control and suspends the clock during map hover or keyboard interaction, while offscreen, and when the document is hidden.

```js
import {
  createMotionPlan,
  motionFrame,
  mountVehicleMotion
} from 'opentransitinformation';

const diagram = await createDiagram(network);
const plan = await createMotionPlan(diagram, { mode: 'demo' });
const frame = motionFrame(plan, 1000);
// Mount after inserting diagram.svg in an element with id="map".
const controller = mountVehicleMotion(document.querySelector('#map'), plan);
controller.play();
controller.pause();
controller.destroy();
```

`createDiagram(network, { motion: { mode: 'demo' } })` also returns `diagram.motion`. `mountViewer` exposes its component as `viewer.motion`. Static SVG geometry is unchanged. See the [motion contract](https://github.com/uningeniero/opentransitinformation/blob/main/spec/network/motion.md) for bounded frame counts, route selection, cycle duration and dwell options.

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

Run `npm run test:motion` for motion controls, reduced-motion behaviour, clock suspension and desktop/mobile browser checks.

The package source is in `packages/opentransitinformation`, geometry in `core/oti-engine`, and technical contracts in `spec/network` and `spec/design`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Version and attribution

Creator: Álvaro Marín Abril. Cite the creator, the Open Transit Information contributors and the version used. See [CITATION.cff](CITATION.cff).

The npm package version, Rust crate version and GitHub release/tag use the same numeric version. Release `X.Y.Z` corresponds to tag `vX.Y.Z`; published archives are immutable. Each release links its npm version and includes the verified package archive. See [CHANGELOG.md](CHANGELOG.md).

Code: Apache-2.0. Documentation: CC-BY-4.0. Font: SIL OFL-1.1. Preserve the applicable licence and [NOTICE](NOTICE) information, including **Open Transit Information - https://opentransitinformation.org**. Third-party assets and input datasets retain their own notices.
