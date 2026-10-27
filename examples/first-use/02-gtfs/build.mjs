// SPDX-License-Identifier: Apache-2.0
import { createDiagram, fromGtfs } from 'opentransitinformation';
import { toHtml } from 'opentransitinformation/node';
import { checkVersion, options, root, save, saveJson, sha256, summary } from '../shared.mjs';
import { feedZip, serviceDate } from './feed.mjs';

await checkVersion();
const bytes = await feedZip();
await save(new URL('out/02-gtfs/feed.zip', root), bytes);
const network = fromGtfs(bytes, {
  id: 'oti-teaching-gtfs',
  name: 'Synthetic GTFS - four stops',
  date: serviceDate,
  metadata: { source: 'Synthetic teaching data - Open Transit Information', license: 'CC-BY-4.0' }
});
const diagram = await createDiagram(network, options);
await saveJson(new URL('out/02-gtfs/network.json', root), network);
await save(new URL('out/02-gtfs/map.svg', root), diagram.svg);
await save(new URL('out/02-gtfs/map.html', root), await toHtml(network, options));
await saveJson(new URL('out/02-gtfs/qa.json', root), diagram.qa);
const result = { ...summary(diagram), serviceDate, tripsInFixture: 2, stopTimesInFixture: 6, shapePointsInFixture: 6, zipSha256: sha256(bytes) };
await saveJson(new URL('out/02-gtfs/result.json', root), result);
console.log(JSON.stringify(result));
