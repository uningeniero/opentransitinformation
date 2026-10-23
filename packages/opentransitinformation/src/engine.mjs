// SPDX-License-Identifier: Apache-2.0
import { OtiError } from './model.mjs';
let modulePromise;
let bytesOverride;
let fontOverride;
const assetCache = new Map();
export function configureAssets({ wasm, font } = {}) {
  if (wasm) {
    if (!(wasm instanceof Uint8Array)) throw new TypeError('wasm must be Uint8Array');
    bytesOverride = wasm;
    modulePromise = undefined;
  }
  if (font) {
    if (!(font instanceof Uint8Array)) throw new TypeError('font must be Uint8Array');
    fontOverride = font;
  }
}
export async function readAsset(name) {
  if (name === 'oti_engine.wasm' && bytesOverride) return bytesOverride;
  if (name === 'SourceSans3-Semibold.ttf' && fontOverride) return fontOverride;
  if (!assetCache.has(name))
    assetCache.set(
      name,
      (async () => {
        const url = new URL(`./${name}`, import.meta.url);
        if (typeof process !== 'undefined' && process.versions?.node) {
          const { readFile } = await import('node:fs/promises');
          return new Uint8Array(await readFile(url));
        }
        const response = await fetch(url);
        if (!response.ok)
          throw new OtiError('ASSET_UNAVAILABLE', `Unable to load ${name}: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      })()
    );
  try {
    return await assetCache.get(name);
  } catch (e) {
    assetCache.delete(name);
    throw e;
  }
}
async function compiled() {
  if (!modulePromise)
    modulePromise = readAsset('oti_engine.wasm').then((b) => WebAssembly.compile(b));
  try {
    return await modulePromise;
  } catch (e) {
    modulePromise = undefined;
    throw e;
  }
}
function invoke(e, bytes) {
  const ptr = e.oti_alloc(bytes.length);
  if (!ptr) throw new Error('Unable to allocate input');
  let resultPtr = 0,
    resultSize = 0;
  try {
    new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
    resultPtr = e.oti_run(ptr, bytes.length);
    if (!resultPtr) throw new Error('Unable to allocate output');
    resultSize = new DataView(e.memory.buffer).getUint32(resultPtr, true);
    if (resultSize > 64 * 1024 * 1024) throw new Error('Engine output exceeds limit');
    return new TextDecoder().decode(new Uint8Array(e.memory.buffer, resultPtr + 4, resultSize));
  } finally {
    e.oti_free(ptr, bytes.length);
    if (resultPtr) e.oti_free(resultPtr, resultSize + 4);
  }
}
export async function runEngine(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (bytes.length > 16 * 1024 * 1024)
    throw new OtiError('NETWORK_TOO_LARGE', 'Engine input exceeds 16 MiB');
  const module = await compiled();
  const execute = `const invoke=${invoke.toString()};const execute=async data=>{try{const instance=await WebAssembly.instantiate(data.module,{env:{oti_progress:stage=>send({progress:stage})}});send({value:invoke(instance.exports,data.bytes)})}catch(error){send({error:error.message})}};`;
  let worker, url;
  const node = typeof process !== 'undefined' && process.versions?.node;
  if (node) {
    const { Worker } = await import('node:worker_threads');
    worker = new Worker(
      `const{parentPort}=require('node:worker_threads');const send=value=>parentPort.postMessage(value);${execute}parentPort.on('message',execute);`,
      { eval: true, execArgv: [] }
    );
  } else {
    url = URL.createObjectURL(
      new Blob(
        [
          `const send=value=>self.postMessage(value);${execute}self.onmessage=event=>execute(event.data);`
        ],
        { type: 'text/javascript' }
      )
    );
    try {
      worker = new Worker(url);
    } catch (e) {
      URL.revokeObjectURL(url);
      throw new OtiError('ENGINE_WORKER_UNAVAILABLE', e.message);
    }
  }
  try {
    const raw = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new OtiError('ENGINE_TIMEOUT', 'Geometry computation exceeded 60 seconds'));
      }, 60000);
      const done = (message) => {
        if (message.progress !== undefined) {
          if (typeof process !== 'undefined' && process.env?.OTI_PROFILE === '1')
            console.error(JSON.stringify({ stage: message.progress, time: Date.now() }));
          return;
        }
        clearTimeout(timeout);
        if (message.error) reject(new OtiError('ENGINE_ERROR', message.error));
        else resolve(message.value);
      };
      const error = (e) => {
        clearTimeout(timeout);
        reject(new OtiError('ENGINE_ERROR', e.message || 'Engine worker failed'));
      };
      if (node) {
        worker.on('message', done);
        worker.once('error', error);
        worker.once('exit', (code) => {
          if (code !== 0) {
            clearTimeout(timeout);
            reject(new OtiError('ENGINE_ERROR', `Engine worker exited: ${code}`));
          }
        });
      } else {
        worker.onmessage = (event) => done(event.data);
        worker.onerror = error;
      }
      worker.postMessage({ module, bytes }, [bytes.buffer]);
    });
    const value = JSON.parse(raw);
    if (value.error) throw new OtiError('ENGINE_ERROR', value.error);
    return value;
  } finally {
    worker.terminate();
    if (url) URL.revokeObjectURL(url);
  }
}
