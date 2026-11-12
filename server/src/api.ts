import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { SHOP_ID_RE, type MarketList, type MarketWare, type PlayerShopDetails } from "../../shared/vending";
import { db, parseWares } from "./db";
import { feed } from "./gattchaa";

// HTTP endpoints the game page calls (everything live goes over the WebSocket):
//
//   GET  /auth/gattchaa      -> "Sign in with Gattchaa": off to gattchaaoripa.com, which
//                               sends the player back to the game with ?ticket=…
//   POST /api/auth/ticket    -> swaps that one-time ticket for a game session token
//   POST /api/auth/logout    -> ends the session
//   GET  /api/shops/:id      -> a player shop's things for Points and Gattchaa cards, for the shop panel
//   GET  /api/market         -> everything for Points in every shop (the Market Keeper's search)

const TICKET_RE = /^[A-Za-z0-9_-]{16,128}$/;
const SIGNIN_ATTEMPTS_PER_MIN = 10;

/** Per-address limit on ticket redemptions: each one costs a request to Gattchaa. */
const attempts = new Map<string, { n: number; resetAt: number }>();
function tooMany(ip: string): boolean {
  const now = Date.now();
  if (attempts.size > 5000) attempts.clear();
  const a = attempts.get(ip);
  if (!a || now > a.resetAt) {
    attempts.set(ip, { n: 1, resetAt: now + 60_000 });
    return false;
  }
  return ++a.n > SIGNIN_ATTEMPTS_PER_MIN;
}

/** The dev client runs on Vite's port, so these are cross-origin there; production is same-origin. */
function cors(req: Request, res: Response, next: NextFunction) {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method !== "OPTIONS") return next();
  res.set("Access-Control-Allow-Methods", "GET, POST").set("Access-Control-Allow-Headers", "Content-Type").set("Access-Control-Max-Age", "86400");
  res.status(204).end();
}

export function registerApiRoutes(app: Application) {
  app.use("/api", cors);

  app.get("/auth/gattchaa", (_req: Request, res: Response) => {
    // Gattchaa only ever redirects back to the town's own address (TOWN_ORIGIN on its side).
    res.redirect(302, feed.signInUrl || "/?signin=unavailable");
  });

  app.post("/api/auth/ticket", express.json({ limit: "2kb" }), async (req: Request, res: Response) => {
    const ticket = String(req.body?.ticket ?? "");
    if (!TICKET_RE.test(ticket)) {
      res.status(400).json({ error: "That sign-in link isn't valid. Please sign in again." });
      return;
    }
    if (tooMany(req.ip ?? "")) {
      res.status(429).json({ error: "Too many sign-in attempts. Wait a minute and try again." });
      return;
    }
    let user;
    try {
      user = await feed.redeemTicket(ticket);
    } catch (err) {
      console.warn(`[auth] ticket redeem failed: ${(err as Error).message}`);
      res.status(502).json({ error: "Couldn't reach Gattchaa. Try again in a moment." });
      return;
    }
    if (!user) {
      res.status(401).json({ error: "That sign-in link has expired. Please sign in again." });
      return;
    }
    const { account, token } = db.signIn(user.id, user.displayName);
    res.set("Cache-Control", "no-store").json({ token, account: { displayName: account.displayName, name: account.name, look: account.look } });
  });

  app.post("/api/auth/logout", express.json({ limit: "2kb" }), (req: Request, res: Response) => {
    const token = String(req.body?.token ?? "");
    if (token) db.signOut(token);
    res.status(204).end();
  });

  app.get("/api/shops/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const row = SHOP_ID_RE.test(id) ? db.shop(id) : undefined;
    const owner = row && db.account(row.accountId);
    if (!row || !owner) {
      res.status(404).json({ error: "This shop has closed." });
      return;
    }
    // Read the stock after waiting for Gattchaa, so it's as fresh as can be.
    const listings = feed.enabled ? await feed.listings(owner.gattchaaId) : [];
    const details: PlayerShopDetails = {
      id,
      name: owner.name || owner.displayName,
      title: row.title,
      wares: parseWares(db.shop(id)?.wares),
      listings: listings ?? [],
      fresh: listings !== undefined,
    };
    res.set("Cache-Control", "no-store").json(details);
  });

  app.get("/api/market", (_req: Request, res: Response) => {
    const wares: MarketWare[] = [];
    for (const row of db.shops()) {
      const owner = db.account(row.accountId);
      if (!owner) continue;
      parseWares(row.wares).forEach((w, ware) => {
        if (w.item.n > 0) wares.push({ ...w, shop: row.id, ware, seller: owner.name || owner.displayName, x: row.x, y: row.y });
      });
    }
    res.set("Cache-Control", "no-store").json({ wares } satisfies MarketList);
  });
}
