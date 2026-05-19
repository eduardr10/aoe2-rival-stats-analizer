import { fetchRating, fetchMatches } from './api.js';
import { analyzeMatches } from './stats.js';
import { computePlayerPrimaryOpenings, classifyPlayerArchetype } from './analysis.js';
import { resolveCivNumber, sleep, formatHms, techDisplayName } from './utils.js';
import { initWebSocket } from './websocket.js';

const DEFAULT_PLAYER_ID = '8621659';
const PER_PAGE = 10;
const PAGES = 1;

let currentPlayerStats = null;
let isAnalyzingRival = false;
let currentRivalId = null;
let currentRivalName = null;

function readControls() {
  const params = new URLSearchParams(window.location.search);
  return {
    playerId: params.get('player_id') || DEFAULT_PLAYER_ID,
    pages: parseInt(params.get('pages') || '1'),
    perPage: parseInt(params.get('per_page') || '10'),
    leaderboard: params.get('leaderboard') || '',
    dateFrom: params.get('date_from') || '',
    dateTo: params.get('date_to') || '',
  };
}

function syncControlsToURL() {
  const url = new URL(window.location.href);
  const ladder = document.getElementById('ctrl-ladder')?.value || '';
  const dateFrom = document.getElementById('ctrl-date-from')?.value || '';
  const dateTo = document.getElementById('ctrl-date-to')?.value || '';

  if (ladder) url.searchParams.set('leaderboard', ladder);
  else url.searchParams.delete('leaderboard');

  if (dateFrom) url.searchParams.set('date_from', dateFrom);
  else url.searchParams.delete('date_from');

  if (dateTo) url.searchParams.set('date_to', dateTo);
  else url.searchParams.delete('date_to');

  window.history.replaceState({}, '', url.toString());
  return readControls();
}

function syncURLToControls(cfg) {
  const sel = document.getElementById('ctrl-ladder');
  const df = document.getElementById('ctrl-date-from');
  const dt = document.getElementById('ctrl-date-to');
  if (sel) sel.value = cfg.leaderboard;
  if (df) df.value = cfg.dateFrom;
  if (dt) dt.value = cfg.dateTo;
}

export async function initDashboard() {
  let cfg = readControls();
  syncURLToControls(cfg);

  const container = document.getElementById('dashboard');
  container.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Cargando perfil...</div>';

  try {
    currentPlayerStats = await runSelfAnalysis(cfg.playerId, cfg.pages, cfg.perPage, cfg.leaderboard || null, cfg.dateFrom, cfg.dateTo);
    renderDashboard(currentPlayerStats);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="loading-state">Error cargando datos.</div>';
  }

  // Botón Aplicar
  const btnApply = document.getElementById('btn-apply');
  if (btnApply) {
    btnApply.addEventListener('click', async () => {
      cfg = syncControlsToURL();
      container.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Cargando perfil...</div>';
      try {
        currentPlayerStats = await runSelfAnalysis(cfg.playerId, cfg.pages, cfg.perPage, cfg.leaderboard || null, cfg.dateFrom, cfg.dateTo);
        renderDashboard(currentPlayerStats);
      } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="loading-state">Error cargando datos.</div>';
      }
    });
  }

  // Botón analizar rival
  const btnAnalyze = document.getElementById('btn-analyze-rival');
  if (btnAnalyze) {
    btnAnalyze.addEventListener('click', async () => {
      if (!currentRivalId || isAnalyzingRival) return;
      isAnalyzingRival = true;
      btnAnalyze.textContent = 'Analizando...';
      btnAnalyze.disabled = true;

      try {
        const rivalStats = await runSelfAnalysis(currentRivalId, cfg.pages, cfg.perPage, cfg.leaderboard || null, cfg.dateFrom, cfg.dateTo);
        renderComparative(currentPlayerStats, rivalStats, currentRivalName);
        btnAnalyze.textContent = 'Análisis listo';
      } catch (err) {
        console.error('Error analizando rival:', err);
        btnAnalyze.textContent = 'Error, reintentar';
        btnAnalyze.disabled = false;
      } finally {
        isAnalyzingRival = false;
      }
    });
  }

  // Iniciar WebSocket para detectar partidas 1v1
  initWebSocket(cfg.playerId, 'self', async ({ matchData, rivalProfileId }) => {
    const banner = document.getElementById('live-match-banner');
    const rivalName = matchData.players.find(p => p.profileId === rivalProfileId)?.name || 'Rival';

    currentRivalId = rivalProfileId;
    currentRivalName = rivalName;

    banner.querySelector('.live-match-vs').textContent = `vs ${rivalName}`;
    banner.classList.add('active');

    // Actualizar link "Ver perfil del rival"
    const btnProfile = document.getElementById('btn-rival-profile');
    if (btnProfile) {
      const url = new URL(window.location.href);
      url.searchParams.set('player_id', rivalProfileId);
      btnProfile.href = url.toString();
    }

    // Resetear botón
    if (btnAnalyze) {
      btnAnalyze.textContent = 'Analizar Rival';
      btnAnalyze.disabled = false;
    }
  });
}

function is1v1Match(m) {
  if (!m.teams || m.teams.length !== 2) return false;
  return m.teams[0].players?.length === 1 && m.teams[1].players?.length === 1;
}

function findPlayerInMatch(m, playerId) {
  for (let i = 0; i < m.teams.length; i++) {
    const team = m.teams[i];
    if (!team.players) continue;
    for (const p of team.players) {
      if (p.profileId === parseInt(playerId)) {
        return { teamIndex: i, player: p };
      }
    }
  }
  return null;
}

function matchInDateRange(started, dateFrom, dateTo) {
  if (!started) return true;
  const d = new Date(started);
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setHours(0, 0, 0, 0);
    if (d < from) return false;
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    if (d > to) return false;
  }
  return true;
}

async function runSelfAnalysis(playerId, pages, perPage, leaderboardParam, dateFrom, dateTo) {
  const playedCivNum = null;
  const opponentCivNum = null;
  const effPages = pages || PAGES;
  const effPerPage = perPage || PER_PAGE;

  // Leaderboards a consultar
  const leaderboards = leaderboardParam
    ? [leaderboardParam]
    : ['rm_1v1', 'unranked'];

  let allMatches = [];

  for (const lb of leaderboards) {
    let page = 1;
    while (page <= effPages) {
      const pageMatches = await fetchMatches(playerId, lb, page, effPerPage);
      if (pageMatches.length === 0) break;

      const processed = pageMatches.map(m => {
        // Para unranked, solo analizar 1v1
        if (lb === 'unranked' && !is1v1Match(m)) return null;

        const found = findPlayerInMatch(m, playerId);
        if (!found) return null;

        // Filtro por fecha
        if (!matchInDateRange(m.started, dateFrom, dateTo)) return null;

        const profileTeamIndex = found.teamIndex;
        const opponentTeamIndex = profileTeamIndex === 0 ? 1 : 0;
        const opponentTeam = m.teams[opponentTeamIndex];
        const opponentPlayer = opponentTeam?.players?.[0];

        return {
          match_id: m.matchId,
          map_name: m.mapName || null,
          player_name: found.player.name || null,
          player_civ: found.player.civName || null,
          opponent_civ: opponentPlayer?.civName || null,
          won: found.player.won || false,
          started: m.started || null,
          finished: m.finished || null,
          leaderboard: lb,
        };
      }).filter(Boolean);

      allMatches.push(...processed);
      if (pageMatches.length < effPerPage) break;
      page++;
      await sleep(300);
    }
  }

  // Ordenar por fecha más reciente y limitar al total esperado
  allMatches.sort((a, b) => new Date(b.started) - new Date(a.started));
  const maxMatches = effPages * effPerPage;
  if (allMatches.length > maxMatches) {
    allMatches = allMatches.slice(0, maxMatches);
  }

  if (allMatches.length === 0) {
    throw new Error('No se encontraron partidas.');
  }

  const dataMainPlayer = {
    player_id: playerId,
    match_id: 'self',
  };

  let stats = await analyzeMatches(allMatches, parseInt(playerId), playedCivNum, opponentCivNum, dataMainPlayer, (progress) => {
    const container = document.getElementById('dashboard');
    if (container) {
      const pct = Math.round((progress.current / progress.total) * 100);
      const cacheLabel = progress.fromCache ? ' (cache)' : '';
      container.innerHTML = `<div class="loading-state">
        <div class="loading-spinner"></div>
        <div>Analizando partida ${progress.current} de ${progress.total}${cacheLabel}...</div>
        <div class="loading-bar"><div class="loading-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }
  });
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
  let ladderText = '';
  if (stats.ladder_counts && Object.keys(stats.ladder_counts).length > 0) {
    const parts = Object.entries(stats.ladder_counts).map(([lb, count]) => {
      const label = lb === 'rm_1v1' ? 'Ranked' : lb === 'unranked' ? 'Unranked' : lb;
      return `${count} ${label}`;
    });
    ladderText = ` · ${parts.join(' + ')}`;
  }
  if (headerMeta) headerMeta.textContent = `Rating: ${stats.rating || '—'} · ${stats.analyzed} partidas${ladderText}`;
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

  // Row 2: Civs + Maps + Economy + Units
  html += '<div class="grid grid-3">';
  html += renderCivsCard(stats);
  html += renderMapsCard(stats);
  html += renderEconomyCard(stats);
  html += '</div>';

  // Row 3: Units by Age + Unit Detail + Techs
  html += '<div class="grid grid-3">';
  html += renderUnitsByAgeCard(stats);
  html += renderUnitDetailCard(stats);
  html += renderTechsCard(stats);
  html += '</div>';

  // Row 3b: Unit Upgrades
  html += '<div class="grid">';
  html += renderUnitUpgradesCard(stats);
  html += '</div>';

  // Row 4: Market + Tech Context
  html += '<div class="grid grid-2">';
  html += renderMarketCard(stats);
  html += renderTechContextCard(stats);
  html += '</div>';

  // Row 5: Playstyle (full width)
  html += '<div class="grid">';
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

function renderUnitsCard(stats) {
  const cats = stats.unit_categories || {};
  const wins = stats.unit_categories_wins || {};
  const losses = stats.unit_categories_losses || {};
  const entries = Object.entries(cats);

  if (entries.length === 0) {
    return '<div class="card"><div class="card-title">Preferencia de Unidades</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  const catLabels = {
    cavalry: 'Caballería',
    archers: 'Arqueros',
    infantry: 'Infantería',
    siege: 'Asedio',
  };
  const catColors = {
    cavalry: 'var(--accent-red)',
    archers: 'var(--accent-blue)',
    infantry: 'var(--accent-green)',
    siege: 'var(--accent-orange)',
  };

  const enriched = entries.map(([cat, total]) => {
    const w = wins[cat] || 0;
    const l = losses[cat] || 0;
    const games = w + l;
    const wr = games > 0 ? Math.round((w * 100 / games) * 100) / 100 : 0;
    return { cat, total, wr, games };
  }).sort((a, b) => b.total - a.total);

  const maxTotal = enriched[0]?.total || 1;

  let html = '<div class="card">';
  html += '<div class="card-title">Preferencia de Unidades</div>';
  html += '<div class="unit-categories">';

  for (const item of enriched) {
    const color = catColors[item.cat] || 'var(--text-muted)';
    const label = catLabels[item.cat] || item.cat;
    const barWidth = (item.total / maxTotal) * 100;

    html += `<div class="unit-cat-row">`;
    html += `<div class="unit-cat-header">`;
    html += `<span class="unit-cat-name" style="color:${color}">${label}</span>`;
    html += `<span class="unit-cat-count">${item.total} unidades</span>`;
    html += `</div>`;
    html += `<div class="unit-cat-bar-track">`;
    html += `<div class="unit-cat-bar" style="width:${barWidth}%;background:${color}"></div>`;
    html += `</div>`;
    html += `<div class="unit-cat-wr">WR ${item.wr}% <span style="font-size:10px;color:var(--text-muted);">(${item.games} games)</span></div>`;
    html += `</div>`;
  }

  html += '</div></div>';
  return html;
}

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
  const playerName = stats.player_name || 'You';
  const playerInitial = playerName.length > 8 ? playerName.substring(0, 6) + '..' : playerName;

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
      <div class="age-label" style="color:var(--accent-blue);font-size:10px;">${playerInitial}</div>
      <div class="age-bar-container"><div class="age-bar player" style="width:${pPct}%"></div></div>
      <div class="age-time" style="color:var(--accent-blue)">${pTime}</div>
    </div>`;
  }

  html += '</div>';
  return html;
}

function renderCivsCard(stats) {
  const civs = stats.civ_played_percent || {};
  const civCounts = stats.civ_played || {};
  const civWins = stats.civ_win || {};
  const civLosses = stats.civ_loss || {};

  if (Object.keys(civs).length === 0) {
    return '<div class="card"><div class="card-title">Civilizaciones</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  const sorted = Object.entries(civs).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxPct = sorted[0][1];

  let html = '<div class="card">';
  html += '<div class="card-title">Civilizaciones</div>';
  html += '<div class="civs-list-detailed">';
  for (const [civ, pct] of sorted) {
    const count = civCounts[civ] || 0;
    const wins = civWins[civ] || 0;
    const losses = civLosses[civ] || 0;
    const games = wins + losses;
    const wr = games > 0 ? Math.round((wins * 100 / games) * 100) / 100 : 0;
    const wrClass = wr >= 55 ? 'good' : wr <= 40 ? 'bad' : 'neutral';
    const barWidth = (pct / maxPct) * 100;

    html += `<div class="civ-detailed-row">`;
    html += `<div class="civ-detailed-header">`;
    html += `<span class="civ-detailed-name">${civ}</span>`;
    html += `<span class="civ-detailed-meta">${count}g · ${wr}% WR</span>`;
    html += `</div>`;
    html += `<div class="civ-detailed-bar-track">`;
    html += `<div class="civ-detailed-bar" style="width:${barWidth}%"></div>`;
    html += `</div>`;
    html += `<div class="civ-detailed-wr ${wrClass}">${wins}W / ${losses}L</div>`;
    html += `</div>`;
  }
  html += '</div></div>';
  return html;
}

function renderMapsCard(stats) {
  const maps = stats.map_played_percent || {};
  const mapCounts = stats.map_played || {};
  if (Object.keys(maps).length === 0) {
    return '<div class="card"><div class="card-title">Mapas</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  const sorted = Object.entries(maps).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxPct = sorted[0][1];

  let html = '<div class="card">';
  html += '<div class="card-title">Top Maps</div>';
  for (const [map, pct] of sorted) {
    const wr = stats.map_win_percent?.[map] ?? 0;
    const wrClass = wr >= 55 ? 'good' : wr <= 40 ? 'bad' : 'neutral';
    const count = mapCounts[map] || 0;
    const barWidth = (pct / maxPct) * 100;

    html += `<div class="map-detailed-row">`;
    html += `<div class="map-detailed-header">`;
    html += `<span class="map-detailed-name">${map}</span>`;
    html += `<span class="map-detailed-meta">${count}g · ${wr}% WR</span>`;
    html += `</div>`;
    html += `<div class="map-detailed-bar-track">`;
    html += `<div class="map-detailed-bar" style="width:${barWidth}%"></div>`;
    html += `</div>`;
    html += `<div class="map-detailed-wr ${wrClass}">${pct}% pick rate</div>`;
    html += `</div>`;
  }
  html += '</div>';
  return html;
}

function renderEconomyCard(stats) {
  const wb = stats.wheel_barrow_avg;
  const hc = stats.hand_cart_avg;
  const tc2 = stats.tc2_time_avg;
  const tc3 = stats.tc3_time_avg;
  const tc2Pct = stats.tc2_pct;
  const tc3Pct = stats.tc3_pct;

  let html = '<div class="card">';
  html += '<div class="card-title">Economía</div>';

  if (wb != null) {
    html += `<div class="economy-row"><div class="economy-label">Wheelbarrow</div><div class="economy-value">${formatHms(wb)}</div></div>`;
  }
  if (hc != null) {
    html += `<div class="economy-row"><div class="economy-label">Hand Cart</div><div class="economy-value">${formatHms(hc)}</div></div>`;
  }

  // TC 2do
  if (tc2 != null) {
    html += `<div class="economy-row">
      <div class="economy-label">2do TC <span style="font-size:10px;color:var(--text-muted);">(${tc2Pct}% games)</span></div>
      <div class="economy-value">${formatHms(tc2)}</div>
    </div>`;
  }
  // TC 3er
  if (tc3 != null) {
    html += `<div class="economy-row">
      <div class="economy-label">3er TC <span style="font-size:10px;color:var(--text-muted);">(${tc3Pct}% games)</span></div>
      <div class="economy-value">${formatHms(tc3)}</div>
    </div>`;
  }

  if (wb == null && hc == null && tc2 == null) {
    html += '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">Sin datos de mejoras.</div>';
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

  // Ordenar por tiempo de partida (avg_time) ascendente
  const allTechs = entries.map(([name, data]) => ({ name, ...data }));
  allTechs.sort((a, b) => (a.avg_time || 99999) - (b.avg_time || 99999));

  let html = '<div class="card">';
  html += '<div class="card-title">Key Techs <span style="font-size:10px;color:var(--text-muted);font-weight:400;">(por tiempo de partida)</span></div>';
  html += '<div class="tech-list">';

  for (const tech of allTechs.slice(0, 12)) {
    const display = techDisplayName(tech.name);
    const time = tech.avg_time != null ? formatHms(tech.avg_time) : '';

    const catColors = {
      military: 'var(--accent-red)',
      economy: 'var(--accent-green)',
      naval: 'var(--accent-blue)',
      other: 'var(--text-muted)',
    };
    const color = catColors[tech.category] || 'var(--text-muted)';

    html += `<div class="tech-list-row">`;
    html += `<div class="tech-list-info">`;
    html += `<span class="tech-list-name" style="color:${color};font-weight:600;">${display}</span>`;
    html += `<span class="tech-list-time">${time}</span>`;
    html += `</div>`;
    html += `<div class="tech-list-freq">${Math.round(tech.frequency)}%</div>`;
    html += `</div>`;
  }

  html += '</div></div>';
  return html;
}

function renderMarketCard(stats) {
  const marketAvg = stats.market_avg_by_age || {};
  const marketTotals = stats.market_totals_by_age || {};
  const marketTrans = stats.market_transactions_by_age || {};
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
  html += '<div style="display:flex;flex-direction:column;gap:12px;">';

  for (const age of ['feudal', 'castle', 'imperial']) {
    const avgByAge = marketAvg[age] || {};
    const totalsByAge = marketTotals[age] || {};
    const trans = marketTrans[age] || 0;
    const buys = avgByAge.buy || {};
    const sells = avgByAge.sell || {};
    if (Object.keys(buys).length === 0 && Object.keys(sells).length === 0) continue;

    html += `<div style="border-bottom:1px solid var(--border-subtle);padding-bottom:8px;">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">`;
    html += `<span style="font-size:12px;font-weight:600;text-transform:capitalize;color:var(--text-primary);">${age}</span>`;
    html += `<span style="font-size:10px;color:var(--text-muted);">${trans} transacciones</span>`;
    html += `</div>`;

    // Compras
    const buyEntries = Object.entries(buys);
    if (buyEntries.length > 0) {
      html += `<div style="margin-bottom:4px;">`;
      html += `<span style="font-size:10px;color:var(--accent-green);font-weight:600;">COMPRA </span>`;
      const buyParts = buyEntries.map(([res, avg]) => {
        const total = (totalsByAge.buy || {})[res] || 0;
        return `<span style="font-size:11px;color:var(--text-secondary);">${res}: <strong>${Math.round(total)}</strong> total (~${Math.round(avg)} c/u)</span>`;
      });
      html += buyParts.join('<span style="color:var(--border-accent);margin:0 4px;">·</span>');
      html += `</div>`;
    }

    // Ventas
    const sellEntries = Object.entries(sells);
    if (sellEntries.length > 0) {
      html += `<div>`;
      html += `<span style="font-size:10px;color:var(--accent-red);font-weight:600;">VENTA </span>`;
      const sellParts = sellEntries.map(([res, avg]) => {
        const total = (totalsByAge.sell || {})[res] || 0;
        return `<span style="font-size:11px;color:var(--text-secondary);">${res}: <strong>${Math.round(total)}</strong> total (~${Math.round(avg)} c/u)</span>`;
      });
      html += sellParts.join('<span style="color:var(--border-accent);margin:0 4px;">·</span>');
      html += `</div>`;
    }

    html += `</div>`;
  }

  html += '</div></div>';
  return html;
}

function renderUnitsByAgeCard(stats) {
  const byAge = stats.units_by_age_period || {};
  const periods = ['pre-feudal', 'pre-castle', 'pre-imperial'];
  const periodLabels = {
    'pre-feudal': 'Antes de Feudal',
    'pre-castle': 'Feudal → Castle',
    'pre-imperial': 'Castle → Imperial',
  };

  let hasAny = false;
  for (const p of periods) {
    if (Object.keys(byAge[p] || {}).length > 0) { hasAny = true; break; }
  }
  if (!hasAny) {
    return '<div class="card"><div class="card-title">Unidades por Edad</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  let html = '<div class="card">';
  html += '<div class="card-title">Unidades por Edad</div>';
  html += '<div class="age-units-container">';

  for (const period of periods) {
    const units = byAge[period] || {};
    const entries = Object.entries(units).sort((a, b) => b[1].total - a[1].total);
    if (entries.length === 0) continue;

    html += `<div class="age-units-section">`;
    html += `<div class="age-units-label">${periodLabels[period]}</div>`;
    html += `<div class="age-units-list">`;
    for (const [unitName, data] of entries.slice(0, 8)) {
      const display = unitName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      html += `<div class="age-unit-row">`;
      html += `<span class="age-unit-name">${display}</span>`;
      html += `<span class="age-unit-count">${data.avg} <span style="font-size:10px;color:var(--text-muted);">avg (${data.total} tot)</span></span>`;
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  html += '</div></div>';
  return html;
}

function renderUnitDetailCard(stats) {
  const units = stats.unit_stats || {};
  const entries = Object.entries(units).slice(0, 12); // Top 12
  if (entries.length === 0) {
    return '<div class="card"><div class="card-title">Unidades Preferidas</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  const catColors = {
    cavalry: 'var(--accent-red)',
    archers: 'var(--accent-blue)',
    infantry: 'var(--accent-green)',
    siege: 'var(--accent-orange)',
  };

  // Para saber la categoría de una unidad individual, reutilizamos la lógica de stats.js
  // Pero como no exportamos categorizeUnit, hacemos una versión local simple
  function getUnitCat(unitName) {
    const cats = {
      cavalry: ['scout_cavalry','knight','cavalier','paladin','camel_rider','heavy_camel_rider','imperial_camel_rider','camel','savar','battle_elephant','elite_battle_elephant','steppe_lancer','elite_steppe_lancer','hussar','light_cavalry','winged_hussar','tarkan','elite_tarkan','konnik','keshik','leitis','boyar','magyar_huszar','war_elephant','mameluke','cataphract','shrivamsha_rider','sosso_guard','monaspa'],
      archers: ['archer','crossbowman','arbalester','skirmisher','elite_skirmisher','cavalry_archer','heavy_cavalry_archer','hand_cannoneer','genoese_crossbowman','plumed_archer','chu_ko_nu','longbowman','war_wagon','elephant_archer','rattan_archer','arambai','genitour','elite_genitour','camel_archer','elite_camel_archer','slinger'],
      infantry: ['militia','men-at-arms','long_swordsman','two-handed_swordsman','champion','spearman','pikeman','halberdier','eagle_warrior','elite_eagle_warrior','ghulam','teutonic_knight','berserk','jaguar_warrior','samurai','woad_raider','throwing_axeman','huskarl','shotel_warrior','condottiero','karambit_warrior','elite_karambit_warrior','serjeant','flemish_militia','obuch','urumi_swordsman','elite_urumi_swordsman','chakram_thrower','elite_chakram_thrower'],
      siege: ['battering_ram','capped_ram','siege_ram','mangonel','onager','siege_onager','scorpion','heavy_scorpion','bombard_cannon','trebuchet','siege_tower','petard','flaming_camel','organ_gun','ballista_elephant','houfnice'],
    };
    for (const [cat, list] of Object.entries(cats)) {
      if (list.includes(unitName)) return cat;
    }
    return 'other';
  }

  const maxTotal = entries[0][1].total || 1;

  let html = '<div class="card">';
  html += '<div class="card-title">Unidades Preferidas</div>';
  html += '<div class="unit-detail-list">';

  for (const [unitName, data] of entries) {
    const cat = getUnitCat(unitName);
    const color = catColors[cat] || 'var(--text-muted)';
    const display = unitName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const barWidth = (data.total / maxTotal) * 100;

    html += `<div class="unit-detail-row">`;
    html += `<div class="unit-detail-header">`;
    html += `<span class="unit-detail-name" style="color:${color}">${display}</span>`;
    html += `<span class="unit-detail-count">${data.avg} avg <span style="font-size:10px;color:var(--text-muted);">(${data.total} tot)</span></span>`;
    html += `</div>`;
    html += `<div class="unit-detail-bar-track">`;
    html += `<div class="unit-detail-bar" style="width:${barWidth}%;background:${color}"></div>`;
    html += `</div>`;
    html += `<div class="unit-detail-wr">WR ${data.wr}% <span style="font-size:10px;color:var(--text-muted);">(${data.matches} games)</span></div>`;
    html += `</div>`;
  }

  html += '</div></div>';
  return html;
}

function renderUnitUpgradesCard(stats) {
  const upgrades = stats.unit_upgrades || {};
  const entries = Object.entries(upgrades);
  if (entries.length === 0) {
    return '<div class="card"><div class="card-title">Mejoras de Unidades</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  // Agrupar por categoría
  const groups = {
    'Ataque (Forja)': ['forging','iron casting','blast furnace'],
    'Armadura Infantería': ['scale mail armor','chain mail armor','plate mail armor'],
    'Armadura Caballería': ['scale barding armor','chain barding armor','plate barding armor'],
    'Armadura Arqueros': ['padded archer armor','leather archer armor','ring archer armor'],
    'Ataque a Distancia': ['fletching','bodkin arrow','bracer'],
    'Caballería': ['bloodlines','husbandry'],
    'Arqueros Especiales': ['thumb ring','ballistics'],
    'Otros': ['chemistry','siege engineers'],
  };

  const groupColors = {
    'Ataque (Forja)': 'var(--accent-red)',
    'Armadura Infantería': 'var(--accent-green)',
    'Armadura Caballería': 'var(--accent-orange)',
    'Armadura Arqueros': 'var(--accent-blue)',
    'Ataque a Distancia': 'var(--accent-purple)',
    'Caballería': 'var(--accent-yellow)',
    'Arqueros Especiales': 'var(--accent-cyan)',
    'Otros': 'var(--text-muted)',
  };

  const displayNames = {
    'forging': 'Forging',
    'iron casting': 'Iron Casting',
    'blast furnace': 'Blast Furnace',
    'scale mail armor': 'Scale Mail',
    'chain mail armor': 'Chain Mail',
    'plate mail armor': 'Plate Mail',
    'scale barding armor': 'Scale Barding',
    'chain barding armor': 'Chain Barding',
    'plate barding armor': 'Plate Barding',
    'padded archer armor': 'Padded Archer',
    'leather archer armor': 'Leather Archer',
    'ring archer armor': 'Ring Archer',
    'fletching': 'Fletching',
    'bodkin arrow': 'Bodkin Arrow',
    'bracer': 'Bracer',
    'bloodlines': 'Bloodlines',
    'husbandry': 'Husbandry',
    'thumb ring': 'Thumb Ring',
    'ballistics': 'Ballistics',
    'chemistry': 'Chemistry',
    'siege engineers': 'Siege Engineers',
  };

  let html = '<div class="card">';
  html += '<div class="card-title">Mejoras de Unidades</div>';
  html += '<div class="unit-upgrades-grid">';

  for (const [groupName, techList] of Object.entries(groups)) {
    const groupEntries = entries.filter(([name]) => techList.includes(name));
    if (groupEntries.length === 0) continue;

    const color = groupColors[groupName] || 'var(--text-muted)';

    html += `<div class="unit-upgrade-group">`;
    html += `<div class="unit-upgrade-group-title" style="color:${color}">${groupName}</div>`;
    html += `<div class="unit-upgrade-items">`;

    for (const [techName, data] of groupEntries) {
      const label = displayNames[techName] || techName;
      html += `<div class="unit-upgrade-item">`;
      html += `<span class="unit-upgrade-name">${label}</span>`;
      html += `<span class="unit-upgrade-value">${data.count}x <span style="font-size:10px;color:var(--text-muted);">WR ${data.wr}%</span></span>`;
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  html += '</div></div>';
  return html;
}

function renderTechContextCard(stats) {
  const ctx = stats.tech_context || {};
  const entries = Object.entries(ctx);
  if (entries.length === 0) {
    return '<div class="card"><div class="card-title">Contexto de Techs</div><div style="font-size:12px;color:var(--text-muted);">Sin datos</div></div>';
  }

  const techLabels = {
    'wheelbarrow': 'Wheelbarrow',
    'hand cart': 'Hand Cart',
    'fletching': 'Fletching',
    'bodkin arrow': 'Bodkin Arrow',
    'bloodlines': 'Bloodlines',
    'scale barding armor': 'Scale Barding',
    'forging': 'Forging',
    'iron casting': 'Iron Casting',
  };
  const unitLabels = {
    'villager': 'Aldeanos',
    'archer': 'Arqueros',
    'crossbowman': 'Arqueros',
    'scout_cavalry': 'Scouts',
    'knight': 'Caballería',
    'light_cavalry': 'Caballería',
    'militia': 'Infantería',
    'men-at-arms': 'Infantería',
    'long_swordsman': 'Infantería',
    'cavalier': 'Caballería',
    'spearman': 'Infantería',
  };

  let html = '<div class="card">';
  html += '<div class="card-title">Contexto de Techs</div>';
  html += '<div class="tech-context-list">';

  for (const [techKey, data] of entries) {
    const label = techLabels[techKey] || techKey;
    const unitType = data.unit_types[0] || '';
    const unitLabel = unitLabels[unitType] || unitType;

    html += `<div class="tech-context-row">`;
    html += `<div class="tech-context-header">`;
    html += `<span class="tech-context-name">${label}</span>`;
    html += `<span class="tech-context-value">${Math.round(data.avg_count * 10) / 10} ${unitLabel}</span>`;
    html += `</div>`;
    html += `<div style="font-size:10px;color:var(--text-muted);">Promedio en ${data.samples} partidas</div>`;
    html += `</div>`;
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
