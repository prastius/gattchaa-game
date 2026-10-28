# Gattchaa Town API: blueprint for gattchaaoripa.com

This is what the Gattchaa Oripa (Laravel) project needs to build so Gattchaa Town can show live packs, rooms and big pulls, let players sign in with their Gattchaa account, and run player shops in the Market Square. The town never scrapes or browses the website: it reads a few small JSON endpoints and receives webhooks.

Players never call this API. Only the game server does: about **8 requests per minute** for packs and rooms however many people are in town, plus about one request per open player shop every 10 minutes. Unchanged responses are answered with `304 Not Modified`, which is nearly free.

```
 Browser (player) ──WebSocket──▶ Game server (Colyseus, VPS)
                                   │  ▲
         GET /api/town/v1/catalog  │  │  POST /hooks/gattchaa   (signed webhook)
         GET /api/town/v1/live     │  │
   POST /api/town/v1/tickets/redeem│  │
   GET  /api/town/v1/users/{id}/listings
                                   ▼  │
                                Gattchaa Oripa (Laravel)
```

Links the player clicks (product pages, daily login, a card in someone's shop…) open gattchaaoripa.com in a new tab, so login, payment and pulls stay on the real site. **The game never handles money**: a card in a player's shop is bought on its marketplace page.

---

## 1. What to build (checklist)

| # | Piece | Effort |
|---|---|---|
| 1 | `.env` + `config/services.php` entries | 5 min |
| 2 | `TownApiKey` middleware (Bearer key) | 10 min |
| 3 | `GET /api/town/v1/catalog`: products on sale | 30 min |
| 4 | `GET /api/town/v1/live`: open rooms + people online | 30 min (reuses the `rooms.state` logic) |
| 5 | `SendTownWebhook` queued job + `Town::event()` helper | 30 min |
| 6 | Fire 3 events from existing code (product saved, room seats changed, highlighted purchase) | 30 min |
| 7 | 256 px product thumbnails + CORS header for them | 30 min |
| 8 | Sign-in: `GET /town/enter` page + `POST /api/town/v1/tickets/redeem` | 45 min |
| 9 | Player shops: `GET /api/town/v1/users/{id}/listings` (a seller's marketplace listings) | 30 min |
| 10 | Fire `listing.updated` when a listing is created, changed, sold or removed | 15 min |

Items 1–7 light up the stalls, machines and Rooms tables. Items 8–10 turn on signing in and player shops; the town works without them (players are simply guests).

---

## 2. Configuration

**Laravel `.env`**

```dotenv
TOWN_API_KEY=<long random string>          # php -r "echo bin2hex(random_bytes(32));"
TOWN_WEBHOOK_URL=https://town.gattchaaoripa.com/hooks/gattchaa
TOWN_WEBHOOK_SECRET=<another long random string>
TOWN_ORIGIN=https://town.gattchaaoripa.com  # where the game is hosted: CORS on thumbnails, and where /town/enter sends players
```

**Game server `server/.env.production`** (on the VPS):

```dotenv
GATTCHAA_API_URL=https://gattchaaoripa.com/api/town/v1
GATTCHAA_API_KEY=<same as TOWN_API_KEY>
GATTCHAA_WEBHOOK_SECRET=<same as TOWN_WEBHOOK_SECRET>
GATTCHAA_SITE_URL=https://gattchaaoripa.com
```

If `TOWN_WEBHOOK_URL` is empty, Laravel should skip sending webhooks. If `GATTCHAA_API_URL` is empty, the game makes no requests and the stalls just show menu links.

---

## 3. Endpoints

All `/api/town/v1` endpoints:

- require `Authorization: Bearer <TOWN_API_KEY>` and return `401` otherwise;
- use `snake_case` fields and absolute URLs.

The `GET` endpoints also:

- return `ETag`, and answer `304` when the request's `If-None-Match` matches;
- are cached server-side (`Cache::remember`) so even a burst costs one query.

### 3.1 `GET /api/town/v1/catalog`

Products currently on sale (not closed), in the same order as the homepage. Sold-out products are included and flagged. The game polls this every **10 min**; the `catalog.updated` webhook makes changes show up right away.

```json
{
  "data": [
    {
      "id": 96,
      "slug": "yugioh-ae-creation-pack-13",
      "title": "Yugioh AE Creation Pack 13",
      "category": "Yu-Gi-Oh! AE",
      "type": "pack_opening",
      "price": 40000,
      "original_price": null,
      "label": "New Release",
      "is_hot": false,
      "is_sold_out": false,
      "image_url": "https://gattchaaoripa.com/storage/products/thumbs/yugioh-ae-creation-pack-13-1791976952.webp",
      "url": "https://gattchaaoripa.com/gacha/yugioh-ae-creation-pack-13"
    }
  ],
  "updated_at": "2026-10-16T08:00:00+07:00"
}
```

| Field | Source on the site today | Notes |
|---|---|---|
| `price` | `current_price` (includes Price Rush / dynamic price) | integer rupiah |
| `original_price` | `price` when it is higher than `current_price`, else `null` | shown struck through |
| `category` | `category.title` | the town matches on this (e.g. "Pokemon ID", "Kuji") |
| `type` | `type` | `pack_opening`, `oripa_kuji`, `kuji` |
| `label` | `custom_label` | short badge text |
| `image_url` | 256 px thumbnail (see §5) | must allow CORS for the game origin |
| `url` | `route('gacha.show', $product->slug)` | |

### 3.2 `GET /api/town/v1/live`

Open rooms and how many people are on the website. The game polls this every **30 s**; `live.updated` webhooks make seat changes appear within about 2 s.

```json
{
  "data": {
    "online": 14,
    "rooms": [
      {
        "code": "SPLH5ZAC",
        "mode": "sharing_pack",
        "status": "open",
        "seats": 5,
        "taken_seats": 1,
        "seat_price": 40000,
        "cards_per_seat": 5,
        "fill_expires_at": "2026-10-15T20:00:00+07:00",
        "url": "https://gattchaaoripa.com/gacha/yugioh-ae-creation-pack-13?mode=sharing_pack",
        "product": {
          "slug": "yugioh-ae-creation-pack-13",
          "title": "Yugioh AE Creation Pack 13",
          "image_url": "https://gattchaaoripa.com/storage/products/thumbs/yugioh-ae-creation-pack-13-1791976952.webp"
        }
      }
    ]
  }
}
```

- `rooms`: build these from the same code behind `route('rooms.state')`. Leave out rooms whose product is closed. `mode` is `sharing_pack` or `packs_battle`. `url` is the link the Rooms page already uses: `route('gacha.show', $slug) . '?mode=' . $mode`.
- `online`: the same number as `online_count` in `/site-activity`.
- Do **not** include anything about the current visitor (`is_seated` etc.). This endpoint is anonymous data for the town.

### 3.3 Sign-in: `GET /town/enter` (web page) and `POST /api/town/v1/tickets/redeem`

Players sign in to the town with their Gattchaa account, so the town knows who owns a shop. Passwords never touch the game:

1. In the town, **Sign in with Gattchaa** opens `https://gattchaaoripa.com/town/enter`. This is an ordinary web route behind the `auth` middleware, so a logged-out player logs in first and comes back.
2. It stores a **one-time ticket** for that user (random, 60 seconds) and redirects to `{TOWN_ORIGIN}/?ticket=<ticket>`. Always redirect to `TOWN_ORIGIN` itself; never take a return address from the request (that would be an open redirect).
3. The game server swaps the ticket at once:

```http
POST /api/town/v1/tickets/redeem
Authorization: Bearer <TOWN_API_KEY>
Content-Type: application/json

{ "ticket": "k3J9…" }
```

```json
{ "data": { "user_id": 1001, "display_name": "Rina" } }
```

- The ticket is deleted when it's read, so it works once. Unknown, used or expired tickets: `404`.
- `display_name` is shown in town as the shop owner's name. Use the public name the marketplace shows, **never** the email or real name if those are private.
- Tickets are 16–128 characters of `A-Z a-z 0-9 _ -` (`Str::random(48)` is fine).

The game then keeps its own session for that player (30 days), so this happens once per device, not on every visit.

### 3.4 `GET /api/town/v1/users/{user_id}/listings`

A seller's **active** marketplace listings. They are what their player shop in town shows. Each card links to its listing page, where it's bought as usual. The game asks when a shop opens, when someone browses it (at most once a minute per seller), and after `listing.updated`.

```json
{
  "data": [
    {
      "id": 5001,
      "title": "Pikachu Illustration Rare",
      "image_url": "https://gattchaaoripa.com/storage/marketplace/thumbs/5001.webp",
      "price": 850000,
      "condition": "Near Mint",
      "grade": "PSA 10",
      "category": "Pokemon JP",
      "url": "https://gattchaaoripa.com/marketplace/listings/5001"
    }
  ]
}
```

| Field | Notes |
|---|---|
| `price` | integer rupiah, what the buyer pays on the site |
| `condition`, `grade` | optional (`null`): grade only for graded slabs, e.g. "PSA 10" |
| `image_url` | a small image (about 256 px). It's shown in an `<img>` in the shop panel, so no CORS is needed |
| `url` | the listing's page on the marketplace |

Newest first, at most 60. An unknown user, or one with nothing listed: `{ "data": [] }`. A shop shows these next to whatever the player sells from their in-game bag (for in-game gold, which never buys a real card), so a player with no listings can still open one.

---

## 4. Webhooks (Laravel → game)

Sent as `POST {TOWN_WEBHOOK_URL}` from a **queued job**, so the website never waits on the game. Use 3 tries with backoff of 5 s, 30 s and 2 min, and a 5 s timeout.

**Signature**: header `X-Gattchaa-Signature: t=<unix seconds>,v1=<hex>`, where `v1 = HMAC-SHA256(secret, "<t>.<raw JSON body>")`. The game rejects anything older than 5 minutes or with a wrong signature, and ignores repeated `id`s, so retries are safe.

```json
{ "id": "evt_01JAB…", "type": "purchase.highlight", "created_at": "2026-10-16T08:00:00+07:00", "data": { … } }
```

| `type` | When to send | `data` |
|---|---|---|
| `purchase.highlight` | Whenever the site creates a purchase notification (the "Recent purchase" toast), or a pull above a rarity/value threshold you choose | `{ "label": "Big hit!", "message": "Someone pulled Charizard ex SAR!", "product": { "title", "image_url", "url" } }` |
| `catalog.updated` | A product is created, updated, closed or sells out | none |
| `live.updated` | A room seat is taken or released, or a room fills, resolves or expires | none |
| `listing.updated` | A marketplace listing is created, changed (price…), sold or removed | `{ "user_id": 1001 }` (the seller) |

In town, `purchase.highlight` shows a toast to everyone, sets off fireworks over the fountain, makes the Town Crier shout it, and posts it in chat. **Use the same wording and masking as the website toast.** Never include a buyer's real name, email or anything private. The game shows `message` verbatim.

`catalog.updated` and `live.updated` carry no data: the game simply re-fetches (bursts are merged into one request). `listing.updated` makes the game re-fetch that seller's listings, so their shop sign and any open shop panels update within a few seconds.

---

## 5. Thumbnails and CORS

The town draws pack images in the game canvas (WebGL). Browsers only allow that for images served with CORS. Today's product images are also 1254 px and about 400 KB each, too big for a 20 px sprite.

1. **Generate a 256 px WebP** next to each product image, e.g. `storage/products/thumbs/<name>.webp`. Do it when the image is uploaded (product observer) and once for existing products (Artisan command, below). [intervention/image](https://image.intervention.io/v3) works; if Cloudflare Image Resizing is on, a `/cdn-cgi/image/width=256,format=webp/...` URL works too.
2. **Allow the game origin** on those files. Nginx serves `/storage` directly, so add this to the site's server block:

```nginx
location ^~ /storage/products/thumbs/ {
    add_header Access-Control-Allow-Origin "https://town.gattchaaoripa.com" always;
    add_header Cache-Control "public, max-age=604800" always;
    try_files $uri =404;
}
```

(The `<img>` tags in the shop panels don't need CORS. Without it, only the little packs on the counters and machines stay empty.)

---

## 6. Laravel code (Laravel 11/12)

Adjust model and relation names to the project. They are written to match the fields the site already exposes (`current_price`, `custom_label`, `is_hot`, `is_closed`, `is_sold_out`, `category`, `image_path`).

### 6.1 `config/services.php`

```php
'town' => [
    'key' => env('TOWN_API_KEY'),
    'webhook_url' => env('TOWN_WEBHOOK_URL'),
    'webhook_secret' => env('TOWN_WEBHOOK_SECRET'),
    'origin' => env('TOWN_ORIGIN'),
],
```

### 6.2 `app/Http/Middleware/TownApiKey.php`

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class TownApiKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = (string) config('services.town.key');
        if ($key === '' || ! hash_equals($key, (string) $request->bearerToken())) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        return $next($request);
    }
}
```

Register the alias in `bootstrap/app.php`:

```php
->withMiddleware(function (Middleware $middleware) {
    $middleware->alias(['town' => \App\Http\Middleware\TownApiKey::class]);
})
```

### 6.3 `routes/api.php`

(Run `php artisan install:api` first if the project has no `routes/api.php` yet.)

```php
use App\Http\Controllers\Api\TownController;

Route::prefix('town/v1')->middleware(['town', 'throttle:120,1'])->group(function () {
    Route::get('catalog', [TownController::class, 'catalog']);
    Route::get('live', [TownController::class, 'live']);
    Route::post('tickets/redeem', [TownController::class, 'redeem']);
    Route::get('users/{userId}/listings', [TownController::class, 'listings'])->whereNumber('userId');
});
```

And in `routes/web.php` (the sign-in page players are sent to):

```php
use App\Http\Controllers\TownEnterController;

Route::get('town/enter', TownEnterController::class)->middleware('auth')->name('town.enter');
```

A "Play Gattchaa Town" button anywhere on the site can link to `route('town.enter')`: it signs the player straight into the town.

### 6.4 `app/Http/Controllers/Api/TownController.php`

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MarketplaceListing;
use App\Models\Product;
use App\Models\User;
use App\Support\Town;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class TownController extends Controller
{
    public function catalog(Request $request): JsonResponse
    {
        $payload = Cache::remember('town:catalog', 60, function () {
            $products = Product::query()
                ->with('category')
                ->where('is_closed', false)
                ->orderBy(/* same order as the homepage */ 'sort_order')
                ->get();

            return [
                'data' => $products->map(fn (Product $p) => Town::product($p))->values(),
                'updated_at' => now()->toIso8601String(),
            ];
        });

        return $this->withEtag($request, $payload);
    }

    public function live(Request $request): JsonResponse
    {
        $payload = Cache::remember('town:live', 10, fn () => [
            'data' => [
                'online' => /* same value as /site-activity online_count */ app(\App\Services\SiteActivity::class)->onlineCount(),
                'rooms' => /* rooms from the rooms.state logic */ app(\App\Services\RoomState::class)->openRooms()
                    ->map(fn ($room) => Town::room($room))->values(),
            ],
        ]);

        return $this->withEtag($request, $payload);
    }

    /** Swaps a one-time sign-in ticket (made by /town/enter) for the user it belongs to. */
    public function redeem(Request $request): JsonResponse
    {
        $ticket = (string) $request->input('ticket');
        // pull(): read once and delete, so a ticket can't be used twice.
        $userId = preg_match('/^[A-Za-z0-9_-]{16,128}$/', $ticket) ? Cache::pull("town:ticket:{$ticket}") : null;
        $user = $userId ? User::find($userId) : null;
        if (! $user) {
            return response()->json(['message' => 'Unknown or expired ticket.'], 404);
        }

        return response()->json(['data' => [
            'user_id' => $user->id,
            'display_name' => $user->name, // the public name the marketplace shows, never the email
        ]]);
    }

    /** A seller's active marketplace listings: what their player shop in town shows. */
    public function listings(Request $request, int $userId): JsonResponse
    {
        $payload = Cache::remember("town:listings:{$userId}", 30, fn () => [
            'data' => MarketplaceListing::query() // adjust to the marketplace's model and columns
                ->where('seller_id', $userId)
                ->where('status', 'active')
                ->latest()
                ->limit(60)
                ->get()
                ->map(fn (MarketplaceListing $l) => Town::listing($l))
                ->values(),
        ]);

        return $this->withEtag($request, $payload);
    }

    /** 304 when the game already has this exact data. */
    private function withEtag(Request $request, array $payload): JsonResponse
    {
        $etag = '"' . md5(json_encode($payload)) . '"';
        if (trim((string) $request->header('If-None-Match')) === $etag) {
            return response()->json(null, 304)->setEtag(trim($etag, '"'));
        }
        return response()->json($payload)->setEtag(trim($etag, '"'))->header('Cache-Control', 'private, max-age=0');
    }
}
```

`App\Services\SiteActivity` and `App\Services\RoomState` stand for wherever that logic lives today (probably the controllers behind `/site-activity` and `/rooms/state`). Move it into a small service so both the website and the Town API call the same code. Likewise, `MarketplaceListing`, `seller_id` and `status` stand for however the marketplace stores listings.

### 6.4b `app/Http/Controllers/TownEnterController.php`: the sign-in page

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/** "Play Gattchaa Town": sends the signed-in user to the town with a one-time ticket. */
class TownEnterController extends Controller
{
    public function __invoke(Request $request): RedirectResponse
    {
        $ticket = Str::random(48);
        Cache::put("town:ticket:{$ticket}", $request->user()->id, now()->addSeconds(60));

        // Only ever back to the town itself, never to an address taken from the request.
        return redirect()->away(rtrim((string) config('services.town.origin'), '/') . '/?ticket=' . $ticket);
    }
}
```

### 6.5 `app/Support/Town.php`: mapping and events in one place

```php
<?php

namespace App\Support;

use App\Jobs\SendTownWebhook;
use App\Models\Product;
use Illuminate\Support\Str;

class Town
{
    public static function product(Product $p): array
    {
        $price = (int) $p->current_price;
        return [
            'id' => $p->id,
            'slug' => $p->slug,
            'title' => $p->title,
            'category' => $p->category?->title ?? '',
            'type' => $p->type,
            'price' => $price,
            'original_price' => (int) $p->price > $price ? (int) $p->price : null,
            'label' => $p->custom_label ?: null,
            'is_hot' => (bool) $p->is_hot,
            'is_sold_out' => (bool) $p->is_sold_out,
            'image_url' => self::thumb($p->image_path),
            'url' => route('gacha.show', $p->slug),
        ];
    }

    /** $room: one entry of the rooms.state list (array or model). */
    public static function room($room): array
    {
        $room = (array) $room;
        $product = (array) $room['product'];
        return [
            'code' => $room['code'],
            'mode' => $room['mode'],
            'status' => $room['status'],
            'seats' => (int) $room['seats'],
            'taken_seats' => (int) $room['taken_seats'],
            'seat_price' => (int) $room['seat_price'],
            'cards_per_seat' => (int) $room['cards_per_seat'],
            'fill_expires_at' => $room['fill_expires_at'],
            'url' => route('gacha.show', $product['slug']) . '?mode=' . $room['mode'],
            'product' => [
                'slug' => $product['slug'],
                'title' => $product['title'],
                'image_url' => self::thumb($product['image_path']),
            ],
        ];
    }

    /** One marketplace listing, as a player's shop in town shows it. */
    public static function listing($l): array
    {
        return [
            'id' => $l->id,
            'title' => $l->title,
            'image_url' => $l->thumbnail_url, // a small (~256 px) image of the card
            'price' => (int) $l->price,
            'condition' => $l->condition ?: null, // "Near Mint"…
            'grade' => $l->grade ?: null,         // "PSA 10"… graded slabs only
            'category' => $l->category?->title,
            'url' => route('marketplace.show', $l), // where it's bought
        ];
    }

    /** products/foo.webp -> https://…/storage/products/thumbs/foo.webp */
    public static function thumb(?string $imagePath): string
    {
        if (! $imagePath) return '';
        $name = pathinfo($imagePath, PATHINFO_FILENAME);
        return asset("storage/products/thumbs/{$name}.webp");
    }

    /** Queue a webhook to the game. Safe to call anywhere; no-op when not configured. */
    public static function event(string $type, ?array $data = null): void
    {
        if (! config('services.town.webhook_url')) return;
        // Bust the API cache so the game's re-fetch sees the change.
        if ($type === 'catalog.updated') cache()->forget('town:catalog');
        if ($type === 'live.updated') cache()->forget('town:live');
        if ($type === 'listing.updated') cache()->forget("town:listings:{$data['user_id']}");

        SendTownWebhook::dispatch(array_filter([
            'id' => 'evt_' . Str::ulid(),
            'type' => $type,
            'created_at' => now()->toIso8601String(),
            'data' => $data,
        ], fn ($v) => $v !== null));
    }
}
```

### 6.6 `app/Jobs/SendTownWebhook.php`

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Http;

class SendTownWebhook implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 3;

    public function __construct(public array $event) {}

    public function backoff(): array
    {
        return [5, 30, 120];
    }

    public function handle(): void
    {
        $body = json_encode($this->event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $t = time();
        $sig = hash_hmac('sha256', "{$t}.{$body}", (string) config('services.town.webhook_secret'));

        Http::timeout(5)
            ->withHeaders(['X-Gattchaa-Signature' => "t={$t},v1={$sig}"])
            ->withBody($body, 'application/json')
            ->post(config('services.town.webhook_url'))
            ->throw(); // non-2xx -> retried
    }
}
```

Sign the **exact string you send**: encode once and send it with `withBody`. Don't pass an array to `->post()`, because it would be re-encoded and the signature would no longer match.

### 6.7 Where to fire the events

```php
// App\Observers\ProductObserver (register with #[ObservedBy] on Product, or in AppServiceProvider)
public function saved(Product $p): void   { Town::event('catalog.updated'); }
public function deleted(Product $p): void { Town::event('catalog.updated'); }

// Where a seat is taken / released, and where a room fills, resolves or expires:
Town::event('live.updated');

// App\Observers\MarketplaceListingObserver: any change to a listing (new, price, sold, removed).
public function saved(MarketplaceListing $l): void   { Town::event('listing.updated', ['user_id' => $l->seller_id]); }
public function deleted(MarketplaceListing $l): void { Town::event('listing.updated', ['user_id' => $l->seller_id]); }

// Where the site creates a purchase notification (what /site-activity returns):
Town::event('purchase.highlight', [
    'label' => $notification->label,          // e.g. "Big hit!"
    'message' => $notification->message,      // same masked text as the website toast
    'product' => [
        'title' => $product->title,
        'image_url' => Town::thumb($product->image_path),
        'url' => route('gacha.show', $product->slug),
    ],
]);
```

Make sure a queue worker is running (`php artisan queue:work`, via Supervisor). If the project still uses `QUEUE_CONNECTION=sync`, webhooks still work, but the site would wait up to 5 s on the game during checkout, so use a real queue.

### 6.8 Thumbnails: `app/Console/Commands/TownThumbnails.php`

```php
<?php

namespace App\Console\Commands;

use App\Models\Product;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Intervention\Image\Laravel\Facades\Image; // composer require intervention/image-laravel

class TownThumbnails extends Command
{
    protected $signature = 'town:thumbnails {--force}';
    protected $description = 'Create 256px WebP thumbnails used by Gattchaa Town';

    public function handle(): void
    {
        $disk = Storage::disk('public');
        Product::whereNotNull('image_path')->each(function (Product $p) use ($disk) {
            $out = 'products/thumbs/' . pathinfo($p->image_path, PATHINFO_FILENAME) . '.webp';
            if (! $this->option('force') && $disk->exists($out)) return;
            $img = Image::read($disk->path($p->image_path))->scaleDown(256, 256)->toWebp(82);
            $disk->put($out, (string) $img);
            $this->line("✓ {$out}");
        });
    }
}
```

Run it once (`php artisan town:thumbnails`), and call the same code from `ProductObserver::saved()` when `image_path` changed.

---

## 7. Testing it

```bash
# 1. Key required
curl -i https://gattchaaoripa.com/api/town/v1/catalog                      # 401
curl -s -H "Authorization: Bearer $KEY" https://gattchaaoripa.com/api/town/v1/catalog | head -c 400

# 2. ETag works (second call -> 304)
curl -si -H "Authorization: Bearer $KEY" https://gattchaaoripa.com/api/town/v1/live | grep -i etag
curl -si -H "Authorization: Bearer $KEY" -H 'If-None-Match: "<etag from above>"' https://gattchaaoripa.com/api/town/v1/live | head -1

# 3. CORS on thumbnails
curl -sI -H "Origin: https://town.gattchaaoripa.com" <an image_url> | grep -i access-control

# 4. Webhook end to end (from tinker)
php artisan tinker --execute="App\Support\Town::event('purchase.highlight', ['label'=>'Test','message'=>'Hello from Laravel'])"
# -> a toast + fireworks in town; the game logs 204. 401 = secret mismatch or server clock off by >5 min.

# 5. Sign-in: log in on the site, open /town/enter -> you land on the town with ?ticket=…
#    A ticket works once:
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"ticket":"<ticket from the address bar>"}' https://gattchaaoripa.com/api/town/v1/tickets/redeem   # 200, then 404

# 6. A seller's listings (what their shop shows)
curl -s -H "Authorization: Bearer $KEY" https://gattchaaoripa.com/api/town/v1/users/<user id>/listings | head -c 400
```

**Without Laravel**: this repo ships a mock that speaks exactly this contract: `npm run mock:gattchaa`. With `server/.env.development` pointing at it, the town fills with sample packs and rooms, and a signed "big hit" arrives every 40 s. Its `/town/enter` page lets you sign in as one of three pretend users (two sellers and a collector with nothing listed), and one seller's prices drop now and then (`listing.updated`). `scripts/mock-gattchaa.ts` is also a working reference for the signature code.

---

## 8. Later

With accounts linked, more is possible without changing the above. For example, `POST /api/town/v1/users/{id}/rewards` (API key) would let the game grant GP or cosmetics, for an event or a finished card album. Rewards should stay tied to the account (not tradeable), and all the rules about them stay on the Laravel side.
