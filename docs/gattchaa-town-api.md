# Gattchaa Town API: blueprint for gattchaaoripa.com

This is what the Gattchaa Oripa (Laravel) project needs to build so Gattchaa Town can show live packs, rooms and big pulls. The town never scrapes or browses the website: it reads two small JSON endpoints and receives webhooks.

Players never call this API. Only the game server does, about **8 requests per minute in total**, however many people are in town. Unchanged responses are answered with `304 Not Modified`, which is nearly free.

```
 Browser (player) ──WebSocket──▶ Game server (Colyseus, VPS)
                                   │  ▲
         GET /api/town/v1/catalog  │  │  POST /hooks/gattchaa   (signed webhook)
         GET /api/town/v1/live     ▼  │
                                Gattchaa Oripa (Laravel)
```

Links the player clicks (product pages, daily login, marketplace…) open gattchaaoripa.com in a new tab, so login, payment and pulls stay on the real site.

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

---

## 2. Configuration

**Laravel `.env`**

```dotenv
TOWN_API_KEY=<long random string>          # php -r "echo bin2hex(random_bytes(32));"
TOWN_WEBHOOK_URL=https://town.gattchaaoripa.com/hooks/gattchaa
TOWN_WEBHOOK_SECRET=<another long random string>
TOWN_ORIGIN=https://town.gattchaaoripa.com  # where the game is hosted (for CORS on thumbnails)
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

Both endpoints:

- require `Authorization: Bearer <TOWN_API_KEY>` and return `401` otherwise;
- return `ETag`, and answer `304` when the request's `If-None-Match` matches;
- are cached server-side (`Cache::remember`) so even a burst costs one query;
- use `snake_case` fields and absolute URLs.

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

In town, `purchase.highlight` shows a toast to everyone, sets off fireworks over the fountain, makes the Town Crier shout it, and posts it in chat. **Use the same wording and masking as the website toast.** Never include a buyer's real name, email or anything private. The game shows `message` verbatim.

`catalog.updated` and `live.updated` carry no data: the game simply re-fetches (bursts are merged into one request).

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
});
```

### 6.4 `app/Http/Controllers/Api/TownController.php`

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
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

`App\Services\SiteActivity` and `App\Services\RoomState` stand for wherever that logic lives today (probably the controllers behind `/site-activity` and `/rooms/state`). Move it into a small service so both the website and the Town API call the same code.

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
```

**Without Laravel**: this repo ships a mock that speaks exactly this contract: `npm run mock:gattchaa`. With `server/.env.development` pointing at it, the town fills with sample packs and rooms, and a signed "big hit" arrives every 40 s. `scripts/mock-gattchaa.ts` is also a working reference for the signature code.

---

## 8. Later: link game accounts to Gattchaa accounts (optional)

This isn't needed for the above. It's the next step if you want GP rewards, cosmetics for purchases, or real names on the leaderboard:

1. A **"Play Gattchaa Town"** button on the site calls `POST /api/town/v1/tickets` (session-authenticated) and gets a one-time ticket that lasts 60 s.
2. The site opens `https://town.gattchaaoripa.com/?ticket=…`; the game sends the ticket when joining.
3. The game server calls `POST /api/town/v1/tickets/redeem` (API key) and gets back `{ user_id, display_name }`. The ticket is deleted, so it can't be reused.
4. Later endpoints like `POST /api/town/v1/users/{id}/rewards` (API key) let the game grant GP or cosmetics. All the rules stay on the Laravel side.
