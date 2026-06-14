# 百名店 Atlas · Tabelog Hyakumeiten

Interactive map of Tabelog's 「百名店」(Top-100 Selection) restaurants across Japan from 2017–2026.

## Features
- 🗺 **Leaflet map** with 12,280 restaurants nationwide
- 🔍 **Filter** by prefecture, genre, dinner budget, rating
- 📍 **Geolocation** — find nearby award-winning restaurants
- 🌐 **i18n** — 中文 / English / 日本語
- 💬 **Customer reviews** scraped from Tabelog (top 3 per restaurant)
- 🎨 Design language inspired by **Mistral.ai**

## Stack
- Vanilla HTML/CSS/JS
- Leaflet + Marker Cluster
- OpenStreetMap tiles
- Google Fonts (Cormorant Garamond + Inter + Noto Sans JP)

## Data Sources
- [tabelog.com](https://tabelog.com) 「百名店」program (2017–2026)
- Scraped with Playwright (see `D:/SIPs/tabelog-*.js`)

## Local dev
```bash
# 1. Rebuild data after fresh Tabelog scrape
node build-data.js

# 2. Serve locally
python -m http.server 8000
# open http://localhost:8000
```

## Deploy
GitHub Pages from `main` branch.

## Disclaimer
Unofficial tool for discovery / research only. Please refer to [Tabelog](https://tabelog.com) for authoritative information.
