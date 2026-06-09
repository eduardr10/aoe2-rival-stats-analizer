import { formatHms, techDisplayName } from './utils.js';

const OVERLAY_AUTO_HIDE_MS = 12000;

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

// Helper to get config
function getConfig(key) {
  return window.app_config?.[key] || '';
}

export function buildOverlay(stats, playerId) {
  const container = document.getElementById('aoe2-overlay');
  if (!container) return;

  container._lastStats = stats;
  container._lastPlayerId = playerId;

  if (stats.error || stats.total === 0) {
    container.innerHTML = '<div class="loading-state">No se encontraron partidas.</div>';
    return;
  }

  // Clear any previous hide timeout
  if (container._hideTimeout) {
    clearTimeout(container._hideTimeout);
  }

  const isRivalMode = stats.match_id !== 'self';
  const rivalName = stats.rival_name || 'Rival';
  const playerName = stats.player_name || 'Player';

  // Build the full overlay HTML
  let html = '';

  // Header with social icons
  html += buildHeader();

  // Scrollable content area
  html += '<div class="overlay-content">';

  // Block 1: Match Summary (20%)
  html += buildMatchSummary(stats, isRivalMode, playerName, rivalName);

  // Block 2: Rival Intelligence (30%)
  html += buildRivalIntelligence(stats);

  // Block 3: Strategic Recommendations (25%)
  html += buildStrategicRecommendations(stats);

  // Block 4: Detailed Analysis with tabs (20%)
  html += buildDetailedAnalysis(stats);

  // Block 5: Historical Data (5%)
  html += buildHistoricalData(stats);

  html += '</div>'; // end overlay-content

  // Footer
  html += buildFooter();

  container.innerHTML = html;
  container.style.opacity = '1';
  container.style.pointerEvents = 'auto';

  // Setup tab switching
  setupTabs(container);

  // Setup social links
  setupSocialLinks(container);

  // Auto-hide after 12 seconds
  container._hideTimeout = setTimeout(() => {
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
  }, OVERLAY_AUTO_HIDE_MS);
}

export function restartOverlay() {
  const container = document.getElementById('aoe2-overlay');
  if (container && container._lastStats && container._lastPlayerId) {
    buildOverlay(container._lastStats, container._lastPlayerId);
  }
}

// ============================================================================
// HEADER
// ============================================================================

function buildHeader() {
  const ytUrl = getConfig('youtube_url');
  const twUrl = getConfig('twitch_url');

  return `<div class="overlay-header-main">
    <div>
      <div class="header-title">AOE2 Rival Analyzer</div>
      <div class="header-subtitle">Decision Assistant</div>
    </div>
    <div class="header-social">
      ${ytUrl ? `<a href="${ytUrl}" target="_blank" class="social-icon" title="YouTube - EduardR10" data-social="youtube">▶</a>` : ''}
      ${twUrl ? `<a href="${twUrl}" target="_blank" class="social-icon" title="Twitch - EduardR10" data-social="twitch">◉</a>` : ''}
    </div>
  </div>`;
}

// ============================================================================
// BLOCK 1: MATCH SUMMARY
// ============================================================================

function buildMatchSummary(stats, isRivalMode, playerName, rivalName) {
  const playerRating = stats.rating || '—';
  const rivalRating = stats.rival_rating || '—';
  const danger = stats.danger_score || { score: 0, level: 'low', label: 'Unknown' };
  const confidence = stats.confidence || 'Low';

  // Expected matchup text
  let matchupText = 'Even Matchup';
  if (typeof playerRating === 'number' && typeof rivalRating === 'number') {
    const diff = rivalRating - playerRating;
    if (diff > 150) matchupText = 'Very Difficult';
    else if (diff > 50) matchupText = 'Difficult';
    else if (diff < -150) matchupText = 'Very Favorable';
    else if (diff < -50) matchupText = 'Favorable';
  }

  const confidenceClass = confidence.toLowerCase();
  const dangerColorClass = danger.level || 'low';

  return `<div class="block">
    <div class="block-title">Match Summary</div>
    <div class="card">
      <div class="match-summary-row">
        <div class="player-vs-block">
          <div class="name">${escapeHtml(playerName)}</div>
          <div class="elo">ELO: ${playerRating}</div>
        </div>
        <div class="vs-divider">VS</div>
        <div class="player-vs-block">
          <div class="name">${escapeHtml(rivalName)}</div>
          <div class="elo">ELO: ${rivalRating}</div>
        </div>
      </div>
      <div class="danger-score">
        <div class="danger-indicator ${dangerColorClass}"></div>
        <span class="danger-text ${dangerColorClass}">Danger: ${danger.label}</span>
        <span class="confidence-badge">Confidence: ${confidence}</span>
      </div>
      <div class="expected-matchup">Expected Matchup: <strong>${matchupText}</strong></div>
    </div>
  </div>`;
}

// ============================================================================
// BLOCK 2: RIVAL INTELLIGENCE
// ============================================================================

function buildRivalIntelligence(stats) {
  let html = `<div class="block">`;
  html += `<div class="block-title">Rival Intelligence</div>`;

  // Card 1: Expected Opening
  html += buildExpectedOpeningCard(stats);

  // Card 2: Preferred Playstyle
  html += buildPlaystyleCard(stats);

  // Card 3: Civilization Tendencies
  html += buildCivTendenciesCard(stats);

  // Card 4: Timing Tendencies
  html += buildTimingTendenciesCard(stats);

  html += `</div>`;
  return html;
}

function buildExpectedOpeningCard(stats) {
  const pp = stats.player_profile || {};
  const primary = pp.primary_opening || 'Unknown';
  const freq = pp.per_opening_frequency || {};
  const stability = Math.round((pp.opening_stability || 0) * 100);
  const confidence = stability >= 60 ? 'High' : stability >= 30 ? 'Medium' : 'Low';

  const openingIcons = {
    'drush': '⚔️',
    'scout_rush': '🐴',
    'archer_rush': '🏹',
    'fast_feudal_aggressive': '⚡',
    'fast_castle': '🏰',
    'tower_rush': '🏗️',
    'Standard/Unknown': '❓',
    'Mixed/No Data': '❓',
  };

  const icon = openingIcons[primary] || '❓';
  const displayName = formatOpeningName(primary);

  // Build horizontal bars for top 3 openings
  const sortedOpenings = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const maxPct = sortedOpenings.length > 0 ? sortedOpenings[0][1] : 100;

  let barsHtml = '';
  const barColors = ['var(--accent-blue)', 'var(--accent-purple)', 'var(--accent-orange)'];
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
    <div class="card-value">${icon} ${displayName}</div>
    <div class="card-subtitle">Probability: ${freq[primary] || 0}% · Confidence: ${confidence}</div>
    ${barsHtml ? `<div style="margin-top:8px;">${barsHtml}</div>` : ''}
  </div>`;
}

function buildPlaystyleCard(stats) {
  const arch = stats.archetype || {};
  const playstyle = stats.playstyle || { label: 'Unknown', score: 0 };
  const aggression = arch.dimensions?.aggression || 0;

  const playstyleClass = playstyle.label.toLowerCase().replace(/\s+/g, '');

  return `<div class="card">
    <div class="card-label">Preferred Playstyle</div>
    <div class="playstyle-badge ${playstyleClass}">${playstyle.label}</div>
    <div class="playstyle-score">Average Feudal aggression: ${aggression}/100</div>
  </div>`;
}

function buildCivTendenciesCard(stats) {
  const civs = stats.civ_played_percent || {};
  const sortedCivs = Object.entries(civs).sort((a, b) => b[1] - a[1]).slice(0, 3);

  if (sortedCivs.length === 0) {
    return `<div class="card">
      <div class="card-label">Civilization Tendencies</div>
      <div class="card-subtitle">No data available</div>
    </div>`;
  }

  let civsHtml = '';
  for (let i = 0; i < sortedCivs.length; i++) {
    const [civ, pct] = sortedCivs[i];
    civsHtml += `<div class="civ-tendency-item">
      <div class="civ-tendency-rank">${i + 1}</div>
      <span>${escapeHtml(civ)} <span style="color:var(--text-muted);font-size:10px;">${pct}%</span></span>
    </div>`;
  }

  return `<div class="card">
    <div class="card-label">Civilization Tendencies</div>
    <div class="civ-tendency-list">${civsHtml}</div>
  </div>`;
}

function buildTimingTendenciesCard(stats) {
  const feudalTime = stats.avg_feudal_hms || 'N/A';
  const castleTime = stats.avg_castle_hms || 'N/A';
  const imperialTime = stats.avg_imperial_hms || 'N/A';
  const avgDuration = stats.avg_duration_hms || 'N/A';

  return `<div class="card">
    <div class="card-label">Timing Tendencies</div>
    <div class="timing-row">
      <span class="timing-label">Avg Feudal</span>
      <span class="timing-value">${feudalTime}</span>
    </div>
    <div class="timing-row">
      <span class="timing-label">Avg Castle</span>
      <span class="timing-value">${castleTime}</span>
    </div>
    <div class="timing-row">
      <span class="timing-label">Avg Imperial</span>
      <span class="timing-value">${imperialTime}</span>
    </div>
    <div class="timing-row">
      <span class="timing-label">Avg Game Length</span>
      <span class="timing-value">${avgDuration}</span>
    </div>
  </div>`;
}

// ============================================================================
// BLOCK 3: STRATEGIC RECOMMENDATIONS
// ============================================================================

function buildStrategicRecommendations(stats) {
  const recs = stats.recommendations || [];
  const weaknesses = stats.weaknesses || [];
  const threats = stats.threats || [];

  let html = `<div class="block">`;
  html += `<div class="block-title">Strategic Recommendations</div>`;

  // Main recommendation card
  html += `<div class="card">
    <div class="card-label">Recommended Strategy</div>
    <ul class="recommendation-list">`;

  if (recs.length > 0) {
    for (const rec of recs) {
      const icon = rec.type === 'must' ? '<span class="check">✓</span>' :
                   rec.type === 'warn' ? '<span class="warn">⚠</span>' :
                   '<span class="danger">✗</span>';
      html += `<li>${icon} ${escapeHtml(rec.text)}</li>`;
    }
  } else {
    html += `<li><span class="check">✓</span> Analyze rival matches for specific recommendations</li>`;
  }

  html += `</ul></div>`;

  // Weaknesses card
  if (weaknesses.length > 0) {
    html += `<div class="card">
      <div class="card-label">Weaknesses Detected</div>
      <ul class="weakness-list">`;
    for (const w of weaknesses) {
      html += `<li>${escapeHtml(w)}</li>`;
    }
    html += `</ul></div>`;
  }

  // Threats card
  if (threats.length > 0) {
    html += `<div class="card">
      <div class="card-label">Major Threats</div>
      <ul class="threat-list">`;
    for (const t of threats) {
      html += `<li>${escapeHtml(t)}</li>`;
    }
    html += `</ul></div>`;
  }

  html += `</div>`;
  return html;
}

// ============================================================================
// BLOCK 4: DETAILED ANALYSIS (Tabs)
// ============================================================================

function buildDetailedAnalysis(stats) {
  const tabIds = ['overview', 'military', 'economy', 'openings', 'maps', 'civs'];
  const tabLabels = ['Overview', 'Military', 'Economy', 'Openings', 'Maps', 'Civs'];

  let html = `<div class="block">`;
  html += `<div class="block-title">Detailed Analysis</div>`;
  html += `<div class="card" style="padding:10px;">`;

  // Tab nav
  html += `<div class="tabs-nav">`;
  for (let i = 0; i < tabIds.length; i++) {
    html += `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-tab="${tabIds[i]}">${tabLabels[i]}</button>`;
  }
  html += `</div>`;

  // Tab panels
  html += buildOverviewPanel(stats, tabIds[0]);
  html += buildMilitaryPanel(stats, tabIds[1]);
  html += buildEconomyPanel(stats, tabIds[2]);
  html += buildOpeningsPanel(stats, tabIds[3]);
  html += buildMapsPanel(stats, tabIds[4]);
  html += buildCivsPanel(stats, tabIds[5]);

  html += `</div></div>`;
  return html;
}

function buildOverviewPanel(stats, id) {
  const wr = stats.win_percent || 0;
  const games = stats.analyzed || 0;
  const wins = stats.total_wins || 0;
  const rating = stats.rating || '—';
  const eapm = stats.avg_eapm || '—';
  const streak = stats.current_streak || { type: 'none', count: 0 };

  const streakText = streak.type === 'win' ? `+${streak.count} wins` :
                       streak.type === 'loss' ? `-${streak.count} losses` :
                       'No streak';

  return `<div class="tab-panel active" data-panel="${id}">
    <div class="tab-stat-grid">
      <div class="tab-stat-item">
        <div class="tab-stat-label">Games</div>
        <div class="tab-stat-value">${games}</div>
      </div>
      <div class="tab-stat-item">
        <div class="tab-stat-label">Winrate</div>
        <div class="tab-stat-value ${wr >= 50 ? 'text-green' : 'text-red'}">${wr}%</div>
      </div>
      <div class="tab-stat-item">
        <div class="tab-stat-label">Wins / Losses</div>
        <div class="tab-stat-value">${wins} / ${games - wins}</div>
      </div>
      <div class="tab-stat-item">
        <div class="tab-stat-label">Current Streak</div>
        <div class="tab-stat-value">${streakText}</div>
      </div>
      <div class="tab-stat-item">
        <div class="tab-stat-label">Avg ELO</div>
        <div class="tab-stat-value">${rating}</div>
      </div>
      <div class="tab-stat-item">
        <div class="tab-stat-label">Avg EAPM</div>
        <div class="tab-stat-value">${eapm}</div>
      </div>
    </div>
  </div>`;
}

function buildMilitaryPanel(stats, id) {
  const unitCats = stats.unit_categories || {};
  const aggression = stats.archetype?.dimensions?.aggression || 0;

  const totalUnits = Object.values(unitCats).reduce((sum, cat) => sum + (cat.count || 0), 0);

  let compositionHtml = '';
  if (totalUnits > 0) {
    const cats = [
      { key: 'cavalry', label: 'Cavalry', color: 'var(--accent-orange)' },
      { key: 'archers', label: 'Archers', color: 'var(--accent-yellow)' },
      { key: 'infantry', label: 'Infantry', color: 'var(--accent-red)' },
      { key: 'siege', label: 'Siege', color: 'var(--accent-purple)' },
    ];
    for (const cat of cats) {
      const data = unitCats[cat.key];
      if (!data || !data.count) continue;
      const pct = Math.round((data.count / totalUnits) * 100);
      compositionHtml += `<div class="opening-bar-row" style="margin-bottom:4px;">
        <div class="opening-bar-label" style="width:60px;">${cat.label}</div>
        <div class="opening-bar-track"><div class="opening-bar-fill" style="width:${pct}%;background:${cat.color}"></div></div>
        <div class="opening-bar-pct">${pct}%</div>
      </div>`;
    }
  }

  return `<div class="tab-panel" data-panel="${id}">
    <div class="tab-stat-grid" style="margin-bottom:10px;">
      <div class="tab-stat-item">
        <div class="tab-stat-label">Aggression Score</div>
        <div class="tab-stat-value">${aggression}/100</div>
      </div>
      <div class="tab-stat-item">
        <div class="tab-stat-label">Total Units</div>
        <div class="tab-stat-value">${totalUnits}</div>
      </div>
    </div>
    ${compositionHtml ? `<div style="margin-top:8px;"><div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Army Composition</div>${compositionHtml}</div>` : '<div class="card-subtitle" style="padding:10px 0;">No military data available.</div>'}
  </div>`;
}

function buildEconomyPanel(stats, id) {
  const tcTiming = stats.tc_timing || {};
  const wb = stats.wheel_barrow_avg;
  const hc = stats.hand_cart_avg;

  return `<div class="tab-panel" data-panel="${id}">
    <div class="tab-stat-grid">
      <div class="tab-stat-item">
        <div class="tab-stat-label">2nd TC Avg</div>
        <div class="tab-stat-value">${tcTiming.tc2_avg_hms || 'N/A'}</div>
      </div>
      <div class="tab-stat-item">
        <div class="tab-stat-label">3rd TC Avg</div>
        <div class="tab-stat-value">${tcTiming.tc3_avg_hms || 'N/A'}</div>
      </div>
      <div class="tab-stat-item">
        <div class="tab-stat-label">Wheelbarrow</div>
        <div class="tab-stat-value">${wb != null ? formatHms(wb) : 'N/A'}</div>
      </div>
      <div class="tab-stat-item">
        <div class="tab-stat-label">Hand Cart</div>
        <div class="tab-stat-value">${hc != null ? formatHms(hc) : 'N/A'}</div>
      </div>
    </div>
    ${stats.boom_tendency ? `<div class="card-subtitle" style="margin-top:8px;">Boom tendency: <strong>${stats.boom_tendency}</strong></div>` : ''}
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
    <div style="margin-bottom:6px;">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Opening Distribution</div>
      ${barsHtml || '<div class="card-subtitle">No opening data available.</div>'}
    </div>
    ${pp.primary_opening ? `<div class="card-subtitle">Primary: <strong>${formatOpeningName(pp.primary_opening)}</strong> (${Math.round((pp.opening_stability || 0) * 100)}% stability)</div>` : ''}
  </div>`;
}

function buildMapsPanel(stats, id) {
  const maps = stats.map_played_percent || {};
  const sorted = Object.entries(maps).sort((a, b) => b[1] - a[1]);

  let topMaps = '';
  let worstMaps = '';

  // Top 3 maps by play rate
  const top3 = sorted.slice(0, 3);
  for (const [map, pct] of top3) {
    const wr = stats.map_win_percent?.[map] ?? 0;
    const wrClass = wr >= 55 ? 'text-green' : wr <= 40 ? 'text-red' : '';
    topMaps += `<div class="timing-row">
      <span class="timing-label">${escapeHtml(map)}</span>
      <span class="timing-value ${wrClass}">${pct}% · ${wr}% WR</span>
    </div>`;
  }

  // Worst 3 maps by win rate (min 2 games)
  const worst3 = sorted
    .filter(([m]) => (stats.map_win_percent?.[m] ?? 50) < 45)
    .sort((a, b) => (stats.map_win_percent?.[a[0]] ?? 50) - (stats.map_win_percent?.[b[0]] ?? 50))
    .slice(0, 3);

  for (const [map, pct] of worst3) {
    const wr = stats.map_win_percent?.[map] ?? 0;
    worstMaps += `<div class="timing-row">
      <span class="timing-label">${escapeHtml(map)}</span>
      <span class="timing-value text-red">${wr}% WR</span>
    </div>`;
  }

  return `<div class="tab-panel" data-panel="${id}">
    <div style="margin-bottom:10px;">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Top Maps</div>
      ${topMaps || '<div class="card-subtitle">No map data.</div>'}
    </div>
    ${worstMaps ? `<div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Worst Maps</div>${worstMaps}</div>` : ''}
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
    <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Civilizations</div>
    ${civsHtml || '<div class="card-subtitle">No civilization data.</div>'}
  </div>`;
}

// ============================================================================
// BLOCK 5: HISTORICAL DATA
// ============================================================================

function buildHistoricalData(stats) {
  const matches = stats.matches || [];
  const recent = matches.slice(0, 10);

  if (recent.length === 0) {
    return `<div class="block">
      <div class="block-title">Historical Data</div>
      <div class="card"><div class="card-subtitle">No match history available.</div></div>
    </div>`;
  }

  let rows = '';
  for (const m of recent) {
    const date = m.started ? new Date(m.started).toLocaleDateString('es', { month: 'short', day: 'numeric' }) : '—';
    const result = m.won ? '<span class="win">W</span>' : '<span class="loss">L</span>';
    const opening = m.opening ? formatOpeningName(m.opening) : '—';
    const duration = m.duration_hms || '—';

    rows += `<tr>
      <td>${date}</td>
      <td>${escapeHtml(m.map_name || '—')}</td>
      <td>${escapeHtml(m.player_civ || '?')} vs ${escapeHtml(m.opponent_civ || '?')}</td>
      <td>${result}</td>
      <td>${opening}</td>
      <td>${duration}</td>
    </tr>`;
  }

  return `<div class="block">
    <div class="block-title">Historical Data</div>
    <div class="card" style="padding:8px;">
      <table class="history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Map</th>
            <th>Civs</th>
            <th>Res</th>
            <th>Opening</th>
            <th>Dur</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

// ============================================================================
// FOOTER
// ============================================================================

function buildFooter() {
  const ytUrl = getConfig('youtube_url');
  const twUrl = getConfig('twitch_url');

  return `<div class="overlay-footer">
    <div class="footer-creator">Created by EduardR10 · Helping AoE2 players make better decisions.</div>
    <div class="footer-links">
      ${ytUrl ? `<a href="${ytUrl}" target="_blank" class="footer-link">YouTube</a>` : ''}
      ${twUrl ? `<a href="${twUrl}" target="_blank" class="footer-link">Twitch</a>` : ''}
    </div>
  </div>`;
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

function setupTabs(container) {
  const tabBtns = container.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (!tabId) return;

      // Update buttons
      tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));

      // Update panels
      container.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panel === tabId);
      });
    });
  });
}

function setupSocialLinks(container) {
  const socialLinks = container.querySelectorAll('[data-social]');
  const config = window.app_config || {};

  socialLinks.forEach(link => {
    const social = link.dataset.social;
    let url = '';
    switch (social) {
      case 'youtube': url = config.youtube_url; break;
      case 'twitch': url = config.twitch_url; break;
      case 'buymeacoffee': url = config.buymeacoffee_url; break;
      case 'kofi': url = config.kofi_url; break;
      case 'binance': url = config.binance_id; break;
    }
    if (url) {
      link.href = url;
      link.target = '_blank';
    } else {
      link.style.opacity = '0.4';
      link.style.pointerEvents = 'none';
    }
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
