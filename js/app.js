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

async function runSelfAnalysis(playerId, leaderboard, pages, perPage, playedCivilization, opponentCiv, ongoing) {
  const overlay = document.getElementById('aoe2-overlay');
  overlay.innerHTML = '<div class="loading-state">Cargando perfil...</div>';

  const playedCivNum = resolveCivNumber(playedCivilization);
  const opponentCivNum = resolveCivNumber(opponentCiv);
  const maxSearchPages = 10;

  const leaderboards = leaderboard
    ? [leaderboard]
    : ['rm_1v1', 'unranked'];

  let allMatches = [];

  for (const lb of leaderboards) {
    let page = 1;
    while (true) {
      if (!playedCivilization && page > pages) break;
      if (page > maxSearchPages) break;

      const pageMatches = await fetchMatches(playerId, lb, page, perPage);
      if (pageMatches.length === 0) break;

      const processed = pageMatches.map(m => {
        if (lb === 'unranked' && !is1v1Match(m)) return null;

        const found = findPlayerInMatch(m, playerId);
        if (!found) return null;

        const profileTeamIndex = found.teamIndex;
        const opponentTeamIndex = profileTeamIndex === 0 ? 1 : 0;
        const opponentTeam = m.teams[opponentTeamIndex];
        const opponentPlayer = opponentTeam?.players?.[0];
        const playerCivName = found.player.civName || null;

        if (playedCivilization && playerCivName && playerCivName.toLowerCase() !== playedCivilization.toLowerCase()) return null;

        return {
          match_id: m.matchId,
          map_name: m.mapName || null,
          player_name: found.player.name || null,
          player_civ: playerCivName,
          opponent_civ: opponentPlayer?.civName || null,
          won: found.player.won || false,
          started: m.started || null,
          finished: m.finished || null,
          leaderboard: lb,
        };
      }).filter(Boolean);

      allMatches.push(...processed);

      const hasMorePages = pageMatches.length === perPage;
      const enoughMatches = playedCivilization ? allMatches.length >= 5 : page >= pages;
      if (!hasMorePages || enoughMatches) break;

      page++;
      await sleep(300);
    }
  }

  // Ordenar por fecha más reciente
  allMatches.sort((a, b) => new Date(b.started) - new Date(a.started));
  const maxMatches = pages * perPage;
  if (allMatches.length > maxMatches) {
    allMatches = allMatches.slice(0, maxMatches);
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

  const leaderboards = leaderboard
    ? [leaderboard]
    : ['rm_1v1', 'unranked'];

  let matches = [];

  for (const lb of leaderboards) {
    const pageMatches = await fetchMatches(analyzeId, lb, 1, effPerPage);
    if (pageMatches.length === 0) continue;

    for (const m of pageMatches) {
      if (lb === 'unranked' && !is1v1Match(m)) continue;

      const found = findPlayerInMatch(m, analyzeId);
      if (!found) continue;

      const profileTeamIndex = found.teamIndex;
      const opponentTeamIndex = profileTeamIndex === 0 ? 1 : 0;
      const opponentTeam = m.teams[opponentTeamIndex];
      const opponentPlayer = opponentTeam?.players?.[0];
      const playerCivName = found.player.civName || null;

      if (playedCivilization && playerCivName && playerCivName.toLowerCase() !== playedCivilization.toLowerCase()) continue;

      matches.push({
        match_id: m.matchId,
        map_name: m.mapName || null,
        player_name: found.player.name || null,
        player_civ: playerCivName,
        opponent_civ: opponentPlayer?.civName || null,
        won: found.player.won || false,
        started: m.started || null,
        finished: m.finished || null,
        leaderboard: lb,
      });
    }
  }

  if (matches.length === 0) {
    overlay.innerHTML = '<div class="loading-state">No se encontraron partidas para analizar.</div>';
    return;
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
