import { formatHms, techDisplayName } from './utils.js';

const OVERLAY_AUTO_HIDE_MS = 15000;

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

  // Ensure normal overlay removes fullscreen mode
  container.classList.remove('overlay-fullscreen');

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
  if (!container) return;

  if (container._lastFaceOff && container._lastFaceOff.left && container._lastFaceOff.right) {
    buildFaceOffOverlay(container._lastFaceOff.left, container._lastFaceOff.right);
    return;
  }

  if (container._lastStats && container._lastPlayerId) {
    buildOverlay(container._lastStats, container._lastPlayerId);
  }
}

// ============================================================================
// FACE-OFF OVERLAY (two players insights, temporary)
// ============================================================================

export function buildFaceOffOverlay(leftStats, rightStats) {
  const container = document.getElementById('aoe2-overlay');
  if (!container) return;

  // Clear previous hide timeout
  if (container._hideTimeout) clearTimeout(container._hideTimeout);

  const leftName = leftStats?.player_name || leftStats?.rival_name || 'Player A';
  const rightName = rightStats?.player_name || rightStats?.rival_name || 'Player B';
  const leftElo = leftStats?.rating || leftStats?.rival_rating || '—';
  const rightElo = rightStats?.rating || rightStats?.rival_rating || '—';
  const leftWr = leftStats?.win_percent != null ? `${leftStats.win_percent}%` : (leftStats?.win_rate ? `${leftStats.win_rate}%` : '—');
  const rightWr = rightStats?.win_percent != null ? `${rightStats.win_percent}%` : (rightStats?.win_rate ? `${rightStats.win_rate}%` : '—');

  function pickInsights(s) {
    const candidates = [];
    if (Array.isArray(s.recommendations)) candidates.push(...s.recommendations);
    if (Array.isArray(s.deep_insights)) candidates.push(...s.deep_insights);
    if (Array.isArray(s.timing_interpretation)) candidates.push(...s.timing_interpretation.map(i => i.conclusion || i));
    if (Array.isArray(s.weaknesses)) candidates.push(...s.weaknesses.map(w => `Weakness: ${w}`));
    const unique = [];
    const seen = new Set();
    for (const item of candidates) {
      const text = typeof item === 'string' ? item : (item.text || item.title || item);
      if (!text) continue;
      const normalized = String(text).trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(normalized);
      if (unique.length >= 3) break;
    }
    return unique;
  }

  function getCompactMetrics(s) {
    const pp = s.player_profile || {};
    const primary = pp.primary_opening || s.current_opening?.chosen_opening || 'Unknown';
    const openingPct = pp.per_opening_frequency ? Math.round((pp.per_opening_frequency[primary] || 0) * 100) / 100 : null;
    const topCivEntry = Object.entries(s.civ_played_percent || {}).sort((a, b) => b[1] - a[1])[0] || [];
    const topCiv = topCivEntry[0] || 'Unknown';
    const feudal = s.avg_feudal_hms || '—';
    const castle = s.avg_castle_hms || '—';
    const tc2pct = s.tc_timing?.tc2_pct != null ? `${s.tc_timing.tc2_pct}%` : '—';
    const tc2time = s.tc_timing?.tc2_avg_hms || '—';
    const ball = s.key_techs && s.key_techs['ballistics'] ? formatHms(s.key_techs['ballistics'].avg_time) : (s.key_techs && s.key_techs['ballistics'] == null ? '—' : null);
    return { primary, openingPct, topCiv, feudal, castle, tc2pct, tc2time, ball };
  }

  const leftTop = pickInsights(leftStats || {});
  const rightTop = pickInsights(rightStats || {});
  const lm = getCompactMetrics(leftStats || {});
  const rm = getCompactMetrics(rightStats || {});

  const buildCol = (name, elo, wr, m, insights, side) => `
    <div class="faceoff-col ${side}">
      <div class="faceoff-header"><div class="faceoff-name">${escapeHtml(name)}</div><div class="faceoff-meta">${elo} · ${wr}</div></div>
      <div class="faceoff-metrics">
        <div class="metric"><strong>Opening:</strong> ${escapeHtml(formatOpeningName(m.primary))}${m.openingPct ? ' · ' + m.openingPct + '%' : ''}</div>
        <div class="metric"><strong>Civ:</strong> ${escapeHtml(m.topCiv)}</div>
        <div class="metric"><strong>Feudal / Castle:</strong> ${escapeHtml(m.feudal)} / ${escapeHtml(m.castle)}</div>
        <div class="metric"><strong>2º TC:</strong> ${escapeHtml(m.tc2pct)} (${escapeHtml(m.tc2time)})</div>
        ${m.ball ? `<div class="metric"><strong>Ballistics:</strong> ${escapeHtml(m.ball)}</div>` : ''}
      </div>
      <div class="faceoff-insights">${insights.map(i => `<div class="insight-card">${escapeHtml(i)}</div>`).join('')}</div>
    </div>`;

  const html = `<div class="faceoff-grid compact">
    ${buildCol(leftName, leftElo, leftWr, lm, leftTop, 'left')}
    ${buildCol(rightName, rightElo, rightWr, rm, rightTop, 'right')}
  </div>
  <button id="faceoff-reopen-btn" class="faceoff-reopen-btn">Ocultar análisis</button>`;

  container.innerHTML = html;
  container.classList.add('overlay-fullscreen');
  document.body.classList.add('chroma-ready');
  container.style.opacity = '1';
  container.style.pointerEvents = 'auto';
  container._lastFaceOff = { leftStats, rightStats };

  const button = container.querySelector('#faceoff-reopen-btn');
  const panels = Array.from(container.querySelectorAll('.faceoff-col'));

  const hidePanels = () => {
    panels.forEach(panel => panel.style.opacity = '0');
    if (button) button.textContent = 'Mostrar análisis';
    document.body.classList.remove('chroma-ready');
  };

  const showPanels = () => {
    panels.forEach(panel => panel.style.opacity = '1');
    if (button) button.textContent = 'Ocultar análisis';
    document.body.classList.add('chroma-ready');
    container.classList.add('overlay-fullscreen');
  };

  if (button) {
    button.addEventListener('click', () => {
      const hidden = panels.some(panel => panel.style.opacity === '0');
      if (hidden) {
        showPanels();
        if (container._hideTimeout) clearTimeout(container._hideTimeout);
        container._hideTimeout = setTimeout(hidePanels, OVERLAY_AUTO_HIDE_MS);
      } else {
        hidePanels();
      }
    });
  }

  // Auto-hide after the same interval as overlay
  if (container._hideTimeout) clearTimeout(container._hideTimeout);
  container._hideTimeout = setTimeout(() => {
    hidePanels();
  }, OVERLAY_AUTO_HIDE_MS);
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
  const confidence = stats.confidence || 'Low';
  const eapm = stats.avg_eapm || 0;

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
        <span class="confidence-badge">Confidence: ${confidence}</span>
        <span style="font-size:10px;font-weight:600;color:var(--accent-blue);margin-left:auto;">APM: ${eapm > 0 ? eapm : '—'}</span>
      </div>
    </div>
  </div>`;
}

// ============================================================================
// BLOCK 2: RIVAL INTELLIGENCE
// ============================================================================

function buildRivalIntelligence(stats) {
  let html = `<div class="block">`;
  html += `<div class="block-title">Rival Intelligence</div>`;

  // Card 0: Strategic Identity (Knowledge base)
  html += buildStrategicIdentityCard(stats);

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

function buildStrategicIdentityCard(stats) {
  const sa = stats.strategic_analysis || {};
  const identity = sa.strategic_identity || {};
  const spike = sa.power_spike || {};
  const weaknesses = sa.weaknesses || [];
  const recs = sa.recommendations || [];

  let weaknessHtml = '';
  for (const w of weaknesses.slice(0, 3)) {
    weaknessHtml += `<span style="display:inline-block;padding:2px 8px;background:rgba(220,38,38,0.08);color:var(--accent-red);border-radius:10px;font-size:10px;margin-right:4px;margin-bottom:3px;">${w}</span>`;
  }

  let recsHtml = '';
  for (const r of recs.slice(0, 3)) {
    recsHtml += `<div style="font-size:11px;color:var(--text-primary);padding:2px 0;">→ ${r}</div>`;
  }

  return `<div class="card">
    <div class="card-label">Strategic Identity</div>
    <div class="card-value" style="font-size:16px;">${identity.identity || 'Unknown'}</div>
    <div class="card-subtitle">${identity.civilization || ''} · ${spike.timing || ''}</div>
    ${weaknessHtml ? `<div style="margin-top:6px;">${weaknessHtml}</div>` : ''}
    ${recsHtml ? `<div style="margin-top:6px;border-top:1px solid var(--border-subtle);padding-top:6px;">${recsHtml}</div>` : ''}
  </div>`;
}

function buildExpectedOpeningCard(stats) {
  const pp = stats.player_profile || {};
  const primary = pp.primary_opening || 'Unknown';
  const freq = pp.per_opening_frequency || {};
  const stability = Math.round((pp.opening_stability || 0) * 100);
  const confidence = stability >= 60 ? 'High' : stability >= 30 ? 'Medium' : 'Low';

  const openingIcons = {
    'drush': '⚔️',
    'maa_rush': '🛡️',
    'scout_rush': '🐴',
    'archer_rush': '🏹',
    'fast_feudal_aggressive': '⚡',
    'fast_castle': '🏰',
    'tower_rush': '🏗️',
    'castle_focus': '🏰',
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
  const interpretations = stats.timing_interpretation || [];
  const feudalTime = stats.avg_feudal_hms || 'N/A';
  const castleTime = stats.avg_castle_hms || 'N/A';
  const imperialTime = stats.avg_imperial_hms || 'N/A';

  let interpHtml = '';
  for (const interp of interpretations.slice(0, 3)) {
    const iconColor = interp.type === 'positive' ? 'var(--accent-green)' : interp.type === 'warning' ? 'var(--accent-yellow)' : 'var(--accent-blue)';
    interpHtml += `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;">
      <span style="color:${iconColor};font-weight:700;">${interp.icon}</span>
      <span style="color:var(--text-secondary);"><strong>${interp.timing}</strong> — ${interp.conclusion}</span>
    </div>`;
  }

  return `<div class="card">
    <div class="card-label">Timing Analysis</div>
    <div class="timing-row">
      <span class="timing-label">Feudal</span>
      <span class="timing-value">${feudalTime}</span>
    </div>
    <div class="timing-row">
      <span class="timing-label">Castle</span>
      <span class="timing-value">${castleTime}</span>
    </div>
    <div class="timing-row">
      <span class="timing-label">Imperial</span>
      <span class="timing-value">${imperialTime}</span>
    </div>
    ${interpHtml ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);">${interpHtml}</div>` : ''}
  </div>`;
}

// ============================================================================
// BLOCK 3: STRATEGIC RECOMMENDATIONS
// ============================================================================

function buildStrategicRecommendations(stats) {
  const pred = stats.prediction || {};
  const recs = stats.recommendations || [];
  const weaknesses = stats.weaknesses || [];
  const threats = stats.threats || [];

  let html = `<div class="block">`;
  html += `<div class="block-title">Strategic Intelligence</div>`;

  // Prediction engine card
  html += `<div class="card">
    <div class="card-label">Expected Strategy</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:3px;">${escapeHtml(pred.expected_strategy || 'Analyzing...')}</div>
    ${pred.strategy_probability > 0 ? `<div class="card-subtitle">${pred.strategy_probability}% probability</div>` : ''}
    ${pred.secondary_strategy ? `<div class="card-subtitle">Backup: ${formatOpeningName(pred.secondary_strategy)}</div>` : ''}
  </div>`;

  // Main recommendation card
  html += `<div class="card">
    <div class="card-label">Recommended Counter</div>
    <ul class="recommendation-list">`;

  if (recs.length > 0) {
    for (const rec of recs.slice(0, 5)) {
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
  const tabIds = ['overview', 'military', 'economy', 'openings', 'maps', 'civs', 'units-age', 'techs'];
  const tabLabels = ['Overview', 'Military', 'Economy', 'Openings', 'Maps', 'Civs', 'Units by Age', 'Techs'];

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
  html += buildUnitsByAgePanel(stats, tabIds[6]);
  html += buildTechTimingsPanel(stats, tabIds[7]);

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
  const games = stats.analyzed || 1;

  const totalCount = Object.values(unitCats).reduce((sum, cat) => sum + (cat.count || 0), 0);
  const totalAvg = Math.round((totalCount / games) * 100) / 100;

  let compositionHtml = '';
  if (totalCount > 0) {
    const cats = [
      { key: 'cavalry', label: 'Cavalry', color: 'var(--accent-orange)' },
      { key: 'archers', label: 'Archers', color: 'var(--accent-yellow)' },
      { key: 'infantry', label: 'Infantry', color: 'var(--accent-red)' },
      { key: 'siege', label: 'Siege', color: 'var(--accent-purple)' },
    ];
    for (const cat of cats) {
      const data = unitCats[cat.key];
      if (!data || !data.count) continue;
      const pct = Math.round((data.count / totalCount) * 100);
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
        <div class="tab-stat-label">Avg Units/Game</div>
        <div class="tab-stat-value">${totalAvg}</div>
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
function buildUnitsByAgePanel(stats, id) {
  const unitsByAge = stats.units_by_age_period || {};
  const periods = [
    { key: 'pre-feudal', label: 'Dark → Feudal' },
    { key: 'pre-castle', label: 'Feudal → Castle' },
    { key: 'pre-imperial', label: 'Castle → Imperial' },
  ];

  let html = '<div class="data-grid">';
  for (const period of periods) {
    const units = unitsByAge[period.key] || {};
    const entries = Object.entries(units).slice(0, 5);
    if (entries.length === 0) continue;

    html += `<div class="data-grid-col">
      <div class="data-grid-col-title">${period.label}</div>`;
    for (const [unitName, data] of entries) {
      html += `<div class="data-grid-row">
        <span>${techDisplayName(unitName)}</span>
        <span class="data-grid-value">${data.avg.toFixed(1)}</span>
      </div>`;
    }
    html += `</div>`;
  }
  html += '</div>';

  return `<div class="tab-panel" data-panel="${id}">
    ${html}
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
      html += `<div class="data-grid-row">
        <span>${techDisplayName(techName)}</span>
        <span class="data-grid-value">${timeStr} · ${Math.round(data.frequency)}%</span>
      </div>`;
    }
    html += `</div>`;
  }
  html += '</div>';

  return `<div class="tab-panel" data-panel="${id}">
    ${html || '<div class="card-subtitle" style="padding:10px 0;">No tech timing data.</div>'}
  </div>`;
}

// ============================================================================

function buildFooter() {
  const ytUrl = getConfig('youtube_url');
  const twUrl = getConfig('twitch_url');

  return `<div class="overlay-footer">
    <div class="footer-creator">Created by EduardR10 · Data by <a href="https://aoe2companion.com" target="_blank" style="color:var(--accent-blue);text-decoration:none;">AoE2 Companion</a></div>
    <div class="footer-links">
      ${ytUrl ? `<a href="${ytUrl}" target="_blank" class="footer-link">YouTube</a>` : ''}
      ${twUrl ? `<a href="${twUrl}" target="_blank" class="footer-link">Twitch</a>` : ''}
      <a href="https://ko-fi.com/V7V12KZ5U" target="_blank" class="footer-link" style="color:var(--accent-red);">Ko-fi</a>
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
    'maa_rush': 'MAA Rush',
    'scout_rush': 'Scout Rush',
    'archer_rush': 'Archer Rush',
    'fast_feudal_aggressive': 'Fast Feudal Aggro',
    'fast_castle': 'Fast Castle',
    'tower_rush': 'Tower Rush',
    'castle_focus': 'Castle Focus',
    'Standard/Unknown': 'Mixed',
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
