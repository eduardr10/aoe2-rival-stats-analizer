import { fetchRating, fetchMatches } from './api.js';
import { analyzeMatches } from './stats.js';
import { computePlayerPrimaryOpenings, classifyPlayerArchetype } from './analysis.js';
import { buildOverlay, restartOverlay } from './render.js';
import { initWebSocket } from './websocket.js';
import { resolveCivNumber, sleep } from './utils.js';
import { clearCache, getCacheStats } from './cache.js';

const DEFAULT_PLAYER_ID = '8621659';

export async function init() {
  const params = new URLSearchParams(window.location.search);
  const playerId = params.get('player_id') || DEFAULT_PLAYER_ID;
  const matchId = params.get('matchId') || 'self';
  const rivalProfileId = params.get('rivalProfileId') || null;
  const playedCivilization = params.get('played_civilization') || null;
  const opponentCiv = params.get('opponent_civ') || null;
  const leaderboard = params.get('leaderboard') || 'rm_1v1';
  const perPage = parseInt(params.get('per_page') || '10');
  const ongoing = params.get('ongoing') === 'true';
  const pages = parseInt(params.get('pages') || '1');

  if (matchId === 'self') {
    await runSelfAnalysis(playerId, leaderboard, pages, perPage, playedCivilization, opponentCiv, ongoing);
  } else if (matchId && rivalProfileId) {
    await runRivalAnalysis(playerId, rivalProfileId, matchId, leaderboard, perPage, playedCivilization, opponentCiv, ongoing);
  } else {
    document.getElementById('aoe2-overlay').innerHTML =
      '<div class="loading-state" style="font-size:13px;">' +
      'Esperando partida... Asegurate de pasar <code>matchId</code> y <code>rivalProfileId</code>.</div>';
  }

  initWebSocket(playerId, matchId);
}

async function runSelfAnalysis(playerId, leaderboard, pages, perPage, playedCivilization, opponentCiv, ongoing) {
  const overlay = document.getElementById('aoe2-overlay');
  overlay.innerHTML = '<div class="loading-state">Cargando perfil...</div>';

  const playedCivNum = resolveCivNumber(playedCivilization);
  const opponentCivNum = resolveCivNumber(opponentCiv);

  let allMatches = [];
  const maxSearchPages = 10;
  let page = 1;

  while (true) {
    if (!playedCivilization && page > pages) break;
    if (page > maxSearchPages) break;

    const pageMatches = await fetchMatches(playerId, leaderboard, page, perPage);
    if (pageMatches.length === 0) break;

    const processed = pageMatches.map(m => {
      const profileTeamIndex = m.teams[0].players[0].profileId === parseInt(playerId) ? 0 : 1;
      const opponentTeamIndex = profileTeamIndex === 0 ? 1 : 0;
      const playerCivName = m.teams[profileTeamIndex].players[0].civName || null;

      if (playedCivilization && playerCivName && playerCivName.toLowerCase() !== playedCivilization.toLowerCase()) return null;

      return {
        match_id: m.matchId,
        map_name: m.mapName || null,
        player_name: m.teams[profileTeamIndex].players[0].name || null,
        player_civ: playerCivName,
        opponent_civ: m.teams[opponentTeamIndex].players[0].civName || null,
        won: m.teams[profileTeamIndex].players[0].won || false,
        started: m.started || null,
        finished: m.finished || null,
      };
    }).filter(Boolean);

    allMatches.push(...processed);

    const hasMorePages = pageMatches.length === perPage;
    const enoughMatches = playedCivilization ? allMatches.length >= 5 : true;
    if (!hasMorePages || enoughMatches) break;

    page++;
    await sleep(300); // delay entre requests de lista de partidas
  }

  if (allMatches.length === 0) {
    overlay.innerHTML = '<div class="loading-state">No se encontraron partidas.</div>';
    return;
  }

  const dataMainPlayer = {
    player_id: playerId,
    played_civilization: playedCivilization,
    opponent_civ: opponentCiv,
    leaderboard,
    pages,
    per_page: perPage,
    match_id: 'self',
  };

  if (ongoing) {
    allMatches = allMatches.filter(m => m.finished !== null);
  }

  let stats = await analyzeMatches(allMatches, parseInt(playerId), playedCivNum, opponentCivNum, dataMainPlayer);

  stats.total_wins = allMatches.filter(m => m.won).length;
  stats.win_percent = stats.total ? Math.round(stats.total_wins * 100 / stats.total * 100) / 100 : 0;

  stats.player_id = playerId;
  stats.match_id = 'self';
  stats.rating = await fetchRating(playerId);
  stats.player_profile = computePlayerPrimaryOpenings(parseInt(playerId), stats.all_match_features || []);
  stats.archetype = classifyPlayerArchetype(stats);

  buildOverlay(stats, playerId);
}

async function runRivalAnalysis(playerId, rivalProfileId, matchId, leaderboard, perPage, playedCivilization, opponentCiv, ongoing) {
  const overlay = document.getElementById('aoe2-overlay');
  overlay.innerHTML = '<div class="loading-state">Cargando analisis...</div>';

  const playedCivNum = resolveCivNumber(playedCivilization);
  const opponentCivNum = resolveCivNumber(opponentCiv);
  const analyzeId = rivalProfileId || playerId;
  const effPerPage = ongoing ? 11 : perPage;

  const pageMatches = await fetchMatches(analyzeId, leaderboard, 1, effPerPage);
  if (pageMatches.length === 0) {
    overlay.innerHTML = '<div class="loading-state">No se encontraron partidas para analizar.</div>';
    return;
  }

  let matches = [];
  for (const m of pageMatches) {
    const profileTeamIndex = m.teams[0].players[0].profileId === parseInt(analyzeId) ? 0 : 1;
    const opponentTeamIndex = profileTeamIndex === 0 ? 1 : 0;
    const playerCivName = m.teams[profileTeamIndex].players[0].civName || null;

    if (playedCivilization && playerCivName && playerCivName.toLowerCase() !== playedCivilization.toLowerCase()) continue;

    matches.push({
      match_id: m.matchId,
      map_name: m.mapName || null,
      player_name: m.teams[profileTeamIndex].players[0].name || null,
      player_civ: playerCivName,
      opponent_civ: m.teams[opponentTeamIndex].players[0].civName || null,
      won: m.teams[profileTeamIndex].players[0].won || false,
      started: m.started || null,
      finished: m.finished || null,
    });
  }

  const dataMainPlayer = {
    player_id: analyzeId,
    played_civilization: playedCivilization,
    opponent_civ: opponentCiv,
    leaderboard,
    pages: 1,
    per_page: effPerPage,
    match_id: matchId,
    ongoing,
  };

  if (ongoing) {
    matches = matches.filter(m => m.finished !== null);
  }

  let stats = await analyzeMatches(matches, parseInt(analyzeId), playedCivNum, opponentCivNum, dataMainPlayer);

  stats.total_wins = matches.filter(m => m.won).length;
  stats.win_percent = stats.total ? Math.round(stats.total_wins * 100 / stats.total * 100) / 100 : 0;

  stats.player_id = playerId;
  stats.match_id = matchId;
  stats.rating = await fetchRating(parseInt(playerId));
  stats.archetype = classifyPlayerArchetype(stats);

  buildOverlay(stats, playerId);
}

function setupButtons() {
  const btnAuto = document.getElementById('btn-autoanalyze');
  const btnToggle = document.getElementById('btn-toggle-overlay');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const overlay = document.getElementById('aoe2-overlay');

  if (btnToggle && overlay) {
    btnToggle.addEventListener('click', () => {
      if (overlay.style.opacity === '0' || overlay.style.opacity === '') {
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'auto';
        restartOverlay();
      } else {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
      }
    });
  }

  if (btnAuto) {
    btnAuto.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('matchId', 'self');
      url.searchParams.delete('rivalProfileId');
      url.searchParams.delete('played_civilization');
      url.searchParams.delete('opponent_civ');
      url.searchParams.delete('leaderboard');
      url.searchParams.delete('pages');
      url.searchParams.delete('per_page');
      window.location.href = url.pathname + '?' + url.searchParams.toString();
    });
  }

  if (btnClearCache) {
    btnClearCache.addEventListener('click', async () => {
      const stats = await getCacheStats();
      const confirmed = confirm(`Limpiar cache?\nMatches: ${stats.matches}\nAnalisis: ${stats.analysis}`);
      if (confirmed) {
        await clearCache();
        btnClearCache.textContent = 'Cache limpiado!';
        setTimeout(() => { btnClearCache.textContent = 'Limpiar cache'; }, 2000);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupButtons();
  const url = new URL(window.location.href);
  if (url.searchParams.has('matchId')) {
    window.history.replaceState({}, document.title, window.location.pathname + '?' + url.searchParams.toString());
  }
  init();
});
