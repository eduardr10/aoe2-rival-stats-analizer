import { fetchRating, fetchMatches } from './api.js';
import { analyzeMatches } from './stats.js';
import {
  computePlayerPrimaryOpenings,
  classifyPlayerArchetype,
  computeDangerScore,
  classifyPlaystyle,
  detectWeaknesses,
  detectThreats,
  generateRecommendations,
  computeConfidence,
  computeStreak,
  interpretTimings,
  generatePrediction,
  computeConfidenceDetails,
} from './analysis.js';
import { resolveCivNumber, sleep, formatHms, techDisplayName } from './utils.js';
import { initWebSocket } from './websocket.js';

const DEFAULT_PLAYER_ID = '8621659';
const PER_PAGE = 10;
const PAGES = 1;

// App configuration for creator links
window.app_config = {
  youtube_url: 'https://youtube.com/@EduardR10',
  twitch_url: 'https://twitch.tv/EduardR10',
  support_enabled: false,
  buymeacoffee_url: '',
  kofi_url: '',
  patreon_url: '',
  binance_id: '',
};

let currentPlayerStats = null;
let currentRivalStats = null;
let isAnalyzingRival = false;
let currentRivalId = null;
let currentRivalName = null;
let liveMatchData = null;

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

// ============================================================================
// INIT
// ============================================================================

export async function initDashboard() {
  let cfg = readControls();
  syncURLToControls(cfg);

  setupEventListeners();
  setupSocialLinks();

  const container = document.getElementById('dashboard');
  container.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Cargando perfil...</div>';

  try {
    currentPlayerStats = await runSelfAnalysis(cfg.playerId, cfg.pages, cfg.perPage, cfg.leaderboard || null, cfg.dateFrom, cfg.dateTo);
    renderDashboard(currentPlayerStats);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="loading-state">Error cargando datos.</div>';
  }

  // WebSocket for live match detection
  initWebSocket(cfg.playerId, 'self', async ({ matchData, rivalProfileId }) => {
    const banner = document.getElementById('live-match-section');
    const info = document.getElementById('live-match-info');
    const rivalName = matchData.players?.find(p => p.profileId === rivalProfileId)?.name || 'Rival';

    currentRivalId = rivalProfileId;
    currentRivalName = rivalName;
    liveMatchData = matchData;

    if (info) info.innerHTML = `<span>vs ${escapeHtml(rivalName)}</span><span style="font-size:12px;color:var(--text-muted);margin-left:8px;">en ${escapeHtml(matchData.mapName || '???')}</span>`;
    if (banner) banner.classList.remove('hidden');

    // Update rival profile link
    const btnProfile = document.getElementById('btn-rival-profile');
    if (btnProfile) {
      const url = new URL(window.location.href);
      url.searchParams.set('player_id', rivalProfileId);
      btnProfile.href = url.toString();
    }

    // Reset analyze button
    const btnAnalyze = document.getElementById('btn-analyze-rival');
    if (btnAnalyze) {
      btnAnalyze.textContent = 'Analizar Rival';
      btnAnalyze.disabled = false;
    }

    // Auto-analyze rival for live view
    if (!isAnalyzingRival && currentRivalId) {
      await analyzeAndShowRival(cfg, rivalProfileId);
    }
  });
}

async function analyzeAndShowRival(cfg, rivalId) {
  const btnAnalyze = document.getElementById('btn-analyze-rival');
  isAnalyzingRival = true;
  if (btnAnalyze) {
    btnAnalyze.textContent = 'Analizando...';
    btnAnalyze.disabled = true;
  }

  try {
    currentRivalStats = await runSelfAnalysis(rivalId, cfg.pages, cfg.perPage, cfg.leaderboard || null, cfg.dateFrom, cfg.dateTo);
    currentRivalStats.rival_name = currentRivalName;
    currentRivalStats.rival_id = rivalId;
    renderLiveMatch(currentPlayerStats, currentRivalStats, liveMatchData);
    if (btnAnalyze) btnAnalyze.textContent = 'Actualizado';
  } catch (err) {
    console.error('Error analizando rival:', err);
    if (btnAnalyze) {
      btnAnalyze.textContent = 'Error, reintentar';
      btnAnalyze.disabled = false;
    }
  } finally {
    isAnalyzingRival = false;
  }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  const btnApply = document.getElementById('btn-apply');
  if (btnApply) {
    btnApply.addEventListener('click', async () => {
      const cfg = syncControlsToURL();
      const container = document.getElementById('dashboard');
      container.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Cargando perfil...</div>';
      try {
        currentPlayerStats = await runSelfAnalysis(cfg.playerId, cfg.pages, cfg.perPage, cfg.leaderboard || null, cfg.dateFrom, cfg.dateTo);
        renderDashboard(currentPlayerStats);
        // If live match is active, re-analyze rival too
        if (currentRivalId && !document.getElementById('live-match-section')?.classList.contains('hidden')) {
          await analyzeAndShowRival(cfg, currentRivalId);
        }
      } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="loading-state">Error cargando datos.</div>';
      }
    });
  }

  const btnAnalyze = document.getElementById('btn-analyze-rival');
  if (btnAnalyze) {
    btnAnalyze.addEventListener('click', async () => {
      if (!currentRivalId || isAnalyzingRival) return;
      const cfg = readControls();
      await analyzeAndShowRival(cfg, currentRivalId);
    });
  }

  // Support modal
  const btnSupport = document.getElementById('btn-support');
  const supportModal = document.getElementById('support-modal');
  const modalClose = document.getElementById('modal-close');

  if (btnSupport && supportModal) {
    btnSupport.addEventListener('click', () => supportModal.classList.add('active'));
  }
  if (modalClose && supportModal) {
    modalClose.addEventListener('click', () => supportModal.classList.remove('active'));
  }
  if (supportModal) {
    supportModal.addEventListener('click', (e) => {
      if (e.target === supportModal) supportModal.classList.remove('active');
    });
  }

  // Show donation links if support enabled
  const donationLinks = document.getElementById('donation-links');
  if (donationLinks && window.app_config?.support_enabled) {
    donationLinks.style.display = 'block';
  }
}

function setupSocialLinks() {
  document.querySelectorAll('[data-social]').forEach(link => {
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
      if (link.tagName === 'A') link.target = '_blank';
    } else {
      link.style.opacity = '0.4';
      link.style.pointerEvents = 'none';
    }
  });
}

// ============================================================================
// DATA FETCHING
// ============================================================================

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
  const leaderboards = leaderboardParam ? [leaderboardParam] : ['rm_1v1'];

  let allMatches = [];

  for (const lb of leaderboards) {
    let page = 1;
    while (page <= effPages) {
      const pageMatches = await fetchMatches(playerId, lb, page, effPerPage);
      if (pageMatches.length === 0) break;

      const processed = pageMatches.map(m => {
        if (lb === 'unranked' && !is1v1Match(m)) return null;
        const found = findPlayerInMatch(m, playerId);
        if (!found) return null;
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

  allMatches.sort((a, b) => new Date(b.started) - new Date(a.started));
  const maxMatches = effPages * effPerPage;
  if (allMatches.length > maxMatches) {
    allMatches = allMatches.slice(0, maxMatches);
  }

  if (allMatches.length === 0) {
    throw new Error('No se encontraron partidas.');
  }

  const dataMainPlayer = { player_id: playerId, match_id: 'self' };

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
  stats.player_name = allMatches[0]?.player_name || 'Player';
  stats.rating = await fetchRating(playerId);
  stats.player_profile = computePlayerPrimaryOpenings(parseInt(playerId), stats.all_match_features || []);
  stats.archetype = classifyPlayerArchetype(stats);

  // NEW: Intelligence features
  stats.playstyle = classifyPlaystyle(stats.archetype);
  stats.danger_score = computeDangerScore(stats, stats.rating);
  stats.confidence = computeConfidence(stats);
  stats.confidence_details = computeConfidenceDetails(stats);
  stats.weaknesses = detectWeaknesses(stats);
  stats.threats = detectThreats(stats);
  stats.recommendations = generateRecommendations(stats);
  stats.prediction = generatePrediction(stats);
  stats.timing_interpretation = interpretTimings(stats);
  stats.current_streak = computeStreak(allMatches);

  // Enrich matches for historical data
  const featureMap = new Map();
  if (stats.all_match_features) {
    for (const f of stats.all_match_features) {
      if (f.match_id) featureMap.set(f.match_id, f);
    }
  }
  for (const m of allMatches) {
    const feat = featureMap.get(m.match_id);
    if (feat && feat.opening) m.opening = feat.opening.chosen_opening;
    if (m.started && m.finished) {
      const dur = (new Date(m.finished) - new Date(m.started)) / 1000;
      if (dur > 0 && dur < 7200) m.duration_hms = formatDurationHms(dur);
    }
  }
  stats.matches = allMatches;

  return stats;
}

function formatDurationHms(seconds) {
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h > 0) return `${h}:${String(rm).padStart(2, '0')}`;
  return `${rm} min`;
}

// ============================================================================
// RENDER DISPATCH
// ============================================================================

function renderDashboard(stats) {
  updateHeader(stats);

  const liveSection = document.getElementById('live-match-section');
  const historicalSection = document.getElementById('historical-section');
  const dashboard = document.getElementById('dashboard');

  // If live match is active, show both: live on top, compressed historical below
  if (liveSection && !liveSection.classList.contains('hidden') && currentRivalStats) {
    renderLiveMatch(currentPlayerStats, currentRivalStats, liveMatchData);
    // Render historical but compressed
    dashboard.innerHTML = renderHistoricalAnalysisHTML(stats, true);
  } else {
    // Only historical analysis
    dashboard.innerHTML = renderHistoricalAnalysisHTML(stats, false);
  }

  setupTabs(dashboard);
}

function updateHeader(stats) {
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
}

// ============================================================================
// HISTORICAL ANALYSIS (5 Blocks)
// ============================================================================

function renderHistoricalAnalysisHTML(stats, compressed) {
  let html = '';

  // BLOCK 1: DANGER SCORE (Dominant visual element)
  html += `<div class="block">`;
  html += renderDangerScoreDominant(stats);
  html += `</div>`;

  // BLOCK 2: PREDICTION ENGINE + STRATEGIC RECOMMENDATIONS
  html += `<div class="block">`;
  html += `<div class="section-title">Strategic Intelligence</div>`;
  html += `<div class="block-grid block-grid-2">`;
  html += renderPredictionEngineCard(stats);
  html += renderRecommendationsCard(stats);
  html += `</div></div>`;

  // BLOCK 3: RIVAL PROFILE (Playstyle + Intelligence)
  html += `<div class="block">`;
  html += `<div class="section-title">Rival Profile</div>`;
  html += `<div class="block-grid block-grid-3">`;
  html += renderPlaystyleWithCivsCard(stats);
  html += renderExpectedOpeningCard(stats);
  html += renderConfidenceCard(stats);
  html += `</div></div>`;

  // BLOCK 4: TIMING ANALYSIS (Visual timeline + interpretations)
  html += `<div class="block">`;
  html += `<div class="section-title">Timing Analysis</div>`;
  html += renderTimingAnalysisCard(stats);
  html += `</div>`;

  // BLOCK 5: WEAKNESSES + THREATS
  html += `<div class="block">`;
  html += `<div class="block-grid block-grid-2">`;
  html += renderWeaknessesCard(stats);
  html += renderThreatsCard(stats);
  html += `</div></div>`;

  // BLOCK 6: Detailed Analysis with tabs
  html += `<div class="block">`;
  html += `<div class="section-title">Detailed Analysis</div>`;
  html += renderDetailedAnalysisCard(stats);
  html += `</div>`;

  // BLOCK 7: Historical Data
  html += `<div class="block">`;
  html += `<div class="section-title">Historical Data</div>`;
  html += renderHistoricalDataCard(stats);
  html += `</div>`;

  return html;
}

function renderDangerScoreDominant(stats) {
  const danger = stats.danger_score || { score: 0, level: 'low', label: 'Unknown' };
  const dangerColorClass = danger.level || 'low';
  const wr = stats.win_percent || 0;
  const streak = stats.current_streak || { type: 'none', count: 0 };
  const streakText = streak.type === 'win' ? `+${streak.count} wins` :
                       streak.type === 'loss' ? `-${streak.count} losses` : 'No streak';

  // Calculate expected matchup
  let matchupText = 'Even Matchup';
  if (typeof stats.rating === 'number' && typeof stats.rival_rating === 'number') {
    const diff = stats.rival_rating - stats.rating;
    if (diff > 150) matchupText = 'Very Difficult';
    else if (diff > 50) matchupText = 'Difficult';
    else if (diff < -150) matchupText = 'Very Favorable';
    else if (diff < -50) matchupText = 'Favorable';
  }

  return `<div class="card danger-card" style="padding:24px;text-align:center;">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin-bottom:12px;">Danger Score</div>
    <div style="font-size:48px;font-weight:800;color:var(--danger-${dangerColorClass === 'low' ? 'low' : dangerColorClass === 'medium' ? 'mid' : 'high'});line-height:1;">${danger.score}</div>
    <div style="font-size:20px;font-weight:700;color:var(--danger-${dangerColorClass === 'low' ? 'low' : dangerColorClass === 'medium' ? 'mid' : 'high'});margin-top:8px;">${danger.label.toUpperCase()}</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-top:12px;">Expected Matchup: <strong style="color:var(--text-primary);">${matchupText}</strong></div>
    <div style="display:flex;justify-content:center;gap:16px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border-subtle);">
      <div style="text-align:center;">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Rating</div>
        <div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-top:2px;">${stats.rating || '—'}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Winrate</div>
        <div style="font-size:18px;font-weight:700;color:${wr >= 50 ? 'var(--accent-green)' : 'var(--accent-red)'};margin-top:2px;">${wr}%</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Games</div>
        <div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-top:2px;">${stats.analyzed}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Streak</div>
        <div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-top:2px;">${streakText}</div>
      </div>
    </div>
  </div>`;
}

function renderPredictionEngineCard(stats) {
  const pred = stats.prediction || {};
  const expected = pred.expected_strategy || 'Analyzing...';
  const prob = pred.strategy_probability || 0;
  const counterRecs = pred.counter_recommendations || [];

  // Build horizontal bar for probability
  let barsHtml = '';
  if (prob > 0) {
    const pp = stats.player_profile || {};
    const freq = pp.per_opening_frequency || {};
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const maxPct = sorted.length > 0 ? sorted[0][1] : 100;
    const colors = ['var(--accent-blue)', 'var(--accent-purple)', 'var(--accent-orange)'];
    for (let i = 0; i < sorted.length; i++) {
      const [name, pct] = sorted[i];
      const width = maxPct > 0 ? (pct / maxPct) * 100 : 0;
      barsHtml += `<div class="opening-bar-row">
        <div class="opening-bar-label">${formatOpeningName(name)}</div>
        <div class="opening-bar-track"><div class="opening-bar-fill" style="width:${width}%;background:${colors[i]}"></div></div>
        <div class="opening-bar-pct">${pct}%</div>
      </div>`;
    }
  }

  let counterHtml = '';
  for (const rec of counterRecs) {
    counterHtml += `<li><span class="check">✓</span> ${escapeHtml(rec)}</li>`;
  }

  return `<div class="card" style="padding:20px;">
    <div class="card-label">Expected Strategy</div>
    <div style="font-size:22px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">${escapeHtml(expected)}</div>
    ${prob > 0 ? `<div class="card-subtitle">Probability: ${prob}%</div>` : ''}
    ${barsHtml ? `<div style="margin-top:12px;margin-bottom:16px;">${barsHtml}</div>` : ''}
    <div style="border-top:1px solid var(--border-subtle);padding-top:12px;">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:8px;">Recommended Counter</div>
      <ul class="recommendation-list">${counterHtml || '<li><span class="check">✓</span> Analyze rival for specific counters</li>'}</ul>
    </div>
  </div>`;
}

function renderConfidenceCard(stats) {
  const cd = stats.confidence_details || { level: 'Low', percentage: 30, games_analyzed: 0, message: 'Limited data' };
  const arch = stats.archetype || {};
  const dims = arch.dimensions || {};

  return `<div class="card">
    <div class="card-label">Analysis Confidence</div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      <div style="font-size:28px;font-weight:800;color:var(--text-primary);">${cd.percentage}%</div>
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--text-primary);">${cd.level}</div>
        <div style="font-size:11px;color:var(--text-muted);">${cd.games_analyzed} games analyzed</div>
      </div>
    </div>
    <div style="width:100%;height:8px;background:rgba(30,30,46,0.06);border-radius:4px;overflow:hidden;margin-bottom:10px;">
      <div style="width:${cd.percentage}%;height:100%;background:linear-gradient(90deg,var(--accent-blue),var(--accent-purple));border-radius:4px;transition:width 0.8s ease;"></div>
    </div>
    <div class="card-subtitle" style="font-size:12px;">${cd.message}</div>
    <div class="dimension-bars" style="margin-top:12px;">
      ${['aggression','economy','versatility'].map(key => {
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        const val = dims[key] || 0;
        const colors = { aggression: 'var(--accent-red)', economy: 'var(--accent-green)', versatility: 'var(--accent-purple)' };
        return `<div class="dim-row">
          <div class="dim-label">${label}</div>
          <div class="dim-bar-track"><div class="dim-bar-fill" style="width:${val}%;background:${colors[key]}"></div></div>
          <div class="dim-value">${val}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderExpectedOpeningCard(stats) {
  const pp = stats.player_profile || {};
  const primary = pp.primary_opening || 'Unknown';
  const freq = pp.per_opening_frequency || {};
  const stability = Math.round((pp.opening_stability || 0) * 100);
  const confidence = stability >= 60 ? 'High' : stability >= 30 ? 'Medium' : 'Low';

  const openingIcons = {
    'drush': '⚔️', 'scout_rush': '🐴', 'archer_rush': '🏹',
    'fast_feudal_aggressive': '⚡', 'fast_castle': '🏰', 'tower_rush': '🏗️',
    'Standard/Unknown': '❓', 'Mixed/No Data': '❓',
  };

  const icon = openingIcons[primary] || '❓';
  const displayName = formatOpeningName(primary);

  const sortedOpenings = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const maxPct = sortedOpenings.length > 0 ? sortedOpenings[0][1] : 100;
  const barColors = ['var(--accent-blue)', 'var(--accent-purple)', 'var(--accent-orange)'];

  let barsHtml = '';
  for (let i = 0; i < sortedOpenings.length; i++) {
    const [name, pct] = sortedOpenings[i];
    const width = maxPct > 0 ? (pct / maxPct) * 100 : 0;
    barsHtml += `<div class="opening-bar-row">
      <div class="opening-bar-label">${formatOpeningName(name)}</div>
      <div class="opening-bar-track"><div class="opening-bar-fill" style="width:${width}%;background:${barColors[i]}"></div></div>
      <div class="opening-bar-pct">${pct}%</div>
    </div>`;
  }

  return `<div class="card">
    <div class="card-label">Expected Opening</div>
    <div style="font-size:18px;font-weight:700;margin-bottom:4px;">${icon} ${displayName}</div>
    <div class="card-subtitle">Probability: ${freq[primary] || 0}% · Confidence: ${confidence}</div>
    ${barsHtml ? `<div style="margin-top:10px;">${barsHtml}</div>` : ''}
  </div>`;
}

function renderPlaystyleWithCivsCard(stats) {
  const playstyle = stats.playstyle || { label: 'Unknown', score: 0 };
  const arch = stats.archetype || {};
  const aggression = arch.dimensions?.aggression || 0;

  // Integrate top 3 civs directly here
  const civs = stats.civ_played_percent || {};
  const sortedCivs = Object.entries(civs).sort((a, b) => b[1] - a[1]).slice(0, 3);
  let civsHtml = '';
  if (sortedCivs.length > 0) {
    civsHtml = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-subtle);">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:6px;">Most Played Civs</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">`;
    for (const [civ, pct] of sortedCivs) {
      civsHtml += `<span style="background:rgba(30,30,46,0.04);border:1px solid var(--border-subtle);padding:3px 10px;border-radius:10px;font-size:12px;color:var(--text-secondary);">${escapeHtml(civ)} <span style="color:var(--accent-blue);font-weight:600;">${pct}%</span></span>`;
    }
    civsHtml += `</div></div>`;
  }

  return `<div class="card">
    <div class="card-label">Preferred Playstyle</div>
    <div class="playstyle-badge ${playstyle.label.toLowerCase().replace(/\s+/g, '')}">${playstyle.label}</div>
    <div class="playstyle-score">Average Feudal aggression: ${aggression}/100</div>
    ${arch.description ? `<div class="card-subtitle" style="margin-top:8px;">${arch.description}</div>` : ''}
    ${civsHtml}
  </div>`;
}

function renderTimingAnalysisCard(stats) {
  const interpretations = stats.timing_interpretation || [];
  const feudal = stats.avg_feudal || 0;
  const castle = stats.avg_castle || 0;
  const imperial = stats.avg_imperial || 0;
  const duration = stats.avg_duration_hms || 'N/A';

  // Build visual timeline
  let timelineHtml = '';
  const maxTime = Math.max(feudal, castle, imperial, 1);

  if (feudal > 0) {
    const fPct = (feudal / maxTime) * 100;
    timelineHtml += `<div class="timeline-track">
      <div class="timeline-label">Feudal</div>
      <div class="timeline-bar-track"><div class="timeline-bar" style="width:${fPct}%;background:var(--accent-green)"></div></div>
      <div class="timeline-time">${stats.avg_feudal_hms}</div>
    </div>`;
  }
  if (castle > 0) {
    const cPct = (castle / maxTime) * 100;
    timelineHtml += `<div class="timeline-track">
      <div class="timeline-label">Castle</div>
      <div class="timeline-bar-track"><div class="timeline-bar" style="width:${cPct}%;background:var(--accent-blue)"></div></div>
      <div class="timeline-time">${stats.avg_castle_hms}</div>
    </div>`;
  }
  if (imperial > 0) {
    const iPct = (imperial / maxTime) * 100;
    timelineHtml += `<div class="timeline-track">
      <div class="timeline-label">Imperial</div>
      <div class="timeline-bar-track"><div class="timeline-bar" style="width:${iPct}%;background:var(--accent-purple)"></div></div>
      <div class="timeline-time">${stats.avg_imperial_hms}</div>
    </div>`;
  }

  // Build interpretations
  let interpHtml = '';
  for (const interp of interpretations) {
    const colorClass = interp.type === 'positive' ? 'text-green' : interp.type === 'warning' ? 'text-yellow' : 'text-blue';
    interpHtml += `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:13px;">
      <span style="font-weight:700;${colorClass === 'text-green' ? 'color:var(--accent-green);' : colorClass === 'text-yellow' ? 'color:var(--accent-yellow);' : 'color:var(--accent-blue);'}flex-shrink:0;">${interp.icon}</span>
      <span><strong>${interp.timing}${interp.value ? ` (${interp.value})` : ''}</strong> — ${interp.conclusion}</span>
    </div>`;
  }

  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div class="card-label" style="margin:0;">Age Timeline</div>
      <div style="font-size:12px;color:var(--text-muted);">Avg Game: ${duration}</div>
    </div>
    <div style="margin-bottom:16px;">${timelineHtml}</div>
    ${interpHtml ? `<div style="border-top:1px solid var(--border-subtle);padding-top:8px;">
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:6px;">Interpretation</div>
      ${interpHtml}
    </div>` : ''}
  </div>`;
}

function renderRecommendationsCard(stats) {
  const recs = stats.recommendations || [];

  let html = `<div class="card" style="padding:20px;">`;
  html += `<div class="card-label">Strategic Recommendations</div>`;
  html += `<ul class="recommendation-list">`;

  if (recs.length > 0) {
    for (const rec of recs.slice(0, 6)) {
      const icon = rec.type === 'must' ? '<span class="check">✓</span>' :
                   rec.type === 'warn' ? '<span class="warn">⚠</span>' :
                   '<span class="danger">✗</span>';
      html += `<li>${icon} ${escapeHtml(rec.text)}</li>`;
    }
  } else {
    html += `<li><span class="check">✓</span> Analyze rival matches for specific recommendations</li>`;
  }

  html += `</ul></div>`;
  return html;
}

function renderWeaknessesCard(stats) {
  const weaknesses = stats.weaknesses || [];

  if (weaknesses.length === 0) {
    return `<div class="card">
      <div class="card-label">Weaknesses Detected</div>
      <div class="card-subtitle">No clear weaknesses identified yet.</div>
    </div>`;
  }

  return `<div class="card">
    <div class="card-label">Weaknesses Detected</div>
    <ul class="weakness-list">
      ${weaknesses.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
    </ul>
  </div>`;
}

function renderThreatsCard(stats) {
  const threats = stats.threats || [];

  if (threats.length === 0) {
    return `<div class="card">
      <div class="card-label">Major Threats</div>
      <div class="card-subtitle">No extreme threats detected.</div>
    </div>`;
  }

  return `<div class="card">
    <div class="card-label">Major Threats</div>
    <ul class="threat-list">
      ${threats.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
    </ul>
  </div>`;
}

function renderDetailedAnalysisCard(stats) {
  const tabIds = ['overview', 'military', 'economy', 'openings', 'maps', 'civs'];
  const tabLabels = ['Overview', 'Military', 'Economy', 'Openings', 'Maps', 'Civs'];

  let html = `<div class="card">`;
  html += `<div class="tabs-nav">`;
  for (let i = 0; i < tabIds.length; i++) {
    html += `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${tabIds[i]}">${tabLabels[i]}</button>`;
  }
  html += `</div>`;

  html += buildOverviewPanel(stats, tabIds[0]);
  html += buildMilitaryPanel(stats, tabIds[1]);
  html += buildEconomyPanel(stats, tabIds[2]);
  html += buildOpeningsPanel(stats, tabIds[3]);
  html += buildMapsPanel(stats, tabIds[4]);
  html += buildCivsPanel(stats, tabIds[5]);

  html += `</div>`;
  return html;
}

function buildOverviewPanel(stats, id) {
  const wr = stats.win_percent || 0;
  const games = stats.analyzed || 0;
  const wins = stats.total_wins || 0;
  const streak = stats.current_streak || { type: 'none', count: 0 };
  const streakText = streak.type === 'win' ? `+${streak.count} wins` :
                       streak.type === 'loss' ? `-${streak.count} losses` : 'No streak';

  return `<div class="tab-panel active" data-panel="${id}">
    <div class="tab-stat-grid">
      <div class="tab-stat-item"><div class="tab-stat-label">Games</div><div class="tab-stat-value">${games}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Winrate</div><div class="tab-stat-value ${wr >= 50 ? 'text-green' : 'text-red'}">${wr}%</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Wins / Losses</div><div class="tab-stat-value">${wins} / ${games - wins}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Current Streak</div><div class="tab-stat-value">${streakText}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Avg ELO</div><div class="tab-stat-value">${stats.rating || '—'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Avg EAPM</div><div class="tab-stat-value">${stats.avg_eapm || '—'}</div></div>
    </div>
  </div>`;
}

function buildMilitaryPanel(stats, id) {
  const unitCats = stats.unit_categories || {};
  const aggression = stats.archetype?.dimensions?.aggression || 0;
  const totalUnits = Object.values(unitCats).reduce((sum, cat) => sum + (cat.count || 0), 0);

  const cats = [
    { key: 'cavalry', label: 'Cavalry', color: 'var(--accent-orange)' },
    { key: 'archers', label: 'Archers', color: 'var(--accent-yellow)' },
    { key: 'infantry', label: 'Infantry', color: 'var(--accent-red)' },
    { key: 'siege', label: 'Siege', color: 'var(--accent-purple)' },
  ];

  let compositionHtml = '';
  for (const cat of cats) {
    const data = unitCats[cat.key];
    if (!data || !data.count) continue;
    const pct = Math.round((data.count / totalUnits) * 100);
    compositionHtml += `<div class="opening-bar-row" style="margin-bottom:5px;">
      <div class="opening-bar-label" style="width:80px;">${cat.label}</div>
      <div class="opening-bar-track"><div class="opening-bar-fill" style="width:${pct}%;background:${cat.color}"></div></div>
      <div class="opening-bar-pct">${pct}%</div>
    </div>`;
  }

  return `<div class="tab-panel" data-panel="${id}">
    <div class="tab-stat-grid" style="margin-bottom:12px;">
      <div class="tab-stat-item"><div class="tab-stat-label">Aggression Score</div><div class="tab-stat-value">${aggression}/100</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Total Units</div><div class="tab-stat-value">${totalUnits}</div></div>
    </div>
    ${compositionHtml ? `<div><div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Army Composition</div>${compositionHtml}</div>` : '<div class="card-subtitle" style="padding:10px 0;">No military data available.</div>'}
  </div>`;
}

function buildEconomyPanel(stats, id) {
  const tcTiming = stats.tc_timing || {};
  return `<div class="tab-panel" data-panel="${id}">
    <div class="tab-stat-grid">
      <div class="tab-stat-item"><div class="tab-stat-label">2nd TC Avg</div><div class="tab-stat-value">${tcTiming.tc2_avg_hms || 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">3rd TC Avg</div><div class="tab-stat-value">${tcTiming.tc3_avg_hms || 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Wheelbarrow</div><div class="tab-stat-value">${stats.wheel_barrow_avg != null ? formatHms(stats.wheel_barrow_avg) : 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Hand Cart</div><div class="tab-stat-value">${stats.hand_cart_avg != null ? formatHms(stats.hand_cart_avg) : 'N/A'}</div></div>
    </div>
    ${stats.boom_tendency ? `<div class="card-subtitle" style="margin-top:10px;">Boom tendency: <strong>${stats.boom_tendency}</strong></div>` : ''}
  </div>`;
}

function buildOpeningsPanel(stats, id) {
  const pp = stats.player_profile || {};
  const freq = pp.per_opening_frequency || {};
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const maxPct = sorted.length > 0 ? sorted[0][1] : 100;

  let barsHtml = '';
  const colors = ['var(--accent-blue)', 'var(--accent-purple)', 'var(--accent-orange)', 'var(--accent-green)', 'var(--accent-red)', 'var(--accent-cyan)'];
  for (let i = 0; i < sorted.length; i++) {
    const [name, pct] = sorted[i];
    const width = maxPct > 0 ? (pct / maxPct) * 100 : 0;
    barsHtml += `<div class="opening-bar-row">
      <div class="opening-bar-label">${formatOpeningName(name)}</div>
      <div class="opening-bar-track"><div class="opening-bar-fill" style="width:${width}%;background:${colors[i % colors.length]}"></div></div>
      <div class="opening-bar-pct">${pct}%</div>
    </div>`;
  }

  return `<div class="tab-panel" data-panel="${id}">
    <div style="margin-bottom:8px;"><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Opening Distribution</div>
    ${barsHtml || '<div class="card-subtitle">No opening data available.</div>'}</div>
    ${pp.primary_opening ? `<div class="card-subtitle">Primary: <strong>${formatOpeningName(pp.primary_opening)}</strong> (${Math.round((pp.opening_stability || 0) * 100)}% stability)</div>` : ''}
  </div>`;
}

function buildMapsPanel(stats, id) {
  const maps = stats.map_played_percent || {};
  const sorted = Object.entries(maps).sort((a, b) => b[1] - a[1]);

  let topMaps = '';
  const top3 = sorted.slice(0, 3);
  for (const [map, pct] of top3) {
    const wr = stats.map_win_percent?.[map] ?? 0;
    const wrClass = wr >= 55 ? 'text-green' : wr <= 40 ? 'text-red' : '';
    topMaps += `<div class="timing-row">
      <span class="timing-label">${escapeHtml(map)}</span>
      <span class="timing-value ${wrClass}">${pct}% · ${wr}% WR</span>
    </div>`;
  }

  const worst3 = sorted
    .filter(([m]) => (stats.map_win_percent?.[m] ?? 50) < 45)
    .sort((a, b) => (stats.map_win_percent?.[a[0]] ?? 50) - (stats.map_win_percent?.[b[0]] ?? 50))
    .slice(0, 3);

  let worstMaps = '';
  for (const [map, pct] of worst3) {
    const wr = stats.map_win_percent?.[map] ?? 0;
    worstMaps += `<div class="timing-row">
      <span class="timing-label">${escapeHtml(map)}</span>
      <span class="timing-value text-red">${wr}% WR</span>
    </div>`;
  }

  return `<div class="tab-panel" data-panel="${id}">
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Top Maps</div>
      ${topMaps || '<div class="card-subtitle">No map data.</div>'}
    </div>
    ${worstMaps ? `<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Worst Maps</div>${worstMaps}</div>` : ''}
  </div>`;
}

function buildCivsPanel(stats, id) {
  const civs = stats.civ_played_percent || {};
  const sorted = Object.entries(civs).sort((a, b) => b[1] - a[1]);

  let civsHtml = '';
  for (const [civ, pct] of sorted) {
    const wr = stats.civ_win_percent?.[civ] ?? 0;
    const wrClass = wr >= 55 ? 'text-green' : wr <= 40 ? 'text-red' : '';
    civsHtml += `<div class="timing-row">
      <span class="timing-label">${escapeHtml(civ)}</span>
      <span class="timing-value ${wrClass}">${pct}% · ${wr}% WR</span>
    </div>`;
  }

  return `<div class="tab-panel" data-panel="${id}">
    <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Civilizations</div>
    ${civsHtml || '<div class="card-subtitle">No civilization data.</div>'}
  </div>`;
}

function renderHistoricalDataCard(stats) {
  const matches = stats.matches || [];
  const recent = matches.slice(0, 10);

  if (recent.length === 0) {
    return `<div class="card"><div class="card-subtitle">No match history available.</div></div>`;
  }

  let rows = '';
  for (const m of recent) {
    const date = m.started ? new Date(m.started).toLocaleDateString('es', { month: 'short', day: 'numeric' }) : '—';
    const result = m.won ? '<span class="win">W</span>' : '<span class="loss">L</span>';
    const opening = m.opening ? formatOpeningName(m.opening) : '—';

    rows += `<tr>
      <td>${date}</td>
      <td>${escapeHtml(m.map_name || '—')}</td>
      <td>${escapeHtml(m.player_civ || '?')} vs ${escapeHtml(m.opponent_civ || '?')}</td>
      <td>${result}</td>
      <td>${opening}</td>
      <td>${m.duration_hms || '—'}</td>
    </tr>`;
  }

  return `<div class="card" style="padding:12px;">
    <table class="history-table">
      <thead><tr><th>Date</th><th>Map</th><th>Civs</th><th>Res</th><th>Opening</th><th>Dur</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ============================================================================
// LIVE MATCH INTELLIGENCE
// ============================================================================

function renderLiveMatch(playerStats, rivalStats, matchData) {
  const container = document.getElementById('live-match-content');
  if (!container) return;

  const playerName = playerStats.player_name || 'Player';
  const rivalName = rivalStats.rival_name || currentRivalName || 'Rival';
  const mapName = matchData?.mapName || 'Unknown Map';

  let html = '';

  // Block 1: Match Status
  html += `<div class="block">`;
  html += `<div class="section-title">Match Status</div>`;
  html += `<div class="block-grid block-grid-3">`;
  html += `<div class="card">
    <div class="card-label">Current Game</div>
    <div class="card-value">${escapeHtml(mapName)}</div>
    <div class="card-subtitle">Live match detected</div>
  </div>`;
  html += `<div class="card">
    <div class="card-label">Player</div>
    <div class="card-value">${escapeHtml(playerName)}</div>
    <div class="card-subtitle">Rating: ${playerStats.rating || '—'}</div>
  </div>`;
  html += `<div class="card">
    <div class="card-label">Rival</div>
    <div class="card-value">${escapeHtml(rivalName)}</div>
    <div class="card-subtitle">Rating: ${rivalStats.rating || '—'}</div>
  </div>`;
  html += `</div></div>`;

  // Block 2: Live Advantage
  html += `<div class="block">`;
  html += `<div class="section-title">Live Advantage</div>`;
  html += renderLiveAdvantage(playerStats, rivalStats);
  html += `</div>`;

  // Block 3: Style Comparison
  html += `<div class="block">`;
  html += `<div class="section-title">Style Comparison</div>`;
  html += `<div class="block-grid block-grid-2">`;
  html += renderStyleComparison(playerStats, rivalStats);
  html += renderTempoAnalysis(playerStats, rivalStats);
  html += `</div></div>`;

  // Block 4: Critical Timings
  html += `<div class="block">`;
  html += `<div class="section-title">Critical Timings</div>`;
  html += `<div class="block-grid block-grid-2">`;
  html += renderCriticalTimings(playerStats, rivalStats);
  html += renderTimingInsights(playerStats, rivalStats);
  html += `</div></div>`;

  // Block 5: Expected Transitions
  html += `<div class="block">`;
  html += `<div class="section-title">Expected Transitions</div>`;
  html += renderExpectedTransitions(rivalStats);
  html += `</div>`;

  // Block 6: Detailed Metrics (collapsible-like tabs)
  html += `<div class="block">`;
  html += `<div class="section-title">Detailed Metrics</div>`;
  html += renderLiveDetailedMetrics(playerStats, rivalStats);
  html += `</div>`;

  container.innerHTML = html;
  setupTabs(container);
}

function renderLiveAdvantage(playerStats, rivalStats) {
  // Estimate advantage based on historical data (placeholder for live data integration)
  const playerElo = playerStats.rating || 1000;
  const rivalElo = rivalStats.rating || 1000;
  const playerWR = playerStats.win_percent || 50;
  const rivalWR = rivalStats.win_percent || 50;

  // Simple heuristic for demo (would use live data in full implementation)
  const eloDiff = playerElo - rivalElo;
  const wrDiff = playerWR - rivalWR;
  let advantage = 50 + (eloDiff / 30) + (wrDiff / 2);
  advantage = Math.max(5, Math.min(95, advantage));

  const playerPct = Math.round(advantage);
  const rivalPct = 100 - playerPct;

  const advantageText = playerPct > 55 ? 'Player Advantage' :
                        playerPct < 45 ? 'Rival Advantage' : 'Even';
  const advantageColor = playerPct > 55 ? 'text-green' : playerPct < 45 ? 'text-red' : 'text-yellow';

  return `<div class="card">
    <div class="card-label">Current Advantage Estimate (Historical-based)</div>
    <div class="advantage-comparison">
      <div class="advantage-row">
        <div class="advantage-label">Player</div>
        <div class="advantage-track"><div class="advantage-fill-player" style="width:${playerPct}%"></div></div>
        <div class="advantage-pct">${playerPct}%</div>
      </div>
      <div class="advantage-row">
        <div class="advantage-label">Rival</div>
        <div class="advantage-track"><div class="advantage-fill-rival" style="width:${rivalPct}%"></div></div>
        <div class="advantage-pct">${rivalPct}%</div>
      </div>
    </div>
    <div style="text-align:center;font-size:16px;font-weight:700;" class="${advantageColor}">${advantageText}</div>
    <div class="card-subtitle" style="text-align:center;">Based on ELO differential and historical winrates. Live data will refine this.</div>
  </div>`;
}

function renderStyleComparison(playerStats, rivalStats) {
  const pDims = playerStats.archetype?.dimensions || {};
  const rDims = rivalStats.archetype?.dimensions || {};

  const dimensions = [
    { key: 'aggression', label: 'Aggression' },
    { key: 'economy', label: 'Economy Focus' },
    { key: 'versatility', label: 'Versatility' },
    { key: 'lateGame', label: 'Late Game' },
    { key: 'speed', label: 'Speed' },
  ];

  let html = `<div class="card">`;
  html += `<div class="card-label">Dimension Comparison</div>`;

  for (const dim of dimensions) {
    const pVal = pDims[dim.key] || 0;
    const rVal = rDims[dim.key] || 0;
    const maxVal = Math.max(pVal, rVal, 1);
    const pWidth = (pVal / maxVal) * 100;
    const rWidth = (rVal / maxVal) * 100;

    html += `<div style="margin-bottom:10px;">`;
    html += `<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">${dim.label}</div>`;
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">`;
    html += `<span style="font-size:11px;width:50px;text-align:right;color:var(--accent-blue);font-weight:600;">${pVal}</span>`;
    html += `<div style="flex:1;height:8px;background:rgba(255,255,255,0.04);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${pWidth}%;background:linear-gradient(90deg,var(--accent-blue),rgba(59,130,246,0.5));border-radius:4px;"></div></div>`;
    html += `</div>`;
    html += `<div style="display:flex;align-items:center;gap:8px;">`;
    html += `<span style="font-size:11px;width:50px;text-align:right;color:var(--accent-red);font-weight:600;">${rVal}</span>`;
    html += `<div style="flex:1;height:8px;background:rgba(255,255,255,0.04);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${rWidth}%;background:linear-gradient(90deg,var(--accent-red),rgba(239,68,68,0.5));border-radius:4px;"></div></div>`;
    html += `</div>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function renderTempoAnalysis(playerStats, rivalStats) {
  const pArch = playerStats.archetype || {};
  const rArch = rivalStats.archetype || {};
  const pDims = pArch.dimensions || {};
  const rDims = rArch.dimensions || {};

  function getStars(val) {
    const filled = Math.round(val / 20);
    return '★'.repeat(filled) + '☆'.repeat(5 - filled);
  }

  function getTempoLabel(econ, mil) {
    if (econ > 60 && mil < 30) return 'Greedy boom';
    if (econ > 50 && mil > 40) return 'Macro play';
    if (mil > 60 && econ < 40) return 'Aggressive';
    if (mil < 30 && econ < 40) return 'Defensive / Turtle';
    return 'Balanced';
  }

  return `<div class="card">
    <div class="card-label">Tempo Analysis</div>
    <div class="tempo-grid">
      <div class="tempo-section">
        <div class="tempo-title">${escapeHtml(playerStats.player_name || 'Player')}</div>
        <div class="tempo-item"><span class="tempo-label">Economic Tempo</span><span class="tempo-stars">${getStars(pDims.economy || 0)}</span></div>
        <div class="tempo-item"><span class="tempo-label">Military Tempo</span><span class="tempo-stars">${getStars(pDims.aggression || 0)}</span></div>
        <div class="tempo-item"><span class="tempo-label">Expansion Tempo</span><span class="tempo-stars">${getStars(((pDims.economy || 0) + (pDims.lateGame || 0)) / 2)}</span></div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);font-size:12px;color:var(--text-muted);">${getTempoLabel(pDims.economy || 0, pDims.aggression || 0)}</div>
      </div>
      <div class="tempo-section">
        <div class="tempo-title">${escapeHtml(rivalStats.rival_name || 'Rival')}</div>
        <div class="tempo-item"><span class="tempo-label">Economic Tempo</span><span class="tempo-stars">${getStars(rDims.economy || 0)}</span></div>
        <div class="tempo-item"><span class="tempo-label">Military Tempo</span><span class="tempo-stars">${getStars(rDims.aggression || 0)}</span></div>
        <div class="tempo-item"><span class="tempo-label">Expansion Tempo</span><span class="tempo-stars">${getStars(((rDims.economy || 0) + (rDims.lateGame || 0)) / 2)}</span></div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);font-size:12px;color:var(--text-muted);">${getTempoLabel(rDims.economy || 0, rDims.aggression || 0)}</div>
      </div>
    </div>
  </div>`;
}

function renderCriticalTimings(playerStats, rivalStats) {
  const pAges = {
    feudal: playerStats.avg_feudal_hms || 'N/A',
    castle: playerStats.avg_castle_hms || 'N/A',
    imperial: playerStats.avg_imperial_hms || 'N/A',
  };
  const rAges = {
    feudal: rivalStats.avg_feudal_hms || 'N/A',
    castle: rivalStats.avg_castle_hms || 'N/A',
    imperial: rivalStats.avg_imperial_hms || 'N/A',
  };

  let html = `<div class="card">`;
  html += `<div class="card-label">Historical Timings</div>`;
  html += `<div class="timeline-container">`;

  const events = [
    { age: 'feudal', label: 'Feudal Age' },
    { age: 'castle', label: 'Castle Age' },
    { age: 'imperial', label: 'Imperial Age' },
  ];

  for (const evt of events) {
    html += `<div class="timeline-item">
      <span class="timeline-time">${pAges[evt.age]}</span> <span class="timeline-event">${evt.label} (Player)</span>
    </div>`;
    html += `<div class="timeline-item">
      <span class="timeline-time">${rAges[evt.age]}</span> <span class="timeline-event">${evt.label} (Rival)</span>
    </div>`;
  }

  html += `</div></div>`;
  return html;
}

function renderTimingInsights(playerStats, rivalStats) {
  const pFeudal = playerStats.avg_feudal || 0;
  const rFeudal = rivalStats.avg_feudal || 0;
  const pCastle = playerStats.avg_castle || 0;
  const rCastle = rivalStats.avg_castle || 0;

  const feudalDiff = pFeudal && rFeudal ? pFeudal - rFeudal : 0;
  const castleDiff = pCastle && rCastle ? pCastle - rCastle : 0;

  let insights = [];
  if (feudalDiff < -20) insights.push({ type: 'positive', text: `Faster Feudal (${Math.abs(Math.round(feudalDiff))}s avg)` });
  else if (feudalDiff > 20) insights.push({ type: 'negative', text: `Slower Feudal (${Math.round(feudalDiff)}s avg)` });

  if (castleDiff < -20) insights.push({ type: 'positive', text: `Faster Castle (${Math.abs(Math.round(castleDiff))}s avg)` });
  else if (castleDiff > 20) insights.push({ type: 'negative', text: `Slower Castle (${Math.round(castleDiff)}s avg)` });

  const rAgg = rivalStats.archetype?.dimensions?.aggression || 0;
  if (rAgg > 60) insights.push({ type: 'negative', text: 'Rival invests heavily into military' });
  if (rAgg < 30) insights.push({ type: 'positive', text: 'Rival plays passive — eco lead likely' });

  if (insights.length === 0) insights.push({ type: 'neutral', text: 'Historical timings are similar' });

  let html = `<div class="card">`;
  html += `<div class="card-label">Timing Analysis</div>`;
  html += `<ul class="recommendation-list">`;
  for (const insight of insights) {
    const icon = insight.type === 'positive' ? '<span class="check">✓</span>' :
                 insight.type === 'negative' ? '<span class="danger">⚠</span>' :
                 '<span class="warn">•</span>';
    html += `<li>${icon} ${escapeHtml(insight.text)}</li>`;
  }
  html += `</ul></div>`;
  return html;
}

function renderExpectedTransitions(rivalStats) {
  const pp = rivalStats.player_profile || {};
  const freq = pp.per_opening_frequency || {};

  // Map openings to expected transitions
  const transitions = {
    'scout_rush': { 'Knights': 60, 'Skirmishers': 20, 'Archers': 15, 'Siege': 5 },
    'archer_rush': { 'Crossbows': 55, 'Knights': 25, 'Siege': 15, 'Monks': 5 },
    'fast_castle': { 'Knights': 50, 'Boom': 30, 'Unique Unit': 15, 'Monks': 5 },
    'drush': { 'Archers': 45, 'Fast Castle': 30, 'Scouts': 20, 'Tower': 5 },
    'fast_feudal_aggressive': { 'Archers': 40, 'Scouts': 35, 'Tower': 15, 'Fast Castle': 10 },
  };

  const primary = pp.primary_opening || 'Unknown';
  const transitionMap = transitions[primary] || { 'Standard follow-up': 100 };

  const totalPct = Object.values(transitionMap).reduce((a, b) => a + b, 0);
  const sortedTrans = Object.entries(transitionMap).sort((a, b) => b[1] - a[1]);

  let barsHtml = '';
  for (const [unit, pct] of sortedTrans) {
    const width = totalPct > 0 ? (pct / totalPct) * 100 : 0;
    barsHtml += `<div class="opening-bar-row">
      <div class="opening-bar-label">${unit}</div>
      <div class="opening-bar-track"><div class="opening-bar-fill" style="width:${width}%;background:var(--accent-blue)"></div></div>
      <div class="opening-bar-pct">${pct}%</div>
    </div>`;
  }

  return `<div class="card">
    <div class="card-label">Expected Rival Transition</div>
    <div class="card-subtitle">Based on primary opening: ${formatOpeningName(primary)}</div>
    <div style="margin-top:10px;">${barsHtml}</div>
  </div>`;
}

function renderLiveDetailedMetrics(playerStats, rivalStats) {
  const tabIds = ['economy', 'military', 'production', 'openings'];
  const tabLabels = ['Economy', 'Military', 'Production', 'Openings'];

  let html = `<div class="card">`;
  html += `<div class="tabs-nav">`;
  for (let i = 0; i < tabIds.length; i++) {
    html += `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="live-${tabIds[i]}">${tabLabels[i]}</button>`;
  }
  html += `</div>`;

  // Economy tab
  html += `<div class="tab-panel active" data-panel="live-economy">
    <div class="tab-stat-grid">
      <div class="tab-stat-item"><div class="tab-stat-label">Player 2nd TC</div><div class="tab-stat-value">${playerStats.tc_timing?.tc2_avg_hms || 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Rival 2nd TC</div><div class="tab-stat-value">${rivalStats.tc_timing?.tc2_avg_hms || 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Player Wheelbarrow</div><div class="tab-stat-value">${playerStats.wheel_barrow_avg != null ? formatHms(playerStats.wheel_barrow_avg) : 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Rival Wheelbarrow</div><div class="tab-stat-value">${rivalStats.wheel_barrow_avg != null ? formatHms(rivalStats.wheel_barrow_avg) : 'N/A'}</div></div>
    </div>
  </div>`;

  // Military tab
  const pAgg = playerStats.archetype?.dimensions?.aggression || 0;
  const rAgg = rivalStats.archetype?.dimensions?.aggression || 0;
  html += `<div class="tab-panel" data-panel="live-military">
    <div class="tab-stat-grid">
      <div class="tab-stat-item"><div class="tab-stat-label">Player Aggression</div><div class="tab-stat-value">${pAgg}/100</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Rival Aggression</div><div class="tab-stat-value">${rAgg}/100</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Player Units</div><div class="tab-stat-value">${Object.values(playerStats.unit_categories || {}).reduce((s, c) => s + (c.count || 0), 0)}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Rival Units</div><div class="tab-stat-value">${Object.values(rivalStats.unit_categories || {}).reduce((s, c) => s + (c.count || 0), 0)}</div></div>
    </div>
  </div>`;

  // Production tab
  html += `<div class="tab-panel" data-panel="live-production">
    <div class="card-subtitle">Production data will appear here when live match data is available.</div>
  </div>`;

  // Openings tab
  html += `<div class="tab-panel" data-panel="live-openings">
    <div style="margin-bottom:8px;"><strong>Player:</strong> ${formatOpeningName(playerStats.player_profile?.primary_opening || 'Unknown')}</div>
    <div><strong>Rival:</strong> ${formatOpeningName(rivalStats.player_profile?.primary_opening || 'Unknown')}</div>
  </div>`;

  html += `</div>`;
  return html;
}

// ============================================================================
// TABS SETUP
// ============================================================================

function setupTabs(container) {
  const tabBtns = container.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (!tabId) return;

      tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
      container.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panel === tabId);
      });
    });
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function formatOpeningName(label) {
  if (!label) return 'Unknown';
  const map = {
    'drush': 'Drush',
    'scout_rush': 'Scout Rush',
    'archer_rush': 'Archer Rush',
    'fast_feudal_aggressive': 'Fast Feudal Aggro',
    'fast_castle': 'Fast Castle',
    'tower_rush': 'Tower Rush',
    'Standard/Unknown': 'Standard',
    'Mixed/No Data': 'Mixed',
  };
  return map[label] || label.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
