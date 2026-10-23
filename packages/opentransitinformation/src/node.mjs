// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { createDiagram } from './index.mjs';
import { base64 } from './measure.mjs';
import { readAsset } from './engine.mjs';
import { escapeXml } from './svg.mjs';
import { localeCopy } from './locale.mjs';
const scriptJson = (v) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
export async function toHtml(network, options = {}) {
  const copy = localeCopy(options.locale);
  const diagram = await createDiagram(network, options);
  const [bundle, wasm, font] = await Promise.all([
    readFile(new URL('./viewer.global.js', import.meta.url), 'utf8'),
    readAsset('oti_engine.wasm'),
    options.font?.data || readAsset('SourceSans3-Semibold.ttf')
  ]);
  const safeOptions = {
    ...options,
    font: undefined,
    onSelectionChange: undefined,
    measureText: undefined
  };
  const data = scriptJson({
    network: diagram.network,
    options: safeOptions,
    wasm: base64(wasm),
    font: base64(font),
    fontFamily: options.font?.family
  });
  const boot = `const config=JSON.parse(${scriptJson(data)});const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));OTI.configureAssets({wasm:bytes(config.wasm),font:bytes(config.font)});if(config.fontFamily)config.options.font={family:config.fontFamily,data:bytes(config.font)};const mount=config.options.openStreetMap?OTI.mountOpenStreetMapViewer:OTI.mountViewer;mount(document.getElementById('oti-map'),config.network,config.options).then(viewer=>{window.otiViewer=viewer;document.getElementById('oti-status').remove()}).catch(error=>{document.getElementById('oti-status').textContent=error.message});`;
  return `<!doctype html><html lang="${options.locale || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(diagram.network.name)}</title><style>body{margin:0;padding:24px;background:#eef2f4;font-family:system-ui,sans-serif}main{max-width:1700px;margin:auto}h1{font-size:24px;margin:0 0 16px}#oti-status{margin:12px 0}@media(max-width:700px){body{padding:8px}h1{font-size:20px}}@media print{body{padding:0;background:white}h1{display:none}}</style></head><body><main><h1>${escapeXml(diagram.network.name)}</h1><p id="oti-status" role="status">${copy.loading}</p><div id="oti-map"></div><noscript>${diagram.svg}</noscript></main><script>${bundle.replace(/<\/script/gi, '<\\/script')}</script><script>${boot}</script></body></html>`;
}
