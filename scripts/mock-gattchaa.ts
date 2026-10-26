// A stand-in for the Gattchaa Town API (docs/gattchaa-town-api.md), for local
// development and as a reference for the Laravel implementation.
//
//   npm run mock:gattchaa
//
// Serves GET /api/town/v1/catalog and /live (Bearer key + ETag) on :8787 and,
// every ~40 s, fires signed webhooks at the game server (a "big pull", a room
// seat change and a price change in a player shop). Point the game server at
// it with server/.env.development:
//
//   GATTCHAA_API_URL=http://localhost:8787/api/town/v1
//   GATTCHAA_API_KEY=dev-key
//   GATTCHAA_WEBHOOK_SECRET=dev-secret
//   GATTCHAA_SIGNIN_URL=http://localhost:8787/town/enter
//
// Sign-in: /town/enter is the website's "Play Gattchaa Town" page. Here you pick
// a pretend user; it sends you back to the game (TOWN_ORIGIN) with a ticket.

import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT) || 8787;
const KEY = process.env.GATTCHAA_API_KEY || "dev-key";
const SECRET = process.env.GATTCHAA_WEBHOOK_SECRET || "dev-secret";
const GAME = process.env.GAME_URL || "http://localhost:2567";
const TOWN = process.env.TOWN_ORIGIN || "http://localhost:5174";
const SITE = "https://gattchaaoripa.com";
const SELF = `http://localhost:${PORT}`;
const TICKET_MS = 60_000;

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

// ------------------------------------------------------------------ accounts + marketplace

/** Pretend users: two sellers and one collector with nothing listed. */
const USERS = [
  { id: "1001", name: "Rina", note: "seller, 6 cards listed" },
  { id: "1002", name: "Budi", note: "seller, 3 cards listed" },
  { id: "1003", name: "Sari", note: "nothing listed yet" },
];

const CARDS: [title: string, category: string, price: number, condition: string, grade: string | null][] = [
  ["Charizard ex SAR 201/165", "Pokemon JP", 2_450_000, "Near Mint", null],
  ["Pikachu Illustration Rare", "Pokemon JP", 850_000, "Near Mint", "PSA 10"],
  ["Monkey D. Luffy Manga Rare", "One Piece JP", 3_200_000, "Near Mint", null],
  ["Blue-Eyes White Dragon QCSR", "Yu-Gi-Oh! JP", 1_100_000, "Lightly Played", null],
  ["Umbreon VMAX Alt Art", "Pokemon JP", 5_900_000, "Near Mint", "BGS 9.5"],
  ["Roronoa Zoro SEC", "One Piece JP", 420_000, "Near Mint", null],
  ["Dark Magician Girl 25th", "Yu-Gi-Oh! AE", 760_000, "Near Mint", null],
  ["Mewtwo ex SAR", "Pokemon ID", 390_000, "Near Mint", null],
  ["Omnimon Alt Art", "Digimon EN", 640_000, "Near Mint", "PSA 9"],
];

const listings: Record<string, ReturnType<typeof listing>[]> = {
  "1001": [0, 1, 2, 3, 4, 5].map((i) => listing(i)),
  "1002": [6, 7, 8].map((i) => listing(i)),
  "1003": [],
};

function listing(i: number) {
  const [title, category, price, condition, grade] = CARDS[i];
  const id = 5000 + i;
  return { id, title, image_url: `${SELF}/cards/${id}.svg`, price, condition, grade, category, url: `${SITE}/marketplace/listings/${id}` };
}

/** One-time sign-in tickets: ticket -> user, valid for a minute. */
const tickets = new Map<string, { userId: string; expires: number }>();

function signInPage(): string {
  const rows = USERS.map((u) => `<li><a href="/town/enter?user=${u.id}">${u.name}</a> <small>${u.note}</small></li>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mock Gattchaa sign-in</title>
<style>body{font:16px system-ui;background:#131313;color:#f5f1ea;display:grid;place-items:center;min-height:90vh}main{max-width:420px}a{color:#eb8224;font-weight:700}li{margin:10px 0}small{color:#b3aca1}</style>
<main><h1>Gattchaa Oripa (mock)</h1><p>On the real site this page signs you in, then sends you back to Gattchaa Town. Pick a pretend user:</p><ul>${rows}</ul></main>`;
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

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
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", SELF);
    const svg = url.pathname.match(/^\/(thumbs|cards)\/(\d+)\.svg$/);
    if (svg) {
      const id = Number(svg[2]);
      const color = COLORS[id % COLORS.length];
      const label = svg[1] === "cards" ? (CARDS[id - 5000]?.[0] ?? "").split(" ").slice(0, 2).join(" ") : `#${id}`;
      res
        .writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=3600" })
        .end(
          `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="24" fill="#131313"/><rect x="48" y="24" width="160" height="208" rx="12" fill="${color}"/><text x="128" y="140" font-family="sans-serif" font-size="${svg[1] === "cards" ? 22 : 44}" font-weight="700" text-anchor="middle" fill="#fff">${label}</text></svg>`,
        );
      return;
    }

    // The website's "Play Gattchaa Town" page: signed-in users get a ticket and go back to the town.
    if (url.pathname === "/town/enter") {
      const user = USERS.find((u) => u.id === url.searchParams.get("user"));
      if (!user) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(signInPage());
        return;
      }
      const ticket = crypto.randomBytes(24).toString("base64url");
      tickets.set(ticket, { userId: user.id, expires: Date.now() + TICKET_MS });
      res.writeHead(302, { Location: `${TOWN}/?ticket=${ticket}` }).end();
      return;
    }

    if (req.headers.authorization !== `Bearer ${KEY}`) {
      res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Unauthenticated." }));
      return;
    }
    if (url.pathname === "/api/town/v1/catalog") return send(res, req, { data: products, updated_at: new Date().toISOString() });
    if (url.pathname === "/api/town/v1/live") return send(res, req, { data: { rooms, online: 40 + Math.floor(Math.random() * 20) } });
    if (url.pathname === "/api/town/v1/tickets/redeem" && req.method === "POST") {
      const ticket = String((await readJson(req)).ticket ?? "");
      const t = tickets.get(ticket);
      tickets.delete(ticket); // one use only
      const user = t && t.expires > Date.now() && USERS.find((u) => u.id === t.userId);
      if (!user) {
        res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Unknown or expired ticket." }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: { user_id: user.id, display_name: user.name } }));
      return;
    }
    const seller = url.pathname.match(/^\/api\/town\/v1\/users\/([^/]+)\/listings$/);
    if (seller) return send(res, req, { data: listings[decodeURIComponent(seller[1])] ?? [] });
    res.writeHead(404).end();
  })
  .listen(PORT, () =>
    console.log(`mock Gattchaa Town API on ${SELF}/api/town/v1 (key "${KEY}"), sign-in at ${SELF}/town/enter -> ${TOWN}, webhooks -> ${GAME}/hooks/gattchaa`),
  );

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
  // Rina knocks 5% off one of her cards.
  const l = listings["1001"][Math.floor(Math.random() * listings["1001"].length)];
  l.price = Math.round((l.price * 0.95) / 1000) * 1000;
  webhook("listing.updated", { user_id: "1001" });
}, 40_000);
