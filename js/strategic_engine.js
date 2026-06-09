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

  // Determine base archetype from civ + openings + units
  let baseArchetype = civData.archetype || 'balanced';
  const archParts = baseArchetype.split('_');

  // Refine based on actual openings
  const scoutFreq = perFreq['scout_rush'] || 0;
  const archerFreq = perFreq['archer_rush'] || 0;
  const maaFreq = perFreq['maa_rush'] || 0;
  const fcFreq = perFreq['fast_castle'] || 0;
  const ffaFreq = perFreq['fast_feudal_aggressive'] || 0;
  const drushFreq = perFreq['drush'] || 0;

  // Refine based on actual unit production
  const cavAvg = unitCats.cavalry?.avg || 0;
  const archAvg = unitCats.archers?.avg || 0;
  const infAvg = unitCats.infantry?.avg || 0;

  let identity = '';

  // High opening concentration = specialist
  const stability = pp.opening_stability || 0;
  if (stability >= 0.65 && primaryOpening !== 'Unknown') {
    if (primaryOpening === 'scout_rush') identity = 'Scout Pressure Specialist';
    else if (primaryOpening === 'archer_rush') identity = 'Archer Macro Player';
    else if (primaryOpening === 'maa_rush') identity = 'MAA Aggression Specialist';
    else if (primaryOpening === 'fast_castle') identity = 'Defensive Boomer';
    else if (primaryOpening === 'fast_feudal_aggressive') identity = 'Aggressive Feudal Player';
    else if (primaryOpening === 'drush') identity = 'Drush Tactical Player';
    else if (primaryOpening === 'tower_rush') identity = 'Forward Pressure Specialist';
    else identity = `${formatOpeningName(primaryOpening)} Specialist`;
  } else if (stability >= 0.4) {
    identity = 'Hybrid Adaptable Player';
  } else {
    identity = 'Flexible Meta Player';
  }

  // Override if unit production strongly contradicts
  if (cavAvg > 4 && archAvg < 2 && infAvg < 2) identity = 'Aggressive Cavalry Player';
  else if (archAvg > 3 && cavAvg < 2 && infAvg < 2) identity = 'Archer Macro Player';
  else if (infAvg > 3 && cavAvg < 2 && archAvg < 2) identity = 'Infantry Pressure Player';

  return {
    identity,
    base_archetype: baseArchetype,
    civilization: civKey,
  };
}

export function generateExpectedBehaviour(stats, civName) {
  const behaviours = [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const primaryOpening = pp.primary_opening || 'Unknown';
  const stability = pp.opening_stability || 0;
  const fcFreq = perFreq['fast_castle'] || 0;
  const cavAvg = (stats.unit_categories || {}).cavalry?.avg || 0;
  const archAvg = (stats.unit_categories || {}).archers?.avg || 0;

  if (fcFreq >= 30) behaviours.push('Prioritizes Castle Age boom over Feudal aggression');
  if (stability >= 0.6) behaviours.push(`Highly consistent ${formatOpeningName(primaryOpening)} approach`);
  if (stability <= 0.35) behaviours.push('Unpredictable — mixes multiple strategies');
  if (cavAvg > 3) behaviours.push('Frequently transitions into cavalry');
  if (archAvg > 3) behaviours.push('Frequently transitions into archers');
  if (stats.wheel_barrow_avg != null && stats.wheel_barrow_avg < 720) behaviours.push('Strong economy timing');
  if (stats.avg_eapm > 30) behaviours.push('High APM — strong micro potential');

  if (behaviours.length === 0) behaviours.push('Standard approach — no extreme tendencies');

  return behaviours.slice(0, 5);
}

export function generatePowerSpike(stats, civName) {
  const kb = knowledgeBase || {};
  const civKey = civName ? civName.charAt(0).toUpperCase() + civName.slice(1).toLowerCase() : '';
  const civData = kb[civKey] || {};

  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const fcFreq = perFreq['fast_castle'] || 0;
  const scoutFreq = perFreq['scout_rush'] || 0;

  let playerSpike = '';
  if (fcFreq >= 30) playerSpike = 'Castle Age';
  else if (scoutFreq >= 25) playerSpike = 'Feudal Age';
  else if ((perFreq['archer_rush'] || 0) >= 25) playerSpike = 'Feudal-Castle';
  else playerSpike = 'Mid Game';

  const civSpikes = civData.strong_ages || [];
  const civPowerSpikes = civData.power_spikes || [];

  // Find overlap
  let combinedSpike = '';
  if (playerSpike === 'Castle Age' && civSpikes.includes('castle')) combinedSpike = 'Castle Age (18:00 - 24:00)';
  else if (playerSpike === 'Feudal Age' && civSpikes.includes('feudal')) combinedSpike = 'Feudal Age (12:00 - 16:00)';
  else if (civSpikes.includes('imperial')) combinedSpike = 'Imperial Age (30:00+)';
  else combinedSpike = `${playerSpike} transition`;

  return {
    timing: combinedSpike,
    civ_spikes: civPowerSpikes.slice(0, 4),
    player_spike: playerSpike,
  };
}

export function generateTransitionForecast(stats, civName) {
  const kb = knowledgeBase || {};
  const civKey = civName ? civName.charAt(0).toUpperCase() + civName.slice(1).toLowerCase() : '';
  const civData = kb[civKey] || {};
  const civTransitions = civData.expected_transitions || [];

  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const unitCats = stats.unit_categories || {};

  const cavAvg = unitCats.cavalry?.avg || 0;
  const archAvg = unitCats.archers?.avg || 0;
  const infAvg = unitCats.infantry?.avg || 0;

  // Score each transition
  const scores = {};
  for (const t of civTransitions) {
    scores[t] = 10; // Base civ weight
  }

  // Adjust based on actual production
  if (cavAvg > 2) {
    for (const t of ['knight', 'cavalry', 'camel', 'scout', 'hussar']) {
      if (scores[t] != null) scores[t] += 15;
    }
  }
  if (archAvg > 2) {
    for (const t of ['archer', 'crossbow', 'cavalry_archer']) {
      if (scores[t] != null) scores[t] += 15;
    }
  }
  if (infAvg > 2) {
    for (const t of ['militia', 'infantry', 'champion']) {
      if (scores[t] != null) scores[t] += 15;
    }
  }

  // Adjust based on openings
  if ((perFreq['scout_rush'] || 0) > 20) {
    scores['knight'] = (scores['knight'] || 0) + 10;
    scores['cavalry'] = (scores['cavalry'] || 0) + 10;
  }
  if ((perFreq['archer_rush'] || 0) > 20) {
    scores['crossbow'] = (scores['crossbow'] || 0) + 10;
    scores['archer'] = (scores['archer'] || 0) + 10;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const totalScore = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  return sorted.map(([name, score]) => ({
    name,
    probability: Math.round((score * 100 / totalScore) * 100) / 100,
  }));
}

export function generateStrategicWeaknesses(stats, civName) {
  const kb = knowledgeBase || {};
  const civKey = civName ? civName.charAt(0).toUpperCase() + civName.slice(1).toLowerCase() : '';
  const civData = kb[civKey] || {};
  const civWeaknesses = civData.weaknesses || [];

  const weaknesses = [...civWeaknesses];

  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};
  const stability = pp.opening_stability || 0;

  if (stability >= 0.7) weaknesses.push('predictable_opening');
  if ((perFreq['fast_castle'] || 0) >= 35) weaknesses.push('vulnerable_to_feudal_pressure');
  if (stats.avg_eapm < 20) weaknesses.push('slow_micro');

  // Map internal keys to readable text
  const weaknessMap = {
    halberdier: 'Halberdier mass',
    siege: 'Siege pressure',
    archers: 'Archer civs',
    cavalry: 'Cavalry rushes',
    hand_cannoneer: 'Gunpowder',
    monk: 'Monk conversions',
    camel: 'Camel civs',
    predictable_opening: 'Predictable strategy',
    vulnerable_to_feudal_pressure: 'Weak to Feudal aggression',
    slow_micro: 'Below-average micro speed',
  };

  return weaknesses.map(w => weaknessMap[w] || w).slice(0, 4);
}

export function generateStrategicRecommendations(stats, civName) {
  const kb = knowledgeBase || {};
  const civKey = civName ? civName.charAt(0).toUpperCase() + civName.slice(1).toLowerCase() : '';
  const civData = kb[civKey] || {};

  const recs = [];
  const weaknesses = civData.weaknesses || [];
  const strongAges = civData.strong_ages || [];
  const pp = stats.player_profile || {};
  const perFreq = pp.per_opening_frequency || {};

  // Recommend based on civ weaknesses
  if (weaknesses.includes('halberdier')) recs.push('Cavalry-heavy composition will exploit this civ');
  if (weaknesses.includes('archers')) recs.push('Archer pressure is highly effective');
  if (weaknesses.includes('cavalry')) recs.push('Scout or Knight rush hits their weak spot');
  if (weaknesses.includes('siege')) recs.push('Siege push in Castle/Imperial is strong');
  if (weaknesses.includes('monk')) recs.push('Monk conversions are devastating');
  if (weaknesses.includes('hand_cannoneer')) recs.push('Infantry mass counters their late game');

  // Recommend based on player's strong ages
  if (strongAges.includes('feudal')) recs.push('Their civ peaks in Feudal — survive to Castle');
  if (strongAges.includes('castle')) recs.push('Avoid extended Castle fights');
  if (strongAges.includes('imperial')) recs.push('Close the game before Imperial');

  // Recommend based on player tendencies
  if ((perFreq['fast_castle'] || 0) >= 30) recs.push('Expect boom — apply Feudal pressure');
  if ((perFreq['scout_rush'] || 0) >= 25) recs.push('Spearmen and walls critical in early Feudal');
  if ((perFreq['archer_rush'] || 0) >= 25) recs.push('Skirmishers if civ allows, or all-in Castle');

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
    'Standard/Unknown': 'Standard',
    'Mixed/No Data': 'Mixed',
  };
  return map[label] || label.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
