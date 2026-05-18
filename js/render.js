import { formatHms, techDisplayName } from './utils.js';

const SLIDE_DURATION = 8000;

export function buildOverlay(stats, playerId) {
  const container = document.getElementById('aoe2-overlay');
  if (!container) return;

  // Guardar para restartOverlay
  container._lastStats = stats;
  container._lastPlayerId = playerId;

  if (stats.error || stats.total === 0) {
    container.innerHTML = '<div class="loading-state">No se encontraron partidas.</div>';
    return;
  }

  // Limpiar slideshow anterior si existe
  clearSlideshow(container);

  // Generar contenido de slides (siempre retorna algo, nunca vacio)
  const slides = [
    buildSlide1(stats),
    buildSlide2(stats),
    buildSlide3(stats),
    buildSlide4(stats),
  ];

  const total = slides.length;

  // Construir HTML
  let html = '<div class="slides-wrapper">';
  for (let i = 0; i < total; i++) {
    html += `<div class="slide ${i === 0 ? 'active' : ''}" data-slide="${i}">${slides[i]}</div>`;
  }
  html += `<div class="slide-nav slide-nav-prev" title="Anterior">&#10094;</div>`;
  html += `<div class="slide-nav slide-nav-next" title="Siguiente">&#10095;</div>`;
  html += `<div class="slide-dots">`;
  for (let i = 0; i < total; i++) {
    html += `<span class="dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>`;
  }
  html += `</div></div>`;

  container.innerHTML = html;
  container.style.opacity = '1';
  container.style.pointerEvents = 'auto';

  // Iniciar slideshow
  startSlideshow(container, total);
}

export function restartOverlay() {
  const container = document.getElementById('aoe2-overlay');
  if (container && container._lastStats && container._lastPlayerId) {
    buildOverlay(container._lastStats, container._lastPlayerId);
  }
}

function clearSlideshow(container) {
  const state = container._slideshowState;
  if (state) {
    if (state.interval) clearInterval(state.interval);
    if (state.hideTimeout) clearTimeout(state.hideTimeout);
  }
  container._slideshowState = null;
}

function startSlideshow(container, totalSlides) {
  const state = {
    currentSlide: 0,
    totalSlides,
    interval: null,
    hideTimeout: null,
  };
  container._slideshowState = state;

  // Navegacion manual - dots
  container.querySelectorAll('.dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(dot.dataset.index);
      if (!isNaN(idx)) goToSlide(container, idx);
    });
  });

  // Navegacion manual - flechas
  const prev = container.querySelector('.slide-nav-prev');
  const next = container.querySelector('.slide-nav-next');
  if (prev) {
    prev.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = (state.currentSlide - 1 + state.totalSlides) % state.totalSlides;
      goToSlide(container, idx);
    });
  }
  if (next) {
    next.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = (state.currentSlide + 1) % state.totalSlides;
      goToSlide(container, idx);
    });
  }

  // Intervalo automatico
  state.interval = setInterval(() => {
    const next = (state.currentSlide + 1) % state.totalSlides;
    showSlide(container, next);
    state.currentSlide = next;
  }, SLIDE_DURATION);

  // Auto-hide despues del ciclo completo + buffer
  state.hideTimeout = setTimeout(() => {
    if (state.interval) clearInterval(state.interval);
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
  }, SLIDE_DURATION * totalSlides + 2000);
}

function goToSlide(container, index) {
  const state = container._slideshowState;
  if (!state || index === state.currentSlide) return;

  showSlide(container, index);
  state.currentSlide = index;

  // Reiniciar intervalo
  if (state.interval) clearInterval(state.interval);
  state.interval = setInterval(() => {
    const next = (state.currentSlide + 1) % state.totalSlides;
    showSlide(container, next);
    state.currentSlide = next;
  }, SLIDE_DURATION);
}

function showSlide(container, index) {
  container.querySelectorAll('.slide').forEach((s, i) => {
    s.classList.toggle('active', i === index);
  });
  container.querySelectorAll('.dot').forEach((d, i) => {
    d.classList.toggle('active', i === index);
  });
}

// ============================================================================
// SLIDE BUILDERS
// ============================================================================

function buildSlide1(stats) {
  const initial = (stats.player_name || '?').charAt(0).toUpperCase();
  const wr = stats.win_percent || 0;
  const wrClass = wr >= 50 ? 'good' : 'bad';

  let html = '';

  html += `<div class="overlay-header">
    <div class="player-avatar">${initial}</div>
    <div class="player-info">
      <div class="player-name">${stats.player_name}</div>
      <div class="player-rating">Rating: ${stats.rating || '—'}</div>
    </div>
    <div class="wr-badge ${wrClass}">${wr}% WR</div>
  </div>`;

  if (stats.player_profile && stats.match_id === 'self') {
    html += buildProfileOpening(stats.player_profile);
  } else if (stats.current_opening && stats.match_id !== 'self') {
    html += buildCurrentOpening(stats.current_opening);
  }

  html += `<div class="quick-stats">
    <div class="stat-card"><div class="stat-label">Games</div><div class="stat-value">${stats.analyzed}</div></div>
    <div class="stat-card"><div class="stat-label">Wins</div><div class="stat-value green">${stats.total_wins || 0}</div></div>
    <div class="stat-card"><div class="stat-label">EAPM</div><div class="stat-value blue">${stats.avg_eapm || '—'}</div></div>
  </div>`;

  html += buildAgeTimingsCompact(stats);

  return html;
}

function buildSlide2(stats) {
  let html = '';
  html += buildCivsSection(stats);
  html += buildMapsSection(stats);
  html += buildEconomySection(stats);
  return html;
}

function buildSlide3(stats) {
  let html = '';
  const techsHtml = buildKeyTechsSection(stats);
  const marketHtml = buildMarketSection(stats);

  if (!techsHtml && !marketHtml) {
    html += `<div class="section-title">Techs & Market</div>`;
    html += `<div class="loading-state" style="font-size:11px;padding:20px 0;">No hay datos suficientes de techs o mercado en las partidas analizadas.</div>`;
  } else {
    html += techsHtml;
    html += marketHtml;
  }

  return html;
}

function buildSlide4(stats) {
  const arch = stats.archetype;
  if (!arch) {
    return `<div class="section-title">Playstyle</div>
      <div class="loading-state" style="font-size:11px;padding:20px 0;">Analizando estilo de juego...</div>`;
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

  let html = `<div class="archetype-section">
    <div class="section-title">Playstyle</div>
    <div class="archetype-badge" style="background:${color}15;color:${color};border-color:${color}30">${arch.title}</div>
    <div class="archetype-desc">${arch.description}</div>`;

  if (arch.traits && arch.traits.length > 0) {
    html += `<div class="archetype-traits">`;
    for (const trait of arch.traits) {
      html += `<span class="archetype-trait">${trait}</span>`;
    }
    html += `</div>`;
  }

  html += `<div class="dimension-bars">`;
  for (const dim of dimLabels) {
    const val = dims[dim.key] || 0;
    html += `<div class="dim-row">
      <div class="dim-label">${dim.label}</div>
      <div class="dim-bar-track">
        <div class="dim-bar-fill" style="width:${val}%;background:${dim.color}"></div>
      </div>
      <div class="dim-value">${val}</div>
    </div>`;
  }
  html += `</div></div>`;

  return html;
}

// ============================================================================
// HELPER BUILDERS
// ============================================================================

function buildProfileOpening(pp) {
  const label = pp.primary_opening || 'N/A';
  const stability = Math.round((pp.opening_stability || 0) * 100);
  const cls = getOpeningClass(label);

  let html = `<div class="opening-section">
    <div class="opening-label">Apertura de perfil</div>
    <div class="opening-name ${cls}">${label}</div>
    <div class="opening-meta"><span>Estabilidad: ${stability}%</span></div>`;

  if (pp.per_opening_frequency && Object.keys(pp.per_opening_frequency).length > 0) {
    html += `<div class="opening-freq">`;
    for (const [lbl, pct] of Object.entries(pp.per_opening_frequency)) {
      html += `<span class="opening-freq-item">${lbl} ${pct}%</span>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function buildCurrentOpening(co) {
  const label = co.chosen_opening || 'N/A';
  const score = co.score || 0;
  const cls = getOpeningClass(label);
  const scoreColor = score >= 0.7 ? 'var(--accent-green)' : 'var(--accent-yellow)';

  return `<div class="opening-section">
    <div class="opening-label">Apertura actual</div>
    <div class="opening-name ${cls}">${label}</div>
    <div class="opening-meta"><span class="opening-score" style="color:${scoreColor}">Score: ${score}</span></div>
  </div>`;
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

function buildAgeTimingsCompact(stats) {
  const ages = ['feudal', 'castle', 'imperial'];
  const allTimes = [];
  for (const age of ages) {
    const p = stats['avg_' + age];
    const o = stats['opp_avg_' + age];
    if (p) allTimes.push(p);
    if (o) allTimes.push(o);
  }
  const maxTime = Math.max(...allTimes, 1);

  let html = `<div class="age-timings"><div class="section-title">Age Timings</div>`;

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
    html += `<div class="age-row" style="margin-top:-2px;margin-bottom:6px;">
      <div class="age-label" style="color:var(--accent-blue)">You</div>
      <div class="age-bar-container"><div class="age-bar player" style="width:${pPct}%"></div></div>
      <div class="age-time" style="color:var(--accent-blue)">${pTime}</div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

function buildMapsSection(stats) {
  const maps = stats.map_played_percent || {};
  if (Object.keys(maps).length === 0) {
    return `<div class="maps-section"><div class="section-title">Top Maps</div><div class="loading-state" style="font-size:10px;padding:8px 0;">Sin datos de mapas.</div></div>`;
  }

  const sorted = Object.entries(maps).sort((a, b) => b[1] - a[1]).slice(0, 4);
  let html = `<div class="maps-section"><div class="section-title">Top Maps</div>`;
  for (const [map, pct] of sorted) {
    const wr = stats.map_win_percent?.[map] ?? 0;
    const wrClass = wr >= 55 ? 'good' : wr <= 40 ? 'bad' : 'neutral';
    html += `<div class="map-row">
      <div class="map-name">${map}</div>
      <div class="map-play-pct">${pct}%</div>
      <div class="map-wr ${wrClass}">${wr}% WR</div>
    </div>`;
  }
  html += `</div>`;
  return html;
}

function buildCivsSection(stats) {
  const civs = stats.civ_played_percent || {};
  if (Object.keys(civs).length === 0) {
    return `<div class="civs-section"><div class="section-title">Civilizations</div><div class="loading-state" style="font-size:10px;padding:8px 0;">Sin datos de civs.</div></div>`;
  }

  let html = `<div class="civs-section"><div class="section-title">Civilizations</div><div class="civs-list">`;
  for (const [civ, pct] of Object.entries(civs)) {
    html += `<span class="civ-pill">${civ} <span class="civ-pct">${pct}%</span></span>`;
  }
  html += `</div></div>`;
  return html;
}

function buildEconomySection(stats) {
  const wb = stats.wheel_barrow_avg;
  const hc = stats.hand_cart_avg;
  if (wb == null && hc == null) {
    return `<div class="economy-section"><div class="section-title">Economy Upgrades</div><div class="loading-state" style="font-size:10px;padding:8px 0;">Sin datos de mejoras.</div></div>`;
  }

  let html = `<div class="economy-section"><div class="section-title">Economy Upgrades</div>`;
  if (wb != null) {
    html += `<div class="economy-row"><div class="economy-label">Wheelbarrow</div><div class="economy-value">${formatHms(wb)}</div></div>`;
  }
  if (hc != null) {
    html += `<div class="economy-row"><div class="economy-label">Hand Cart</div><div class="economy-value">${formatHms(hc)}</div></div>`;
  }
  html += `</div>`;
  return html;
}

function buildMarketSection(stats) {
  const marketAvg = stats.market_avg_by_age || {};
  let hasAny = false;
  for (const age of ['feudal', 'castle', 'imperial']) {
    const avg = marketAvg[age];
    if (avg && (Object.keys(avg.buy || {}).length > 0 || Object.keys(avg.sell || {}).length > 0)) {
      hasAny = true;
      break;
    }
  }
  if (!hasAny) return '';

  let html = `<div class="market-section"><div class="section-title">Market Activity</div>`;
  for (const age of ['feudal', 'castle', 'imperial']) {
    const avgByAge = marketAvg[age] || null;
    const topBuys = [];
    const topSells = [];

    if (avgByAge) {
      const buys = avgByAge.buy || {};
      const sells = avgByAge.sell || {};
      if (Object.keys(buys).length > 0) {
        Object.entries(buys).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([r, v]) => topBuys.push([r, Math.round(v)]));
      }
      if (Object.keys(sells).length > 0) {
        Object.entries(sells).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([r, v]) => topSells.push([r, Math.round(v)]));
      }
    }

    if (topBuys.length === 0 && topSells.length === 0) continue;

    html += `<div class="market-age-row"><div class="market-age-label">${age}</div><div class="market-items">`;
    for (const [resource, val] of topBuys) {
      html += `<span class="market-item buy">+${resource} ${val}</span>`;
    }
    for (const [resource, val] of topSells) {
      html += `<span class="market-item sell">-${resource} ${val}</span>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  return html;
}

function buildKeyTechsSection(stats) {
  const keyTechs = stats.key_techs || {};
  const entries = Object.entries(keyTechs);
  if (entries.length === 0) return '';

  const byCategory = { military: [], economy: [], other: [] };
  for (const [name, data] of entries) {
    const cat = data.category || 'other';
    if (byCategory[cat]) byCategory[cat].push([name, data]);
    else byCategory.other.push([name, data]);
  }

  let html = `<div class="techs-section"><div class="section-title">Key Techs</div>`;
  for (const cat of ['military', 'economy', 'other']) {
    const list = byCategory[cat];
    if (list.length === 0) continue;
    list.sort((a, b) => b[1].frequency - a[1].frequency);

    html += `<div class="tech-category"><div class="tech-category-label">${cat}</div><div class="tech-items">`;
    for (const [name, data] of list.slice(0, 5)) {
      const display = techDisplayName(name);
      const time = data.avg_time != null ? formatHms(data.avg_time) : '';
      html += `<span class="tech-item">${display} <span class="tech-freq">${data.frequency}%</span>${time ? `<span class="tech-time">${time}</span>` : ''}</span>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  return html;
}
