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
  // First check if we have face-off data
  const container = document.getElementById('aoe2-overlay');
  if (container && container._lastFaceOff && container._lastFaceOff.left && container._lastFaceOff.right) {
    buildFaceOffOverlay(container._lastFaceOff.left, container._lastFaceOff.right);
    return;
  }

  // Fallback to regular overlay
  if (container && container._lastStats && container._lastPlayerId) {
    buildOverlay(container._lastStats, container._lastPlayerId);
  }
}

// ============================================================================
// FACE-OFF OVERLAY (two players insights, temporary)
// ============================================================================

export function buildFaceOffOverlay(leftStats, rightStats) {
  const old = document.getElementById('faceoff-overlay');
  if (old) old.remove();

  const container = document.createElement('div');
  container.id = 'faceoff-overlay';
  document.body.appendChild(container);

  if (container._hideTimeout) clearTimeout(container._hideTimeout);

  const left = leftStats || {};
  const right = rightStats || {};

  const leftName = left.player_name || left.rival_name || 'Player A';
  const rightName = right.player_name || right.rival_name || 'Player B';
  const leftElo = left.rating || left.rival_rating || '—';
  const rightElo = right.rating || right.rival_rating || '—';
  const leftWr = left.win_percent != null ? left.win_percent : (left.win_rate || 0);
  const rightWr = right.win_percent != null ? right.win_percent : (right.win_rate || 0);
  const leftGames = left.analyzed || left.total || 0;
  const rightGames = right.analyzed || right.total || 0;
  const leftConf = left.confidence || 'Low';
  const rightConf = right.confidence || 'Low';

  // ==========================================================================
  // DATA EXTRACTION HELPERS
  // ==========================================================================

  function getOpening(s) {
    const pp = s.player_profile || {};
    const primary = pp.primary_opening || s.current_opening?.chosen_opening || '';
    if (!primary) return null;
    const freq = pp.per_opening_frequency || {};
    const pct = freq[primary] || 0;
    return { name: primary, pct, label: formatOpeningName(primary) };
  }

  function getStratSeq(s) {
    const pred = s.prediction || {};
    if (pred.expected_strategy && !pred.expected_strategy.includes('Analyzing') && !pred.expected_strategy.includes('Mixed')) {
      return pred.expected_strategy;
    }
    const sa = s.strategic_analysis || {};
    const tf = sa.transition_forecast;
    if (Array.isArray(tf) && tf.length > 0) {
      const top = tf.slice(0, 2).map(t => t.name || t).join(' → ');
      if (top) return top;
    }
    return null;
  }

  function getUnitBars(s) {
    const cats = s.unit_categories || {};
    const total = Object.values(cats).reduce((sum, c) => sum + (c.count || 0), 0);
    if (!total) return null;
    const order = ['cavalry', 'archers', 'infantry', 'siege'];
    const colors = { cavalry: '#f59e0b', archers: '#eab308', infantry: '#ef4444', siege: '#a855f7' };
    const names = { cavalry: 'Cav', archers: 'Arch', infantry: 'Inf', siege: 'Siege' };
    const bars = [];
    for (const cat of order) {
      const data = cats[cat];
      if (!data || !data.count) continue;
      const pct = Math.round((data.count / total) * 100);
      if (pct < 5) continue;
      bars.push({ name: names[cat] || cat, pct, color: colors[cat] || '#888' });
    }
    if (bars.length === 0) return null;
    return bars;
  }

  function getUnitEffectiveness(s, maxStrong, maxWeak) {
    const ue = s.unit_effectiveness || {};
    const entries = Object.entries(ue).filter(([, d]) => d.label && d.label !== 'neutral' && (d.wins + d.losses) >= 3);
    if (entries.length === 0) return null;
    const strong = entries.filter(([, d]) => d.label === 'strong').sort((a, b) => b[1].wr - a[1].wr).slice(0, maxStrong);
    const weak = entries.filter(([, d]) => d.label === 'weak' && d.share >= 5).sort((a, b) => a[1].wr - b[1].wr).slice(0, maxWeak);
    return { strong, weak };
  }

  function getEarlyPressureSignal(s) {
    const ep = s.early_pressure || {};
    const w10 = ep.before10?.wins;
    const l10 = ep.before10?.losses;
    if (w10 == null || l10 == null) return null;
    const w = Number(w10);
    const l = Number(l10);
    if (isNaN(w) || isNaN(l)) return null;
    if (w > l * 1.3) return `Early military pressure wins more games`;
    if (l > w * 1.3) return `Boomear to Castle wins more games`;
    return null;
  }

  function getMatchup(leftS, rightS) {
    const lElo = leftS.rating || 0;
    const rElo = rightS.rating || 0;
    const diff = lElo - rElo;
    if (diff > 50) return { label: 'FAVORITO', diff: `+${Math.round(diff)} ELO`, cls: 'fav' };
    if (diff < -50) return { label: 'UNDERDOG', diff: `${Math.round(diff)} ELO`, cls: 'dog' };
    return { label: 'EVEN', diff: '', cls: 'even' };
  }

  function getCounterRecs(s) {
    const pred = s.prediction || {};
    const recs = pred.counter_recommendations || [];
    if (!Array.isArray(recs)) return null;
    return recs.filter(r => r && !r.includes('Insufficient') && !r.includes('no data')).slice(0, 3);
  }

  function getTimingRow(s) {
    const feudal = s.avg_feudal_hms || '';
    const castle = s.avg_castle_hms || '';
    if (!feudal && !castle) return null;
    const parts = [];
    if (feudal) parts.push(`Fed ${feudal}`);
    if (castle) parts.push(`Cas ${castle}`);
    return parts.join(' · ');
  }

  function getTopInsights(s) {
    const candidates = [];
    if (Array.isArray(s.deep_insights)) {
      candidates.push(...s.deep_insights.filter(i => i && i.length > 15));
    }
    if (Array.isArray(s.threats)) {
      candidates.push(...s.threats.filter(t => t && !t.includes('No dominant') && t.length > 10));
    }
    if (Array.isArray(s.weaknesses)) {
      candidates.push(...s.weaknesses.filter(w => w && !w.includes('No extreme') && !w.includes('No patterns') && w.length > 10));
    }
    if (Array.isArray(s.recommendations)) {
      candidates.push(...s.recommendations.map(r => r.text || r).filter(r => r && !r.includes('Analyze') && !r.includes('no data') && r.length > 10));
    }
    const seen = new Set();
    const unique = [];
    for (const item of candidates) {
      const text = String(item).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      unique.push(text);
      if (unique.length >= 2) break;
    }
    if (unique.length === 0) {
      const topCiv = Object.entries(s.civ_played_percent || {}).sort((a, b) => b[1] - a[1])[0];
      if (topCiv) unique.push(`Prefers ${topCiv[0]} (${topCiv[1]}% of games)`);
    }
    return unique;
  }

  function unitIcon(unitName) {
    const n = (unitName || '').toLowerCase();
    if (n.includes('knight') || n.includes('caval') || n.includes('scout') || n.includes('camel') || n.includes('cavalry')) return '\u{1F434}';
    if (n.includes('archer') || n.includes('crossbow') || n.includes('arbalest') || n.includes('skirm') || n.includes('cav_archer')) return '\u{1F3F9}';
    if (n.includes('militia') || n.includes('spear') || n.includes('pikeman') || n.includes('halberdier') || n.includes('champion') || n.includes('eagle')) return '\u2694\uFE0F';
    if (n.includes('siege') || n.includes('mangonel') || n.includes('scorpion') || n.includes('ram') || n.includes('trebuchet')) return '\u{1F4A3}';
    return '\u{1F396}\uFE0F';
  }

  function insightIcon(text) {
    const t = text.toLowerCase();
    if (t.includes('strength') || t.includes('fuerte') || t.includes('win')) return '\u26A1';
    if (t.includes('weakness') || t.includes('vulnerable') || t.includes('debil')) return '\u26A0\uFE0F';
    if (t.includes('aggress') || t.includes('rush') || t.includes('presion')) return '\u{1F525}';
    if (t.includes('boom') || t.includes('econom')) return '\u{1F33E}';
    if (t.includes('timing') || t.includes('fast') || t.includes('rapid')) return '\u23F1\uFE0F';
    if (t.includes('opening') || t.includes('apertur')) return '\u{1F3AF}';
    if (t.includes('map') || t.includes('mapa')) return '\u{1F5FA}\uFE0F';
    if (t.includes('civ') || t.includes('civiliz')) return '\u{1F3DB}\uFE0F';
    if (t.includes('scout') || t.includes('explor')) return '\u{1F434}';
    if (t.includes('archer') || t.includes('arquero')) return '\u{1F3F9}';
    if (t.includes('castle')) return '\u{1F3F0}';
    if (t.includes('knight') || t.includes('caval')) return '\u2694\uFE0F';
    return '\u{1F4A1}';
  }

  // ==========================================================================
  // BUILD PANELS
  // ==========================================================================

  function buildCol(name, elo, wr, games, conf, side, s) {
    const opening = getOpening(s);
    const stratSeq = getStratSeq(s);
    const unitBars = getUnitBars(s);
    const unitEff = getUnitEffectiveness(s, 2, 1);
    const timing = getTimingRow(s);
    const insights = getTopInsights(s);

    const wrClass = wr >= 55 ? 'green' : wr <= 40 ? 'red' : 'neutral';
    const wrColor = wr >= 55 ? 'var(--accent-blue)' : wr <= 40 ? 'var(--accent-red)' : 'var(--text-primary)';

    // Hero row
    let html = `<div class="faceoff-col ${side}">
      <div class="faceoff-header">
        <div class="faceoff-name">${escapeHtml(name)}</div>
        <div class="faceoff-live"><span class="faceoff-live-dot"></span>LIVE</div>
      </div>
      <div class="faceoff-hero-v2">
        <div class="fh-el"><div class="fh-val" style="color:${wrColor}">${wr}%</div><div class="fh-lbl">WR</div></div>
        <div class="fh-div"></div>
        <div class="fh-el"><div class="fh-val">${elo}</div><div class="fh-lbl">ELO</div></div>
        <div class="fh-div"></div>
        <div class="fh-el"><div class="fh-val">${games}</div><div class="fh-lbl">Games</div></div>
      </div>`;

    // Opening badge (prominent)
    if (opening) {
      const icons = { drush: '\u2694\uFE0F', maa_rush: '\u{1F6E1}\uFE0F', scout_rush: '\u{1F434}', archer_rush: '\u{1F3F9}', fast_feudal_aggressive: '\u26A1', fast_castle: '\u{1F3F0}', tower_rush: '\u{1F3D7}\uFE0F', castle_focus: '\u{1F3F0}' };
      const oicon = icons[opening.name] || '\u{1F3AF}';
      html += `<div class="faceoff-opening">
        <span class="fop-icon">${oicon}</span>
        <span class="fop-text">${opening.label}</span>
        <span class="fop-pct">${opening.pct}%</span>
      </div>`;
    }

    // Strategy sequence
    if (stratSeq) {
      html += `<div class="faceoff-strat-seq">${escapeHtml(stratSeq)}</div>`;
    }

    // Unit composition bars
    if (unitBars) {
      html += '<div class="faceoff-unit-bars">';
      for (const b of unitBars) {
        html += `<div class="fub-row"><span class="fub-label">${b.name}</span><div class="fub-track"><div class="fub-fill" style="width:${b.pct}%;background:${b.color}"></div></div><span class="fub-pct">${b.pct}%</span></div>`;
      }
      html += '</div>';
    }

    // Unit effectiveness badges
    if (unitEff) {
      html += '<div class="faceoff-unit-eff">';
      for (const [uname, udata] of unitEff.strong) {
        html += `<div class="fue-badge strong"><span class="fue-icon">${unitIcon(uname)}</span><span class="fue-name">${formatUnitName(uname)}</span><span class="fue-stat">${udata.wr}% WR</span></div>`;
      }
      for (const [uname, udata] of unitEff.weak) {
        html += `<div class="fue-badge weak"><span class="fue-icon">${unitIcon(uname)}</span><span class="fue-name">${formatUnitName(uname)}</span><span class="fue-stat">WR ${udata.wr}%</span></div>`;
      }
      html += '</div>';
    }

    // Timings
    if (timing) {
      html += `<div class="faceoff-timings">${escapeHtml(timing)}</div>`;
    }

    // Insights
    if (insights.length > 0) {
      html += '<div class="faceoff-insights-v2">';
      for (const ins of insights) {
        html += `<div class="foi-card"><span class="foi-icon">${insightIcon(ins)}</span><span class="foi-text">${escapeHtml(ins)}</span></div>`;
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function buildRightCol(name, elo, wr, games, conf, side, s) {
    const opening = getOpening(s);
    const stratSeq = getStratSeq(s);
    const unitBars = getUnitBars(s);
    const unitEff = getUnitEffectiveness(s, 1, 1);
    const timing = getTimingRow(s);
    const insights = getTopInsights(s);
    const counterRecs = getCounterRecs(s);
    const earlySignal = getEarlyPressureSignal(s);
    const matchup = getMatchup(left, right);

    const wrClass = wr >= 55 ? 'green' : wr <= 40 ? 'red' : 'neutral';
    const wrColor = wr >= 55 ? 'var(--accent-blue)' : wr <= 40 ? 'var(--accent-red)' : 'var(--text-primary)';

    let html = `<div class="faceoff-col ${side}">
      <div class="faceoff-header">
        <div class="faceoff-name">${escapeHtml(name)}</div>
        <div class="faceoff-live"><span class="faceoff-live-dot"></span>LIVE</div>
      </div>
      <div class="faceoff-hero-v2">
        <div class="fh-el"><div class="fh-val" style="color:${wrColor}">${wr}%</div><div class="fh-lbl">WR</div></div>
        <div class="fh-div"></div>
        <div class="fh-el"><div class="fh-val">${elo}</div><div class="fh-lbl">ELO</div></div>
        <div class="fh-div"></div>
        <div class="fh-el"><div class="fh-val">${games}</div><div class="fh-lbl">Games</div></div>
      </div>`;

    // Opening badge
    if (opening) {
      const icons = { drush: '\u2694\uFE0F', maa_rush: '\u{1F6E1}\uFE0F', scout_rush: '\u{1F434}', archer_rush: '\u{1F3F9}', fast_feudal_aggressive: '\u26A1', fast_castle: '\u{1F3F0}', tower_rush: '\u{1F3D7}\uFE0F', castle_focus: '\u{1F3F0}' };
      const oicon = icons[opening.name] || '\u{1F3AF}';
      html += `<div class="faceoff-opening">
        <span class="fop-icon">${oicon}</span>
        <span class="fop-text">${opening.label}</span>
        <span class="fop-pct">${opening.pct}%</span>
      </div>`;
    }

    // Strategy sequence
    if (stratSeq) {
      html += `<div class="faceoff-strat-seq">${escapeHtml(stratSeq)}</div>`;
    }

    // Matchup prediction
    if (matchup && matchup.label !== 'EVEN') {
      const mColor = matchup.cls === 'fav' ? 'var(--accent-blue)' : 'var(--accent-red)';
      html += `<div class="faceoff-matchup" style="border-color:${mColor}">
        <span class="fmu-label" style="color:${mColor}">${matchup.label}</span>
        <span class="fmu-diff">${matchup.diff}</span>
      </div>`;
    }

    // Counter recommendations
    if (counterRecs && counterRecs.length > 0) {
      html += '<div class="faceoff-counters">';
      for (const rec of counterRecs) {
        html += `<div class="fco-item">→ ${escapeHtml(rec)}</div>`;
      }
      html += '</div>';
    }

    // Early pressure signal
    if (earlySignal) {
      html += `<div class="faceoff-pressure">${escapeHtml(earlySignal)}</div>`;
    }

    // Unit composition bars
    if (unitBars) {
      html += '<div class="faceoff-unit-bars">';
      for (const b of unitBars) {
        html += `<div class="fub-row"><span class="fub-label">${b.name}</span><div class="fub-track"><div class="fub-fill" style="width:${b.pct}%;background:${b.color}"></div></div><span class="fub-pct">${b.pct}%</span></div>`;
      }
      html += '</div>';
    }

    // Unit effectiveness badges
    if (unitEff) {
      html += '<div class="faceoff-unit-eff">';
      for (const [uname, udata] of unitEff.strong) {
        html += `<div class="fue-badge strong"><span class="fue-icon">${unitIcon(uname)}</span><span class="fue-name">${formatUnitName(uname)}</span><span class="fue-stat">${udata.wr}% WR</span></div>`;
      }
      for (const [uname, udata] of unitEff.weak) {
        html += `<div class="fue-badge weak"><span class="fue-icon">${unitIcon(uname)}</span><span class="fue-name">${formatUnitName(uname)}</span><span class="fue-stat">WR ${udata.wr}%</span></div>`;
      }
      html += '</div>';
    }

    // Timings
    if (timing) {
      html += `<div class="faceoff-timings">${escapeHtml(timing)}</div>`;
    }

    // Insights
    if (insights.length > 0) {
      html += '<div class="faceoff-insights-v2">';
      for (const ins of insights) {
        html += `<div class="foi-card"><span class="foi-icon">${insightIcon(ins)}</span><span class="foi-text">${escapeHtml(ins)}</span></div>`;
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  // Build both panels
  // Left = self (your gameplan with matchup + counters)
  // Right = rival (enemy intel with unit comp + effectiveness)

  // Check which has more data to decide what goes where
  // selfStats (left) shows: opening + matchup + counters + early pressure
  // rivalStats (right) shows: opening + unit comp + unit effectiveness + weaknesses

  const leftHtml = buildRightCol(leftName, leftElo, leftWr, leftGames, leftConf, 'left', left);
  const rightHtml = buildCol(rightName, rightElo, rightWr, rightGames, rightConf, 'right', right);

  container.innerHTML = `${leftHtml}${rightHtml}
    <button id="faceoff-reopen-btn" class="faceoff-reopen-btn">Mostrar</button>`;

  container.classList.add('active');
  container.style.background = 'transparent';
  container._lastFaceOff = { leftStats, rightStats };

  const button = container.querySelector('#faceoff-reopen-btn');
  const panels = Array.from(container.querySelectorAll('.faceoff-col'));

  const showButton = () => { if (button) button.classList.add('visible'); };
  const hideButton = () => { if (button) button.classList.remove('visible'); };

  const hidePanels = (animated = true) => {
    if (animated) {
      panels.forEach(p => {
        p.classList.add(p.classList.contains('left') ? 'slide-out-left' : 'slide-out-right');
      });
      setTimeout(() => {
        panels.forEach(p => { p.style.opacity = '0'; });
        showButton();
        container.style.background = 'transparent';
      }, 380);
    } else {
      panels.forEach(p => { p.style.opacity = '0'; });
      showButton();
      container.style.background = 'transparent';
    }
  };

  const showPanels = () => {
    panels.forEach(p => {
      p.style.opacity = '';
      p.classList.remove('slide-out-left', 'slide-out-right');
      p.style.animation = 'none';
      void p.offsetHeight;
      p.style.animation = '';
    });
    container.style.background = 'transparent';
    hideButton();
    if (container._hideTimeout) clearTimeout(container._hideTimeout);
    container._hideTimeout = setTimeout(() => hidePanels(true), OVERLAY_AUTO_HIDE_MS);
  };

  container._hideTimeout = setTimeout(() => hidePanels(true), OVERLAY_AUTO_HIDE_MS);

  if (button) {
    button.addEventListener('click', () => {
      const hidden = panels.some(p => p.style.opacity === '0' || getComputedStyle(p).opacity === '0');
      if (hidden) {
        showPanels();
      } else {
        hidePanels(true);
      }
    });
  }
}

function formatUnitName(name) {
  if (!name) return '';
  return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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

  // Card 3b: Cross-analysis (determinant features + matchup model)
  html += buildCrossAnalysisCard(stats);


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

function buildCrossAnalysisCard(stats) {
  const ca = stats.cross_analysis || null;
  if (!ca) return `<div class="card"><div class="card-label">Cross Analysis</div><div class="card-subtitle">Insufficient data for cross analysis</div></div>`;

  // Determinant features
  const det = ca.determinantFeatures || [];
  let detHtml = '';
  if (det.length === 0) {
    detHtml = '<div style="font-size:12px;color:var(--text-muted)">No strong determinant features detected</div>';
  } else {
    detHtml = '<ul class="det-features">';
    for (const f of det.slice(0, 5)) {
      detHtml += `<li><strong>${formatFeatureName(f.feature)}</strong>: ${f.cohen_d > 0 ? '+' : ''}${f.cohen_d} (${f.strength}, n=${f.samples.wins + f.samples.losses})</li>`;
    }
    detHtml += '</ul>';
  }

  // Suggested counters
  const counters = (ca.matchupBehavior && ca.matchupBehavior.suggestedCounters) || [];
  let countersHtml = '';
  if (counters.length) {
    countersHtml = '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">';
    for (const c of counters.slice(0, 4)) countersHtml += `<span class="pill">${formatUnitName(c.unit)} · ${c.wr}% WR</span>`;
    countersHtml += '</div>';
  }

  return `<div class="card">
    <div class="card-label">Cross Analysis</div>
    <div class="card-subtitle">Determinant features and suggested counters</div>
    <div style="margin-top:8px">${detHtml}</div>
    ${countersHtml}
  </div>`;
}

function buildPredictionCard(stats) {
  const ca = stats.cross_analysis || null;
  if (!ca || !ca.matchupBehavior) return '';
  const mb = ca.matchupBehavior;
  const currentOpening = stats.current_opening?.chosen_opening || stats.player_profile?.primary_opening || null;
  const currentMap = stats.current_map || null;
  const currentOpponentCiv = stats.current_opponent_civ || null;
  const pred = mb.predict({ myOpening: currentOpening, map: currentMap, opponentCiv: currentOpponentCiv, topN: 3 });
  const preds = pred.predictions || [];
  if (!preds.length) return '';

  const sourceLabels = {
    global: 'Global opponent opening distribution',
    opening: 'Conditioned on your opening',
    'opening+map': 'Conditioned on your opening and map',
    'opening+opponentCiv': 'Conditioned on your opening and opponent civ',
    'opening+map+opponentCiv': 'Conditioned on opening, map and opponent civ',
  };
  const sourceText = sourceLabels[pred.source] || '';
  const sampleText = pred.sample ? ` (${pred.sample}g)` : '';
  const confidenceText = pred.confidence === 'high' ? '' : pred.confidence === 'medium' ? ' · medium confidence' : ' · low confidence';
  const contextParts = [];
  if (currentMap) contextParts.push(`Map: ${currentMap}`);
  if (currentOpponentCiv) contextParts.push(`Opponent civ: ${currentOpponentCiv}`);
  const contextText = contextParts.length ? ` · ${contextParts.join(' · ')}` : '';

  let html = `<div class="card">
    <div class="card-label">Predicted Opponent Responses</div>
    <div class="card-subtitle">${sourceText}${sampleText}${confidenceText}${contextText}</div>
    <div style="margin-top:8px">`;
  for (const p of preds) {
    html += `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--border-subtle)"><div>${formatOpeningName(p.opponent_opening)}</div><div style="color:var(--accent-blue)">${p.probability_pct}%</div></div>`;
  }
  html += '</div></div>';
  return html;
}

function formatFeatureName(name) {
  if (!name) return '';
  return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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

  // Prediction based on cross-analysis (opponent openings)
  html += buildPredictionCard(stats);

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
