import { fetchRating, fetchMatches } from './api.js';
import { analyzeMatches } from './stats.js';
import {
  classifyPlaystyle,
  classifyPlayerArchetype,
  detectWeaknesses,
  detectThreats,
  generateDataDrivenRecommendations,
  generatePrediction,
  interpretTimings,
  computeConfidence,
  computeConfidenceDetails,
  computeStreak,
  analyzeOpponentPatterns,
  computePlayerPrimaryOpenings,
  generateDeepInsights,
} from './analysis.js';
import { loadKnowledgeBase, buildStrategicAnalysis } from './strategic_engine.js';
import { analyzeMatchup } from './matchup_engine.js';
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

  // For overlay mode we don't auto-run analysis here to avoid intermediate flashes.
  // The websocket callback will trigger parallel analyses when a match is detected.
  // Start with empty overlay, waiting for WebSocket to detect a match
  document.getElementById('aoe2-overlay').innerHTML = '';

  initWebSocket(playerId, matchId, async ({ matchData, rivalProfileId }) => {
    // Auto-analyze both players for overlay face-off when a new match is detected
    let mid = null;
    try {
      mid = matchData.matchId || matchData.match_id || null;
      if (!mid || !rivalProfileId) return;

      // Run analyses sequentially to avoid overwhelming the API
      let leftStats = null;
      let rightStats = null;
      try {
        leftStats = await runRivalAnalysis(playerId, null, mid, leaderboard, perPage, playedCivilization, opponentCiv, ongoing, false);
      } catch (e) {
        console.warn('Left player analysis failed:', e);
      }
      try {
        rightStats = await runRivalAnalysis(playerId, rivalProfileId, mid, leaderboard, perPage, playedCivilization, opponentCiv, ongoing, false);
      } catch (e) {
        console.warn('Right player analysis failed:', e);
      }

      const playerEntry = findPlayerInMatch(matchData, playerId);
      const rivalEntry = findPlayerInMatch(matchData, rivalProfileId);
      if (leftStats) {
        leftStats.current_map = matchData.mapName || null;
        leftStats.current_opponent_civ = rivalEntry?.player?.civName || rivalEntry?.player?.civilization || null;
      }
      if (rightStats) {
        rightStats.current_map = matchData.mapName || null;
        rightStats.current_opponent_civ = playerEntry?.player?.civName || playerEntry?.player?.civilization || null;
      }

      // If at least one succeeded, render face-off overlay (use available data)
      let overlayBuilt = false;
      if (leftStats || rightStats) {
        try {
          const render = await import('./render.js');
          if (render && render.buildFaceOffOverlay) {
            render.buildFaceOffOverlay(leftStats || {}, rightStats || {});
            overlayBuilt = true;
          } else if (leftStats) {
            buildOverlay(leftStats, playerId);
            overlayBuilt = true;
          }
        } catch (e) {
          if (leftStats) {
            buildOverlay(leftStats, playerId);
            overlayBuilt = true;
          }
        }
      }
      if (overlayBuilt && mid) {
        localStorage.setItem(`aoe2_shown_match_${mid}`, '1');
      }
    } catch (err) {
      console.error('Error in overlay auto-analysis:', err);
    }
  });
}

function is1v1Match(m) {
  if (!m.teams || m.teams.length !== 2) return false;
  return m.teams[0].players?.length === 1 && m.teams[1].players?.length === 1;
}

function findPlayerInMatch(m, playerId) {
  const pid = parseInt(playerId, 10);
  if (Array.isArray(m.players)) {
    const matchPlayer = m.players.find(p => p.profileId === pid || p.profileId === playerId);
    if (matchPlayer) return { teamIndex: null, player: matchPlayer };
  }

  if (Array.isArray(m.teams)) {
    for (let i = 0; i < m.teams.length; i++) {
      const team = m.teams[i];
      if (!team.players) continue;
      for (const p of team.players) {
        if (p.profileId === pid || p.profileId === playerId) {
          return { teamIndex: i, player: p };
        }
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

  allMatches = allMatches.filter(m => m.finished !== null);

  let stats = await analyzeMatches(allMatches, parseInt(playerId), playedCivNum, opponentCivNum, dataMainPlayer);

  stats.total_wins = allMatches.filter(m => m.won).length;
  stats.win_percent = stats.total ? Math.round(stats.total_wins * 100 / stats.total * 100) / 100 : 0;

  stats.player_id = playerId;
  stats.match_id = 'self';
  stats.player_name = allMatches[0]?.player_name || 'Player';
  stats.rating = await fetchRating(playerId);
  stats.player_profile = computePlayerPrimaryOpenings(parseInt(playerId), stats.all_match_features || []);
  stats.archetype = classifyPlayerArchetype(stats);

  // NEW: Intelligence features
  stats.playstyle = classifyPlaystyle(stats.archetype);
  stats.confidence = computeConfidence(stats);
  stats.confidence_details = computeConfidenceDetails(stats);
  stats.weaknesses = detectWeaknesses(stats);
  stats.threats = detectThreats(stats);
  stats.recommendations = generateDataDrivenRecommendations(stats);
  stats.prediction = generatePrediction(stats);
  stats.opp_patterns = analyzeOpponentPatterns(stats);
  stats.deep_insights = generateDeepInsights(stats);
  stats.timing_interpretation = interpretTimings(stats);
  stats.current_streak = computeStreak(allMatches);

  // Strategic engine
  const mainCivEntry = Object.entries(stats.civ_played_percent || {}).sort((a, b) => b[1] - a[1])[0];
  const mainCivName = mainCivEntry ? mainCivEntry[0] : '';
  await loadKnowledgeBase();
  stats.strategic_analysis = buildStrategicAnalysis(stats, mainCivName);

  // Compute avg duration and enrich matches for historical data
  const featureMap = new Map();
  if (stats.all_match_features) {
    for (const f of stats.all_match_features) {
      if (f.match_id) featureMap.set(f.match_id, f);
    }
  }

  const durations = [];
  for (const m of allMatches) {
    if (m.started && m.finished) {
      const dur = (new Date(m.finished) - new Date(m.started)) / 1000;
      if (dur > 0 && dur < 7200) {
        durations.push(dur);
        m.duration_hms = formatDurationHms(dur);
      }
    }
    const feat = featureMap.get(m.match_id);
    if (feat && feat.opening) {
      m.opening = feat.opening.chosen_opening;
    }
  }
  if (durations.length > 0) {
    const avgDur = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    stats.avg_duration_hms = formatDurationHms(avgDur);
  }

  stats.matches = allMatches;

  buildOverlay(stats, playerId);
}

async function runRivalAnalysis(playerId, rivalProfileId, matchId, leaderboard, perPage, playedCivilization, opponentCiv, ongoing, buildOverlayFlag = true) {
  const overlay = document.getElementById('aoe2-overlay');
  if (buildOverlayFlag) {
    overlay.innerHTML = '<div class="loading-state">Cargando análisis...</div>';
  }

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
    if (buildOverlayFlag) {
      overlay.innerHTML = '<div class="loading-state">No se encontraron partidas para analizar.</div>';
    }
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

  matches = matches.filter(m => m.finished !== null);

  let stats = await analyzeMatches(matches, parseInt(analyzeId), playedCivNum, opponentCivNum, dataMainPlayer);

  stats.total_wins = matches.filter(m => m.won).length;
  stats.win_percent = stats.total ? Math.round(stats.total_wins * 100 / stats.total * 100) / 100 : 0;

  stats.player_id = playerId;
  stats.match_id = matchId;
  stats.player_name = matches[0]?.player_name || 'Player';
  stats.rival_name = matches[0]?.player_name || 'Rival';
  stats.rating = await fetchRating(parseInt(playerId));
  stats.rival_rating = await fetchRating(parseInt(analyzeId));
  stats.player_profile = computePlayerPrimaryOpenings(parseInt(analyzeId), stats.all_match_features || []);
  stats.archetype = classifyPlayerArchetype(stats);

  // NEW: Intelligence features
  stats.playstyle = classifyPlaystyle(stats.archetype);
  stats.confidence = computeConfidence(stats);
  stats.confidence_details = computeConfidenceDetails(stats);
  stats.weaknesses = detectWeaknesses(stats);
  stats.threats = detectThreats(stats);
  stats.recommendations = generateDataDrivenRecommendations(stats);
  stats.prediction = generatePrediction(stats);
  stats.opp_patterns = analyzeOpponentPatterns(stats);
  stats.deep_insights = generateDeepInsights(stats);
  stats.timing_interpretation = interpretTimings(stats);
  stats.current_streak = computeStreak(matches);

  // Strategic engine for rival
  const rivalMainCiv = Object.entries(stats.civ_played_percent || {}).sort((a, b) => b[1] - a[1])[0];
  const rivalCivName = rivalMainCiv ? rivalMainCiv[0] : '';
  await loadKnowledgeBase();
  stats.strategic_analysis = buildStrategicAnalysis(stats, rivalCivName);

  // Matchup analysis (placeholder — requires player civ)
  stats.matchup_analysis = null;

  // Compute avg duration and enrich matches for historical data
  const featureMap = new Map();
  if (stats.all_match_features) {
    for (const f of stats.all_match_features) {
      if (f.match_id) featureMap.set(f.match_id, f);
    }
  }

  const durations = [];
  for (const m of matches) {
    if (m.started && m.finished) {
      const dur = (new Date(m.finished) - new Date(m.started)) / 1000;
      if (dur > 0 && dur < 7200) {
        durations.push(dur);
        m.duration_hms = formatDurationHms(dur);
      }
    }
    const feat = featureMap.get(m.match_id);
    if (feat && feat.opening) {
      m.opening = feat.opening.chosen_opening;
    }
  }
  if (durations.length > 0) {
    const avgDur = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    stats.avg_duration_hms = formatDurationHms(avgDur);
  }

  stats.matches = matches;

  if (buildOverlayFlag) buildOverlay(stats, playerId);
  return stats;
}

function formatDurationHms(seconds) {
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h > 0) return `${h}:${String(rm).padStart(2, '0')}`;
  return `${rm} min`;
}

function setupButtons() {
  const btnAuto = document.getElementById('btn-autoanalyze');
  const btnToggle = document.getElementById('btn-toggle-overlay');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const btnSupport = document.getElementById('btn-support');
  const overlay = document.getElementById('aoe2-overlay');
  const supportModal = document.getElementById('support-modal');

  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      // Check if face-off overlay is active
      const faceoff = document.getElementById('faceoff-overlay');
      if (faceoff && faceoff.classList.contains('active')) {
        faceoff.remove();
        return;
      }
      // Fallback to regular overlay
      if (overlay) {
        if (overlay.style.opacity === '0' || overlay.style.opacity === '') {
          overlay.style.opacity = '1';
          overlay.style.pointerEvents = 'auto';
          restartOverlay();
        } else {
          overlay.style.opacity = '0';
          overlay.style.pointerEvents = 'none';
        }
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

  if (btnSupport && supportModal) {
    btnSupport.addEventListener('click', () => {
      supportModal.classList.add('active');
    });

    supportModal.addEventListener('click', (e) => {
      if (e.target === supportModal) {
        supportModal.classList.remove('active');
      }
    });
  }

  // Show donation links if support is enabled
  const donationLinks = document.getElementById('donation-links');
  if (donationLinks && window.app_config?.support_enabled) {
    donationLinks.style.display = 'block';
  }

  // Setup modal social links
  document.querySelectorAll('#support-modal [data-social]').forEach(link => {
    const social = link.dataset.social;
    let url = '';
    switch (social) {
      case 'youtube': url = window.app_config?.youtube_url || ''; break;
      case 'twitch': url = window.app_config?.twitch_url || ''; break;
      case 'buymeacoffee': url = window.app_config?.buymeacoffee_url || ''; break;
      case 'kofi': url = window.app_config?.kofi_url || ''; break;
      case 'binance': url = window.app_config?.binance_id || ''; break;
    }
    if (url) {
      link.href = url;
      link.target = '_blank';
      link.style.opacity = '1';
      link.style.pointerEvents = 'auto';
    } else {
      link.style.opacity = '0.4';
      link.style.pointerEvents = 'none';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupButtons();
  const url = new URL(window.location.href);
  if (url.searchParams.has('matchId')) {
    window.history.replaceState({}, document.title, window.location.pathname + '?' + url.searchParams.toString());
  }
  init();
});
