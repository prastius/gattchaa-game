import fs from "node:fs";
import path from "node:path";
import express, { type Application, type NextFunction, type Request, type Response } from "express";

// Serves the built game client (production: one port for everything).
//
// - Text files are sent pre-compressed: `npm run build` writes a .br (Brotli)
//   and .gz copy next to each one (scripts/compress-dist.mjs), so the 1.6 MB
//   game script goes out as roughly 350 KB without costing CPU per visit.
// - Vite's bundles have a content hash in their name, so browsers keep them for
//   a year; the page itself is always re-checked, so a deploy shows up at once.

/** Vite output such as assets/index-fW682KR-.js: the name changes whenever the content does. */
const HASHED = /-[A-Za-z0-9_-]{8}\.(js|css)$/;

function cacheControl(file: string): string {
  if (HASHED.test(file)) return "public, max-age=31536000, immutable";
  if (file.endsWith(".html")) return "no-cache";
  return "public, max-age=3600";
}

/** Every file that has a .br or .gz twin, found once at startup (the build never changes while running). */
function compressedFiles(dir: string): Set<string> {
  const found = new Set<string>();
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".br") || entry.name.endsWith(".gz")) found.add(p);
    }
  };
  walk(dir);
  return found;
}

/** The info pages' plain addresses (/guide, /rules, /terms, /privacy) and their files (client/public/info). */
const INFO = /^\/(guide|rules|terms|privacy)\/?$/;
const INFO_FILE = /^\/info\/(guide|rules|terms|privacy)\.html$/;

export function serveClient(app: Application, dist: string) {
  const root = path.resolve(dist);
  const compressed = compressedFiles(root);

  // /guide shows info/guide.html; the old /info/guide.html address sends you to /guide.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const page = req.path.match(INFO);
    if (page) {
      req.url = `/info/${page[1]}.html${query}`;
      return next();
    }
    const file = req.path.match(INFO_FILE);
    if (file) return res.redirect(301, `/${file[1]}${query}`);
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.headers.range) return next();
    const accept = String(req.headers["accept-encoding"] ?? "");
    const encoding = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : undefined;
    if (!encoding) return next();
    let file: string;
    try {
      file = path.join(root, decodeURIComponent(req.path === "/" ? "/index.html" : req.path));
    } catch {
      return next();
    }
    const packed = `${file}.${encoding === "br" ? "br" : "gz"}`;
    if (!file.startsWith(root + path.sep) || !compressed.has(packed)) return next();
    res.setHeader("Content-Encoding", encoding);
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Cache-Control", cacheControl(file));
    res.type(path.extname(file));
    res.sendFile(packed, { cacheControl: false });
  });

  app.use(
    express.static(root, {
      index: "index.html",
      cacheControl: false,
      setHeaders: (res, file) => {
        res.setHeader("Cache-Control", cacheControl(file));
        res.setHeader("Vary", "Accept-Encoding");
      },
    }),
  );
}
