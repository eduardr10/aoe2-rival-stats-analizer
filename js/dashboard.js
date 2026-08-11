import { fetchRating, fetchMatches } from './api.js';
import { fetchFullProfile } from './api.js';
import { analyzeMatches } from './stats.js';
import {
  interpretTimings,
  computeStreak,
  computePlayerPrimaryOpenings,
} from './analysis.js';
import { resolveCivNumber, sleep, formatHms, techDisplayName, escapeHtml } from './utils.js';
import { initWebSocket } from './websocket.js';
import { initI18n, t, formatOpeningName, getLanguage, setLanguage, unitDisplayName } from './i18n.js';

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
  await initI18n();
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

  initWebSocket(cfg.playerId, 'self', ({ matchData, rivalProfileId }) => {
    const banner = document.getElementById('live-match-section');
    const info = document.getElementById('live-match-info');
    const rivalName = matchData.players?.find(p => p.profileId === rivalProfileId)?.name || 'Rival';

    // Store rival info
    currentRivalId = rivalProfileId;
    currentRivalName = rivalName;
    liveMatchData = matchData;

    if (info) info.innerHTML = `<span>En partida — vs ${escapeHtml(rivalName)}</span><span class="text-sm text-muted ml-2">en ${escapeHtml(matchData.mapName || '???')}</span>`;
    if (banner) banner.classList.remove('hidden');

    const btnProfile = document.getElementById('btn-rival-profile');
    if (btnProfile) {
      const url = new URL(window.location.href);
      url.searchParams.set('player_id', rivalProfileId);
      btnProfile.href = url.toString();
    }

    // Auto-analyze rival (once per session, with 5min cooldown)
    if (rivalProfileId && currentPlayerStats && !isAnalyzingRival) {
      const lastRivalKey = `aoe2_rival_analyzed_${rivalProfileId}`;
      const lastTime = localStorage.getItem(lastRivalKey);
      const now = Date.now();
      if (!lastTime || (now - parseInt(lastTime)) > 5 * 60 * 1000) {
        localStorage.setItem(lastRivalKey, now.toString());
        analyzeAndShowRival(readControls(), rivalProfileId);
      }
    }

    const btnAnalyze = document.getElementById('btn-analyze-rival');
    if (btnAnalyze) {
      btnAnalyze.textContent = 'Actualizar';
      btnAnalyze.disabled = false;
    }
  });
}

async function analyzeAndShowRival(cfg, rivalId) {
  const btnAnalyze = document.getElementById('btn-analyze-rival');
  const liveContent = document.getElementById('live-match-content');
  isAnalyzingRival = true;
  if (btnAnalyze) {
    btnAnalyze.textContent = 'Analizando...';
    btnAnalyze.disabled = true;
  }
  if (liveContent) {
    liveContent.innerHTML = `<div class="loading-state" style="padding:40px"><div class="loading-spinner"></div><div>Analizando rival...</div></div>`;
  }

  try {
    currentRivalStats = await runSelfAnalysis(rivalId, cfg.pages, cfg.perPage, cfg.leaderboard || null, cfg.dateFrom, cfg.dateTo, true);
    currentRivalStats.rival_name = currentRivalName;
    currentRivalStats.rival_id = rivalId;

    // Fetch rival's full profile for H2H opponents data
    try {
      const rivalProfile = await fetchFullProfile(rivalId);
      if (rivalProfile) {
        // Store opponents data for H2H lookup
        currentRivalStats.profile_data = rivalProfile;
      }
    } catch (e) {
      // Non-critical - H2H from profile is optional
    }

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
      headers: {
        'User-Agent': 'eduardr10-stats-script',
        'X-User-Agent': 'eduardr10-stats-script',
      },
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

async function runSelfAnalysis(playerId, pages, perPage, leaderboardParam, dateFrom, dateTo, skipProgress) {
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

  let stats = await analyzeMatches(allMatches, parseInt(playerId), playedCivNum, opponentCivNum, dataMainPlayer, skipProgress ? null : (progress) => {
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
  stats.timing_interpretation = interpretTimings(stats);
  stats.current_streak = computeStreak(allMatches);

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

  setupDataTabs(dashboard);
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

  const playerBar = document.getElementById('player-bar');
  if (playerBar && stats.player_id) {
    let companionLink = playerBar.querySelector('.btn-companion');
    if (!companionLink) {
      companionLink = document.createElement('a');
      companionLink.className = 'btn-companion';
      companionLink.target = '_blank';
      companionLink.textContent = t('app.viewOnCompanion');
      playerBar.querySelector('.player-bar-inner').appendChild(companionLink);
    }
    companionLink.href = `https://www.aoe2companion.com/players/${stats.player_id}`;
  }
}

// ============================================================================
// DASHBOARD — SECTION 1: SUMMARY (2-second scouting view)
// ============================================================================

function renderHistoricalAnalysisHTML(stats, compressed) {
  let html = '';
  html += renderSummarySection(stats);
  html += renderDataSection(stats);
  return html;
}

function wrClass(wr) {
  if (wr >= 55) return 'wr-good';
  if (wr <= 42) return 'wr-bad';
  return 'wr-mid';
}

function openingWR(stats, openingName) {
  const matches = stats.matches || [];
  let w = 0, l = 0;
  for (const m of matches) {
    if (m.opening === openingName) {
      if (m.won) w++; else l++;
    }
  }
  const total = w + l;
  return { wr: total > 0 ? Math.round(w * 100 / total) : null, games: total };
}

function getArmyComposition(stats) {
  const unitCats = stats.unit_categories || {};
  const entries = Object.entries(unitCats)
    .map(([cat, d]) => [cat, d.count || 0])
    .filter(([, c]) => c > 0);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (total === 0) return null;
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([cat, c]) => ({ cat, pct: Math.round(c * 100 / total) }));
}

function buildSummaryFacts(stats) {
  const facts = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const games = stats.analyzed || 0;

  const sortedOpenings = Object.entries(perFreq).sort((a, b) => b[1] - a[1]);
  if (sortedOpenings.length > 0) {
    const [name, pct] = sortedOpenings[0];
    const owr = openingWR(stats, name);
    facts.push({
      icon: 'opening',
      text: `${formatOpeningName(name)}: ${pct}% ${t('summary.ofGames')}${owr.wr != null ? ` · ${owr.wr}% WR` : ''}`,
      sample: owr.games || games,
    });
  }

  const eff = Object.entries(stats.unit_effectiveness || {})
    .filter(([n, d]) => n !== 'villager' && d.matches >= 3 && d.share >= 5)
    .sort((a, b) => b[1].wr - a[1].wr);
  if (eff.length > 0) {
    const [bestName, best] = eff[0];
    facts.push({
      icon: 'unit',
      text: `${unitDisplayName(bestName)}: ${best.wr}% WR ${t('summary.whenWins')}`,
      sample: best.matches,
      good: true,
    });
    const weak = eff.filter(([, d]) => d.wr <= 42).sort((a, b) => a[1].wr - b[1].wr)[0];
    if (weak) {
      facts.push({
        icon: 'weak',
        text: `${unitDisplayName(weak[0])}: ${weak[1].wr}% WR`,
        sample: weak[1].matches,
        bad: true,
      });
    }
  }

  const mw = stats.matchup_weaknesses || [];
  if (mw.length > 0) {
    const worst = [...mw].sort((a, b) => a.wr - b.wr)[0];
    if (worst.games >= 2) {
      facts.push({
        icon: 'weak',
        text: `${t('summary.weakVs')} ${worst.civ}: ${worst.wr}% WR`,
        sample: worst.games,
        bad: true,
      });
    }
  }

  const mapPlayed = stats.map_played || {};
  const mapWR = stats.map_win_percent || {};
  const mapEntries = Object.entries(mapPlayed).filter(([, c]) => c >= 2);
  if (mapEntries.length > 0) {
    const best = mapEntries.sort((a, b) => (mapWR[b[0]] || 0) - (mapWR[a[0]] || 0))[0];
    facts.push({
      icon: 'map',
      text: `${best[0]}: ${mapWR[best[0]] || 0}% WR`,
      sample: best[1],
      good: (mapWR[best[0]] || 0) >= 55,
    });
  }

  const gaps = stats.economic_gaps || [];
  if (gaps.length > 0) {
    const g = gaps[0];
    facts.push({
      icon: 'eco',
      text: `${g.tech}: +${formatHms(g.gap)} ${t('summary.gap')} (${g.winAvg} → ${g.lossAvg})`,
      sample: games,
      bad: true,
    });
  }

  return facts.slice(0, 6);
}

function buildSummaryText(stats) {
  const lines = [];
  const wr = stats.win_percent || 0;
  const wins = stats.total_wins || 0;
  const games = stats.analyzed || 0;
  const losses = games - wins;

  lines.push(`${stats.player_name || 'Player'} (${t('header.rating')} ${stats.rating || '-'}) — ${games} ${t('summary.games')}`);
  lines.push(`WR ${wr}% (${wins}W-${losses}L)`);

  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const sortedOpenings = Object.entries(perFreq).sort((a, b) => b[1] - a[1]);
  if (sortedOpenings.length > 0) {
    const openingParts = sortedOpenings.slice(0, 2).map(([n, p]) => `${formatOpeningName(n)} ${p}%`);
    lines.push(`${t('summary.mainOpening')}: ${openingParts.join(' / ')}`);
  }

  const army = getArmyComposition(stats);
  if (army) {
    const catLabels = { cavalry: 'Cav', archers: 'Arch', infantry: 'Inf', siege: 'Siege' };
    lines.push(`${t('summary.army')}: ${army.map(a => `${a.pct}% ${catLabels[a.cat] || a.cat}`).join(' / ')}`);
  }

  const ageParts = [];
  if (stats.avg_feudal != null) ageParts.push(`${t('summary.feudal')} ${formatHms(stats.avg_feudal)}`);
  if (stats.avg_castle != null) ageParts.push(`${t('summary.castle')} ${formatHms(stats.avg_castle)}`);
  if (stats.avg_imperial != null) ageParts.push(`${t('summary.imperial')} ${formatHms(stats.avg_imperial)}`);
  if (ageParts.length) lines.push(ageParts.join(' | '));

  const civs = Object.entries(stats.civ_played_percent || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (civs.length) {
    lines.push(`Civs: ${civs.map(([c, p]) => `${c} ${p}% (${stats.civ_win_percent?.[c] ?? '-'}% WR)`).join(', ')}`);
  }

  const facts = buildSummaryFacts(stats);
  if (facts.length) {
    lines.push('');
    for (const f of facts) lines.push(`- ${f.text} (${f.sample} ${t('summary.games')})`);
  }

  return lines.join('\n');
}

function renderSummarySection(stats) {
  const wr = stats.win_percent || 0;
  const wins = stats.total_wins || 0;
  const games = stats.analyzed || 0;
  const losses = games - wins;
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const sortedOpenings = Object.entries(perFreq).sort((a, b) => b[1] - a[1]);
  const mainOpening = sortedOpenings[0];
  const stability = Math.round((pp.opening_stability || 0) * 100);
  const army = getArmyComposition(stats);
  const catLabels = { cavalry: 'Cav', archers: 'Arch', infantry: 'Inf', siege: 'Siege' };
  const catColors = { cavalry: 'var(--c-cav)', archers: 'var(--c-arch)', infantry: 'var(--c-inf)', siege: 'var(--c-siege)' };

  let armyHtml = `<span class="text-muted">${t('app.noData')}</span>`;
  if (army) {
    armyHtml = army.map(a =>
      `<span class="army-chip" style="--chip:${catColors[a.cat] || 'var(--text-muted)'}"><i></i>${a.pct}% ${catLabels[a.cat] || a.cat}</span>`
    ).join('');
  }

  const tempoParts = [];
  if (stats.avg_feudal != null) tempoParts.push(`<span><b>${formatHms(stats.avg_feudal)}</b> ${t('summary.feudal')}</span>`);
  if (stats.avg_castle != null) tempoParts.push(`<span><b>${formatHms(stats.avg_castle)}</b> ${t('summary.castle')}</span>`);
  const tempoHtml = tempoParts.length ? tempoParts.join('') : `<span class="text-muted">${t('app.noData')}</span>`;

  const facts = buildSummaryFacts(stats);
  let factsHtml = '';
  for (const f of facts) {
    const cls = f.bad ? 'fact-bad' : f.good ? 'fact-good' : '';
    factsHtml += `<li class="fact ${cls}"><span class="fact-text">${escapeHtml(f.text)}</span><span class="fact-sample">${f.sample} ${t('summary.games')}</span></li>`;
  }

  let openingBarsHtml = '';
  const maxPct = sortedOpenings[0]?.[1] || 1;
  for (const [name, pct] of sortedOpenings.slice(0, 4)) {
    const owr = openingWR(stats, name);
    openingBarsHtml += `
      <div class="obar-row">
        <span class="obar-label">${formatOpeningName(name)}</span>
        <div class="obar-track"><div class="obar-fill" style="width:${(pct / maxPct) * 100}%"></div></div>
        <span class="obar-pct">${pct}%</span>
        <span class="obar-wr ${owr.wr != null ? wrClass(owr.wr) : ''}">${owr.wr != null ? owr.wr + '%' : '—'}</span>
      </div>`;
  }

  return `
  <section class="sum-section">
    <div class="sum-head">
      <h2 class="sum-title">${t('summary.title')}</h2>
      <button class="btn-copy" id="btn-copy-summary">${t('summary.copy')}</button>
    </div>

    <div class="hero-grid">
      <div class="hero-card">
        <div class="hero-label">${t('summary.winrate')}</div>
        <div class="hero-value ${wrClass(wr)}">${wr}%</div>
        <div class="hero-sub">${wins}W – ${losses}L · ${games} ${t('summary.games')}</div>
      </div>
      <div class="hero-card">
        <div class="hero-label">${t('summary.mainOpening')}</div>
        <div class="hero-value hero-value-sm">${mainOpening ? formatOpeningName(mainOpening[0]) : '—'}</div>
        <div class="hero-sub">${mainOpening ? `${mainOpening[1]}% · ${t('summary.stability')} ${stability}%` : t('app.noData')}</div>
      </div>
      <div class="hero-card">
        <div class="hero-label">${t('summary.army')}</div>
        <div class="hero-army">${armyHtml}</div>
      </div>
      <div class="hero-card">
        <div class="hero-label">${t('summary.tempo')}</div>
        <div class="hero-tempo">${tempoHtml}</div>
      </div>
    </div>

    <div class="sum-columns">
      <div class="sum-block">
        <div class="sum-block-title">${t('summary.expect')}</div>
        <ul class="fact-list">${factsHtml || `<li class="fact"><span class="text-muted">${t('app.noData')}</span></li>`}</ul>
      </div>
      <div class="sum-block">
        <div class="sum-block-title">${t('summary.mainOpening')} · ${t('summary.frequency')} / WR</div>
        ${openingBarsHtml || `<div class="text-muted">${t('app.noData')}</div>`}
      </div>
    </div>
  </section>`;
}

// ============================================================================
// DASHBOARD — SECTION 2: SUPPORTING DATA (tabs)
// ============================================================================

function renderDataSection(stats) {
  const tabs = [
    { id: 'openings', label: t('summary.tabOpenings'), render: () => renderTabOpenings(stats) },
    { id: 'units', label: t('summary.tabUnits'), render: () => renderTabUnits(stats) },
    { id: 'economy', label: t('summary.tabEconomy'), render: () => renderTabEconomy(stats) },
    { id: 'techs', label: t('summary.tabTechs'), render: () => renderTabTechs(stats) },
    { id: 'mapscivs', label: t('summary.tabMapsCivs'), render: () => renderTabMapsCivs(stats) },
    { id: 'history', label: t('summary.tabHistory'), render: () => renderTabHistory(stats) },
  ];

  const nav = tabs.map((tab, i) =>
    `<button class="dtab-btn${i === 0 ? ' active' : ''}" data-dtab="${tab.id}">${tab.label}</button>`
  ).join('');

  const panels = tabs.map((tab, i) =>
    `<div class="dtab-panel${i === 0 ? ' active' : ''}" data-dtab-panel="${tab.id}">${tab.render()}</div>`
  ).join('');

  return `
  <section class="data-section">
    <h2 class="sum-title">${t('summary.dataTitle')}</h2>
    <div class="dtab-nav">${nav}</div>
    ${panels}
  </section>`;
}

function setupDataTabs(container) {
  container.querySelectorAll('.dtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.dtab;
      container.querySelectorAll('.dtab-btn').forEach(b => b.classList.toggle('active', b === btn));
      container.querySelectorAll('.dtab-panel').forEach(p => p.classList.toggle('active', p.dataset.dtabPanel === id));
    });
  });

  const copyBtn = container.querySelector('#btn-copy-summary');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const text = buildSummaryText(currentPlayerStats);
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      const original = copyBtn.textContent;
      copyBtn.textContent = t('summary.copied');
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = original;
        copyBtn.classList.remove('copied');
      }, 1500);
    });
  }
}

function kvRow(label, value, cls = '') {
  return `<div class="kv-row"><span class="kv-label">${label}</span><span class="kv-value ${cls}">${value}</span></div>`;
}

function hbarRow(label, pct, maxPct, right, color) {
  return `
    <div class="hbar-row">
      <span class="hbar-label">${label}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${maxPct > 0 ? (pct / maxPct) * 100 : 0}%;${color ? `background:${color}` : ''}"></div></div>
      <span class="hbar-right">${right}</span>
    </div>`;
}

// --- Tab: Openings ---
function renderTabOpenings(stats) {
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const entries = Object.entries(perFreq).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return `<div class="empty-tab">${t('app.noData')}</div>`;

  const games = stats.analyzed || 1;
  const maxPct = entries[0][1] || 1;
  let rows = '';
  for (const [name, pct] of entries) {
    const owr = openingWR(stats, name);
    const count = Math.round(pct * games / 100);
    rows += `
      <div class="trow">
        <span class="trow-name">${formatOpeningName(name)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(pct / maxPct) * 100}%"></div></div>
        <span class="trow-num">${pct}% <em>(${count}g)</em></span>
        <span class="trow-wr ${owr.wr != null ? wrClass(owr.wr) : ''}">${owr.wr != null ? `${owr.wr}% WR` : '—'}</span>
      </div>`;
  }

  const stability = Math.round((pp.opening_stability || 0) * 100);
  return `
    <div class="tab-note">${t('summary.stability')}: <b>${stability}%</b> — ${entries[0] ? formatOpeningName(entries[0][0]) : '—'}</div>
    <div class="trow trow-head">
      <span class="trow-name">${t('summary.opening')}</span>
      <span class="trow-track-spacer"></span>
      <span class="trow-num">${t('summary.frequency')}</span>
      <span class="trow-wr">WR</span>
    </div>
    ${rows}`;
}

// --- Tab: Units ---
function renderTabUnits(stats) {
  const unitStats = stats.unit_stats || {};
  const entries = Object.entries(unitStats)
    .filter(([n]) => n !== 'villager')
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 12);

  let html = '';

  if (entries.length > 0) {
    const maxTotal = entries[0][1].total || 1;
    let rows = '';
    for (const [name, d] of entries) {
      rows += `
        <div class="trow">
          <span class="trow-name">${unitDisplayName(name)}</span>
          <div class="hbar-track"><div class="hbar-fill" style="width:${(d.total / maxTotal) * 100}%"></div></div>
          <span class="trow-num">${d.avg} ${t('summary.avgPerGame')} <em>(${d.total})</em></span>
          <span class="trow-wr ${wrClass(d.wr)}">${d.wr}% <em>(${d.matches}g)</em></span>
        </div>`;
    }
    html += `
      <div class="trow trow-head">
        <span class="trow-name">${t('summary.tabUnits')}</span>
        <span class="trow-track-spacer"></span>
        <span class="trow-num">${t('summary.total')}</span>
        <span class="trow-wr">WR</span>
      </div>
      ${rows}`;
  }

  const upgrades = Object.entries(stats.unit_upgrades || {}).slice(0, 12);
  if (upgrades.length > 0) {
    const chips = upgrades.map(([name, d]) =>
      `<span class="chip" title="${d.count} ${t('summary.times')} · ${d.wr}% WR">${techDisplayName(name)} <b>${d.count}×</b></span>`
    ).join('');
    html += `<div class="tab-subtitle">${t('summary.upgrades')}</div><div class="chip-row">${chips}</div>`;
  }

  return html || `<div class="empty-tab">${t('app.noData')}</div>`;
}

// --- Tab: Economy ---
function renderTabEconomy(stats) {
  let html = '<div class="eco-grid">';

  const wb = stats.wheel_barrow_avg;
  const hc = stats.hand_cart_avg;
  html += `<div class="eco-card">
    <div class="eco-card-title">Wheelbarrow</div>
    <div class="eco-card-value">${wb != null ? formatHms(wb) : '—'}</div>
    <div class="eco-card-sub">${stats.wheel_barrow_win_avg != null ? `${t('summary.winAvg')}: ${formatHms(stats.wheel_barrow_win_avg)}` : ''}
      ${stats.wheel_barrow_loss_avg != null ? ` · ${t('summary.lossAvg')}: ${formatHms(stats.wheel_barrow_loss_avg)}` : ''}</div>
  </div>`;
  html += `<div class="eco-card">
    <div class="eco-card-title">Hand Cart</div>
    <div class="eco-card-value">${hc != null ? formatHms(hc) : '—'}</div>
    <div class="eco-card-sub">${stats.hand_cart_win_avg != null ? `${t('summary.winAvg')}: ${formatHms(stats.hand_cart_win_avg)}` : ''}
      ${stats.hand_cart_loss_avg != null ? ` · ${t('summary.lossAvg')}: ${formatHms(stats.hand_cart_loss_avg)}` : ''}</div>
  </div>`;

  if (stats.tc2_time_avg != null) {
    html += `<div class="eco-card">
      <div class="eco-card-title">${t('summary.secondTc')}</div>
      <div class="eco-card-value">${formatHms(stats.tc2_time_avg)}</div>
      <div class="eco-card-sub">${stats.tc2_pct}% ${t('summary.ofGames')}</div>
    </div>`;
  }
  if (stats.tc3_time_avg != null) {
    html += `<div class="eco-card">
      <div class="eco-card-title">${t('summary.thirdTc')}</div>
      <div class="eco-card-value">${formatHms(stats.tc3_time_avg)}</div>
      <div class="eco-card-sub">${stats.tc3_pct}% ${t('summary.ofGames')}</div>
    </div>`;
  }

  if (stats.avg_eapm != null) {
    html += `<div class="eco-card">
      <div class="eco-card-title">${t('summary.eapm')}</div>
      <div class="eco-card-value">${Math.round(stats.avg_eapm)}</div>
      <div class="eco-card-sub">${stats.avg_eapm_wins != null ? `${t('summary.wins')}: ${Math.round(stats.avg_eapm_wins)}` : ''}
        ${stats.avg_eapm_losses != null ? ` · ${t('summary.losses')}: ${Math.round(stats.avg_eapm_losses)}` : ''}</div>
    </div>`;
  }

  html += '</div>';

  const gaps = stats.economic_gaps || [];
  if (gaps.length > 0) {
    let gapRows = '';
    for (const g of gaps) {
      gapRows += kvRow(g.tech, `${g.winAvg} → ${g.lossAvg} <span class="wr-bad">(+${formatHms(g.gap)})</span>`);
    }
    html += `<div class="tab-subtitle">${t('summary.winAvg')} vs ${t('summary.lossAvg')}</div>${gapRows}`;
  }

  const marketAvg = stats.market_avg_by_age || {};
  const ages = ['feudal', 'castle', 'imperial'].filter(a => marketAvg[a] && (Object.keys(marketAvg[a].buy || {}).length > 0 || Object.keys(marketAvg[a].sell || {}).length > 0));
  if (ages.length > 0) {
    let marketHtml = '';
    for (const age of ages) {
      const { buy = {}, sell = {} } = marketAvg[age];
      const resources = [...new Set([...Object.keys(buy), ...Object.keys(sell)])].slice(0, 4);
      const items = resources.map(res => {
        const parts = [];
        if (buy[res]) parts.push(`${t('summary.buy')} ${Math.round(buy[res] * 100) / 100}`);
        if (sell[res]) parts.push(`${t('summary.sell')} ${Math.round(sell[res] * 100) / 100}`);
        return `<span class="chip">${res}: ${parts.join(' / ')}</span>`;
      }).join('');
      marketHtml += `<div class="market-age"><span class="market-age-label">${t('summary.' + age)}</span><div class="chip-row">${items}</div></div>`;
    }
    html += `<div class="tab-subtitle">${t('summary.market')}</div>${marketHtml}`;
  }

  return html;
}

// --- Tab: Techs ---
function renderTabTechs(stats) {
  let html = '';

  const top5 = stats.techs_top5_after_age || {};
  const avgTimes = stats.techs_top5_avg_time || {};
  const ages = ['feudal', 'castle', 'imperial'];
  let ageCols = '';
  for (const age of ages) {
    const techs = top5[age] || [];
    if (techs.length === 0) continue;
    const items = techs.map(tech => {
      const time = avgTimes[age]?.[tech];
      return `<div class="kv-row"><span class="kv-label">${techDisplayName(tech)}</span><span class="kv-value">${time != null ? formatHms(time) : '—'}</span></div>`;
    }).join('');
    ageCols += `<div class="tech-age-col"><div class="tech-age-title">${t('summary.' + age)}</div>${items}</div>`;
  }
  if (ageCols) {
    html += `<div class="tab-subtitle">${t('summary.topTechsByAge')}</div><div class="tech-age-grid">${ageCols}</div>`;
  }

  const keyTechs = Object.entries(stats.key_techs || {}).sort((a, b) => b[1].frequency - a[1].frequency);
  if (keyTechs.length > 0) {
    let rows = '';
    for (const [name, d] of keyTechs) {
      rows += `
        <div class="trow">
          <span class="trow-name">${techDisplayName(name)}</span>
          <div class="hbar-track"><div class="hbar-fill" style="width:${d.frequency}%"></div></div>
          <span class="trow-num">${d.frequency}%</span>
          <span class="trow-wr">${d.avg_time != null ? formatHms(d.avg_time) : '—'}</span>
        </div>`;
    }
    html += `
      <div class="tab-subtitle">${t('summary.keyTechTimings')}</div>
      <div class="trow trow-head">
        <span class="trow-name">Tech</span>
        <span class="trow-track-spacer"></span>
        <span class="trow-num">${t('summary.frequency')}</span>
        <span class="trow-wr">avg</span>
      </div>
      ${rows}`;
  }

  return html || `<div class="empty-tab">${t('app.noData')}</div>`;
}

// --- Tab: Maps & Civs ---
function renderTabMapsCivs(stats) {
  let html = '<div class="mc-grid">';

  const mapPlayed = stats.map_played || {};
  const mapWR = stats.map_win_percent || {};
  const mapEntries = Object.entries(mapPlayed).sort((a, b) => b[1] - a[1]);
  if (mapEntries.length > 0) {
    const maxCount = mapEntries[0][1] || 1;
    let rows = '';
    for (const [map, count] of mapEntries) {
      const mwr = mapWR[map] || 0;
      rows += `
        <div class="trow">
          <span class="trow-name">${escapeHtml(map)}</span>
          <div class="hbar-track"><div class="hbar-fill" style="width:${(count / maxCount) * 100}%"></div></div>
          <span class="trow-num">${count}g</span>
          <span class="trow-wr ${wrClass(mwr)}">${mwr}%</span>
        </div>`;
    }
    html += `<div class="mc-col">
      <div class="tab-subtitle">${t('summary.map')}</div>
      <div class="trow trow-head"><span class="trow-name">${t('summary.map')}</span><span class="trow-track-spacer"></span><span class="trow-num">${t('summary.games')}</span><span class="trow-wr">WR</span></div>
      ${rows}
    </div>`;
  }

  const civPlayed = stats.civ_played_percent || {};
  const civWR = stats.civ_win_percent || {};
  const civEntries = Object.entries(civPlayed).sort((a, b) => b[1] - a[1]);
  if (civEntries.length > 0) {
    const maxPct = civEntries[0][1] || 1;
    let rows = '';
    for (const [civ, pct] of civEntries) {
      const cwr = civWR[civ] || 0;
      rows += `
        <div class="trow">
          <span class="trow-name">${escapeHtml(civ)}</span>
          <div class="hbar-track"><div class="hbar-fill" style="width:${(pct / maxPct) * 100}%"></div></div>
          <span class="trow-num">${pct}%</span>
          <span class="trow-wr ${wrClass(cwr)}">${cwr}%</span>
        </div>`;
    }
    html += `<div class="mc-col">
      <div class="tab-subtitle">${t('summary.civ')}</div>
      <div class="trow trow-head"><span class="trow-name">${t('summary.civ')}</span><span class="trow-track-spacer"></span><span class="trow-num">%</span><span class="trow-wr">WR</span></div>
      ${rows}
    </div>`;
  }

  html += '</div>';
  return mapEntries.length || civEntries.length ? html : `<div class="empty-tab">${t('app.noData')}</div>`;
}

// --- Tab: History ---
function renderTabHistory(stats) {
  const matches = stats.matches || [];
  if (matches.length === 0) return `<div class="empty-tab">${t('summary.noGames')}</div>`;

  let rows = '';
  for (const m of matches) {
    const date = m.started ? new Date(m.started).toLocaleDateString(getLanguage() === 'es' ? 'es-ES' : 'en-US', { day: '2-digit', month: '2-digit' }) : '—';
    rows += `
      <tr>
        <td>${date}</td>
        <td class="${m.won ? 'wr-good' : 'wr-bad'}">${m.won ? t('summary.win') : t('summary.loss')}</td>
        <td>${escapeHtml(m.player_civ || '—')}</td>
        <td>vs ${escapeHtml(m.opponent_civ || '—')}</td>
        <td>${escapeHtml(m.map_name || '—')}</td>
        <td>${m.opening ? formatOpeningName(m.opening) : '—'}</td>
        <td>${m.duration_hms || '—'}</td>
      </tr>`;
  }

  return `
    <div class="hist-wrap">
      <table class="hist-table">
        <thead><tr>
          <th>${t('summary.date')}</th><th>${t('summary.result')}</th><th>${t('summary.civ')}</th>
          <th>vs</th><th>${t('summary.map')}</th><th>${t('summary.opening')}</th><th>${t('summary.duration')}</th>
        </tr></thead>
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
  if (!playerStats || !rivalStats) {
    container.innerHTML = '<div class="loading-state">Waiting for player/rival data...</div>';
    return;
  }

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
  html += `<div class="section-title">Matchup Intelligence</div>`;
  html += renderMatchupIntelligence(playerStats, rivalStats);
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

function renderMatchupIntelligence(playerStats, rivalStats) {
  const pp = playerStats.player_profile || {};
  const rp = rivalStats.player_profile || {};
  const myOpening = pp.primary_opening || 'Unknown';
  const oppOpening = rp.primary_opening || 'Unknown';
  const myOpenPct = (pp.per_opening_frequency || {})[myOpening] || 0;
  const oppOpenPct = (rp.per_opening_frequency || {})[oppOpening] || 0;

  // Find historical WR for this specific opening matchup
  let matchupWr = null;
  let matchupTotal = 0;
  const matrix = playerStats.opening_vs_opponent || {};
  if (matrix[myOpening] && matrix[myOpening][oppOpening]) {
    const rec = matrix[myOpening][oppOpening];
    matchupTotal = rec.wins + rec.losses;
    matchupWr = matchupTotal > 0 ? Math.round((rec.wins / matchupTotal) * 100) : null;
  }

  // H2H from rival's profile opponents data (pre-computed by Companion)
  let h2hWr = null;
  let h2hTotal = null;
  const profile = rivalStats.profile_data || {};
  const statsArr = profile.stats || [];
  const rmStats = statsArr.find(s => s.leaderboardId === 'rm_1v1' || s.abbreviation === 'RM 1v1');
  if (rmStats && rmStats.opponents) {
    const myId = playerStats.player_id ? Number(playerStats.player_id) : null;
    if (myId) {
      const h2hEntry = rmStats.opponents.find(o => o.profileId === myId);
      if (h2hEntry && h2hEntry.games > 0) {
        h2hTotal = h2hEntry.games;
        h2hWr = Math.round((h2hEntry.wins / h2hTotal) * 100);
      }
    }
  }

  // Player's counter recommendations vs opponent style
  const recs = playerStats.prediction?.counter_recommendations || [];
  const validRecs = recs.slice(0, 3);

  let recsHtml = '';
  if (validRecs.length > 0) {
    recsHtml = '<ul class="matchup-recs">' + validRecs.map(r => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>';
  }

  const myOpeningLabel = formatOpeningName(myOpening);
  const oppOpeningLabel = formatOpeningName(oppOpening);

  return `<div class="card matchup-intel-card">
    <div class="card-label">Opening Matchup</div>
    <div class="matchup-openings">
      <div class="matchup-side">
        <div class="matchup-label">You usually play</div>
        <div class="matchup-opening">${myOpeningLabel}</div>
        <div class="matchup-pct">${myOpenPct}%</div>
      </div>
      <div class="matchup-vs">VS</div>
      <div class="matchup-side">
        <div class="matchup-label">Rival usually plays</div>
        <div class="matchup-opening">${oppOpeningLabel}</div>
        <div class="matchup-pct">${oppOpenPct}%</div>
      </div>
    </div>
    ${matchupWr != null ? `<div class="matchup-historical">Historical WR in this matchup: <span class="${matchupWr >= 55 ? 'text-green' : matchupWr <= 40 ? 'text-red' : ''}">${matchupWr}%</span> (${matchupTotal} games)</div>` : ''}
    ${h2hWr != null ? `<div class="matchup-historical">H2H record vs this rival: <span class="${h2hWr >= 55 ? 'text-green' : h2hWr <= 40 ? 'text-red' : ''}">${h2hWr}%</span> (${h2hTotal} games)</div>` : ''}
    ${recsHtml ? `<div class="matchup-recs-wrap"><div class="matchup-recs-title">Recommended counters</div>${recsHtml}</div>` : ''}
  </div>`;
}


function renderStyleComparison(playerStats, rivalStats) {
  function featStr(stats, label) {
    const pp = stats.player_profile || {};
    const sorted = Object.entries(pp.per_opening_frequency || {}).sort((a, b) => b[1] - a[1]);
    const topOpening = sorted[0] ? `${formatOpeningName(sorted[0][0])} ${sorted[0][1]}%` : '—';
    const wr = stats.win_percent || 0;
    const apm = stats.avg_eapm || '—';
    const feudal = stats.avg_feudal_hms || '—';
    const castle = stats.avg_castle_hms || '—';
    const imperial = stats.avg_imperial_hms || '—';
    return `<div class="tempo-section">
      <div class="tempo-title">${label}</div>
      <div class="tempo-item"><span class="tempo-label">${t('header.winrate')}</span><span class="${wr >= 50 ? 'text-green' : 'text-red'}">${wr}%</span></div>
      <div class="tempo-item"><span class="tempo-label">${t('tabs.avgEapm')}</span><span>${apm}</span></div>
      <div class="tempo-item"><span class="tempo-label">${t('sections.openings')}</span><span>${topOpening}</span></div>
      <div class="tempo-item"><span class="tempo-label">Feudal</span><span>${feudal}</span></div>
      <div class="tempo-item"><span class="tempo-label">Castle</span><span>${castle}</span></div>
      <div class="tempo-item"><span class="tempo-label">Imperial</span><span>${imperial}</span></div>
    </div>`;
  }

  return `<div class="card">
    <div class="card-label">Head to Head Metrics</div>
    <div class="tempo-grid">
      ${featStr(playerStats, escapeHtml(playerStats.player_name || 'Player'))}
      ${featStr(rivalStats, escapeHtml(rivalStats.rival_name || 'Rival'))}
    </div>
  </div>`;
}

function renderTempoAnalysis(playerStats, rivalStats) {
  function unitComp(stats, label) {
    const cats = stats.unit_categories || {};
    const total = Object.values(cats).reduce((s, c) => s + (c.count || 0), 0);
    const pct = (cat) => total > 0 ? Math.round(((cats[cat]?.count || 0) / total) * 100) : 0;
    const top3Civs = Object.entries(stats.civ_played_percent || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, p]) => `${c} ${p}%`).join(' · ');
    return `<div class="tempo-section">
      <div class="tempo-title">${label}</div>
      <div class="tempo-item"><span class="tempo-label">Army</span><span>Cav ${pct('cavalry')}% · Arch ${pct('archers')}% · Inf ${pct('infantry')}%</span></div>
      <div class="tempo-item"><span class="tempo-label">${t('sections.civs')}</span><span>${top3Civs || '—'}</span></div>
      <div class="tempo-item"><span class="tempo-label">${t('tabs.2ndTc')}</span><span>${stats.tc_timing?.tc2_avg_hms || '—'} · ${(stats.tc2_pct || 0)}% matches</span></div>
    </div>`;
  }

  return `<div class="card">
    <div class="card-label">Unit & Economy Comparison</div>
    <div class="tempo-grid">
      ${unitComp(playerStats, escapeHtml(playerStats.player_name || 'Player'))}
      ${unitComp(rivalStats, escapeHtml(rivalStats.rival_name || 'Rival'))}
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

  // Additional important timings: Ballistics, 2nd/3rd TC, Blacksmith and key smith upgrades
  const getTechAvgHms = (s, key) => {
    if (!s) return 'N/A';
    return s.build_order?.wins?.techs?.[key]?.avg_hms || s.build_order?.losses?.techs?.[key]?.avg_hms || (s.key_techs && s.key_techs[key] && s.key_techs[key].avg_time ? formatHms(s.key_techs[key].avg_time) : 'N/A');
  };
  const getBuildingAvgHms = (s, key) => {
    if (!s) return 'N/A';
    return s.build_order?.wins?.buildings?.[key]?.avg_hms || s.build_order?.losses?.buildings?.[key]?.avg_hms || 'N/A';
  };

  html += `<div class="timeline-item">
      <span class="timeline-time">${playerStats.tc_timing?.tc2_avg_hms || 'N/A'}</span> <span class="timeline-event">2nd TC (Player)</span>
    </div>`;
  html += `<div class="timeline-item">
      <span class="timeline-time">${rivalStats.tc_timing?.tc2_avg_hms || 'N/A'}</span> <span class="timeline-event">2nd TC (Rival)</span>
    </div>`;
  html += `<div class="timeline-item">
      <span class="timeline-time">${playerStats.tc_timing?.tc3_avg_hms || 'N/A'}</span> <span class="timeline-event">3rd TC (Player)</span>
    </div>`;
  html += `<div class="timeline-item">
      <span class="timeline-time">${rivalStats.tc_timing?.tc3_avg_hms || 'N/A'}</span> <span class="timeline-event">3rd TC (Rival)</span>
    </div>`;

  html += `<div class="timeline-item">
      <span class="timeline-time">${getTechAvgHms(playerStats, 'ballistics')}</span> <span class="timeline-event">Ballistics (Player)</span>
    </div>`;
  html += `<div class="timeline-item">
      <span class="timeline-time">${getTechAvgHms(rivalStats, 'ballistics')}</span> <span class="timeline-event">Ballistics (Rival)</span>
    </div>`;

  html += `<div class="timeline-item">
      <span class="timeline-time">${getBuildingAvgHms(playerStats, 'blacksmith')}</span> <span class="timeline-event">Blacksmith (Player)</span>
    </div>`;
  html += `<div class="timeline-item">
      <span class="timeline-time">${getBuildingAvgHms(rivalStats, 'blacksmith')}</span> <span class="timeline-event">Blacksmith (Rival)</span>
    </div>`;

  // Key blacksmith-related upgrades (forging/bodkin/bracer)
  html += `<div class="timeline-item">
      <span class="timeline-time">${getTechAvgHms(playerStats, 'forging')}</span> <span class="timeline-event">Forging (Player)</span>
    </div>`;
  html += `<div class="timeline-item">
      <span class="timeline-time">${getTechAvgHms(playerStats, 'bodkin_arrow') || getTechAvgHms(playerStats, 'bodkin arrow')}</span> <span class="timeline-event">Bodkin Arrow (Player)</span>
    </div>`;

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
  const primary = pp.primary_opening || 'Unknown';

  const signature = rivalStats.unit_signature || [];
  let unitLine = '';
  if (signature.length > 0) {
    unitLine = signature.map(u => `${escapeHtml(u.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))} (${u.share || 0}% army, ${u.wr}% WR)`).join(' · ');
  }

  return `<div class="card">
    <div class="card-label">Rival Production Profile</div>
    <div class="card-subtitle">Primary opening: <strong>${formatOpeningName(primary)}</strong> (${Math.round((freq[primary] || 0) * 10) / 10}% of games)</div>
    ${unitLine ? `<div class="mt-2 text-sm">Most produced: ${unitLine}</div>` : '<div class="mt-2 text-sm">Insufficient production data.</div>'}
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

  const pUnits = Object.values(playerStats.unit_categories || {}).reduce((s, c) => s + (c.count || 0), 0);
  const rUnits = Object.values(rivalStats.unit_categories || {}).reduce((s, c) => s + (c.count || 0), 0);
  html += `<div class="tab-panel" data-panel="live-military">
    <div class="tab-stat-grid">
      <div class="tab-stat-item"><div class="tab-stat-label">Player EAPM</div><div class="tab-stat-value">${playerStats.avg_eapm || '—'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Rival EAPM</div><div class="tab-stat-value">${rivalStats.avg_eapm || '—'}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Player Units</div><div class="tab-stat-value">${pUnits}</div></div>
      <div class="tab-stat-item"><div class="tab-stat-label">Rival Units</div><div class="tab-stat-value">${rUnits}</div></div>
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
// WIN & LOSS PATTERNS — What wins/loses this player games
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
