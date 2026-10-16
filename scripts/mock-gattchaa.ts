// A stand-in for the Gattchaa Town API (docs/gattchaa-town-api.md), for local
// development and as a reference for the Laravel implementation.
//
//   npm run mock:gattchaa
//
// Serves GET /api/town/v1/catalog and /live (Bearer key + ETag) on :8787 and,
// every ~40 s, fires signed webhooks at the game server (a "big pull" plus a
// room seat change). Point the game server at it with server/.env.development:
//
//   GATTCHAA_API_URL=http://localhost:8787/api/town/v1
//   GATTCHAA_API_KEY=dev-key
//   GATTCHAA_WEBHOOK_SECRET=dev-secret

import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT) || 8787;
const KEY = process.env.GATTCHAA_API_KEY || "dev-key";
const SECRET = process.env.GATTCHAA_WEBHOOK_SECRET || "dev-secret";
const GAME = process.env.GAME_URL || "http://localhost:2567";
const SITE = "https://gattchaaoripa.com";
const SELF = `http://localhost:${PORT}`;

const COLORS = ["#eb8224", "#3b82f6", "#ef4444", "#10b981", "#a855f7", "#f59e0b"];
const thumb = (id: number) => `${SELF}/thumbs/${id}.svg`;

const products = [
  ["Pokemon ID", "Pokemon 30th Celebration", 40000, "New Release"],
  ["Pokemon CH", "Pokemon Final Flame Dance", 30000, null],
  ["Pokemon JP", "Pokemon Abyss Eyes", 35000, "Trending"],
  ["One Piece JP", "One Piece The World's Strongest Warriors", 90000, null],
  ["Yu-Gi-Oh! AE", "Yugioh AE Creation Pack 13", 40000, "New Release"],
  ["Yu-Gi-Oh! JP", "Yugioh JP Glorious Victors", 30000, null],
  ["Digimon EN", "Digimon EN Timeless Bonds", 90000, "EN Version"],
  ["Union Arena", "Union Arena Bleach Vol. 3", 60000, null],
  ["Riftbound EN", "Riftbound Unleashed", 120000, null],
  ["Kuji", "Ichiban Kuji Pokémon 30th Anniversary Vol.2", 189000, null],
].map(([category, title, price, label], i) => {
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return {
    id: 100 + i,
    slug,
    title,
    category,
    type: category === "Kuji" ? "oripa_kuji" : "pack_opening",
    price,
    original_price: i === 2 ? 40000 : null,
    label,
    is_hot: i === 0,
    is_sold_out: i === 5,
    image_url: thumb(100 + i),
    url: `${SITE}/gacha/${slug}`,
  };
});

const rooms = products.slice(0, 4).map((p, i) => ({
  code: i === 0 ? "SPDEMO01" : null,
  mode: i % 2 ? "packs_battle" : "sharing_pack",
  status: "open",
  seats: 5,
  taken_seats: i === 0 ? 2 : 0,
  seat_price: p.price,
  cards_per_seat: 5,
  fill_expires_at: null,
  url: `${p.url}?mode=${i % 2 ? "packs_battle" : "sharing_pack"}`,
  product: { slug: p.slug, title: p.title, image_url: p.image_url },
}));

function send(res: http.ServerResponse, req: http.IncomingMessage, body: unknown) {
  const json = JSON.stringify(body);
  const etag = `"${crypto.createHash("md5").update(json).digest("hex")}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag }).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json", ETag: etag, "Cache-Control": "private, max-age=0" }).end(json);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", SELF);
    const svg = url.pathname.match(/^\/thumbs\/(\d+)\.svg$/);
    if (svg) {
      const id = Number(svg[1]);
      const color = COLORS[id % COLORS.length];
      res
        .writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=3600" })
        .end(
          `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="24" fill="#131313"/><rect x="48" y="24" width="160" height="208" rx="12" fill="${color}"/><text x="128" y="140" font-family="sans-serif" font-size="44" font-weight="700" text-anchor="middle" fill="#fff">#${id}</text></svg>`,
        );
      return;
    }
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Unauthenticated." }));
      return;
    }
    if (url.pathname === "/api/town/v1/catalog") return send(res, req, { data: products, updated_at: new Date().toISOString() });
    if (url.pathname === "/api/town/v1/live") return send(res, req, { data: { rooms, online: 40 + Math.floor(Math.random() * 20) } });
    res.writeHead(404).end();
  })
  .listen(PORT, () => console.log(`mock Gattchaa Town API on ${SELF}/api/town/v1 (key "${KEY}"), webhooks -> ${GAME}/hooks/gattchaa`));

/** Signs and POSTs one event the way the Laravel side will. */
async function webhook(type: string, data?: unknown) {
  const body = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, type, created_at: new Date().toISOString(), ...(data !== undefined && { data }) });
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  try {
    const res = await fetch(`${GAME}/hooks/gattchaa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gattchaa-Signature": `t=${t},v1=${v1}` },
      body,
    });
    console.log(`webhook ${type} -> ${res.status}`);
  } catch (err) {
    console.log(`webhook ${type} failed: ${(err as Error).message}`);
  }
}

const HITS = ["Charizard ex SAR", "Monkey D. Luffy Manga Rare", "Blue-Eyes White Dragon QCSR", "Pikachu Illustration Rare"];
setInterval(() => {
  const p = products[Math.floor(Math.random() * products.length)];
  const hit = HITS[Math.floor(Math.random() * HITS.length)];
  webhook("purchase.highlight", {
    label: "Big hit!",
    message: `Someone pulled ${hit} from ${p.title}!`,
    product: { title: p.title, image_url: p.image_url, url: p.url },
  });
  const r = rooms[0];
  r.taken_seats = (r.taken_seats % r.seats) + 1;
  webhook("live.updated");
}, 40_000);
