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
import { resolveCivNumber, sleep, formatHms, techDisplayName, escapeHtml } from './utils.js';
import { initWebSocket } from './websocket.js';
import { initI18n, t, formatOpeningName, getLanguage, setLanguage } from './i18n.js';
import { generateInsights, renderInsightCard } from './insights.js';

const DEFAULT_PLAYER_ID = '8621659';
const PER_PAGE = 10;
const PAGES = 1;
let cachedKnowledgeBase = null;

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
  await initI18n();
  if (!cachedKnowledgeBase) {
    cachedKnowledgeBase = await loadKnowledgeBase();
  }

  let cfg = readControls();
  syncURLToControls(cfg);

  setupEventListeners();
  setupSocialLinks();

  const container = document.getElementById('dashboard');
  container.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div>${t('app.loading')}</div>`;

  try {
    currentPlayerStats = await runSelfAnalysis(cfg.playerId, cfg.pages, cfg.perPage, cfg.leaderboard || null, cfg.dateFrom, cfg.dateTo);
    renderDashboard(currentPlayerStats);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="loading-state">${t('app.error')}</div>`;
  }

  initWebSocket(cfg.playerId, 'self', async ({ matchData, rivalProfileId }) => {
    const banner = document.getElementById('live-match-section');
    const info = document.getElementById('live-match-info');
    const rivalName = matchData.players?.find(p => p.profileId === rivalProfileId)?.name || 'Rival';

    currentRivalId = rivalProfileId;
    currentRivalName = rivalName;
    liveMatchData = matchData;

    if (info) info.innerHTML = `<span>vs ${escapeHtml(rivalName)}</span><span class="text-sm text-muted ml-2">en ${escapeHtml(matchData.mapName || '???')}</span>`;
    if (banner) banner.classList.remove('hidden');

    const btnProfile = document.getElementById('btn-rival-profile');
    if (btnProfile) {
      const url = new URL(window.location.href);
      url.searchParams.set('player_id', rivalProfileId);
      btnProfile.href = url.toString();
    }

    const btnAnalyze = document.getElementById('btn-analyze-rival');
    if (btnAnalyze) {
      btnAnalyze.textContent = 'Analizar Rival';
      btnAnalyze.disabled = false;
    }

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

  const donationLinks = document.getElementById('donation-links');
  if (donationLinks && window.app_config?.support_enabled) {
    donationLinks.style.display = 'block';
  }

  const langSelector = document.getElementById('lang-selector');
  if (langSelector) {
    langSelector.value = getLanguage();
    langSelector.addEventListener('change', () => {
      const lang = langSelector.value;
      const url = new URL(window.location.href);
      if (lang) {
        setLanguage(lang);
        url.searchParams.set('lang', lang);
      } else {
        url.searchParams.delete('lang');
      }
      window.location.href = url.toString();
    });
  }

  setupPlayerSearch();
}

// ============================================================================
// PLAYER SEARCH
// ============================================================================

function setupPlayerSearch() {
  const input = document.getElementById('player-search-input');
  const btn = document.getElementById('player-search-btn');
  const results = document.getElementById('player-search-results');
  if (!input || !results) return;

  let debounceTimer = null;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 2) {
      results.classList.add('hidden');
      return;
    }
    debounceTimer = setTimeout(() => searchPlayers(query), 400);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimer);
      const query = input.value.trim();
      if (query.length >= 2) searchPlayers(query);
    }
  });

  if (btn) {
    btn.addEventListener('click', () => {
      const query = input.value.trim();
      if (query.length >= 2) searchPlayers(query);
    });
  }

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !results.contains(e.target) && !btn?.contains(e.target)) {
      results.classList.add('hidden');
    }
  });
}

let searchAbortController = null;

async function searchPlayers(query) {
  const results = document.getElementById('player-search-results');
  if (!results) return;

  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();

  results.innerHTML = '<div class="search-loading">Searching...</div>';
  results.classList.remove('hidden');

  try {
    const url = `https://data.aoe2companion.com/api/profiles?search=${encodeURIComponent(query)}&extend=profiles.avatar_medium_url,profiles.avatar_full_url&language=es&page=1`;
    const res = await fetch(url, {
      signal: searchAbortController.signal,
      headers: { 'User-Agent': 'eduardr10-stats-script' },
    });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    const profiles = data.profiles || [];
    renderSearchResults(profiles);
  } catch (err) {
    if (err.name === 'AbortError') return;
    results.innerHTML = '<div class="search-no-results">Error searching. Try again.</div>';
  }
}

function renderSearchResults(profiles) {
  const results = document.getElementById('player-search-results');
  if (!results) return;

  if (profiles.length === 0) {
    results.innerHTML = '<div class="search-no-results">No players found.</div>';
    return;
  }

  let html = '';
  for (const p of profiles.slice(0, 8)) {
    const name = p.name || 'Unknown';
    const profileId = p.profileId;
    const rating = p.rating || p.ratings?.[0]?.rating || '—';
    const avatarUrl = p.avatar_medium_url || p.avatar_full_url || '';
    const initial = name.charAt(0).toUpperCase();

    html += `<a href="?player_id=${profileId}" class="search-result-item" data-profile-id="${profileId}">`;
    if (avatarUrl) {
      html += `<div class="search-result-avatar"><img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy"></div>`;
    } else {
      html += `<div class="search-result-avatar">${initial}</div>`;
    }
    html += `<div class="search-result-info">
      <div class="search-result-name">${escapeHtml(name)}</div>
      <div class="search-result-meta">ID: ${profileId}</div>
    </div>`;
    html += `<div class="search-result-rating">${rating}</div>`;
    html += `</a>`;
  }

  results.innerHTML = html;

  results.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const profileId = item.dataset.profileId;
      if (!profileId) return;
      const url = new URL(window.location.href);
      url.search = `?player_id=${profileId}`;
      window.location.href = url.toString();
    });
  });
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

  allMatches = allMatches.filter(m => m.finished !== null);
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

  const mainCivEntry = Object.entries(stats.civ_played_percent || {}).sort((a, b) => b[1] - a[1])[0];
  const mainCivName = mainCivEntry ? mainCivEntry[0] : '';
  cachedKnowledgeBase = await loadKnowledgeBase();
  stats.strategic_analysis = buildStrategicAnalysis(stats, mainCivName);

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
  const dashboard = document.getElementById('dashboard');

  if (liveSection && !liveSection.classList.contains('hidden') && currentRivalStats) {
    renderLiveMatch(currentPlayerStats, currentRivalStats, liveMatchData);
    dashboard.innerHTML = renderHistoricalAnalysisHTML(stats, true);
  } else {
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

  const headerSocial = document.querySelector('.header-social');
  if (headerSocial && stats.player_id) {
    let companionLink = headerSocial.querySelector('.btn-companion');
    if (!companionLink) {
      companionLink = document.createElement('a');
      companionLink.className = 'btn-companion';
      companionLink.target = '_blank';
      companionLink.textContent = t('app.viewOnCompanion');
      headerSocial.insertBefore(companionLink, headerSocial.firstChild);
    }
    companionLink.href = `https://www.aoe2companion.com/players/${stats.player_id}`;
  }
}

// ============================================================================
// HISTORICAL ANALYSIS (Consolidated)
// ============================================================================

function renderHistoricalAnalysisHTML(stats, compressed) {
  let html = '';

  // SECTION 1: Executive Summary (consolidated banner)
  html += `<div class="block">`;
  html += renderExecutiveSummary(stats);
  html += `</div>`;

  // SECTION 2: Findings (unified insights list)
  const insights = generateInsights(stats, cachedKnowledgeBase || {});
  html += renderFindingsSection(insights);

  // SECTION 3: Timing Analysis
  html += `<div class="block">`;
  html += `<div class="section-title">${t('sections.timingAnalysis')}</div>`;
  html += renderTimingAnalysisCard(stats);
  html += `</div>`;

  // SECTION 4: Detailed Analysis (tabs)
  html += `<div class="block">`;
  html += `<div class="section-title">${t('sections.detailedAnalysis')}</div>`;
  html += renderDetailedAnalysisCard(stats);
  html += `</div>`;

  // SECTION 5: Historical Data
  html += `<div class="block">`;
  html += `<div class="section-title">${t('sections.historicalData')}</div>`;
  html += renderHistoricalDataCard(stats);
  html += `</div>`;

  return html;
}

function renderExecutiveSummary(stats) {
  const wr = stats.win_percent || 0;
  const games = stats.analyzed || 0;
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const arch = stats.archetype || {};
  const dims = arch.dimensions || {};
  const playstyle = stats.playstyle || { label: 'Unknown', score: 0 };

  // Best map by play count
  let bestMap = null;
  const mapPlayed = stats.map_played || {};
  const mapWR = stats.map_win_percent || {};
  for (const [map, count] of Object.entries(mapPlayed)) {
    if (count >= 2 && (!bestMap || count > bestMap.count)) {
      bestMap = { name: map, count, wr: mapWR[map] || 0 };
    }
  }

  // Main opening
  const primaryOpening = pp.primary_opening || 'Unknown';
  const stability = pp.opening_stability || 0;
  let mainStyle = t('banner.mixedOpenings');
  if (primaryOpening && primaryOpening !== 'Unknown' && stability >= 0.4) {
    const sorted = Object.entries(perFreq).sort((a, b) => b[1] - a[1]);
    const top2 = sorted.slice(0, 2);
    if (top2.length === 1) mainStyle = `${formatOpeningName(top2[0][0])}`;
    else if (top2.length >= 2) mainStyle = `${formatOpeningName(top2[0][0])} / ${formatOpeningName(top2[1][0])}`;
  }

  // Main weakness
  const weaknesses = stats.weaknesses || [];
  let mainWeakness = t('banner.noWeakness');
  if (weaknesses.length > 0 && weaknesses[0] !== 'No extreme patterns detected') {
    mainWeakness = weaknesses[0];
  }

  // Top 3 civs
  const civs = stats.civ_played_percent || {};
  const sortedCivs = Object.entries(civs).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // Aggression label
  const aggression = dims.aggression || 0;
  const aggressionLabel = aggression >= 65 ? 'High' : aggression >= 40 ? 'Moderate' : 'Low';

  return `<div class="card executive-summary">
    <div class="executive-summary-grid">
      <!-- Left: Player info -->
      <div class="executive-summary-left">
        <div class="player-name-large">${escapeHtml(stats.player_name || 'Player')}</div>
        <div class="player-meta">
          ${stats.rating ? `${stats.rating} ${t('header.rating')}` : ''}
          ${stats.rating && wr > 0 ? ' · ' : ''}
          ${wr > 0 ? `${wr}% ${t('header.winrate')}` : ''}
          ${games > 0 ? ` · ${games} ${t('header.games')}` : ''}
        </div>
        <div class="playstyle-section">
          <div class="playstyle-badge ${playstyle.label.toLowerCase().replace(/\s+/g, '')}">${playstyle.label}</div>
          <div class="playstyle-score">${t('aggressionScore')}: ${aggression}/100 (${aggressionLabel})</div>
        </div>
        ${sortedCivs.length > 0 ? `<div class="civs-section">
          <div class="section-label">${t('mostPlayedCivs')}</div>
          <div class="civs-tags">
            ${sortedCivs.map(([civ, pct]) => `<span class="civ-tag">${escapeHtml(civ)} <span class="civ-pct">${pct}%</span></span>`).join('')}
          </div>
        </div>` : ''}
      </div>
      
      <!-- Right: Key metrics -->
      <div class="executive-summary-right">
        <div class="section-label">${t('banner.rivalSnapshot')}</div>
        <div class="metrics-grid">
          <div class="metric-item">
            <div class="metric-icon">🏹</div>
            <div class="metric-content">
              <div class="metric-label">${t('banner.mainStyle')}</div>
              <div class="metric-value">${escapeHtml(mainStyle)}</div>
            </div>
          </div>
          ${bestMap ? `<div class="metric-item">
            <div class="metric-icon">🌍</div>
            <div class="metric-content">
              <div class="metric-label">${t('banner.favoriteMap')}</div>
              <div class="metric-value">${escapeHtml(bestMap.name)} <span class="metric-sub">(${bestMap.count} ${t('banner.games')})</span></div>
            </div>
          </div>` : ''}
          <div class="metric-item">
            <div class="metric-icon">🏰</div>
            <div class="metric-content">
              <div class="metric-label">${t('banner.typicalTiming')}</div>
              <div class="metric-value">${t('sections.openings')} ${stats.avg_feudal_hms || 'N/A'}</div>
            </div>
          </div>
          <div class="metric-item">
            <div class="metric-icon">⚠</div>
            <div class="metric-content">
              <div class="metric-label">${t('banner.mainWeakness')}</div>
              <div class="metric-value text-red">${escapeHtml(mainWeakness)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderFindingsSection(insights) {
  if (!insights || insights.length === 0) return '';

  let html = `<div class="block">`;
  html += `<div class="section-title">${t('sections.insights')}</div>`;
  html += `<div class="block-grid block-grid-2">`;
  
  for (const insight of insights) {
    html += renderInsightCard(insight);
  }
  
  html += `</div></div>`;
  return html;
}

function renderTimingAnalysisCard(stats) {
  const interpretations = stats.timing_interpretation || [];
  const feudal = stats.avg_feudal || 0;
  const castle = stats.avg_castle || 0;
  const imperial = stats.avg_imperial || 0;
  const duration = stats.avg_duration_hms || 'N/A';

  let leftHtml = '';
  const ages = [
    { key: 'feudal', label: t('feudal'), color: 'var(--accent-green)' },
    { key: 'castle', label: t('castle'), color: 'var(--accent-blue)' },
    { key: 'imperial', label: t('imperial'), color: 'var(--accent-purple)' },
  ];
  for (const age of ages) {
    const avg = stats['avg_' + age.key + '_hms'] || 'N/A';
    const winAvg = stats.age_time_win_avg?.[age.key];
    const lossAvg = stats.age_time_loss_avg?.[age.key];
    let diffHtml = '';
    if (winAvg != null && lossAvg != null) {
      const gap = lossAvg - winAvg;
      if (gap > 30) {
        diffHtml = `<div class="timing-diff">+${formatHms(gap)} in losses</div>`;
      }
    }
    leftHtml += `<div class="timing-age-row">
      <div class="timing-age-header">
        <span class="timing-age-label" style="color:${age.color};">${age.label}</span>
        <span class="timing-age-value">${avg}</span>
      </div>
      ${diffHtml}
    </div>`;
  }

  let rightHtml = '';
  for (const interp of interpretations.slice(0, 5)) {
    const iconColor = interp.type === 'positive' ? 'var(--accent-green)' : interp.type === 'warning' ? 'var(--accent-yellow)' : 'var(--accent-blue)';
    rightHtml += `<div class="interpretation-row">
      <span class="interpretation-icon" style="color:${iconColor};">${interp.icon}</span>
      <span class="interpretation-text"><strong>${interp.timing}${interp.value ? ` (${interp.value})` : ''}</strong> — ${interp.conclusion}</span>
    </div>`;
  }

  return `<div class="card timing-analysis-card">
    <div class="timing-analysis-header">
      <div class="card-label">${t('ageTimeline')}</div>
      <div class="timing-duration">${duration}</div>
    </div>
    <div class="analysis-two-col">
      <div>
        <div class="section-label">Average Times</div>
        ${leftHtml}
      </div>
      <div>
        <div class="section-label">${t('interpretation')}</div>
        ${rightHtml || '<div class="card-subtitle">No interpretations available.</div>'}
      </div>
    </div>
  </div>`;
}

function renderDetailedAnalysisCard(stats) {
  const tabIds = ['overview', 'military', 'economy', 'openings', 'maps', 'civs', 'techs'];
  const tabLabels = [t('overview'), t('military'), t('economy'), t('openings'), t('maps'), t('civs'), t('techs')];

  let html = `<div class="card detailed-analysis-card">`;
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
  html += buildTechTimingsPanel(stats, tabIds[6]);

  html += `</div>`;
  return html;
}

function buildOverviewPanel(stats, id) {
  const wr = stats.win_percent || 0;
  const games = stats.analyzed || 0;
  const wins = stats.total_wins || 0;
  const streak = stats.current_streak || { type: 'none', count: 0 };
  const streakText = streak.type === 'win' ? `+${streak.count}` :
                     streak.type === 'loss' ? `-${streak.count}` : '—';

  return `<div class="tab-panel active" data-panel="${id}">
    <div class="tab-stat-grid">
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.games')}</div><div class="tab-stat-value">${games}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.winrate')}</div><div class="tab-stat-value ${wr >= 50 ? 'text-green' : 'text-red'}">${wr}%</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.wl')}</div><div class="tab-stat-value">${wins} / ${games - wins}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.streak')}</div><div class="tab-stat-value">${streakText}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">${t('header.rating')}</div><div class="tab-stat-value">${stats.rating || '—'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.avgEapm')}</div><div class="tab-stat-value">${stats.avg_eapm || '—'}</div></div>
    </div>
  </div>`;
}

function buildMilitaryPanel(stats, id) {
  const unitCats = stats.unit_categories || {};
  const aggression = stats.archetype?.dimensions?.aggression || 0;
  const games = stats.analyzed || 1;

  const totalCount = Object.values(unitCats).reduce((sum, cat) => sum + (cat.count || 0), 0);
  const totalAvg = Math.round((totalCount / games) * 100) / 100;

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
    const pct = Math.round((data.count / totalCount) * 100);
    compositionHtml += `<div class="composition-bar-row">
      <div class="composition-bar-label">${cat.label}</div>
      <div class="composition-bar-track"><div class="composition-bar-fill" style="width:${pct}%;background:${cat.color}"></div></div>
      <div class="composition-bar-pct">${pct}%</div>
    </div>`;
  }

  return `<div class="tab-panel" data-panel="${id}">
    <div class="tab-stat-grid mb-3">
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.aggressionScore')}</div><div class="tab-stat-value">${aggression}/100</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.avgUnitsPerGame')}</div><div class="tab-stat-value">${totalAvg}</div></div>
    </div>
    ${compositionHtml ? `<div><div class="section-label">${t('tabs.armyComposition')}</div>${compositionHtml}</div>` : `<div class="card-subtitle">${t('app.noData')}</div>`}
  </div>`;
}

function buildEconomyPanel(stats, id) {
  const tcTiming = stats.tc_timing || {};
  return `<div class="tab-panel" data-panel="${id}">
    <div class="tab-stat-grid">
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.2ndTc')}</div><div class="tab-stat-value">${tcTiming.tc2_avg_hms || 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.3rdTc')}</div><div class="tab-stat-value">${tcTiming.tc3_avg_hms || 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.wheelbarrow')}</div><div class="tab-stat-value">${stats.wheel_barrow_avg != null ? formatHms(stats.wheel_barrow_avg) : 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">${t('tabs.handCart')}</div><div class="tab-stat-value">${stats.hand_cart_avg != null ? formatHms(stats.hand_cart_avg) : 'N/A'}</div></div>
    </div>
    ${stats.boom_tendency ? `<div class="card-subtitle mt-2">${t('tabs.boomTendency')}: <strong>${stats.boom_tendency}</strong></div>` : ''}
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
    <div class="mb-2"><div class="section-label">${t('tabs.openingDistribution')}</div>
    ${barsHtml || `<div class="card-subtitle">${t('app.noData')}</div>`}</div>
    ${pp.primary_opening ? `<div class="card-subtitle">${t('sections.openings')}: <strong>${formatOpeningName(pp.primary_opening)}</strong> (${Math.round((pp.opening_stability || 0) * 100)}%)</div>` : ''}
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
    <div class="mb-3">
      <div class="section-label">${t('tabs.topMaps')}</div>
      ${topMaps || `<div class="card-subtitle">${t('app.noData')}</div>`}
    </div>
    ${worstMaps ? `<div><div class="section-label">${t('tabs.worstMaps')}</div>${worstMaps}</div>` : ''}
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
    <div class="section-label">${t('tabs.civilizations')}</div>
    ${civsHtml || `<div class="card-subtitle">${t('app.noData')}</div>`}
  </div>`;
}

function buildTechTimingsPanel(stats, id) {
  const coreTechs = stats.core_tech_timings || {};
  const categoryLabels = {
    wood: 'Wood', farm: 'Farm', blacksmith: 'Blacksmith',
    archery_range: 'Archery', barracks: 'Barracks', stable: 'Stable',
    university: 'University', other: 'Other',
  };

  let html = '<div class="data-grid">';
  for (const [cat, techs] of Object.entries(coreTechs)) {
    const entries = Object.entries(techs);
    if (entries.length === 0) continue;

    html += `<div class="data-grid-col">
      <div class="data-grid-col-title">${categoryLabels[cat] || cat}</div>`;
    for (const [techName, data] of entries) {
      const timeStr = data.avg_time != null ? formatHms(data.avg_time) : '—';
      const winAvg = stats.key_tech_win_avg?.[techName];
      const lossAvg = stats.key_tech_loss_avg?.[techName];
      let extra = '';
      if (winAvg != null && lossAvg != null) {
        const gap = lossAvg - winAvg;
        if (gap > 45) extra = `<span class="text-red text-xs ml-1">+${formatHms(gap)} in losses</span>`;
      }
      html += `<div class="data-grid-row">
        <span>${techDisplayName(techName)}</span>
        <span class="data-grid-value">${timeStr} · ${Math.round(data.frequency)}%${extra}</span>
      </div>`;
    }
    html += `</div>`;
  }
  html += '</div>';

  return `<div class="tab-panel" data-panel="${id}">
    ${html || '<div class="card-subtitle">No tech timing data.</div>'}
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

  return `<div class="card historical-data-card">
    <table class="history-table">
      <thead><tr><th>${t('tabs.date')}</th><th>${t('sections.maps')}</th><th>${t('sections.civs')}</th><th>${t('tabs.result')}</th><th>${t('sections.openings')}</th><th>${t('tabs.duration')}</th></tr></thead>
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

  html += `<div class="block">`;
  html += `<div class="section-title">Live Advantage</div>`;
  html += renderLiveAdvantage(playerStats, rivalStats);
  html += `</div>`;

  html += `<div class="block">`;
  html += `<div class="section-title">Style Comparison</div>`;
  html += `<div class="block-grid block-grid-2">`;
  html += renderStyleComparison(playerStats, rivalStats);
  html += renderTempoAnalysis(playerStats, rivalStats);
  html += `</div></div>`;

  html += `<div class="block">`;
  html += `<div class="section-title">Critical Timings</div>`;
  html += `<div class="block-grid block-grid-2">`;
  html += renderCriticalTimings(playerStats, rivalStats);
  html += renderTimingInsights(playerStats, rivalStats);
  html += `</div></div>`;

  html += `<div class="block">`;
  html += `<div class="section-title">Expected Transitions</div>`;
  html += renderExpectedTransitions(rivalStats);
  html += `</div>`;

  html += `<div class="block">`;
  html += `<div class="section-title">Detailed Metrics</div>`;
  html += renderLiveDetailedMetrics(playerStats, rivalStats);
  html += `</div>`;

  container.innerHTML = html;
  setupTabs(container);
}

function renderLiveAdvantage(playerStats, rivalStats) {
  const playerElo = playerStats.rating || 1000;
  const rivalElo = rivalStats.rating || 1000;
  const playerWR = playerStats.win_percent || 50;
  const rivalWR = rivalStats.win_percent || 50;

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
    <div class="advantage-text ${advantageColor}">${advantageText}</div>
    <div class="card-subtitle text-center">Based on ELO differential and historical winrates. Live data will refine this.</div>
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

    html += `<div class="dimension-comparison-row">`;
    html += `<div class="dimension-label">${dim.label}</div>`;
    html += `<div class="dimension-bar-row">`;
    html += `<span class="dimension-value text-blue">${pVal}</span>`;
    html += `<div class="dimension-bar-track"><div class="dimension-bar-fill player" style="width:${pWidth}%"></div></div>`;
    html += `</div>`;
    html += `<div class="dimension-bar-row">`;
    html += `<span class="dimension-value text-red">${rVal}</span>`;
    html += `<div class="dimension-bar-track"><div class="dimension-bar-fill rival" style="width:${rWidth}%"></div></div>`;
    html += `</div>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function renderTempoAnalysis(playerStats, rivalStats) {
  const pDims = playerStats.archetype?.dimensions || {};
  const rDims = rivalStats.archetype?.dimensions || {};

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
        <div class="tempo-summary">${getTempoLabel(pDims.economy || 0, pDims.aggression || 0)}</div>
      </div>
      <div class="tempo-section">
        <div class="tempo-title">${escapeHtml(rivalStats.rival_name || 'Rival')}</div>
        <div class="tempo-item"><span class="tempo-label">Economic Tempo</span><span class="tempo-stars">${getStars(rDims.economy || 0)}</span></div>
        <div class="tempo-item"><span class="tempo-label">Military Tempo</span><span class="tempo-stars">${getStars(rDims.aggression || 0)}</span></div>
        <div class="tempo-item"><span class="tempo-label">Expansion Tempo</span><span class="tempo-stars">${getStars(((rDims.economy || 0) + (rDims.lateGame || 0)) / 2)}</span></div>
        <div class="tempo-summary">${getTempoLabel(rDims.economy || 0, rDims.aggression || 0)}</div>
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
    <div class="mt-2">${barsHtml}</div>
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

  html += `<div class="tab-panel active" data-panel="live-economy">
    <div class="tab-stat-grid">
      <div class="tab-stat-item"><div class="tab-stat-label">Player 2nd TC</div><div class="tab-stat-value">${playerStats.tc_timing?.tc2_avg_hms || 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Rival 2nd TC</div><div class="tab-stat-value">${rivalStats.tc_timing?.tc2_avg_hms || 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Player Wheelbarrow</div><div class="tab-stat-value">${playerStats.wheel_barrow_avg != null ? formatHms(playerStats.wheel_barrow_avg) : 'N/A'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Rival Wheelbarrow</div><div class="tab-stat-value">${rivalStats.wheel_barrow_avg != null ? formatHms(rivalStats.wheel_barrow_avg) : 'N/A'}</div></div>
    </div>
  </div>`;

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

  html += `<div class="tab-panel" data-panel="live-production">
    <div class="card-subtitle">Production data will appear here when live match data is available.</div>
  </div>`;

  html += `<div class="tab-panel" data-panel="live-openings">
    <div class="mb-2"><strong>Player:</strong> ${formatOpeningName(playerStats.player_profile?.primary_opening || 'Unknown')}</div>
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
