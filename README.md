# 百名店 Atlas · Tabelog Hyakumeiten

Interactive map of Tabelog's 「百名店」(Top-100 Selection) restaurants across Japan, 2017–2026.

**Live:** <https://chi2tseng.github.io/hyakumeiten-atlas/>

## Features
- 🗺 **Leaflet map** of **10,067** award-winning restaurants nationwide (deduped from ~12,280 award entries — a shop can win multiple years/genres)
- 🧭 **Stepless smooth wheel zoom** (desktop) + Google-Maps-style mobile bottom sheet
- 🔍 **Filter** by prefecture, genre, dinner budget, rating, reservation
- 📍 **Geolocation** — find nearby award-winning restaurants (pin/dot centered above the sheet)
- 🕒 **Business hours** — today's open/closed status (JST) + full week
- 🖼 **Photos** with a swipeable strip + lightbox · 💬 top reviews from Tabelog
- 🏷 **Category pins** — each pin shows its genre's icon
- 🌐 **i18n** — 中文 / English / 日本語

## Stack
- Vanilla HTML/CSS/JS (no build step), served statically from GitHub Pages
- Leaflet 1.9.4 + Marker Cluster · OpenStreetMap tiles
- Google Fonts (Material Symbols, Cormorant Garamond, Inter, Noto Sans JP/TC)
- Design language inspired by **Mistral.ai**

## Data
- Source: [tabelog.com](https://tabelog.com) 「百名店」program (2017–2026)
- `data/index.json` = light index (all restaurants); `data/d/NN.json` = lazy per-restaurant shards (reviews, photos, hours)

## Local dev
```bash
py -m http.server 5602      # then open http://localhost:5602/
node build-data.js          # rebuild data/ after a fresh scrape
```

## Maintenance & updates
See **[MAINTENANCE.md](MAINTENANCE.md)** — architecture, full data schema, every scraper
script, and the exact steps to add the next 百名店 year / new restaurants.

## Deploy
Push to `main` → GitHub Pages redeploys (~1 min). Remember to bump `DATA_VERSION` (`app.js`)
and the `?v=` asset query (`index.html`) so caches refresh.

## Disclaimer
Unofficial tool for discovery / research only. Refer to [Tabelog](https://tabelog.com) for authoritative information.
