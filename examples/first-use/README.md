<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# First-use examples

Follow the canonical [getting-started guide](../../docs/getting-started.md) for installation, commands, expected maps and troubleshooting. These examples use the published `opentransitinformation@0.4.0`; consumers do not build Rust.

`01-tiny` contains the starting network. `02-gtfs/feed` contains a synthetic one-day teaching feed. `03-web` contains a plain browser integration and a loopback HTTP server. Generated work stays in ignored `out/`; installation stays in local `node_modules/`.

Code: Apache-2.0, under the repository [licence](../../LICENSE). Guide, synthetic data and expected diagrams: CC-BY-4.0. The GTFS CSV files use their required header rows and are covered by `02-gtfs/feed/LICENSE.txt`. Package, font and dependency notices are copied by `npm run web` into `out/web/vendor/`.

Project credit: Álvaro Marín Abril and Open Transit Information contributors, https://opentransitinformation.org.
