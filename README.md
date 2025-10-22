<div align="center">

# 🚉 BVG Dashboard

**Beautiful, realtime departures for Berlin/Brandenburg**

<br/>

<img alt="Tech" src="https://img.shields.io/badge/CDN%20Only-Tailwind%20v4%20%2B%20daisyUI%20v5-14b8a6?style=for-the-badge"/>
<img alt="Data" src="https://img.shields.io/badge/Data-v6.bvg.transport.rest-3b82f6?style=for-the-badge"/>
<img alt="Mode" src="https://img.shields.io/badge/Themes-Light%20%E2%97%8F%20Dark-8b5cf6?style=for-the-badge"/>
<a href="https://bvg.tameraktas.de"><img alt="Live" src="https://img.shields.io/badge/Live%20Site-bvg.tameraktas.de-10b981?style=for-the-badge"/></a>

</div>

## ✨ Highlights

- **Fast stop search** with type‑ahead suggestions (Enter/click to select)
- **Nearby stops** via geolocation with distance display (when permitted)
- **Clean departures board** — mobile‑optimized, compact, and accessible
- **Time window tabs** (15m · 30m · 60m) with smooth sliding animation
- **Journey planner** — search routes between any two stops with real-time delay info and visual timeline
- **Live Radar** — real-time vehicle tracking on interactive map showing all vehicles from your 60-minute departure window
- **Line overview modal** — click any departure to see full route with stopovers
- **Smart delays** — visual indicators for late, early, or on-time departures
- **Optimized API calls** — visibility-based auto-refresh, client-side filtering, and caching
- **Dark/Light theme** toggle with persistence
- **Local storage** — remembers your stop, journey locations, and time window preferences
- **Pure HTML + JS + CSS** over CDNs — zero build tools, instant deployment

## 🚀 Quick Start

1) Download/clone this folder
2) Open `index.html` in your browser
3) Optional: serve locally for best results (geolocation typically requires HTTPS or `localhost`)

Tip: If your browser blocks location, click the 📍 button after granting permission or choose a stop via search.

## 🧭 Using the Dashboard

- **Search**: Type to search for a stop, then select from the dropdown (Enter or click)
- **Nearby**: Click the 📍 button to find and list stops near your location
- **Time window**: Select 15, 30, or 60 minutes — preference is saved automatically
- **Journey planner**: Use the "Journeys" tab to search routes between two stops with real-time delays and visual timeline
- **Radar**: Click the 🎯 Radar button to view live vehicle positions on an interactive map
- **View route**: Click on any departure to see the complete journey with all stopovers
- **Refresh**: Click the refresh button or wait for automatic 30-second updates
- **Theme**: Toggle light/dark mode in the top right — your choice persists across sessions

## 🧩 Data & Endpoints

Powered by **BVG Transport REST API v6** (`v6.bvg.transport.rest`)

- **Real-time departures** with delay information
- **Journey details** with complete stopover sequences
- **Live vehicle positions** via radar endpoint
- **Location-based search** for nearby transit stops
- **Comprehensive stop database** across Berlin/Brandenburg

## ⚙️ Behavior & Persistence

- **Auto-refresh**: 30-second interval (pauses when tab is hidden to save API calls)
- **Smart caching**: Fetches 60 minutes of data, filters client-side when switching time windows
- **LocalStorage persistence**:
  - Selected stop and station name
  - Time window preference (15/30/60 min)
  - Journey origin and destination (auto-restored when searching)
  - Theme choice (light/dark)
  - Current active view (Departures/Journeys/Settings)
- **Accessibility**: ARIA labels and semantic HTML throughout
- **Local time**: Updates every second in the footer

## 🔎 Troubleshooting

- **No departures**: ensure a stop is selected and the time window isn’t too short.
- **Geolocation**: most browsers require HTTPS or `localhost`. If blocked, use search.
- **Rate limiting**: the API may throttle excessive requests; keep the tab count modest.
- **Time format**: uses your browser’s locale.

## 📁 Project Structure

```
├── index.html      # Clean semantic HTML with accessibility attributes
├── styles.css      # External CSS with custom animations and theme styles
├── app.js          # Organized application logic with clear sections:
│                   #   - DOM utilities and constants
│                   #   - State management with caching
│                   #   - API integration and optimization
│                   #   - Search and geolocation features
│                   #   - Departure rendering and modal system
│                   #   - Journey planner with route visualization
│                   #   - Live radar with vehicle tracking
│                   #   - Theme management and persistence
└── README.md       # This file
```
---

## 🙌 Credits

**Data**: [BVG Transport REST API v6](https://v6.bvg.transport.rest) by [transport.rest](https://transport.rest)  
**Styling**: [Tailwind CSS v4](https://tailwindcss.com) + [daisyUI v5](https://daisyui.com)  
**Maps**: [Leaflet v1.9.4](https://leafletjs.com) with OpenStreetMap & CartoDB tiles  
**Icons**: Native emoji and Unicode characters

**Created by [Tamer Aktas](https://tameraktas.de)** • 2025