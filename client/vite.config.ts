import { defineConfig, type Connect, type Plugin } from "vite";

/**
 * The info pages have plain addresses (/guide, /rules, /terms, /privacy): the files live in
 * public/info/*.html, and the old .html addresses send you to the plain ones. The game server
 * does the same in production (server/src/static.ts).
 */
const INFO = /^\/(guide|rules|terms|privacy)\/?$/;
const INFO_FILE = /^\/info\/(guide|rules|terms|privacy)\.html$/;
const infoPages: Connect.NextHandleFunction = (req, res, next) => {
  const [path, query = ""] = (req.url ?? "/").split("?");
  const page = path.match(INFO);
  if (page) {
    req.url = `/info/${page[1]}.html${query ? `?${query}` : ""}`;
    return next();
  }
  const file = path.match(INFO_FILE);
  if (file) {
    res.statusCode = 301;
    res.setHeader("Location", `/${file[1]}${query ? `?${query}` : ""}`);
    return res.end();
  }
  next();
};
const cleanInfoUrls = (): Plugin => ({
  name: "clean-info-urls",
  configureServer: (server) => void server.middlewares.use(infoPages),
  configurePreviewServer: (server) => void server.middlewares.use(infoPages),
});

export default defineConfig({
  plugins: [cleanInfoUrls()],
  server: {
    host: true,
    port: 5174,
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000, // Phaser alone is ~1.2 MB minified
  },
});
