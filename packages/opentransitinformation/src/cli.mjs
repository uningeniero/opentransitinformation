#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  createDiagram,
  fromGtfs,
  fromGeoJSON,
  fromText,
  loadOpenStreetMap,
  withOpenStreetMap
} from './index.mjs';
import { toHtml } from './node.mjs';
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log(
    'oti <input> --out <map.svg|map.html> [--format json|geojson|gtfs|text] [--profile schematic|geographic|print|highContrast] [--width number] [--height number] [--colors source|adaptive] [--background none|subtle|atlas|mono] [--osm west,south,east,north] [--osm-endpoint URL] [--locale en|es] [--qa report.json]'
  );
  process.exit(0);
}
try {
  const input = args.shift();
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        '--out',
        '--format',
        '--profile',
        '--qa',
        '--width',
        '--height',
        '--colors',
        '--background',
        '--locale',
        '--osm',
        '--osm-endpoint'
      ].includes(args[i]) ||
      !args[i + 1]
    )
      throw new Error(`Invalid argument: ${args[i]}`);
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.out) throw new Error('--out is required');
  const bytes = await readFile(input);
  const extension = extname(input).toLowerCase();
  let format =
    options.format ||
    (extension === '.zip'
      ? 'gtfs'
      : extension === '.txt'
        ? 'text'
        : extension === '.geojson'
          ? 'geojson'
          : 'json');
  let network;
  if (format === 'gtfs') network = fromGtfs(bytes);
  else if (format === 'text') network = await fromText(bytes.toString('utf8'));
  else if (format === 'geojson')
    network = fromGeoJSON(JSON.parse(bytes.toString('utf8')));
  else if (format === 'json') {
    const data = JSON.parse(bytes.toString('utf8'));
    network = data.type === 'FeatureCollection' ? fromGeoJSON(data) : data;
  } else throw new Error(`Unknown input format: ${format}`);
  if (options['osm-endpoint'] && !options.osm)
    throw new Error('--osm-endpoint requires --osm');
  if (options.osm) {
    if (network.coordinateSystem !== 'wgs84')
      throw new Error('--osm requires WGS84 transport coordinates');
    const bounds = options.osm.split(',').map(Number);
    network = withOpenStreetMap(
      network,
      await loadOpenStreetMap({
        bounds,
        endpoint: options['osm-endpoint']
      })
    );
  }
  const renderOptions = {
    ...(options.osm ? { backgroundStyle: 'atlas' } : {}),
    ...(options.width ? { width: Number(options.width) } : {}),
    ...(options.height ? { height: Number(options.height) } : {}),
    ...(options.colors ? { colorMode: options.colors } : {}),
    ...(options.background ? { backgroundStyle: options.background } : {}),
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.profile ? { profile: options.profile } : {})
  };
  const diagram = await createDiagram(network, renderOptions);
  const html = extname(options.out).toLowerCase() === '.html';
  if (!html && extname(options.out).toLowerCase() !== '.svg')
    throw new Error('--out must end with .svg or .html');
  await writeFile(
    options.out,
    html ? await toHtml(network, renderOptions) : diagram.svg
  );
  if (options.qa)
    await writeFile(options.qa, JSON.stringify(diagram.qa, null, 2) + '\n');
  console.log(
    JSON.stringify({
      output: options.out,
      passed: diagram.qa.passed,
      ...diagram.qa.statistics
    })
  );
} catch (error) {
  console.error(
    JSON.stringify({
      code: error.code || 'CLI_ERROR',
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    })
  );
  process.exitCode = 1;
}
