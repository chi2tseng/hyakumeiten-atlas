# 百名店 Atlas — Architecture & Maintenance Guide

How the site is built, what every data field means, and exactly how to **update it**
(re-scrape, add a new 百名店 year, add restaurants) and **maintain** it over time.

> Live: <https://chi2tseng.github.io/hyakumeiten-atlas/> · Repo: `chi2tseng/hyakumeiten-atlas`
> Local working copy: `D:/Hyakumeiten/`

---

## 1. Architecture

A **static site** — no backend, no build step. GitHub Pages serves the files on `main`
directly. All logic runs in the browser.

```
index.html        Shell: top-nav, sidebar/bottom-sheet, #map, detail drawer, lightbox.
                  Loads Leaflet + markercluster (unpkg) and Google Fonts.
app.js            ALL app logic (see §2). Cache-busted with ?v=YYYYMMDD<letter>.
styles.css        Mistral-inspired design tokens + every style. Cache-busted.
i18n.js           Translation dictionaries + translateCat()/translatePref(). Cache-busted.
logo.svg          Nav wordmark (百名店 mark). favicon.svg = same mark, orange.
data/index.json   LIGHT index of ALL restaurants — loaded once on page load (§3).
data/d/NN.json    100 shards (by restaurant-id last 2 digits) with the HEAVY per-restaurant
                  data (reviews, photos, hours) — lazy-loaded when a detail opens.
.nojekyll         Tells GitHub Pages to serve files as-is (don't run Jekyll).
.claude/launch.json  Local preview server config (port 5602).
```

Third-party (CDN, pinned): Leaflet 1.9.4, leaflet.markercluster 1.5.3, OpenStreetMap
tiles, Google Fonts (Material Symbols Rounded + Cormorant Garamond + Inter + Noto Sans
JP/TC). No npm install needed to run — only the data scripts use Node.

### Data flow
1. Page load → `loadData()` fetches `data/index.json?v=DATA_VERSION` (≈4–5 MB, all
   restaurants, light fields). Everything on the map/list/filters comes from this.
2. Open a restaurant → `loadDetail(r)` fetches its shard `data/d/NN.json?v=DATA_VERSION`
   (NN = last 2 digits of the Tabelog id), merges `rv`/`ph`/`bh` onto the record, re-renders.
3. Shards are cached in-memory per session (`DETAIL_CACHE`).

### app.js — what lives where
- **Smooth wheel zoom** — `L.Map.SmoothWheelZoom` handler (top of file). Stepless zoom via
  per-frame `map._move` (CSS-transforms tiles, no reload mid-gesture); reloads once at the
  end. Tune speed with `smoothSensitivity` in `initMap()`.
- **Markers** — `customPin(r)` builds a teardrop divIcon with the category's Material Symbol
  (`categoryIcon()` maps the JP genre → icon name).
- **Mobile bottom sheet** — `setupMobileSheet()`: nested-scroll, snap states. `sheetHeights()`
  returns `collapsed`/`peek`/`full`; list peek = 25vh, detail peek = 52vh. Google-Maps feel.
- **Detail panel** — `openDetail()` + `renderDetail()`. Order: name → rating·category·price →
  hours → photo strip → address/info (+ full-week hours) → Google Maps/Tabelog → reviews.
- **Business hours** — `renderHoursTop()` (status + 營業至/營業開始 time, JST) and
  `renderHoursWeek()` (full week). Reads `bh`.
- **Centering** — `centerInView()` offsets the map by the current sheet height so the
  located pin / blue dot lands in the visible strip above the sheet.

### Cache-busting (IMPORTANT)
- Assets (css/js/i18n/logo/favicon): the `?v=YYYYMMDD<letter>` query in `index.html`.
- Data (index.json + shards): the `DATA_VERSION` constant at the top of `app.js`.
**Bump both whenever you change code or data**, or returning visitors get stale files.

---

## 2. Deploy

```bash
git add -A
git commit -m "..."
git push origin main          # GitHub Pages redeploys in ~1 min
```
Standing approval: pushes to `chi2tseng/hyakumeiten-atlas` don't need to be asked about.

Local preview: `py -m http.server 5602` in `D:/Hyakumeiten/` → <http://localhost:5602/>
(or use the Claude preview server named `hyakumeiten-atlas`).

---

## 3. Data schema

### `data/index.json` — array of restaurant records (the light index)
| key | meaning | example |
|----|----|----|
| `n` | name (JP) | `"葉隠うどん"` |
| `p` | prefecture (JP kanji) | `"福岡"` |
| `a` | address (JP) | `"福岡県福岡市..."` |
| `c` | genre(s), `/`-joined | `"うどん"` / `"寿司/日本料理"` |
| `y` | award years won, `,`-joined | `"2024,2026"` |
| `w` | number of award years (= `y`.length) | `2` |
| `d` | dinner budget (raw JP text) | `"￥1,000～￥1,999"` |
| `l` | lunch budget (raw JP text) | `"～￥999"` |
| `dl` | dinner budget lower bound (number) — drives the budget filter | `1000` / `null` |
| `r` | Tabelog rating | `"3.72"` |
| `u` | canonical Tabelog URL (ends `/{id}/`) | `"https://tabelog.com/.../46000812/"` |
| `lat`,`lng` | coordinates | `33.59, 130.42` |
| `cv` | cover photo URL | `"https://tblg.k-img.com/.../...jpg"` |
| `rsv` | reservation raw text (JP) | `"予約可"` / `"予約不可"` |
| `rs` | reservation status: `net` (online) · `phone` · `no` | `"net"` |

The restaurant **id** = the trailing number of `u` (`tabelogId()`), and the shard for it is
`data/d/` + last-2-digits + `.json`.

### `data/d/NN.json` — `{ "<id>": { rv, ph, bh } }` (heavy, lazy)
| key | meaning |
|----|----|
| `rv` | reviews: `[{ t:title(JP), b:body(JP), r:rating, d:date, tz?,bz?:zh, te?,be?:en }]` |
| `ph` | gallery photo URLs (≤20, `640x640_rect_{hash}.jpg` format) |
| `bh` | business hours per day: `{ 月,火,水,木,金,土,日,祝? }`, each `"11:00 - 22:00"` (multiple ranges space-separated) or `"定休日"` |

### Photo URL formats (Tabelog CDN `tblg.k-img.com`)
- ✅ `…/restaurant/images/Rvw/{id}/640x640_rect_{hash}.jpg` — **use this** (stable, 200).
- ✅ `…/resize/640x640c/…/{hash}.jpg?token=…&api=v2` — works but the token can expire.
- ❌ `…/640x640_square_{hash}.jpg` — **DEAD format** (Tabelog retired it → 404). Never store.
- `onerror` handlers in the UI drop any image that fails, so a stray dead URL just disappears.

---

## 4. Scripts (run with Node in `D:/Hyakumeiten/`)

| script | what it does | output |
|----|----|----|
| `build-data.js` | Rebuild `index.json` + shards from a raw scrape. **Dedups by id** (canonicalizes URLs, strips `/dtlrvwlst/` etc., picks the cleanest, **merges award years/`w`**), carries review translations forward from old shards. | `data/index.json`, `data/d/*.json` |
| `scrape-hours.js` | Scrape 営業時間 from each page's JSON-LD FAQ → `bh` in shards. Resumable via `data/_hours.json`. ~89% have structured hours. | shards `bh` |
| `scrape-photos.js` | For restaurants with **zero photos**, pull `640x640_rect` review photos → `cv` (index) + `ph` (shards). Resumable via `data/_photos.json`. | `index.json` `cv`, shards `ph` |
| `split-reviews.js` → `wf-translate.js` / `translate-reviews.js` → `merge-reviews.js` | Review zh/en translation pipeline (Sonnet). **Currently on hold.** Writes `tz/bz/te/be` into `rv`. | shards `rv.*` |

Resumable scrapers store progress in `data/_*.json` (git-ignored). **Delete that file to force
a full re-scrape**; otherwise a re-run only retries what's missing.

Scraper request shape (all scripts): `https.get` with a desktop Chrome `User-Agent` +
`Accept-Language: ja`. **Use GET, not HEAD** (Tabelog answers HEAD with 400). Concurrency ~10,
retry once, ~89–94% of pages are live (the rest are 404 = delisted restaurants).

---

## 5. How to UPDATE — add the next 百名店 year / new restaurants

Tabelog publishes new 百名店 lists each year (e.g. `ラーメン 百名店 2027`). To add them:

1. **Collect the new award URLs.** For each award category's list page, scrape the restaurant
   links + the year/category they won. (The original nationwide listing scrape lived in the
   `/SIPs`-style Playwright tooling; any scraper that yields `{url, award, year}` works.)
2. **Scrape each restaurant's detail.** For every NEW url (one not already in `index.json`),
   capture the fields in §3 — see the rules below for exactly what and how.
3. **Merge, don't duplicate.** A restaurant can win multiple categories/years → it must stay
   **one record**. Keyed by id (`tabelogId(url)`). Append the new year to `y`, bump `w`,
   union the genres into `c`. `build-data.js` already does this dedup/merge — feed it the
   combined raw scrape (old + new) and re-run it.
4. **Backfill heavy data** for the new ids: `node scrape-hours.js` and `node scrape-photos.js`
   (both skip ids already done). Reviews come from the detail scrape.
5. **Ship it.** Bump `DATA_VERSION` in `app.js` **and** the `?v=` on assets in `index.html`,
   then commit + push. Open the live site, open a couple of the new restaurants, confirm
   photos/hours/reviews render.

### New-restaurant data rules — what to capture and how
| field | how to get it |
|----|----|
| id | trailing number of the canonical url (`/A####/A######/{id}/`) — strip any `/dtlrvwlst/`, `/dtlphotolst/`, query, etc. first |
| `u` | the **canonical** url (`tabelog.com/{pref}/A####/A######/{id}/`), trailing slash |
| `n`,`a`,`r` | name / address / rating from the page header (or JSON-LD `Restaurant`) |
| `c` | genre tags, joined with `/`. Keep the **short** Tabelog form (`アジア`, `ステーキ`, `和菓子`) — those are the keys `i18n.js` translates |
| `d`,`l`,`dl` | dinner/lunch budget text; `dl` = parsed lower-bound integer of the dinner range (for the filter) |
| `lat`,`lng` | from the page map data |
| `rsv`,`rs` | reservation: detect the **net-booking** widget (`.rstdtl-side-yoyaku__action.is-yoyaku-booking` / `js-show-yoyaku-modal-trigger`) → `rs:"net"`; phone-only → `"phone"`; none → `"no"`. (The global "ネット予約" nav link is on every page — ignore it.) |
| `cv`,`ph` | `640x640_rect_{hash}.jpg` review photos (see `scrape-photos.js`); `cv` = first, `ph` = up to 20 |
| `bh` | from the JSON-LD `FAQPage` answer to 「営業時間・定休日」 (see `scrape-hours.js`) |
| `y`,`w` | the award year(s) and count from step 1 |
| `rv` | top reviews: `{t,b,r,d}` (title, body, rating, date) |

### New genre? add a translation
If a new genre string appears, add it to `CAT_I18N` in `i18n.js` (zh/en/ja) so it isn't
shown raw. Quick check: compare the distinct `c` values in the data against `CAT_I18N` keys.

---

## 6. Routine maintenance checklist

- **Any data or code change → bump caches** (`DATA_VERSION` in `app.js` + `?v=` in
  `index.html`). This is the #1 cause of "my fix isn't showing".
- **Re-scrape hours occasionally** — hours change. `node scrape-hours.js` (delete
  `data/_hours.json` first for a full refresh).
- **Backfill photos** — `node scrape-photos.js` picks up any restaurant still at zero photos.
- **Dead images** — only ever store `640x640_rect_` (or token `resize`) photo URLs; never the
  `640x640_square_` format (404). The UI's `onerror` hides any that slip through.
- **Verify the render, not just the JSON** — after a data change, actually open the site and a
  detail page; confirm photos, hours (open/closed badge), and reviews display.
- **Delisted restaurants** (~6%) return 404 on Tabelog — they keep whatever data they had; no
  photos/hours is expected for them.
