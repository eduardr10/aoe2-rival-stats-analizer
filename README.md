# AoE2 Rival Stats Analyzer

Análisis de partidas de Age of Empires II para streaming y dashboard personal.

## URLs

### Streaming Overlay (para OBS)
`https://TU_USUARIO.github.io/rival-stats-analizer/`

El overlay muestra 4 slides rotativas con:
- Header (nombre, rating, WR%)
- Apertura de perfil + Age timings
- Civilizaciones + Mapas + Economy upgrades
- Key techs + Market activity
- Playstyle (arquetipo + dimensiones)

Se oculta automáticamente después del ciclo. Botón **Toggle** para mostrarlo de nuevo.

### Dashboard
`https://TU_USUARIO.github.io/rival-stats-analizer/dashboard.html`

Dashboard responsive (PC y móvil) que muestra todo el análisis en una sola vista sin slides.
Detecta automáticamente partidas 1v1 en curso vía WebSocket y muestra análisis comparativo contra el rival.

## Parámetros URL

| Parámetro | Default | Descripción |
|---|---|---|
| `player_id` | `8621659` | Tu ID de perfil en AoE2 Companion |
| `matchId` | `self` | `self` = análisis de perfil. ID específico = partida concreta |
| `rivalProfileId` | — | ID del rival (para comparativo) |
| `leaderboard` | `rm_1v1` | Tipo de leaderboard |
| `pages` | `1` | Páginas de partidas a analizar |

## Características

- **Sin backend** — SPA pura, sirve desde GitHub Pages
- **Sin frameworks** — Vanilla JS, CSS puro
- **Cache local** — IndexedDB con TTL (30min listas, 24h análisis)
- **WebSocket** — Detección de partidas en curso en tiempo real
- **Clasificación de aperturas** — Drush, scout rush, archer rush, fast castle, tower rush
- **Arquetipos de jugador** — 12 tipos distintos basados en métricas reales

## Estructura

```
├── index.html          # Overlay streaming
├── dashboard.html      # Dashboard responsive
├── ws.html             # Monitor WebSocket
├── css/
│   ├── style.css       # Estilos overlay
│   └── dashboard.css   # Estilos dashboard
├── data/
│   └── civilizations.json
└── js/
    ├── app.js          # Orchestrator overlay
    ├── dashboard.js    # Orchestrator dashboard
    ├── api.js          # HTTP fetch + cache
    ├── analysis.js     # Motor de análisis
    ├── stats.js        # Agregación de stats
    ├── render.js       # Builder overlay
    ├── websocket.js    # WebSocket live matches
    ├── cache.js        # IndexedDB
    └── utils.js        # Helpers
```

## API

- `data.aoe2companion.com/api/profiles/{id}`
- `data.aoe2companion.com/api/matches`
- `data.aoe2companion.com/api/matches/{id}/analysis`
- `wss://socket.aoe2companion.com/listen`

## Desarrollo

No requiere build step. Abre `index.html` directamente en navegador o usa cualquier servidor estático.
