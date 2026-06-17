# AoE2 Rival Stats Analyzer — Project Guidelines for AI

## Project Identity
- **Name:** AoE2 Rival Stats Analyzer (Rival Stats Analyzer)
- **Type:** Static SPA (Single Page Application) for GitHub Pages
- **Purpose:** Age of Empires II match analysis overlay showing player performance metrics, opening classification, civ/map preferences, and real-time match tracking via WebSocket.
- **Source data:** AoE2 Companion public APIs (`data.aoe2companion.com` and `socket.aoe2companion.com`)

## Architecture (inviolable)
This is a **zero-backend, pure client-side application**. There is NO server, NO build step, NO framework, NO npm dependencies.

```
rival-stats-analizer/
├── index.html          # Entry point
├── ws.html             # WebSocket-only monitor page
├── css/
│   └── style.css       # All styles
├── data/
│   ├── civilizations.json  # Static civ name→number lookup (45 civs)
│   ├── knowledge_base.json # Static civ archetypes and strategic context (official + pre-Columbian regional civs)
│   └── i18n.json           # UI translations (en/es)
└── js/
    ├── app.js          # Main orchestrator
    ├── api.js          # HTTP fetch wrappers (with cache integration)
    ├── analysis.js     # Core engine (features, openings, baselines)
    ├── stats.js        # Match aggregation
    ├── render.js       # DOM overlay builder (auto-hide after 12s)
    ├── websocket.js    # WebSocket for ongoing matches
    ├── cache.js        # IndexedDB local cache (matches, analysis, profiles)
    ├── utils.js        # Helpers
    ├── i18n.js         # Language detection and translations
    └── insights.js     # Data-driven insight generator
```

## Technology constraints (NEVER violate)
1. **NO frameworks** — No React, Vue, Svelte, Angular, jQuery, etc. Pure vanilla JS only.
2. **NO build tools** — No webpack, vite, babel, npm, node_modules, package.json, etc.
3. **NO server-side code** — No PHP, Node servers, Express, etc. Files are served as-is by GitHub Pages.
4. **NO external CSS/JS libraries** — No CDN imports. Everything is self-contained in the repo.
5. **NO TypeScript** — Plain `.js` files only.
6. **ES modules allowed** (`type="module"`) — modern browsers support them.
7. **All API calls go directly to AoE2 Companion** — No proxy, no middleware. The API returns `access-control-allow-origin: *` (CORS open).

## URL parameters (query string based)
All configuration comes from URL query parameters:

| Parameter | Default | Description |
|---|---|---|
| `player_id` | (required) | Profile ID to analyze |
| `matchId` | — | If `self`, triggers profile analysis mode (10 pages). Otherwise a specific match ID. |
| `rivalProfileId` | — | Rival profile ID for comparison |
| `played_civilization` | — | Filter by civilization name (e.g. `Franks`) |
| `opponent_civ` | — | Filter opponent by civilization name |
| `leaderboard` | `rm_1v1` | Leaderboard type |
| `pages` | `1` | Number of pages to fetch |
| `per_page` | `10` | Matches per page |
| `ongoing` | `false` | If `true`, filter to finished matches only |
| `lang` | (auto) | Force UI language: `es` or `en`. Overrides IP/browser detection |

## Core business logic (must be preserved)

### Opening classification (rule-based scoring)
- **drush**: militia_by_feudal >= 2 (+0.6), barracks <= 480s (+0.25). Threshold: >= 0.6
- **scout_rush**: t_first_stable <= 660s (+0.4), scouts_by_early >= 2 (+0.5), >= 3 scouts (+0.2 bonus). Threshold: >= 0.7
- **archer_rush**: t_first_archery_range <= 720s (+0.4), archers >= 3 (+0.45), archer/villager ratio >= 0.08 (+0.15). Threshold: >= 0.6
- **fast_feudal_aggressive**: t_feudal <= p25 baseline (+0.6), total_military > baseline+IQR (+0.4). Threshold: >= 0.6
- **fast_castle**: t_castle <= p25 baseline (+0.6), low military <= 3 (+0.2), 2+ TCs before 15min (+0.2). Threshold: >= 0.6
- **tower_rush**: t_first_watch_tower <= 900s (+0.6). Threshold: >= 0.6
- Unknown if no opening meets threshold → fallback `Standard/Unknown`

### Player profile (self mode)
- Counts openings across all analyzed matches.
- `primary_opening` = most frequent opening.
- `opening_stability` = frequency of primary / total.
- `per_opening_frequency` = percentage for each opening.

### Metrics computed
- WR% (win rate), total wins, total analyzed, skipped
- Average EAPM, % prefer random
- Best map (most wins), map play%, map WR%
- Average age times (feudal/castle/imperial) for player and opponent
- Most played civilizations with percentages (min 2 games to show)
- Market buys/sells per age (top 4 resources, averages)
- Top 5 most frequent techs per age with average research time
- Wheelbarrow/Hand Cart average research time
- Player name, rating

## API endpoints used
- `GET https://data.aoe2companion.com/api/profiles/{player_id}` — player rating
- `GET https://data.aoe2companion.com/api/matches?profile_ids=&leaderboard_ids=&page=&per_page=&direction=forward` — match list
- `GET https://data.aoe2companion.com/api/matches/{matchId}/analysis?language=es` — match analysis JSON
- `wss://socket.aoe2companion.com/listen?handler=ongoing-matches&profile_ids={player_id}` — live match events

## Internationalization

- Language detection order: `?lang=` URL parameter → `localStorage` (`aoe2-lang`) → IP geolocation via `https://ipapi.co/json/` → `navigator.language`.
- Supported languages: `en`, `es`.
- All UI text, tooltips, and insight messages are translated via `js/i18n.js` and `data/i18n.json`.
- Static strings must not be hard-coded in render functions; use `t('key')`.

## Insights engine

- `js/insights.js` generates data-driven conclusions from aggregated match stats (`js/stats.js`).
- Insights must be anchored to real player behavior (units produced, win/loss differentials, timings, matchups) rather than civ archetypes from `knowledge_base.json`.
- `knowledge_base.json` is used only as **context** (e.g., "although Vietnamese can go archers/elephants, this player's actual signature is...").
- Unit effectiveness insights (strength/weakness) require the unit to represent at least 5% of the player's total army in addition to sample-size and win-rate thresholds.
- Each insight card includes a tooltip explaining the metric and sample size.

## AI session rules (READ FIRST before any work)
1. This is a **static site for GitHub Pages**. Never add server-side code, build tools, or npm packages.
2. All logic lives in `.js` files under `/js/`. All styles in `/css/style.css`. All data in `/data/`.
3. Use ES modules (`export`/`import`) for code organization.
4. When adding features: add logic to the appropriate JS module, never to HTML inline.
5. When debugging: check browser console. There is no server-side logging.
6. CSS should remain in `style.css`, not inline.
7. The overlay UI design (dark panel, right side, fixed position) is part of the project identity — preserve its visual character.
8. All civilization lookups use `data/civilizations.json`.
9. API calls must include the User-Agent header: `eduardr10-stats-script`.
10. This file is the source of truth. Future AIs should read it first.

## Browser compatibility
- Target: modern browsers (Chrome, Firefox, Edge, Safari) — ES2020+
- `fetch()`, `WebSocket`, ES modules, `URLSearchParams`, `localStorage`, `Set`, `Array.from`, arrow functions, template literals are all supported.

## Base path detection
The app must auto-detect its base path to work both locally (file:// or http://localhost) and on GitHub Pages (https://user.github.io/rival-stats-analizer/). The WS page URL must be constructed dynamically.

## Local cache (IndexedDB)
The app caches all API responses in IndexedDB to avoid redundant requests:
- **Match lists** (`cache.js` → `matches` store): TTL 30 minutes
- **Match analysis** (`cache.js` → `analysis` store): TTL 24 hours
- **Player profiles** (`cache.js` → `profile` store): TTL 5 minutes

`api.js` checks cache before making any fetch. If cached data exists and is not expired, it returns the cached version. The cache is cleared via the "Limpiar cache" button.

## Overlay behavior
The overlay auto-hides after 12 seconds (fade-out). The "Toggle" button can show/hide it manually at any time. This is intentional for streaming — it appears, shows data, then disappears so it doesn't block the game view.
