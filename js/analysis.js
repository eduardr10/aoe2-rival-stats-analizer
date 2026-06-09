import {
  CIV_CANONICAL_NAMES, MILITARY_UNITS,
  parseTimestamp, formatHms, average, median, percentile,
} from './utils.js';

export function parseGameJson(analysisData, playerId) {
  const playersData = analysisData.players || [];
  const gameRecord = { player: null, opponent: null, map: analysisData.map || {} };

  for (const p of playersData) {
    const isMe = p.profileId != null && p.profileId === playerId;
    const playerKey = isMe ? 'player' : 'opponent';

    p.events = [];
    const eventSources = [
      ['queuedTechs', 'tech'],
      ['queuedUnits', 'unit'],
      ['queuedBuildings', 'building'],
      ['queuedWalls', 'wall'],
    ];

    for (const [key, type] of eventSources) {
      for (const event of (p[key] || [])) {
        const sec = parseTimestamp(event.timestamp || null);
        const unitName = event.unit || event.building || null;
        if (sec !== null && unitName !== null) {
          const canonicalName = CIV_CANONICAL_NAMES[unitName]
            || unitName.toLowerCase().replace(/ /g, '_');
          p.events.push({
            time: sec,
            type: type,
            name: canonicalName,
            original_name: unitName,
            amount: event.amount || 1,
          });
        }
      }
    }

    for (const market of (p.market || [])) {
      const sec = parseTimestamp(market.timestamp || null);
      if (sec !== null) {
        p.events.push({
          time: sec,
          type: 'market_' + market.type,
          name: (market.unit || '').toLowerCase(),
          amount: market.amount || 1,
        });
      }
    }

    p.events.sort((a, b) => a.time - b.time);
    gameRecord[playerKey] = p;
  }

  if (!gameRecord.player && playersData.length > 0) {
    gameRecord.player = playersData[0];
  }
  if (!gameRecord.opponent && playersData.length > 1) {
    gameRecord.opponent = playersData[1];
  }

  return gameRecord;
}

export function extractEarlyFeatures(gameRecord) {
  const player = gameRecord.player;
  if (!player) return {};

  const features = {};
  const events = player.events || [];
  const uptimes = player.uptimes || [];

  const tFeudalObj = uptimes.find(u => u.age === 'feudal_age')
    || events.find(e => e.type === 'tech' && e.name === 'feudal_age');
  const tCastleObj = uptimes.find(u => u.age === 'castle_age')
    || events.find(e => e.type === 'tech' && e.name === 'castle_age');

  features.t_feudal = tFeudalObj ? (parseTimestamp(tFeudalObj.timestamp) || null) : null;
  features.t_castle = tCastleObj ? (parseTimestamp(tCastleObj.timestamp) || null) : null;

  const windowDark = features.t_feudal !== null ? features.t_feudal : 600;
  const windowEarly = (features.t_feudal || 600) + 120;

  function findFirstBuilding(name) {
    const ev = events.find(e => e.type === 'building' && e.name === name);
    return ev ? ev.time : Number.MAX_SAFE_INTEGER;
  }

  function countUnits(names, maxTime) {
    let count = 0;
    for (const e of events) {
      if (e.type === 'unit' && e.time <= maxTime && names.includes(e.name)) {
        count += e.amount;
      }
    }
    return count;
  }

  function countUnitsAllTypes(unitNames, maxTime) {
    let count = 0;
    for (const e of events) {
      if (e.type === 'unit' && e.time <= maxTime && unitNames.includes(e.name)) {
        count += e.amount;
      }
    }
    return count;
  }

  features.t_first_barracks = findFirstBuilding('barracks');
  features.t_first_archery_range = findFirstBuilding('archery_range');
  features.t_first_stable = findFirstBuilding('stable');
  features.t_first_blacksmith = findFirstBuilding('blacksmith');
  features.t_first_market = findFirstBuilding('market');
  features.t_first_town_center = findFirstBuilding('town_center');
  features.t_first_watch_tower = findFirstBuilding('watch_tower');

  features.villagers_by_feudal = countUnits(['villager'], windowDark);
  features.militia_by_feudal = countUnits(['militia', 'men-at-arms'], windowDark);
  features.scouts_by_early = countUnits(['scout_cavalry'], windowEarly);
  features.archers_by_early = countUnits(['archer'], windowEarly);
  features.skirmishers_by_early = countUnits(['skirmisher'], windowEarly);
  features.total_military_by_early = countUnitsAllTypes(MILITARY_UNITS, windowEarly);

  features.barracks_before_210 = features.t_first_barracks <= 210;
  features.stable_before_450 = features.t_first_stable <= 900;
  features.archery_before_450 = features.t_first_archery_range <= 720;

  let tcCountEarly = 0;
  for (const e of events) {
    if (e.type === 'building' && e.name === 'town_center' && e.time <= 1500) {
      tcCountEarly++;
    }
  }
  features.tc_count_first_15min = tcCountEarly;

  let marketUsedBeforeFeudal = false;
  for (const e of events) {
    if ((e.type === 'market_buy' || e.type === 'market_sell') && e.time <= windowDark) {
      marketUsedBeforeFeudal = true;
      break;
    }
  }
  features.market_used_before_feudal = marketUsedBeforeFeudal;
  features.villagers_total_at_feudal = features.villagers_by_feudal;

  features.archers_per_villager_early = features.archers_by_early / Math.max(1, features.villagers_by_feudal);
  features.military_per_villager_early = features.total_military_by_early / Math.max(1, features.villagers_by_feudal);

  return features;
}

export function computePlayerBaselines(playerId, allFeatures) {
  const timings = ['t_feudal', 't_castle', 't_first_stable', 't_first_archery_range', 't_first_barracks'];
  const counts = ['archers_by_early', 'scouts_by_early', 'villagers_by_feudal', 'total_military_by_early'];
  const keys = [...timings, ...counts];
  const baselines = {};

  for (const key of keys) {
    const values = allFeatures
      .map(f => f[key])
      .filter(v => v !== null && v !== undefined && v !== Number.MAX_SAFE_INTEGER && v !== 0)
      .sort((a, b) => a - b);

    if (values.length === 0) continue;

    baselines[key] = {
      median: median(values),
      p25: percentile(values, 0.25),
      p75: percentile(values, 0.75),
    };
    baselines[key].iqr = baselines[key].p75 - baselines[key].p25;
  }

  return baselines;
}

export function classifyOpening(features, baselines) {
  const openings = [];
  const tFeudalP25 = baselines.t_feudal?.p25 || 660;
  const totalMilitaryMedian = baselines.total_military_by_early?.median || 3;
  const totalMilitaryIqr = baselines.total_military_by_early?.iqr || 3;

  // 1) drush
  let drushScore = 0;
  const drushCriteria = [];
  if (features.militia_by_feudal >= 2) {
    drushScore += 0.6;
    drushCriteria.push(['Militia Count', '>= 2', '+0.6', features.militia_by_feudal]);
  }
  if (features.t_first_barracks <= 480) {
    drushScore += 0.25;
    drushCriteria.push(['Barracks Time', '<= 480s (3:30)', '+0.25', formatHms(features.t_first_barracks)]);
  }
  if (drushScore >= 0.6) {
    openings.push({ label: 'drush', score: Math.round(drushScore * 100) / 100, matched: drushCriteria });
  }

  // 2) scout_rush
  let scoutScore = 0;
  const scoutCriteria = [];
  if (features.t_first_stable <= 660) {
    scoutScore += 0.4;
    scoutCriteria.push(['Stable Time', '<= 660s (11:00)', '+0.4', formatHms(features.t_first_stable)]);
  }
  if (features.scouts_by_early >= 2) {
    scoutScore += 0.5;
    scoutCriteria.push(['Scout Count', '>= 2', '+0.5', features.scouts_by_early]);
  }
  if (features.scouts_by_early >= 3) {
    scoutScore += 0.2;
    scoutCriteria.push(['Committed Rush', '>= 3 Scouts (Bonus)', '+0.2', features.scouts_by_early]);
  }
  if (scoutScore >= 0.7) {
    openings.push({ label: 'scout_rush', score: Math.round(scoutScore * 100) / 100, matched: scoutCriteria });
  }

  // 3) archer_rush
  let archerScore = 0;
  const archerCriteria = [];
  if (features.t_first_archery_range <= 720) {
    archerScore += 0.4;
    archerCriteria.push(['Archery Time', '<= 720s (7:30)', '+0.4', formatHms(features.t_first_archery_range)]);
  }
  if (features.archers_by_early >= 3) {
    archerScore += 0.45;
    archerCriteria.push(['Archer Count', '>= 3', '+0.45', features.archers_by_early]);
  }
  if (features.archers_per_villager_early >= 0.08) {
    archerScore += 0.15;
    archerCriteria.push(['Archer/Villager Ratio', '>= 0.08', '+0.15', Math.round(features.archers_per_villager_early * 1000) / 1000]);
  }
  if (archerScore >= 0.6) {
    openings.push({ label: 'archer_rush', score: Math.round(archerScore * 100) / 100, matched: archerCriteria });
  }

  // 4) fast_feudal_aggressive
  let ffaScore = 0;
  const ffaCriteria = [];
  if (features.t_feudal !== null && features.t_feudal <= tFeudalP25) {
    ffaScore += 0.6;
    ffaCriteria.push(['Fast Feudal', '<= P25', '+0.6', formatHms(features.t_feudal)]);
  }
  const aggressiveThreshold = totalMilitaryMedian + (1 * totalMilitaryIqr);
  if (features.total_military_by_early >= aggressiveThreshold) {
    ffaScore += 0.4;
    ffaCriteria.push(['High Military', '> Baseline + IQR', '+0.4', features.total_military_by_early]);
  }
  if (ffaScore >= 0.6) {
    openings.push({ label: 'fast_feudal_aggressive', score: Math.round(ffaScore * 100) / 100, matched: ffaCriteria });
  }

  // 5) fast_castle
  let fcScore = 0;
  const fcCriteria = [];
  const tCastleThreshold = baselines.t_castle?.p25 || 720;
  if (features.t_castle !== null && features.t_castle <= tCastleThreshold) {
    fcScore += 0.6;
    fcCriteria.push(['Fast Castle Time', '<= P25', '+0.6', formatHms(features.t_castle)]);
  }
  if (features.total_military_by_early <= 3) {
    fcScore += 0.2;
    fcCriteria.push(['Low Early Military', '<= 3', '+0.2', features.total_military_by_early]);
  }
  if (features.tc_count_first_15min >= 2 && features.t_castle !== null && features.t_castle < 900) {
    fcScore += 0.2;
    fcCriteria.push(['Multiple TCs Post-Castle', '>= 2 TC (antes 15m)', '+0.2', features.tc_count_first_15min]);
  }
  if (fcScore >= 0.6) {
    openings.push({ label: 'fast_castle', score: Math.round(fcScore * 100) / 100, matched: fcCriteria });
  }

  // 6) tower_rush
  let trScore = 0;
  const trCriteria = [];
  if (features.t_first_watch_tower <= 900) {
    trScore += 0.6;
    trCriteria.push(['Early Tower Time', '<= 900s (15:00)', '+0.6', formatHms(features.t_first_watch_tower)]);
  }
  if (trScore >= 0.6) {
    openings.push({ label: 'tower_rush', score: Math.round(trScore * 100) / 100, matched: trCriteria });
  }

  openings.sort((a, b) => b.score - a.score);

  const chosen = openings[0] || { label: 'Standard/Unknown', score: 0, matched: [] };

  console.log('Classified opening:', chosen.label, chosen.matched);

  return {
    opening_candidates: openings,
    chosen_opening: chosen.label,
    score: chosen.score,
    matched_criteria: chosen.matched,
  };
}

export function computePlayerPrimaryOpenings(playerId, allFeatures) {
  const counts = {};
  for (const f of allFeatures) {
    if (f.opening && f.opening.chosen_opening) {
      const label = f.opening.chosen_opening;
      counts[label] = (counts[label] || 0) + 1;
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (total === 0) {
    return {
      primary_opening: 'Mixed/No Data',
      opening_stability: 0,
      per_opening_frequency: {},
    };
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const perOpeningFrequency = {};
  for (const [label, count] of sorted) {
    perOpeningFrequency[label] = Math.round((count * 100 / total) * 10) / 10;
  }

  const [primaryLabel, primaryCount] = sorted[0];
  const stability = Math.round((primaryCount / total) * 100) / 100;

  return {
    primary_opening: primaryLabel,
    opening_stability: stability,
    per_opening_frequency: perOpeningFrequency,
  };
}

export function classifyPlayerArchetype(stats) {
  const dims = computeDimensions(stats);
  const archetype = mapToArchetype(dims, stats);
  return { ...archetype, dimensions: dims };
}

function computeDimensions(stats) {
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const keyTechs = stats.key_techs || {};
  const marketAvg = stats.market_avg_by_age || {};

  // --- AGRESSION (0-100) ---
  let aggression = 0;
  const aggressiveLabels = ['drush', 'scout_rush', 'archer_rush', 'tower_rush', 'fast_feudal_aggressive'];
  for (const label of aggressiveLabels) {
    aggression += (perFreq[label] || 0) * 0.5;
  }
  if (marketAvg.feudal?.buy && Object.keys(marketAvg.feudal.buy).length > 0) aggression += 10;
  const milTechs = Object.entries(keyTechs).filter(([_, d]) => d.category === 'military');
  if (milTechs.length > 0) {
    const milFreq = milTechs.reduce((s, [_, d]) => s + d.frequency, 0) / milTechs.length;
    aggression += milFreq * 0.2;
  }
  if (stats.avg_feudal != null && stats.avg_feudal < 600) aggression += 8;
  aggression = Math.round(Math.min(100, Math.max(0, aggression)));

  // --- ECONOMY (0-100) ---
  let economy = 0;
  economy += (perFreq['fast_castle'] || 0) * 0.5;
  const ecoTechs = Object.entries(keyTechs).filter(([_, d]) => d.category === 'economy');
  if (ecoTechs.length > 0) {
    const ecoFreq = ecoTechs.reduce((s, [_, d]) => s + d.frequency, 0) / ecoTechs.length;
    economy += ecoFreq * 0.2;
  }
  if (stats.wheel_barrow_avg != null) {
    if (stats.wheel_barrow_avg < 700) economy += 15;
    if (stats.wheel_barrow_avg < 600) economy += 5;
  }
  if (stats.hand_cart_avg != null && stats.hand_cart_avg < 1100) economy += 10;
  economy = Math.round(Math.min(100, Math.max(0, economy)));

  // --- VERSATILITY (0-100) ---
  let versatility = 0;
  const openingCount = Object.keys(perFreq).length;
  versatility += openingCount * 12;
  const civCount = Object.keys(stats.civ_played_percent || {}).length;
  versatility += civCount * 3;
  const mapCount = Object.keys(stats.map_played_percent || {}).length;
  versatility += mapCount * 2;
  versatility += (1 - (pp.opening_stability || 0)) * 40;
  versatility = Math.round(Math.min(100, Math.max(0, versatility)));

  // --- LATE GAME (0-100) ---
  let lateGame = 30;
  if (stats.avg_imperial != null) {
    if (stats.avg_imperial < 1500) lateGame += 20;
    else if (stats.avg_imperial < 1800) lateGame += 12;
    else if (stats.avg_imperial > 2100) lateGame -= 10;
  }
  const impTechs = Object.entries(keyTechs).filter(([n, d]) =>
    ['chemistry', 'siege engineers', 'bombard tower', 'paladin', 'arbalest', 'champion', 'elite'].some(t => n.toLowerCase().includes(t))
  );
  if (impTechs.length > 0) {
    const impFreq = impTechs.reduce((s, [_, d]) => s + d.frequency, 0) / impTechs.length;
    lateGame += impFreq * 0.2;
  }
  lateGame = Math.round(Math.min(100, Math.max(0, lateGame)));

  // --- SPEED (0-100) ---
  let speed = 20;
  const eapm = stats.avg_eapm;
  if (eapm != null) {
    if (eapm >= 30) speed = 90;
    else if (eapm >= 25) speed = 75;
    else if (eapm >= 20) speed = 60;
    else if (eapm >= 15) speed = 45;
    else if (eapm >= 10) speed = 30;
    else speed = 15;
  }

  return { aggression, economy, versatility, lateGame, speed };
}

function mapToArchetype(dims, stats) {
  const { aggression, economy, versatility, lateGame, speed } = dims;
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const trdrush = (perFreq['tower_rush'] || 0) + (perFreq['drush'] || 0);
  const fcFreq = perFreq['fast_castle'] || 0;
  const scoutFreq = perFreq['scout_rush'] || 0;
  const archerFreq = perFreq['archer_rush'] || 0;
  const ffaFreq = perFreq['fast_feudal_aggressive'] || 0;
  const wr = stats.win_percent || 0;
  const analyzed = stats.analyzed || 0;

  let primary = 'standard';
  let title = 'Standard Player';
  let description = 'Estilo balanceado sin tendencias extremas. Adapta su juego segun la partida.';
  let traits = [];

  // 1) Ineffective — bajo WR independientemente del estilo
  if (analyzed >= 5 && wr < 38) {
    primary = 'ineffective';
    title = 'Struggling Player';
    description = `Win rate bajo (${wr}%). Su estilo actual no le da resultados consistentes. Necesita ajustar su juego.`;
    traits = ['WR bajo', 'Necesita ajustes'];
  }
  // 2) Cheese — drush/tower rush dominante
  else if (trdrush >= 30) {
    primary = 'cheese';
    title = 'Cheese Enjoyer';
    description = 'Estrategias de alto riesgo como tower rush o drush. Busca desestabilizar al rival desde Dark Age.';
    traits = ['Estrategias de riesgo', `Drush/Tower ${trdrush}%`, 'Busca caos temprano'];
  }
  // 3) Feudal All-In — feudal muy rapido + alta agresion feudal
  else if (ffaFreq >= 40 && stats.avg_feudal != null && stats.avg_feudal < 580) {
    primary = 'feudal_allin';
    title = 'Feudal All-In';
    description = 'Castea a Feudal extremadamente rapido y presiona de inmediato. Todo o nada en la primera edad militar.';
    traits = [`Feudal a ${formatHms(stats.avg_feudal)}`, 'Presion inmediata', 'Alto riesgo'];
  }
  // 4) Castle Timing Pusher — buena agresion castle + buen timing
  else if (aggression >= 45 && aggression < 65 && stats.avg_castle != null && stats.avg_castle < 1100 && fcFreq < 40) {
    primary = 'castle_pusher';
    title = 'Castle Timing Pusher';
    description = 'Buen timing de Castle. Presiona fuerte al llegar con tecnologias y unidades clave antes de que el rival este listo.';
    traits = [`Castle a ${formatHms(stats.avg_castle)}`, 'Push castle fuerte', 'Timing preciso'];
  }
  // 5) Aggressive Rusher — agresion alta, economia baja
  else if (aggression >= 55 && economy < 45) {
    primary = 'aggressive';
    title = 'Aggressive Rusher';
    description = 'Prefiere aperturas agresivas, castea rapido y presiona temprano. Genera ventaja militar en Feudal.';
    traits = ['Apertura agresiva', 'Temprano al feudal', 'Presion militar constante'];
    if (scoutFreq >= 30) traits.push('Scout rush specialist');
    if (archerFreq >= 30) traits.push('Archer rush specialist');
  }
  // 6) Eco Boomer — economia alta, agresion baja
  else if (economy >= 55 && aggression < 40) {
    primary = 'boomer';
    title = 'Eco Boomer';
    description = 'Prioriza economia. Fast Castle con multiples TC. Brilla en late game con superioridad de recursos.';
    traits = ['Economia solida', 'Fast Castle', 'Multiples TC temprano'];
  }
  // 7) Macro Player — economia alta + velocidad alta
  else if (economy >= 50 && speed >= 60) {
    primary = 'macro';
    title = 'Macro Player';
    description = 'Combina buena economia con alta velocidad de ejecucion. Crece rapido y mantiene presion constante.';
    traits = ['Eco + mecanica', 'Crece rapido', 'Presion sostenida'];
  }
  // 8) Turtle/Defensive — baja agresion, imperial lento, pocas compras mercado
  else if (aggression < 30 && lateGame >= 40) {
    primary = 'turtle';
    title = 'Turtle / Defensive';
    description = 'Juega pasivo, castea tarde y defiende. Prefiere llegar a Imperial con economia solida y ganar en late game.';
    traits = ['Juego pasivo', 'Defensivo', 'Late game'];
  }
  // 9) Imperial Specialist — late game fuerte
  else if (lateGame >= 60) {
    primary = 'imperial';
    title = 'Imperial Specialist';
    description = 'Se siente comodo en late game. Buen timing de imperial y uso de tecnologias avanzadas.';
    traits = ['Fuerte en Imperial', 'Tecnologias avanzadas', 'Late game solido'];
  }
  // 10) One-Trick — baja versatilidad
  else if (versatility <= 25) {
    primary = 'onetrick';
    title = 'One-Trick Specialist';
    description = `Juega casi siempre la misma estrategia (${pp.primary_opening || 'N/A'}). Muy predecible pero ejecutada con precision.`;
    traits = ['Una estrategia principal', 'Ejecucion precisa', 'Poco versatil'];
  }
  // 11) Versatile — alta versatilidad
  else if (versatility >= 60) {
    primary = 'versatile';
    title = 'Versatile All-Rounder';
    description = 'Juega multiples aperturas, civilizaciones y mapas. Dificil de predecir y contrarrestar.';
    traits = ['Multiples estrategias', 'Varias civilizaciones', 'Impredecible'];
  }
  // 12) Balanced — resto
  else if (aggression >= 40 && economy >= 40) {
    primary = 'balanced';
    title = 'Balanced Player';
    description = 'Alterna entre agresion y economia segun la partida. Sin debilidades claras.';
    traits = ['Equilibrado', 'Adaptable', 'Sin extremos'];
  }

  // Traits adicionales
  if (speed >= 75) traits.push('APM alto');
  if (speed <= 30 && speed > 0) traits.push('Relajado');
  if (analyzed >= 5 && wr >= 58) traits.push(`WR fuerte ${wr}%`);

  return { primary, title, description, traits };
}

// ============================================================================
// NEW INTELLIGENCE FEATURES
// ============================================================================

export function computeDangerScore(stats, playerRating) {
  let score = 0;
  const analyzed = stats.analyzed || 0;
  const wr = stats.win_percent || 0;
  const rivalRating = stats.rating || 0;

  // ELO factor (0-40 points)
  if (typeof playerRating === 'number' && typeof rivalRating === 'number') {
    const diff = rivalRating - playerRating;
    if (diff > 200) score += 40;
    else if (diff > 100) score += 30;
    else if (diff > 50) score += 20;
    else if (diff > 0) score += 10;
    else if (diff < -100) score += 0;
    else score += 5;
  } else {
    score += 15; // unknown rating = medium danger
  }

  // Winrate factor (0-30 points)
  if (analyzed >= 5) {
    if (wr >= 60) score += 30;
    else if (wr >= 55) score += 22;
    else if (wr >= 50) score += 15;
    else if (wr >= 45) score += 8;
    else score += 3;
  } else {
    score += 10;
  }

  // Streak factor (0-20 points)
  const streak = stats.current_streak || { type: 'none', count: 0 };
  if (streak.type === 'win') {
    if (streak.count >= 5) score += 20;
    else if (streak.count >= 3) score += 12;
    else score += 5;
  }

  // History depth factor (0-10 points)
  if (analyzed >= 20) score += 10;
  else if (analyzed >= 10) score += 6;
  else if (analyzed >= 5) score += 3;

  score = Math.min(100, Math.max(0, score));

  let level = 'low';
  let label = 'Low';
  if (score >= 71) { level = 'high'; label = 'High'; }
  else if (score >= 31) { level = 'medium'; label = 'Medium'; }

  return { score, level, label };
}

export function classifyPlaystyle(archetype) {
  if (!archetype) return { label: 'Unknown', score: 0 };

  const primary = archetype.primary || 'standard';
  const dims = archetype.dimensions || {};
  const aggression = dims.aggression || 0;
  const economy = dims.economy || 0;

  const map = {
    'aggressive': 'Aggressive',
    'feudal_allin': 'All-in',
    'castle_pusher': 'Aggressive',
    'cheese': 'Aggressive',
    'boomer': 'Boomer',
    'macro': 'Boomer',
    'turtle': 'Defensive',
    'imperial': 'Boomer',
    'ineffective': 'Adaptive',
    'onetrick': 'Adaptive',
    'versatile': 'Adaptive',
    'balanced': 'Adaptive',
    'standard': 'Adaptive',
  };

  let label = map[primary] || 'Adaptive';

  // Override based on dimensions
  if (aggression >= 70 && label !== 'All-in') label = 'Aggressive';
  if (economy >= 70 && aggression < 30) label = 'Boomer';
  if (aggression < 20 && economy < 30) label = 'Defensive';

  const score = Math.max(aggression, economy);

  return { label, score };
}

export function detectWeaknesses(stats) {
  const weaknesses = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const arch = stats.archetype || {};
  const dims = arch.dimensions || {};

  // Low winrate in long games
  if (stats.avg_imperial != null && stats.avg_imperial > 2100) {
    weaknesses.push('Winrate drops in games >35 min');
  }

  // One-trick = predictable
  if (pp.opening_stability >= 0.7) {
    weaknesses.push('Very predictable opening');
  }

  // Low economy = vulnerable to late game
  if (dims.economy < 30) {
    weaknesses.push('Weak late-game economy');
  }

  // Low versatility = counterable
  if (dims.versatility < 30) {
    weaknesses.push('Limited strategic variety');
  }

  // Slow player = vulnerable to aggression
  if (dims.speed < 30) {
    weaknesses.push('Slow execution, vulnerable to early pressure');
  }

  // Specific opening weaknesses
  const fcFreq = perFreq['fast_castle'] || 0;
  if (fcFreq > 40) {
    weaknesses.push('Often plays greedy — punish with early aggression');
  }

  const trushFreq = perFreq['tower_rush'] || 0;
  if (trushFreq > 20) {
    weaknesses.push('Relies on cheese — scout and counter');
  }

  // Low WR on certain map types could be added with more data

  // If no specific weaknesses found, add generic ones
  if (weaknesses.length === 0) {
    if (dims.aggression > 60) weaknesses.push('May overextend with aggression');
    else if (dims.economy > 60) weaknesses.push('May be vulnerable to early pressure');
    else weaknesses.push('No clear pattern — scout and adapt');
  }

  return weaknesses.slice(0, 4); // Max 4 weaknesses
}

export function detectThreats(stats) {
  const threats = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const arch = stats.archetype || {};
  const dims = arch.dimensions || {};

  // High aggression = early pressure threat
  if (dims.aggression >= 60) {
    threats.push('High early-game pressure expected');
  }

  // Specific opening threats
  const scoutFreq = perFreq['scout_rush'] || 0;
  if (scoutFreq >= 30) {
    threats.push('Strong scout rush execution');
  }

  const archerFreq = perFreq['archer_rush'] || 0;
  if (archerFreq >= 30) {
    threats.push('Skilled archer micro and transitions');
  }

  const ffaFreq = perFreq['fast_feudal_aggressive'] || 0;
  if (ffaFreq >= 30) {
    threats.push('Fast feudal with immediate military');
  }

  // High speed = good macro threat
  if (dims.speed >= 70) {
    threats.push('High APM / strong macro play');
  }

  // Boomer = late game threat
  if (dims.economy >= 60) {
    threats.push('Strong late-game scaling');
  }

  // Castle pusher
  if (stats.avg_castle != null && stats.avg_castle < 1100 && dims.aggression >= 45) {
    threats.push('Dangerous castle-age timing push');
  }

  // Cheese threat
  const trushFreq = perFreq['tower_rush'] || 0;
  const drushFreq = perFreq['drush'] || 0;
  if (trushFreq >= 15 || drushFreq >= 15) {
    threats.push('Cheese potential (scout walls early)');
  }

  // If no specific threats
  if (threats.length === 0) {
    threats.push('Standard play expected — no extreme threats');
  }

  return threats.slice(0, 4); // Max 4 threats
}

export function generateRecommendations(stats) {
  const recs = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const primary = pp.primary_opening || 'Unknown';
  const arch = stats.archetype || {};
  const dims = arch.dimensions || {};

  // Opening-based recommendations
  if (primary === 'scout_rush' || perFreq['scout_rush'] >= 30) {
    recs.push({ type: 'must', text: 'Expect Scout Rush — wall early' });
    recs.push({ type: 'must', text: 'Protect berries with houses/palisade' });
    recs.push({ type: 'must', text: 'Prioritize spear production in Feudal' });
    recs.push({ type: 'warn', text: 'Avoid greedy fast castle' });
  } else if (primary === 'archer_rush' || perFreq['archer_rush'] >= 30) {
    recs.push({ type: 'must', text: 'Expect Archer Rush — early skirms' });
    recs.push({ type: 'must', text: 'Get fletching quickly if matching archers' });
    recs.push({ type: 'warn', text: 'Wall vulnerable eco areas' });
  } else if (primary === 'fast_castle' || perFreq['fast_castle'] >= 30) {
    recs.push({ type: 'must', text: 'Expect Fast Castle — pressure Feudal' });
    recs.push({ type: 'must', text: 'Deny map control and relics' });
    recs.push({ type: 'warn', text: 'Scout for forward buildings' });
  } else if (primary === 'drush' || perFreq['drush'] >= 20) {
    recs.push({ type: 'must', text: 'Expect Dark Age militia — wall early' });
    recs.push({ type: 'must', text: 'Keep scout near base until Feudal' });
  } else if (primary === 'tower_rush' || perFreq['tower_rush'] >= 15) {
    recs.push({ type: 'must', text: 'Scout for villager forward at 8:00' });
    recs.push({ type: 'must', text: 'Pre-wall strategic resources' });
  } else if (primary === 'fast_feudal_aggressive' || perFreq['fast_feudal_aggressive'] >= 30) {
    recs.push({ type: 'must', text: 'Expect very fast Feudal aggression' });
    recs.push({ type: 'must', text: 'Prepare defense before clicking up' });
  } else {
    recs.push({ type: 'must', text: 'Mixed openings — scout with first unit' });
    recs.push({ type: 'warn', text: 'Play reactive until pattern identified' });
  }

  // Playstyle-based additions
  if (dims.aggression >= 60) {
    recs.push({ type: 'must', text: 'Play defensively, let them overextend' });
  } else if (dims.economy >= 60) {
    recs.push({ type: 'must', text: 'Apply constant pressure, deny boom' });
  }

  if (pp.opening_stability >= 0.7) {
    recs.push({ type: 'must', text: 'Rival is predictable — prepare hard counter' });
  }

  if (dims.speed >= 70) {
    recs.push({ type: 'warn', text: 'High APM rival — avoid macro battles' });
  }

  return recs.slice(0, 6); // Max 6 recommendations
}

export function computeConfidence(stats) {
  const analyzed = stats.analyzed || 0;
  if (analyzed >= 20) return 'High';
  if (analyzed >= 8) return 'Medium';
  return 'Low';
}

export function computeStreak(matches) {
  if (!matches || matches.length === 0) return { type: 'none', count: 0 };

  let currentType = null;
  let count = 0;

  for (const m of matches) {
    const type = m.won ? 'win' : 'loss';
    if (currentType === null) {
      currentType = type;
      count = 1;
    } else if (currentType === type) {
      count++;
    } else {
      break;
    }
  }

  return { type: currentType || 'none', count };
}
