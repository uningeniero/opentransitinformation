// SPDX-License-Identifier: Apache-2.0
import { createDiagram } from 'opentransitinformation';
import { toHtml } from 'opentransitinformation/node';
import { checkVersion, options, readJson, root, save, saveJson, summary } from '../shared.mjs';

await checkVersion();
const network = await readJson(new URL('01-tiny/network.json', root));
const diagram = await createDiagram(network, options);
await save(new URL('out/01-tiny/map.svg', root), diagram.svg);
await save(new URL('out/01-tiny/map.html', root), await toHtml(network, options));
await saveJson(new URL('out/01-tiny/qa.json', root), diagram.qa);
const result = summary(diagram);
await saveJson(new URL('out/01-tiny/result.json', root), result);
console.log(JSON.stringify(result));
