import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { defineRoom, defineServer } from "colyseus";
import { ROOM_NAME } from "../../shared/protocol";
import { WorldRoom } from "./rooms/WorldRoom";

const port = Number(process.env.PORT) || 2567;

// Same relative depth from src/ (dev) and build/ (prod).
const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));

const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(WorldRoom),
  },

  express: (app) => {
    app.get("/health", (_req, res) => {
      res.json({ ok: true, uptime: process.uptime() });
    });

    // In production the server also hosts the built client, so one port serves everything.
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist, { maxAge: "1h", index: "index.html" }));
    }
  },
});

server.listen(port);
console.log(`my-world server listening on :${port}`);
