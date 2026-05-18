import { fetchRating, fetchMatches } from './api.js';
import { analyzeMatches } from './stats.js';
import { computePlayerPrimaryOpenings, classifyPlayerArchetype } from './analysis.js';
import { resolveCivNumber, sleep, formatHms, techDisplayName } from './utils.js';
import { initWebSocket } from './websocket.js';

const DEFAULT_PLAYER_ID = '8621659';
const LEADERBOARD = 'rm_1v1';
const PER_PAGE = 10;
const PAGES = 1;

let currentPlayerStats = null;
let isAnalyzingRival = false;

export async function initDashboard() {
  const params = new URLSearchParams(window.location.search);
  const playerId = params.get('player_id') || DEFAULT_PLAYER_ID;
  const container = document.getElementById('dashboard');
  container.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Cargando perfil...</div>';

  try {
    currentPlayerStats = await runSelfAnalysis(playerId);
    renderDashboard(currentPlayerStats);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="loading-state">Error cargando datos.</div>';
  }

  // Iniciar WebSocket para detectar partidas 1v1
  initWebSocket(playerId, 'self', async ({ matchData, rivalProfileId }) => {
    if (isAnalyzingRival) return;
    isAnalyzingRival = true;

    const banner = document.getElementById('live-match-banner');
    const rivalName = matchData.players.find(p => p.profileId === rivalProfileId)?.name || 'Rival';
    banner.querySelector('.live-match-vs').textContent = `vs ${rivalName}`;
    banner.classList.add('active');

    try {
      const rivalStats = await runSelfAnalysis(rivalProfileId);
      renderComparative(currentPlayerStats, rivalStats, rivalName);
    } catch (err) {
      console.error('Error analizando rival:', err);
    } finally {
      isAnalyzingRival = false;
    }
  });
}

async function runSelfAnalysis(playerId) {
  const playedCivNum = null;
  const opponentCivNum = null;

  let allMatches = [];
  let page = 1;

  while (page <= PAGES) {
    const pageMatches = await fetchMatches(playerId, LEADERBOARD, page, PER_PAGE);
    if (pageMatches.length === 0) break;

    const processed = pageMatches.map(m => {
      const profileTeamIndex = m.teams[0].players[0].profileId === parseInt(playerId) ? 0 : 1;
      const opponentTeamIndex = profileTeamIndex === 0 ? 1 : 0;
      return {
        match_id: m.matchId,
        map_name: m.mapName || null,
        player_name: m.teams[profileTeamIndex].players[0].name || null,
        player_civ: m.teams[profileTeamIndex].players[0].civName || null,
        opponent_civ: m.teams[opponentTeamIndex].players[0].civName || null,
        won: m.teams[profileTeamIndex].players[0].won || false,
        started: m.started || null,
        finished: m.finished || null,
      };
    }).filter(Boolean);

    allMatches.push(...processed);
    if (pageMatches.length < PER_PAGE) break;
    page++;
    await sleep(300);
  }

  if (allMatches.length === 0) {
    throw new Error('No se encontraron partidas.');
  }

  const dataMainPlayer = {
    player_id: playerId,
    match_id: 'self',
  };

  let stats = await analyzeMatches(allMatches, parseInt(playerId), playedCivNum, opponentCivNum, dataMainPlayer);
  stats.total_wins = allMatches.filter(m => m.won).length;
  stats.win_percent = stats.total ? Math.round(stats.total_wins * 100 / stats.total * 100) / 100 : 0;
  stats.player_id = playerId;
  stats.match_id = 'self';
  stats.rating = await fetchRating(playerId);
  stats.player_profile = computePlayerPrimaryOpenings(parseInt(playerId), stats.all_match_features || []);
  stats.archetype = classifyPlayerArchetype(stats);

  return stats;
}

// ============================================================================
// RENDER DASHBOARD
// ============================================================================

function renderDashboard(stats) {
  const container = document.getElementById('dashboard');

  // Header info
  const headerName = document.getElementById('header-name');
  const headerMeta = document.getElementById('header-meta');
  const headerBadge = document.getElementById('header-wr');
  const headerAvatar = document.getElementById('header-avatar');

  if (headerName) headerName.textContent = stats.player_name || 'Unknown';
  if (headerMeta) headerMeta.textContent = `Rating: ${stats.rating || '—'} · ${stats.analyzed} partidas analizadas`;
  if (headerBadge) {
    headerBadge.textContent = `${stats.win_percent || 0}% WR`;
    headerBadge.className = `wr-badge ${(stats.win_percent || 0) >= 50 ? 'good' : 'bad'}`;
  }
  if (headerAvatar) headerAvatar.textContent = (stats.player_name || '?').charAt(0).toUpperCase();

  let html = '';

  // Row 1: Opening + Quick Stats + Age Timings
  html += '<div class="grid grid-3">';
  html += renderOpeningCard(stats);
  html += renderQuickStatsCard(stats);
  html += renderAgeTimingsCard(stats);
  html += '</div>';

  // Row 2: Civs + Maps + Economy
  html += '<div class="grid grid-3">';
  html += renderCivsCard(stats);
  html += renderMapsCard(stats);
  html += renderEconomyCard(stats);
  html += '</div>';

  // Row 3: Techs + Market + Playstyle
  html += '<div class="grid grid-3">';
  html += renderTechsCard(stats);
  html += renderMarketCard(stats);
  html += renderPlaystyleCard(stats);
  html += '</div>';

  container.innerHTML = html;
}

// ============================================================================
// COMPARATIVE RENDER (Live Match)
// ============================================================================

function renderComparative(playerStats, rivalStats, rivalName) {
  const container = document.getElementById('comparative');
  if (!container) return;

  let html = '<div class="comparative-grid">';

  // Player column
  html += '<div class="card">';
  html += `<div class="comparative-header">
    <div>
      <div class="comparative-name">${playerStats.player_name}</div>
      <div class="comparative-rating">Rating: ${playerStats.rating || '—'}</div>
    </div>
    <div class="wr-badge ${(playerStats.win_percent || 0) >= 50 ? 'good' : 'bad'}">${playerStats.win_percent || 0}% WR</div>
  </div>`;
  html += renderMiniOpening(playerStats.player_profile);
  html += renderMiniStats(playerStats);
  html += '</div>';

  // Rival column
  html += '<div class="card">';
  html += `<div class="comparative-header">
    <div>
      <div class="comparative-name">${rivalStats.player_name || rivalName}</div>
      <div class="comparative-rating">Rating: ${rivalStats.rating || '—'}</div>
    </div>
    <div class="wr-badge ${(rivalStats.win_percent || 0) >= 50 ? 'good' : 'bad'}">${rivalStats.win_percent || 0}% WR</div>
  </div>`;
  html += renderMiniOpening(rivalStats.player_profile);
  html += renderMiniStats(rivalStats);
  html += '</div>';

  html += '</div>';
  container.innerHTML = html;
}

function renderMiniOpening(pp) {
  if (!pp) return '';
  const label = pp.primary_opening || 'N/A';
  const stability = Math.round((pp.opening_stability || 0) * 100);
  return `<div style="margin-bottom:12px;">
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Apertura principal</div>
    <div style="font-size:14px;font-weight:700;">${label}</div>
    <div style="font-size:11px;color:var(--text-secondary);">Estabilidad: ${stability}%</div>
  </div>`;
}

function renderMiniStats(stats) {
  return `<div class="stats-row" style="grid-template-columns:repeat(3,1fr);gap:8px;">
    <div class="stat-box"><div class="stat-label">Games</div><div class="stat-value">${stats.analyzed}</div></div>
    <div class="stat-box"><div class="stat-label">Wins</div><div class="stat-value green">${stats.total_wins || 0}</div></div>
    <div class="stat-box"><div class="stat-label">EAPM</div><div class="stat-value blue">${stats.avg_eapm || '—'}</div></div>
  </div>`;
}

// ============================================================================
// CARD BUILDERS
// ============================================================================

function renderOpeningCard(stats) {
  const pp = stats.player_profile;
  if (!pp) return '<div class="card"><div class="card-title">Apertura</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';

  const label = pp.primary_opening || 'N/A';
  const stability = Math.round((pp.opening_stability || 0) * 100);
  const cls = getOpeningClass(label);

  let html = '<div class="card">';
  html += '<div class="card-title">Apertura de Perfil</div>';
  html += `<div class="opening-badge ${cls}">${label}</div>`;
  html += `<div class="opening-meta">Estabilidad: <strong>${stability}%</strong></div>`;

  if (pp.per_opening_frequency && Object.keys(pp.per_opening_frequency).length > 0) {
    html += '<div class="opening-freq">';
    for (const [lbl, pct] of Object.entries(pp.per_opening_frequency)) {
      html += `<span class="opening-freq-item">${lbl} ${pct}%</span>`;
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function renderQuickStatsCard(stats) {
  return `<div class="card">
    <div class="card-title">Resumen</div>
    <div class="stats-row">
      <div class="stat-box"><div class="stat-label">Games</div><div class="stat-value">${stats.analyzed}</div></div>
      <div class="stat-box"><div class="stat-label">Wins</div><div class="stat-value green">${stats.total_wins || 0}</div></div>
      <div class="stat-box"><div class="stat-label">EAPM</div><div class="stat-value blue">${stats.avg_eapm || '—'}</div></div>
    </div>
  </div>`;
}

function renderAgeTimingsCard(stats) {
  const ages = ['feudal', 'castle', 'imperial'];
  const allTimes = [];
  for (const age of ages) {
    const p = stats['avg_' + age];
    const o = stats['opp_avg_' + age];
    if (p) allTimes.push(p);
    if (o) allTimes.push(o);
  }
  const maxTime = Math.max(...allTimes, 1);

  let html = '<div class="card">';
  html += '<div class="card-title">Age Timings</div>';

  for (const age of ages) {
    const pTime = stats['avg_' + age + '_hms'] || 'N/A';
    const oTime = stats['opp_avg_' + age + '_hms'] || 'N/A';
    const pSec = stats['avg_' + age];
    const oSec = stats['opp_avg_' + age];

    const pPct = pSec ? Math.min((pSec / maxTime) * 100, 100) : 0;
    const oPct = oSec ? Math.min((oSec / maxTime) * 100, 100) : 0;

    html += `<div class="age-row">
      <div class="age-label">${age}</div>
      <div class="age-bar-container"><div class="age-bar opponent" style="width:${oPct}%"></div></div>
      <div class="age-time">${oTime}</div>
    </div>`;
    html += `<div class="age-row" style="margin-top:-2px;margin-bottom:8px;">
      <div class="age-label" style="color:var(--accent-blue)">You</div>
      <div class="age-bar-container"><div class="age-bar player" style="width:${pPct}%"></div></div>
      <div class="age-time" style="color:var(--accent-blue)">${pTime}</div>
    </div>`;
  }

  html += '</div>';
  return html;
}

function renderCivsCard(stats) {
  const civs = stats.civ_played_percent || {};
  if (Object.keys(civs).length === 0) {
    return '<div class="card"><div class="card-title">Civilizaciones</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  let html = '<div class="card">';
  html += '<div class="card-title">Civilizaciones</div>';
  html += '<div class="civs-list">';
  for (const [civ, pct] of Object.entries(civs)) {
    html += `<span class="civ-pill">${civ} <span class="civ-pct">${pct}%</span></span>`;
  }
  html += '</div></div>';
  return html;
}

function renderMapsCard(stats) {
  const maps = stats.map_played_percent || {};
  if (Object.keys(maps).length === 0) {
    return '<div class="card"><div class="card-title">Mapas</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  const sorted = Object.entries(maps).sort((a, b) => b[1] - a[1]).slice(0, 6);
  let html = '<div class="card">';
  html += '<div class="card-title">Top Maps</div>';
  for (const [map, pct] of sorted) {
    const wr = stats.map_win_percent?.[map] ?? 0;
    const wrClass = wr >= 55 ? 'good' : wr <= 40 ? 'bad' : 'neutral';
    html += `<div class="map-row">
      <div class="map-name">${map}</div>
      <div class="map-play-pct">${pct}%</div>
      <div class="map-wr ${wrClass}">${wr}% WR</div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function renderEconomyCard(stats) {
  const wb = stats.wheel_barrow_avg;
  const hc = stats.hand_cart_avg;
  const tcAvg = stats.tc_post_castle_avg;
  const tcTime = stats.tc_post_castle_first_time_avg;

  if (wb == null && hc == null && tcAvg == null) {
    return '<div class="card"><div class="card-title">Economía</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  let html = '<div class="card">';
  html += '<div class="card-title">Economía</div>';
  if (wb != null) {
    html += `<div class="economy-row"><div class="economy-label">Wheelbarrow</div><div class="economy-value">${formatHms(wb)}</div></div>`;
  }
  if (hc != null) {
    html += `<div class="economy-row"><div class="economy-label">Hand Cart</div><div class="economy-value">${formatHms(hc)}</div></div>`;
  }
  if (tcAvg != null) {
    html += `<div class="economy-row">
      <div class="economy-label">TCs post-Castle</div>
      <div class="economy-value">${tcAvg.toFixed(1)} ${tcTime != null ? '(+' + formatHms(tcTime) + ')' : ''}</div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function renderTechsCard(stats) {
  const keyTechs = stats.key_techs || {};
  const entries = Object.entries(keyTechs);
  if (entries.length === 0) {
    return '<div class="card"><div class="card-title">Key Techs</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  // Juntar todas las techs y ordenar por frecuencia descendente
  const allTechs = entries.map(([name, data]) => ({ name, ...data }));
  allTechs.sort((a, b) => b.frequency - a.frequency);

  let html = '<div class="card">';
  html += '<div class="card-title">Key Techs</div>';
  html += '<div class="tech-list">';

  for (const tech of allTechs.slice(0, 12)) {
    const display = techDisplayName(tech.name);
    const time = tech.avg_time != null ? formatHms(tech.avg_time) : '';
    const maxFreq = allTechs[0].frequency || 100;
    const barWidth = maxFreq > 0 ? (tech.frequency / maxFreq) * 100 : 0;

    const catColors = {
      military: 'var(--accent-red)',
      economy: 'var(--accent-green)',
      naval: 'var(--accent-blue)',
      other: 'var(--text-muted)',
    };
    const color = catColors[tech.category] || 'var(--text-muted)';

    html += `<div class="tech-list-row">`;
    html += `<div class="tech-list-info">`;
    html += `<span class="tech-list-name">${display}</span>`;
    html += `<span class="tech-list-time">${time}</span>`;
    html += `</div>`;
    html += `<div class="tech-list-bar-track">`;
    html += `<div class="tech-list-bar" style="width:${barWidth}%;background:${color}"></div>`;
    html += `</div>`;
    html += `<div class="tech-list-freq">${Math.round(tech.frequency)}%</div>`;
    html += `</div>`;
  }

  html += '</div></div>';
  return html;
}

function renderMarketCard(stats) {
  const marketAvg = stats.market_avg_by_age || {};
  let hasAny = false;
  for (const age of ['feudal', 'castle', 'imperial']) {
    const avg = marketAvg[age];
    if (avg && (Object.keys(avg.buy || {}).length > 0 || Object.keys(avg.sell || {}).length > 0)) {
      hasAny = true;
      break;
    }
  }
  if (!hasAny) {
    return '<div class="card"><div class="card-title">Market</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  let html = '<div class="card">';
  html += '<div class="card-title">Uso del Mercado</div>';
  html += '<div style="display:flex;flex-direction:column;gap:10px;">';

  for (const age of ['feudal', 'castle', 'imperial']) {
    const avgByAge = marketAvg[age] || null;
    if (!avgByAge) continue;

    const buys = Object.keys(avgByAge.buy || {});
    const sells = Object.keys(avgByAge.sell || {});
    if (buys.length === 0 && sells.length === 0) continue;

    html += `<div style="display:flex;align-items:flex-start;gap:10px;">`;
    html += `<div style="width:56px;font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:capitalize;flex-shrink:0;padding-top:3px;">${age}</div>`;
    html += `<div style="flex:1;display:flex;flex-direction:column;gap:4px;">`;

    if (buys.length > 0) {
      html += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--accent-green);">`;
      html += `<span style="font-weight:600;">Compra</span>`;
      html += `<span style="color:var(--text-secondary);">${buys.join(', ')}</span>`;
      html += `</div>`;
    }
    if (sells.length > 0) {
      html += `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--accent-red);">`;
      html += `<span style="font-weight:600;">Vende</span>`;
      html += `<span style="color:var(--text-secondary);">${sells.join(', ')}</span>`;
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  html += '</div></div>';
  return html;
}

function renderPlaystyleCard(stats) {
  const arch = stats.archetype;
  if (!arch) {
    return '<div class="card"><div class="card-title">Playstyle</div><div style="font-size:12px;color:var(--text-muted);">Analizando...</div></div>';
  }

  const dims = arch.dimensions || {};
  const dimLabels = [
    { key: 'aggression', label: 'Aggression', color: 'var(--accent-red)' },
    { key: 'economy', label: 'Economy', color: 'var(--accent-green)' },
    { key: 'versatility', label: 'Versatility', color: 'var(--accent-purple)' },
    { key: 'lateGame', label: 'Late Game', color: 'var(--accent-blue)' },
    { key: 'speed', label: 'Speed', color: 'var(--accent-orange)' },
  ];

  const archetypeColors = {
    aggressive: 'var(--accent-red)',
    boomer: 'var(--accent-green)',
    onetrick: 'var(--accent-yellow)',
    versatile: 'var(--accent-purple)',
    balanced: 'var(--accent-blue)',
    imperial: 'var(--accent-orange)',
    cheese: 'var(--accent-red)',
    feudal_allin: 'var(--accent-red)',
    castle_pusher: 'var(--accent-orange)',
    macro: 'var(--accent-green)',
    turtle: 'var(--accent-blue)',
    ineffective: 'var(--text-muted)',
  };

  const color = archetypeColors[arch.primary] || 'var(--accent-blue)';

  let html = '<div class="card">';
  html += '<div class="card-title">Playstyle</div>';
  html += `<div class="archetype-badge" style="background:${color}15;color:${color};border-color:${color}30">${arch.title}</div>`;
  html += `<div class="archetype-desc">${arch.description}</div>`;

  if (arch.traits && arch.traits.length > 0) {
    html += '<div class="archetype-traits">';
    for (const trait of arch.traits) {
      html += `<span class="archetype-trait">${trait}</span>`;
    }
    html += '</div>';
  }

  html += '<div class="dimension-bars">';
  for (const dim of dimLabels) {
    const val = dims[dim.key] || 0;
    html += `<div class="dim-row">
      <div class="dim-label">${dim.label}</div>
      <div class="dim-bar-track"><div class="dim-bar-fill" style="width:${val}%;background:${dim.color}"></div></div>
      <div class="dim-value">${val}</div>
    </div>`;
  }
  html += '</div></div>';
  return html;
}

function getOpeningClass(label) {
  if (!label) return 'unknown';
  const l = label.toLowerCase();
  if (l.includes('drush')) return 'drush';
  if (l.includes('scout')) return 'scout_rush';
  if (l.includes('archer')) return 'archer_rush';
  if (l.includes('fast_feudal')) return 'fast_feudal_aggressive';
  if (l.includes('fast_castle') || l.includes('fc')) return 'fast_castle';
  if (l.includes('tower')) return 'tower_rush';
  return 'unknown';
}
