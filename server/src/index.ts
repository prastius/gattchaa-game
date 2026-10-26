import fs from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { defineRoom, defineServer } from "colyseus";
import { ROOM_NAME } from "../../shared/protocol";
import { WorldRoom } from "./rooms/WorldRoom";
import { feed, registerGattchaaRoutes } from "./gattchaa";
import { registerApiRoutes } from "./api";
import { serveClient } from "./static";

const port = Number(process.env.PORT) || 2567;

// Same relative depth from src/ (dev) and build/ (prod).
const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));

const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(WorldRoom),
  },

  express: (app) => {
    // Behind nginx on the same machine: take the player's address from X-Forwarded-For.
    app.set("trust proxy", "loopback");
    let lastCpu = process.cpuUsage();
    let lastAt = Date.now();
    // How late the server runs its work. If this climbs into seconds, players
    // rubber-band: the machine is overloaded (not the network).
    const loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
    app.get("/health", (_req, res) => {
      // CPU % of one core since the previous call; handy when load testing.
      const cpu = process.cpuUsage(lastCpu);
      const now = Date.now();
      const cpuPct = ((cpu.user + cpu.system) / 1000 / Math.max(1, now - lastAt)) * 100;
      lastCpu = process.cpuUsage();
      lastAt = now;
      res.json({
        ok: true,
        uptime: Math.round(process.uptime()),
        rssMB: Math.round(process.memoryUsage().rss / 1e6),
        cpuPct: Math.round(cpuPct),
        loopLagMs: { p99: Math.round(loopDelay.percentile(99) / 1e6), max: Math.round(loopDelay.max / 1e6) },
      });
      loopDelay.reset();
    });

    registerGattchaaRoutes(app);
    registerApiRoutes(app);

    // In production the server also hosts the built client, so one port serves everything.
    if (fs.existsSync(clientDist)) serveClient(app, clientDist);
  },
});

feed.start();
server.listen(port);
console.log(`my-world server listening on :${port}`);
