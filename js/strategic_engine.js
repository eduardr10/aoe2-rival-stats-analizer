import { formatHms } from './utils.js';

let knowledgeBase = null;

export async function loadKnowledgeBase() {
  if (knowledgeBase) return knowledgeBase;
  try {
    const res = await fetch('data/knowledge_base.json');
    knowledgeBase = await res.json();
  } catch (e) {
    knowledgeBase = {};
  }
  return knowledgeBase;
}

export function analyzeStrategicIdentity(stats, civName) {
  const kb = knowledgeBase || {};
  const civKey = civName ? civName.charAt(0).toUpperCase() + civName.slice(1).toLowerCase() : '';
  const civData = kb[civKey] || {};
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const primaryOpening = pp.primary_opening || 'Unknown';
  const unitCats = stats.unit_categories || {};

  const cavAvg = unitCats.cavalry?.avg || 0;
  const archAvg = unitCats.archers?.avg || 0;
  const infAvg = unitCats.infantry?.avg || 0;

  let identity = '';

  // DATA-DRIVEN: based on actual openings + unit production
  const stability = pp.opening_stability || 0;
  if (stability >= 0.65 && primaryOpening !== 'Unknown') {
    if (primaryOpening === 'scout_rush') identity = 'Scout Pressure';
    else if (primaryOpening === 'archer_rush') identity = 'Archer Macro';
    else if (primaryOpening === 'maa_rush') identity = 'MAA Aggression';
    else if (primaryOpening === 'fast_castle') identity = 'Defensive Boom';
    else if (primaryOpening === 'fast_feudal_aggressive') identity = 'Aggressive Feudal';
    else if (primaryOpening === 'drush') identity = 'Drush Tactical';
    else if (primaryOpening === 'tower_rush') identity = 'Forward Pressure';
    else identity = formatOpeningName(primaryOpening);
  } else if (stability >= 0.4) {
    identity = 'Mixed Style';
  } else {
    identity = 'Flexible';
  }

  // Refine based on actual unit production
  if (cavAvg > 4 && archAvg < 2 && infAvg < 2) identity = 'Cavalry Heavy';
  else if (archAvg > 3 && cavAvg < 2 && infAvg < 2) identity = 'Archer Heavy';
  else if (infAvg > 3 && cavAvg < 2 && archAvg < 2) identity = 'Infantry Heavy';

  return {
    identity,
    base_archetype: civData.archetype || '',
    civilization: civKey,
  };
}

export function generateExpectedBehaviour(stats, civName) {
  const behaviours = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const primaryOpening = pp.primary_opening || 'Unknown';
  const stability = pp.opening_stability || 0;
  const unitCats = stats.unit_categories || {};

  const cavAvg = unitCats.cavalry?.avg || 0;
  const archAvg = unitCats.archers?.avg || 0;
  const infAvg = unitCats.infantry?.avg || 0;

  // DATA-DRIVEN only: what the player actually does
  if ((perFreq['fast_castle'] || 0) >= 30) behaviours.push(`Fast Castle ${perFreq['fast_castle']}% — low early military`);
  if ((perFreq['scout_rush'] || 0) >= 25) behaviours.push(`Scout rush ${perFreq['scout_rush']}%`);
  if ((perFreq['archer_rush'] || 0) >= 25) behaviours.push(`Archer rush ${perFreq['archer_rush']}%`);
  if ((perFreq['maa_rush'] || 0) >= 20) behaviours.push(`MAA rush ${perFreq['maa_rush']}%`);
  if ((perFreq['drush'] || 0) >= 15) behaviours.push(`Drush ${perFreq['drush']}%`);

  if (cavAvg > 3) behaviours.push(`${cavAvg.toFixed(1)} cavalry avg per game`);
  if (archAvg > 3) behaviours.push(`${archAvg.toFixed(1)} archers avg per game`);
  if (infAvg > 3) behaviours.push(`${infAvg.toFixed(1)} infantry avg per game`);

  if (stability >= 0.6) behaviours.push(`Highly consistent ${formatOpeningName(primaryOpening)}`);
  if (stability <= 0.35) behaviours.push(`Unpredictable — ${Object.keys(perFreq).length} different openings`);

  // Economy timing (data-driven)
  if (stats.wheel_barrow_avg != null) behaviours.push(`Wheelbarrow avg ${formatHms(stats.wheel_barrow_avg)}`);
  if (stats.hand_cart_avg != null) behaviours.push(`Hand Cart avg ${formatHms(stats.hand_cart_avg)}`);

  // Civ context (only if no data)
  if (behaviours.length === 0 && civName) {
    behaviours.push(`Plays ${civName}`);
  }

  return behaviours.slice(0, 5);
}

export function generatePowerSpike(stats, civName) {
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const fcFreq = perFreq['fast_castle'] || 0;
  const scoutFreq = perFreq['scout_rush'] || 0;
  const archerFreq = perFreq['archer_rush'] || 0;

  let playerSpike = '';
  if (fcFreq >= 30) playerSpike = 'Castle Age';
  else if (scoutFreq >= 25) playerSpike = 'Feudal Age';
  else if (archerFreq >= 25) playerSpike = 'Feudal-Castle';
  else playerSpike = 'Mid Game';

  return {
    timing: playerSpike,
    civ: civName || '',
    player_spike: playerSpike,
  };
}

export function generateTransitionForecast(stats, civName) {
  // DATA-DRIVEN: predict transitions from ACTUAL unit production, not civ potential
  const unitCats = stats.unit_categories || {};
  const unitStats = stats.unit_stats || {};
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};

  const cavAvg = unitCats.cavalry?.avg || 0;
  const archAvg = unitCats.archers?.avg || 0;
  const infAvg = unitCats.infantry?.avg || 0;
  const siegeAvg = unitCats.siege?.avg || 0;

  // Score transitions based on actual observed production
  const scores = {};

  // Cavalry transitions
  if (cavAvg > 0) {
    scores['Knights / Cav'] = cavAvg;
  }
  if ((unitStats['scout_cavalry']?.avg || 0) > 1.5) {
    scores['Scout → Knight'] = (scores['Knights / Cav'] || 0) + 2;
  }
  if ((unitStats['camel_rider']?.avg || 0) > 0.5) {
    scores['Camel line'] = unitStats['camel_rider'].avg;
  }

  // Archer transitions
  if (archAvg > 0) {
    scores['Archers / Xbow'] = archAvg;
  }
  if ((unitStats['archer']?.avg || 0) > 1.5) {
    scores['Archer → Crossbow'] = (scores['Archers / Xbow'] || 0) + 2;
  }
  if ((unitStats['cavalry_archer']?.avg || 0) > 0.5) {
    scores['Cav Archer'] = unitStats['cavalry_archer'].avg;
  }

  // Infantry transitions
  if (infAvg > 0) {
    scores['Infantry line'] = infAvg;
  }
  if ((unitStats['militia']?.avg || 0) > 1.0) {
    scores['MAA → Longsword'] = (scores['Infantry line'] || 0) + 1;
  }

  // Siege transitions
  if (siegeAvg > 0.5) {
    scores['Siege push'] = siegeAvg;
  }

  // Opening-based adjustments (only if observed)
  if ((perFreq['scout_rush'] || 0) > 20) {
    scores['Scout → Knight'] = (scores['Scout → Knight'] || 0) + 1;
  }
  if ((perFreq['archer_rush'] || 0) > 20) {
    scores['Archer → Crossbow'] = (scores['Archer → Crossbow'] || 0) + 1;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const totalScore = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  return sorted.map(([name, score]) => ({
    name,
    probability: Math.round((score * 100 / totalScore) * 100) / 100,
  }));
}

export function generateStrategicWeaknesses(stats, civName) {
  // DATA-DRIVEN: weaknesses derived from actual match data
  const weaknesses = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const stability = pp.opening_stability || 0;

  if (stability >= 0.7) weaknesses.push('Predictable opening');
  if ((perFreq['fast_castle'] || 0) >= 35) weaknesses.push('Vulnerable to Feudal pressure');
  if (stats.avg_eapm && stats.avg_eapm < 20) weaknesses.push('Below-average micro speed');

  // Win/loss differentials
  for (const age of ['feudal', 'castle', 'imperial']) {
    const winAvg = stats.age_time_win_avg?.[age];
    const lossAvg = stats.age_time_loss_avg?.[age];
    if (winAvg != null && lossAvg != null) {
      const gap = lossAvg - winAvg;
      if (gap > 30) weaknesses.push(`Late ${age} age costs games`);
    }
  }

  return weaknesses.slice(0, 4);
}

export function generateStrategicRecommendations(stats, civName) {
  // DATA-DRIVEN ONLY: recommendations based on observed patterns
  const recs = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};

  // What does the player do? (not what the civ can do)
  if ((perFreq['fast_castle'] || 0) >= 30) {
    recs.push(`Fast Castle ${perFreq['fast_castle']}% — expect boom`);
  }
  if ((perFreq['scout_rush'] || 0) >= 25) {
    recs.push(`Scout Rush ${perFreq['scout_rush']}% — wall berries early`);
  }
  if ((perFreq['archer_rush'] || 0) >= 25) {
    recs.push(`Archer Rush ${perFreq['archer_rush']}% — skirms if available`);
  }
  if ((perFreq['maa_rush'] || 0) >= 20) {
    recs.push(`MAA Rush ${perFreq['maa_rush']}% — early barracks scout`);
  }
  if ((perFreq['drush'] || 0) >= 15) {
    recs.push(`Drush ${perFreq['drush']}% — scout for forward militia`);
  }
  if ((perFreq['tower_rush'] || 0) >= 10) {
    recs.push(`Tower Rush ${perFreq['tower_rush']}% — check for vils forward`);
  }

  // Opponent-derived: what happens when rival does X
  const oppPatterns = stats.opp_patterns || {};
  for (const [opening, wr] of Object.entries(oppPatterns.opp_opening_wr || {})) {
    if (wr >= 70) {
      recs.push(`${wr}% WR when rival goes ${formatOpeningName(opening)} (${oppPatterns.opp_opening_freq?.[opening] || 0} games)`);
    } else if (wr <= 35) {
      recs.push(`${wr}% WR when rival goes ${formatOpeningName(opening)}`);
    }
  }
  for (const [cat, wr] of Object.entries(oppPatterns.opp_unit_wr || {})) {
    if (wr <= 35) {
      recs.push(`${wr}% WR when rival mass ${cat}`);
    }
  }

  return recs.slice(0, 5);
}

export function buildStrategicAnalysis(stats, civName) {
  return {
    strategic_identity: analyzeStrategicIdentity(stats, civName),
    expected_behaviour: generateExpectedBehaviour(stats, civName),
    power_spike: generatePowerSpike(stats, civName),
    transition_forecast: generateTransitionForecast(stats, civName),
    weaknesses: generateStrategicWeaknesses(stats, civName),
    recommendations: generateStrategicRecommendations(stats, civName),
    confidence: stats.analyzed >= 15 ? 'High' : stats.analyzed >= 8 ? 'Medium' : 'Low',
  };
}

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
