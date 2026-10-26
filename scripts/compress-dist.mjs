#!/usr/bin/env node
// Compresses the built client ahead of time (Brotli and gzip, best settings),
// so the game server sends the small versions without spending CPU on every
// visit. Runs as part of `npm run build`; the server picks the .br/.gz files up
// by itself (server/src/static.ts).

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client/dist");
const TEXT = /\.(js|css|html|json|svg|txt)$/;
const MIN_BYTES = 1024;
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

async function* files(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(p);
    else yield p;
  }
}

let raw = 0;
let small = 0;
let count = 0;
for await (const file of files(DIST)) {
  if (!TEXT.test(file)) continue;
  const data = await fs.readFile(file);
  if (data.length < MIN_BYTES) continue;
  const br = await brotli(data, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });
  await fs.writeFile(`${file}.br`, br);
  await fs.writeFile(`${file}.gz`, await gzip(data, { level: 9 }));
  raw += data.length;
  small += br.length;
  count++;
}
console.log(`compressed ${count} files: ${(raw / 1024).toFixed(0)} KB -> ${(small / 1024).toFixed(0)} KB (Brotli)`);
