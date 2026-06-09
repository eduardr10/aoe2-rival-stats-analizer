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

  let drushScore = 0;
  const drushCriteria = [];
  if (features.militia_by_feudal >= 2) {
    drushScore += 0.6;
    drushCriteria.push(['Militia Count', '>= 2', '+0.6', features.militia_by_feudal]);
  }
  if (features.t_first_barracks <= 480) {
    drushScore += 0.25;
    drushCriteria.push(['Barracks Time', '<= 480s', '+0.25', formatHms(features.t_first_barracks)]);
  }
  if (drushScore >= 0.6) {
    openings.push({ label: 'drush', score: Math.round(drushScore * 100) / 100, matched: drushCriteria });
  }

  let scoutScore = 0;
  const scoutCriteria = [];
  if (features.t_first_stable <= 660) {
    scoutScore += 0.4;
    scoutCriteria.push(['Stable Time', '<= 660s', '+0.4', formatHms(features.t_first_stable)]);
  }
  if (features.scouts_by_early >= 2) {
    scoutScore += 0.5;
    scoutCriteria.push(['Scout Count', '>= 2', '+0.5', features.scouts_by_early]);
  }
  if (features.scouts_by_early >= 3) {
    scoutScore += 0.2;
    scoutCriteria.push(['Committed Rush', '>= 3 Scouts', '+0.2', features.scouts_by_early]);
  }
  if (scoutScore >= 0.7) {
    openings.push({ label: 'scout_rush', score: Math.round(scoutScore * 100) / 100, matched: scoutCriteria });
  }

  let archerScore = 0;
  const archerCriteria = [];
  if (features.t_first_archery_range <= 720) {
    archerScore += 0.4;
    archerCriteria.push(['Archery Time', '<= 720s', '+0.4', formatHms(features.t_first_archery_range)]);
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
    fcCriteria.push(['Multiple TCs Post-Castle', '>= 2 TC', '+0.2', features.tc_count_first_15min]);
  }
  if (fcScore >= 0.6) {
    openings.push({ label: 'fast_castle', score: Math.round(fcScore * 100) / 100, matched: fcCriteria });
  }

  let trScore = 0;
  const trCriteria = [];
  if (features.t_first_watch_tower <= 900) {
    trScore += 0.6;
    trCriteria.push(['Early Tower Time', '<= 900s', '+0.6', formatHms(features.t_first_watch_tower)]);
  }
  if (trScore >= 0.6) {
    openings.push({ label: 'tower_rush', score: Math.round(trScore * 100) / 100, matched: trCriteria });
  }

  openings.sort((a, b) => b.score - a.score);

  const chosen = openings[0] || { label: 'Standard/Unknown', score: 0, matched: [] };

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

  let versatility = 0;
  const openingCount = Object.keys(perFreq).length;
  versatility += openingCount * 12;
  const civCount = Object.keys(stats.civ_played_percent || {}).length;
  versatility += civCount * 3;
  const mapCount = Object.keys(stats.map_played_percent || {}).length;
  versatility += mapCount * 2;
  versatility += (1 - (pp.opening_stability || 0)) * 40;
  versatility = Math.round(Math.min(100, Math.max(0, versatility)));

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
  let description = 'Balanced style without extreme tendencies. Adapts to the game.';
  let traits = [];

  if (analyzed >= 5 && wr < 38) {
    primary = 'ineffective';
    title = 'Struggling Player';
    description = `Low win rate (${wr}%). Current style does not yield consistent results.`;
    traits = ['Low WR', 'Needs adjustments'];
  }
  else if (trdrush >= 30) {
    primary = 'cheese';
    title = 'Cheese Enjoyer';
    description = 'High-risk strategies like tower rush or drush. Seeks to destabilize early.';
    traits = ['Risky strategies', `Drush/Tower ${trdrush}%`, 'Seeks early chaos'];
  }
  else if (ffaFreq >= 40 && stats.avg_feudal != null && stats.avg_feudal < 580) {
    primary = 'feudal_allin';
    title = 'Feudal All-In';
    description = 'Extremely fast Feudal with immediate pressure. All or nothing.';
    traits = [`Feudal at ${formatHms(stats.avg_feudal)}`, 'Immediate pressure', 'High risk'];
  }
  else if (aggression >= 45 && aggression < 65 && stats.avg_castle != null && stats.avg_castle < 1100 && fcFreq < 40) {
    primary = 'castle_pusher';
    title = 'Castle Timing Pusher';
    description = 'Strong Castle timing. Pushes hard with key technologies before the opponent is ready.';
    traits = [`Castle at ${formatHms(stats.avg_castle)}`, 'Strong Castle push', 'Precise timing'];
  }
  else if (aggression >= 55 && economy < 45) {
    primary = 'aggressive';
    title = 'Aggressive Rusher';
    description = 'Prefers aggressive openings, fast ages, and early pressure.';
    traits = ['Aggressive opening', 'Early Feudal', 'Constant military pressure'];
    if (scoutFreq >= 30) traits.push('Scout rush specialist');
    if (archerFreq >= 30) traits.push('Archer rush specialist');
  }
  else if (economy >= 55 && aggression < 40) {
    primary = 'boomer';
    title = 'Eco Boomer';
    description = 'Prioritizes economy. Fast Castle with multiple TCs. Strong late game.';
    traits = ['Solid economy', 'Fast Castle', 'Multiple TCs early'];
  }
  else if (economy >= 50 && speed >= 60) {
    primary = 'macro';
    title = 'Macro Player';
    description = 'Combines good economy with high execution speed. Grows fast and sustains pressure.';
    traits = ['Eco + mechanics', 'Fast growth', 'Sustained pressure'];
  }
  else if (aggression < 30 && lateGame >= 40) {
    primary = 'turtle';
    title = 'Turtle / Defensive';
    description = 'Passive play, late ages, defends. Prefers Imperial with solid economy.';
    traits = ['Passive play', 'Defensive', 'Late game'];
  }
  else if (lateGame >= 60) {
    primary = 'imperial';
    title = 'Imperial Specialist';
    description = 'Comfortable in late game. Good Imperial timing and advanced techs.';
    traits = ['Strong Imperial', 'Advanced technologies', 'Late game solid'];
  }
  else if (versatility <= 25) {
    primary = 'onetrick';
    title = 'One-Trick Specialist';
    description = `Plays almost the same strategy (${pp.primary_opening || 'N/A'}). Predictable but precise.`;
    traits = ['Single main strategy', 'Precise execution', 'Low variety'];
  }
  else if (versatility >= 60) {
    primary = 'versatile';
    title = 'Versatile All-Rounder';
    description = 'Multiple openings, civs, and maps. Hard to predict and counter.';
    traits = ['Multiple strategies', 'Various civs', 'Unpredictable'];
  }
  else if (aggression >= 40 && economy >= 40) {
    primary = 'balanced';
    title = 'Balanced Player';
    description = 'Alternates between aggression and economy. No clear weaknesses.';
    traits = ['Balanced', 'Adaptable', 'No extremes'];
  }

  if (speed >= 75) traits.push('High APM');
  if (speed <= 30 && speed > 0) traits.push('Relaxed');
  if (analyzed >= 5 && wr >= 58) traits.push(`Strong WR ${wr}%`);

  return { primary, title, description, traits };
}

// ============================================================================
// DATA-DRIVEN INTELLIGENCE (NOT GENERIC)
// ============================================================================

export function computeDangerScore(stats) {
  let score = 0;
  const analyzed = stats.analyzed || 0;
  const wr = stats.win_percent || 0;
  const arch = stats.archetype || {};
  const dims = arch.dimensions || {};
  const pp = stats.player_profile || {};

  // Winrate factor (0-30) — most important
  if (analyzed >= 5) {
    if (wr >= 65) score += 30;
    else if (wr >= 58) score += 24;
    else if (wr >= 52) score += 18;
    else if (wr >= 45) score += 10;
    else score += 4;
  } else {
    score += 12;
  }

  // Current streak (0-20)
  const streak = stats.current_streak || { type: 'none', count: 0 };
  if (streak.type === 'win') {
    if (streak.count >= 5) score += 20;
    else if (streak.count >= 3) score += 13;
    else score += 6;
  }

  // Versatility = harder to counter (0-15)
  if (dims.versatility >= 60) score += 15;
  else if (dims.versatility >= 40) score += 10;
  else if (dims.versatility >= 25) score += 5;
  else score += 2;

  // Speed/APM (0-15)
  const eapm = stats.avg_eapm;
  if (eapm != null) {
    if (eapm >= 35) score += 15;
    else if (eapm >= 28) score += 11;
    else if (eapm >= 22) score += 7;
    else if (eapm >= 15) score += 3;
  }

  // Opening stability inverse (predictable = less dangerous) (0-10)
  const stability = pp.opening_stability || 0;
  if (stability < 0.4) score += 10;
  else if (stability < 0.6) score += 6;
  else if (stability < 0.8) score += 3;

  // History depth (0-10)
  if (analyzed >= 30) score += 10;
  else if (analyzed >= 15) score += 6;
  else if (analyzed >= 8) score += 3;

  score = Math.min(100, Math.max(0, score));

  let level = 'low';
  let label = 'Low';
  if (score >= 71) { level = 'high'; label = 'High'; }
  else if (score >= 36) { level = 'medium'; label = 'Medium'; }

  return { score, level, label };
}

export function classifyPlaystyle(archetype) {
  if (!archetype) return { label: 'Unknown', score: 0 };
  const primary = archetype.primary || 'standard';
  const dims = archetype.dimensions || {};
  const aggression = dims.aggression || 0;
  const economy = dims.economy || 0;

  const map = {
    'aggressive': 'Aggressive', 'feudal_allin': 'All-in', 'castle_pusher': 'Aggressive',
    'cheese': 'Aggressive', 'boomer': 'Boomer', 'macro': 'Boomer',
    'turtle': 'Defensive', 'imperial': 'Boomer', 'ineffective': 'Adaptive',
    'onetrick': 'Adaptive', 'versatile': 'Adaptive', 'balanced': 'Adaptive', 'standard': 'Adaptive',
  };

  let label = map[primary] || 'Adaptive';
  if (aggression >= 70 && label !== 'All-in') label = 'Aggressive';
  if (economy >= 70 && aggression < 30) label = 'Boomer';
  if (aggression < 20 && economy < 30) label = 'Defensive';

  return { label, score: Math.max(aggression, economy) };
}

export function detectWeaknesses(stats) {
  const weaknesses = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const arch = stats.archetype || {};
  const dims = arch.dimensions || {};

  // DATA-DRIVEN: based on actual unit stats
  const unitStats = stats.unit_stats || {};
  const unitCats = stats.unit_categories || {};

  // If they barely produce military in feudal, vulnerable to early pressure
  if (unitCats.infantry?.count < 5 && unitCats.cavalry?.count < 5 && unitCats.archers?.count < 5) {
    weaknesses.push('Low military production overall — vulnerable to aggression');
  }

  // DATA-DRIVEN: if they always play the same opening
  if (pp.opening_stability >= 0.7) {
    const primary = pp.primary_opening || 'Unknown';
    weaknesses.push(`One-trick ${formatOpeningName(primary)} — hard counterable`);
  }

  // DATA-DRIVEN: late wheelbarrow = eco weakness
  if (stats.wheel_barrow_avg != null && stats.wheel_barrow_avg > 800) {
    weaknesses.push('Delayed wheelbarrow — economy falls behind');
  }

  // DATA-DRIVEN: low versatility
  if (dims.versatility < 30) {
    weaknesses.push('Plays same civs and maps — easy to prepare against');
  }

  // DATA-DRIVEN: slow execution
  if (dims.speed < 30) {
    weaknesses.push('Low APM — struggles with multi-tasking');
  }

  // DATA-DRIVEN: specific from openings
  const fcFreq = perFreq['fast_castle'] || 0;
  if (fcFreq > 40) {
    weaknesses.push(`Fast Castle ${fcFreq}% — punish with early military`);
  }

  const scoutFreq = perFreq['scout_rush'] || 0;
  if (scoutFreq > 40) {
    weaknesses.push(`Scout rush ${scoutFreq}% — spear walls neutralize it`);
  }

  const archerFreq = perFreq['archer_rush'] || 0;
  if (archerFreq > 40) {
    weaknesses.push(`Archer rush ${archerFreq}% — skirmishers hard counter`);
  }

  if (weaknesses.length === 0) {
    if (dims.aggression > 60) weaknesses.push('May overextend with aggression');
    else if (dims.economy > 60) weaknesses.push('May be vulnerable to early pressure');
    else weaknesses.push('No clear pattern — scout and adapt');
  }

  return weaknesses.slice(0, 4);
}

export function detectThreats(stats) {
  const threats = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const arch = stats.archetype || {};
  const dims = arch.dimensions || {};
  const unitStats = stats.unit_stats || {};

  // DATA-DRIVEN: specific unit threats from actual stats
  const scoutCount = unitStats['scout_cavalry']?.total || 0;
  const archerCount = unitStats['archer']?.total || 0;
  const knightCount = unitStats['knight']?.total || 0;

  if (scoutCount > 20) {
    threats.push(`Heavy scout production (${scoutCount} total) — early map control`);
  }
  if (archerCount > 20) {
    threats.push(`Mass archer player (${archerCount} total) — ranged pressure`);
  }
  if (knightCount > 15) {
    threats.push(`Knight switch threat (${knightCount} total) — cav armor needed`);
  }

  // DATA-DRIVEN: speed threat
  if (dims.speed >= 70) {
    threats.push(`High APM (${stats.avg_eapm}) — out-micros in skirmishes`);
  }

  // DATA-DRIVEN: opening-specific
  const scoutFreq = perFreq['scout_rush'] || 0;
  if (scoutFreq >= 30) {
    threats.push(`Scout rush ${scoutFreq}% — expect early raid damage`);
  }

  const archerFreq = perFreq['archer_rush'] || 0;
  if (archerFreq >= 30) {
    threats.push(`Archer rush ${archerFreq}% — forward ranges likely`);
  }

  const ffaFreq = perFreq['fast_feudal_aggressive'] || 0;
  if (ffaFreq >= 30) {
    threats.push(`Fast Feudal aggression ${ffaFreq}% — immediate military`);
  }

  if (dims.economy >= 60) {
    threats.push('Strong late-game scaling — close games are dangerous');
  }

  const trushFreq = perFreq['tower_rush'] || 0;
  const drushFreq = perFreq['drush'] || 0;
  if (trushFreq >= 15 || drushFreq >= 15) {
    threats.push(`Cheese potential — scout early for forwards`);
  }

  if (threats.length === 0) {
    threats.push('Standard play expected — no extreme threats');
  }

  return threats.slice(0, 4);
}

export function generateDataDrivenRecommendations(stats) {
  const recs = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const primary = pp.primary_opening || 'Unknown';
  const unitStats = stats.unit_stats || {};
  const unitCats = stats.unit_categories || {};
  const keyTechs = stats.key_techs || {};

  // DATA-DRIVEN: based on actual unit production stats
  const scoutCount = unitStats['scout_cavalry']?.total || 0;
  const archerCount = unitStats['archer']?.total || 0;
  const knightCount = unitStats['knight']?.total || 0;
  const militiaCount = unitStats['militia']?.total || 0;
  const skirmCount = unitStats['skirmisher']?.total || 0;

  // Opening frequency based
  const scoutFreq = perFreq['scout_rush'] || 0;
  const archerFreq = perFreq['archer_rush'] || 0;
  const fcFreq = perFreq['fast_castle'] || 0;
  const ffaFreq = perFreq['fast_feudal_aggressive'] || 0;
  const drushFreq = perFreq['drush'] || 0;
  const trushFreq = perFreq['tower_rush'] || 0;

  // Build opening-based recommendations with DATA backing
  if (scoutFreq >= 25 || scoutCount > 15) {
    recs.push({ type: 'must', text: `Expect Scout Rush (${scoutFreq}% / ${scoutCount} scouts total)` });
    recs.push({ type: 'must', text: 'Build houses to wall berries before Feudal' });
  }

  if (archerFreq >= 25 || archerCount > 15) {
    recs.push({ type: 'must', text: `Expect Archer Rush (${archerFreq}% / ${archerCount} archers total)` });
    recs.push({ type: 'must', text: 'Get early skirmishers if civ allows' });
  }

  if (fcFreq >= 25) {
    recs.push({ type: 'must', text: `Expect Fast Castle (${fcFreq}%) — deny relics` });
  }

  if (ffaFreq >= 25) {
    recs.push({ type: 'must', text: `Expect aggressive Feudal (${ffaFreq}%) — extra wood for walls` });
  }

  if (drushFreq >= 15 || militiaCount > 10) {
    recs.push({ type: 'must', text: `Expect Drush (${drushFreq}% / ${militiaCount} militia) — early palisade` });
  }

  if (trushFreq >= 10) {
    recs.push({ type: 'must', text: `Expect Tower Rush (${trushFreq}%) — scout for villager forward` });
  }

  // DATA-DRIVEN: tech preferences
  const fletchingData = keyTechs['fletching'];
  if (fletchingData && fletchingData.frequency >= 60) {
    recs.push({ type: 'warn', text: `Fletching in ${fletchingData.frequency}% games — archer threat real` });
  }

  const bloodlinesData = keyTechs['bloodlines'];
  if (bloodlinesData && bloodlinesData.frequency >= 50) {
    recs.push({ type: 'warn', text: `Bloodlines in ${bloodlinesData.frequency}% — knight switch incoming` });
  }

  // DATA-DRIVEN: map preferences
  const mapWR = stats.map_win_percent || {};
  const bestMap = Object.entries(mapWR).sort((a, b) => b[1] - a[1])[0];
  if (bestMap && bestMap[1] >= 65) {
    recs.push({ type: 'warn', text: `Strong on ${bestMap[0]} (${bestMap[1]}% WR) — ban if possible` });
  }

  // DATA-DRIVEN: civ preferences
  const civPlayed = stats.civ_played_percent || {};
  const mainCiv = Object.entries(civPlayed).sort((a, b) => b[1] - a[1])[0];
  if (mainCiv && mainCiv[1] >= 60) {
    recs.push({ type: 'warn', text: `Plays ${mainCiv[0]} ${mainCiv[1]}% — prepare civ counter` });
  }

  // DATA-DRIVEN: economy timing
  if (stats.wheel_barrow_avg != null && stats.wheel_barrow_avg > 750) {
    recs.push({ type: 'warn', text: `Late wheelbarrow (${formatHms(stats.wheel_barrow_avg)}) — eco vulnerable` });
  }

  if (recs.length === 0) {
    recs.push({ type: 'must', text: 'Mixed strategy — scout with first military unit' });
  }

  return recs.slice(0, 7);
}

export function generatePrediction(stats) {
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const primary = pp.primary_opening || 'Unknown';
  const unitStats = stats.unit_stats || {};
  const keyTechs = stats.key_techs || {};

  // Determine expected strategy from REAL data
  let expectedStrategy = '';
  let strategyProb = 0;

  const scoutFreq = perFreq['scout_rush'] || 0;
  const archerFreq = perFreq['archer_rush'] || 0;
  const fcFreq = perFreq['fast_castle'] || 0;
  const ffaFreq = perFreq['fast_feudal_aggressive'] || 0;
  const drushFreq = perFreq['drush'] || 0;
  const trushFreq = perFreq['tower_rush'] || 0;

  // Pick the dominant strategy with unit stats backing
  if (scoutFreq >= 30 || (unitStats['scout_cavalry']?.total || 0) > 20) {
    expectedStrategy = 'Scout Rush → Knights/Skirms';
    strategyProb = scoutFreq || 40;
  } else if (archerFreq >= 30 || (unitStats['archer']?.total || 0) > 20) {
    expectedStrategy = 'Archer Rush → Crossbows/Knights';
    strategyProb = archerFreq || 40;
  } else if (fcFreq >= 30) {
    expectedStrategy = 'Fast Castle → Boom/Relic control';
    strategyProb = fcFreq;
  } else if (ffaFreq >= 25) {
    expectedStrategy = 'Aggressive Feudal → Military pressure';
    strategyProb = ffaFreq;
  } else if (drushFreq >= 20 || (unitStats['militia']?.total || 0) > 15) {
    expectedStrategy = 'Drush → Archer/Scout transition';
    strategyProb = drushFreq || 30;
  } else if (trushFreq >= 15) {
    expectedStrategy = 'Tower Rush → Economic damage';
    strategyProb = trushFreq;
  } else {
    expectedStrategy = 'Mixed — no clear dominant pattern';
    strategyProb = 0;
  }

  // Secondary from second most common opening
  let secondaryStrategy = '';
  const sorted = Object.entries(perFreq).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1) {
    secondaryStrategy = formatOpeningName(sorted[1][0]);
  }

  // Counter recs from actual data
  const counterRecs = [];

  if (expectedStrategy.includes('Scout')) {
    counterRecs.push('Build houses around berries before Feudal');
    counterRecs.push('Spearmen production in Feudal');
  }
  if (expectedStrategy.includes('Archer')) {
    counterRecs.push('Early skirmishers from archery range');
    counterRecs.push('Get fletching if matching archers');
  }
  if (expectedStrategy.includes('Fast Castle')) {
    counterRecs.push('Apply Feudal pressure immediately');
    counterRecs.push('Deny relics and map control');
  }
  if (expectedStrategy.includes('Aggressive Feudal')) {
    counterRecs.push('Extra villagers on wood for walls');
    counterRecs.push('Do not try to match aggression');
  }
  if (expectedStrategy.includes('Drush')) {
    counterRecs.push('Early palisade around wood/gold');
    counterRecs.push('Keep scout near base until Feudal');
  }
  if (expectedStrategy.includes('Tower')) {
    counterRecs.push('Scout for villager forward at 8:00');
    counterRecs.push('Pre-wall strategic resources');
  }

  // Add data-backed counters
  const fletchingData = keyTechs['fletching'];
  if (fletchingData && fletchingData.frequency >= 60) {
    counterRecs.push('Expect early fletching — wall vulnerable areas');
  }

  const bloodlinesData = keyTechs['bloodlines'];
  if (bloodlinesData && bloodlinesData.frequency >= 50) {
    counterRecs.push('Bloodlines player — prepare pikemen transition');
  }

  if (counterRecs.length < 3) {
    counterRecs.push('Scout with first military unit');
    counterRecs.push('Play reactive until pattern identified');
  }

  return {
    expected_strategy: expectedStrategy,
    strategy_probability: strategyProb,
    secondary_strategy: secondaryStrategy,
    counter_recommendations: counterRecs.slice(0, 5),
  };
}

// ============================================================================
// TIMING INTERPRETATION (CONTEXTUAL, DATA-DRIVEN)
// ============================================================================

export function interpretTimings(stats) {
  const interpretations = [];
  const feudal = stats.avg_feudal || 0;
  const castle = stats.avg_castle || 0;
  const imperial = stats.avg_imperial || 0;

  // Get actual military data by period for context
  const unitsByAge = stats.units_by_age_period || {};
  const preCastle = unitsByAge['pre-castle'] || {};
  const preFeudal = unitsByAge['pre-feudal'] || {};

  // Calculate total military in feudal period from REAL data
  const feudalMilitary = Object.values(preCastle).reduce((sum, u) => sum + (u.total || 0), 0);
  const darkMilitary = Object.values(preFeudal).reduce((sum, u) => sum + (u.total || 0), 0);

  // Feudal analysis WITH military context
  if (feudal > 0) {
    if (feudal < 600) {
      if (feudalMilitary > 10) {
        interpretations.push({ timing: 'Feudal', value: formatHms(feudal), conclusion: `Fast Feudal + ${feudalMilitary} military units — Aggressive opener`, icon: '⚠', type: 'warning' });
      } else if (feudalMilitary < 3) {
        interpretations.push({ timing: 'Feudal', value: formatHms(feudal), conclusion: 'Fast Feudal but low military — Greedy boom', icon: '✓', type: 'positive' });
      } else {
        interpretations.push({ timing: 'Feudal', value: formatHms(feudal), conclusion: 'Fast Feudal with moderate pressure', icon: '✓', type: 'positive' });
      }
    } else if (feudal < 720) {
      interpretations.push({ timing: 'Feudal', value: formatHms(feudal), conclusion: `Standard Feudal timing (${feudalMilitary} pre-castle units)`, icon: '✓', type: 'positive' });
    } else {
      interpretations.push({ timing: 'Feudal', value: formatHms(feudal), conclusion: 'Delayed Feudal — likely Fast Castle or boom', icon: '⚠', type: 'warning' });
    }
  }

  // Castle analysis WITH military context
  if (castle > 0) {
    if (castle < 1080) {
      if (feudalMilitary > 15) {
        interpretations.push({ timing: 'Castle', value: formatHms(castle), conclusion: `Extended Feudal pressure (${feudalMilitary} units) before Castle`, icon: '⚠', type: 'warning' });
      } else {
        interpretations.push({ timing: 'Castle', value: formatHms(castle), conclusion: 'Fast Castle — expect boom or tech switch', icon: '✓', type: 'positive' });
      }
    } else if (castle < 1260) {
      interpretations.push({ timing: 'Castle', value: formatHms(castle), conclusion: 'Standard Castle timing', icon: '✓', type: 'positive' });
    } else {
      interpretations.push({ timing: 'Castle', value: formatHms(castle), conclusion: 'Slow Castle — possible turtle or defensive play', icon: '⚠', type: 'warning' });
    }
  }

  // Imperial analysis
  if (imperial > 0) {
    if (imperial < 1500) {
      interpretations.push({ timing: 'Imperial', value: formatHms(imperial), conclusion: 'Fast Imperial — tech-based win condition', icon: '✓', type: 'positive' });
    } else if (imperial < 1800) {
      interpretations.push({ timing: 'Imperial', value: formatHms(imperial), conclusion: 'Standard Imperial timing', icon: '✓', type: 'positive' });
    } else {
      interpretations.push({ timing: 'Imperial', value: formatHms(imperial), conclusion: 'Late Imperial — prefers Castle/Feudal fights', icon: '⚠', type: 'warning' });
    }
  }

  // Pattern from real data
  if (feudal < 600 && castle > 1260 && feudalMilitary > 8) {
    interpretations.push({ timing: 'Pattern', value: '', conclusion: `Fast Feudal + ${feudalMilitary} military + Slow Castle = Extended aggression`, icon: '⚠', type: 'warning' });
  } else if (castle < 1080 && imperial < 1500) {
    interpretations.push({ timing: 'Pattern', value: '', conclusion: 'Rapid aging — macro/boom specialist', icon: '✓', type: 'positive' });
  } else if (imperial > 1800 && stats.avg_duration_hms) {
    const durMin = parseInt(stats.avg_duration_hms) || 0;
    if (durMin > 30) {
      interpretations.push({ timing: 'Pattern', value: '', conclusion: `Long avg games (${stats.avg_duration_hms}) — late game comfort`, icon: '✓', type: 'positive' });
    }
  }

  return interpretations;
}

// ============================================================================
// CONFIDENCE & STREAK
// ============================================================================

export function computeConfidence(stats) {
  const analyzed = stats.analyzed || 0;
  if (analyzed >= 20) return 'High';
  if (analyzed >= 8) return 'Medium';
  return 'Low';
}

export function computeConfidenceDetails(stats) {
  const analyzed = stats.analyzed || 0;
  let level = 'Low';
  let pct = 30;

  if (analyzed >= 30) { level = 'High'; pct = 90; }
  else if (analyzed >= 15) { level = 'Medium'; pct = 65; }
  else if (analyzed >= 8) { level = 'Medium'; pct = 50; }
  else { level = 'Low'; pct = Math.max(20, analyzed * 4); }

  return {
    level,
    percentage: pct,
    games_analyzed: analyzed,
    message: analyzed >= 20
      ? 'Strong statistical foundation'
      : analyzed >= 8
        ? 'Moderate sample size'
        : 'Limited data — patterns may change',
  };
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
