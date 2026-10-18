import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5174,
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000, // Phaser alone is ~1.2 MB minified
  },
});
