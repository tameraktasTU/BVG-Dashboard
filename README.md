<div align="center">

# 🚉 BVG Departures Dashboard

Beautiful, realtime departures for Berlin/Brandenburg — no build step, just open the file.

<br/>

<img alt="Tech" src="https://img.shields.io/badge/CDN%20Only-Tailwind%20v4%20%2B%20daisyUI%20v5-14b8a6?style=for-the-badge"/>
<img alt="Data" src="https://img.shields.io/badge/Data-v6.bvg.transport.rest-3b82f6?style=for-the-badge"/>
<img alt="Mode" src="https://img.shields.io/badge/Themes-Light%20%E2%97%8F%20Dark-8b5cf6?style=for-the-badge"/>

</div>

## ✨ Highlights

- Fast stop search with type‑ahead (Enter/click to select)
- Nearby stops via geolocation (when permitted)
- Clean departures board, mobile‑optimized and compact
- Time window tabs: 10m · 20m · 30m · 45m · 60m
- Dark/Light theme toggle with persistence
- Sticky footer with API source and local time
- Pure HTML + JS + CSS over CDNs — zero tooling

## 🚀 Quick Start

1) Download/clone this folder
2) Open `index.html` in your browser
3) Optional: serve locally for best results (geolocation typically requires HTTPS or `localhost`)

Tip: If your browser blocks location, click the 📍 button after granting permission or choose a stop via search.

## 🧭 Using the Dashboard

- Search: search for a stop, then pick a result.
- Nearby: use the 📍 button to list nearby stops.
- Time window: click a tab to change the horizon (10–60 minutes).
- Refresh: press the Refresh button or wait for the 30s auto‑refresh.
- Theme: toggle light/dark in the top right. Your choice is remembered.

## 🧩 Data & Endpoints

Powered by `v6.bvg.transport.rest`.

## ⚙️ Behavior & Persistence

- Auto‑refresh interval: 30 seconds (fixed)
- Selected stop persists via `localStorage`
- Theme persists via `localStorage`
- Local time updates every second

## 🔎 Troubleshooting

- “No departures”: ensure a stop is selected and the time window isn’t too short.
- Geolocation: most browsers require HTTPS or `localhost`. If blocked, use search.
- Rate limiting: the API may throttle excessive requests; keep the tab count modest.
- Time format: uses your browser’s locale.

## 📁 Project Structure

- `index.html` — UI, Tailwind/daisyUI via CDN, layout and components
- `app.js` — data fetching, rendering, state, theming, timers

## 🙌 Credits

Data by `transport.rest`. Crafted with Tailwind CSS + daisyUI.

Created by Tamer Aktas • 2025

