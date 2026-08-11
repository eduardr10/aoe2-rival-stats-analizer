import { formatHms } from './utils.js';
import { formatOpeningName } from './i18n.js';

// ============================================================================
// CROSS ANALYSIS — Cross-referenced intelligence from all extracted data
// ============================================================================

export function buildCrossAnalysis(stats) {
  if (!stats || stats.analyzed < 5) return null;

  return {
    openingVsOpponent: buildOpeningMatrix(stats),
    timingBrackets: buildTimingBrackets(stats),
    ageOrder: buildAgeOrder(stats),
    feudalAdvantage: buildFeudalAdvantage(stats),
    matchupBehavior: buildMatchupBehaviorModel(stats),
    determinantFeatures: buildDeterminantFeatures(stats),
  };
}

// ---- Opening × Opponent Opening Matrix ----
function buildOpeningMatrix(stats) {
  const matrix = stats.opening_vs_opponent || {};
  const entries = [];
  for (const [myOpen, oppMap] of Object.entries(matrix)) {
    for (const [oppOpen, record] of Object.entries(oppMap)) {
      const total = record.wins + record.losses;
      if (total < 3) continue;
      const wr = Math.round((record.wins / total) * 100);
      entries.push({ myOpen, oppOpen, wins: record.wins, losses: record.losses, total, wr });
    }
  }
  entries.sort((a, b) => b.total - a.total);
  return entries;
}

// ---- Timing Brackets × Result ----
function buildTimingBrackets(stats) {
  const feudalTimes = stats.age_times?.feudal || [];
  const feudalWins = stats.age_times_wins?.feudal || [];
  const feudalLosses = stats.age_times_losses?.feudal || [];

  const brackets = [];
  const ranges = [
    { label: '<9:00', max: 540 },
    { label: '9:00–9:59', min: 540, max: 600 },
    { label: '10:00–10:59', min: 600, max: 660 },
    { label: '11:00+', min: 660 },
  ];

  for (const range of ranges) {
    const inRange = feudalTimes.filter(t => {
      if (range.max && range.min) return t >= range.min && t < range.max;
      if (range.max) return t < range.max;
      return t >= range.min;
    });
    const winsInRange = inRange.filter(t => feudalWins.includes(t)).length;
    const totalInRange = inRange.length;
    if (totalInRange < 3) continue;
    brackets.push({
      label: range.label,
      total: totalInRange,
      wins: winsInRange,
      wr: Math.round((winsInRange / totalInRange) * 100),
      avgTime: formatHms(Math.round(inRange.reduce((a, b) => a + b, 0) / totalInRange)),
    });
  }
  return brackets.length >= 2 ? brackets : null;
}

// ---- Age-up Order vs Result ----
function buildAgeOrder(stats) {
  const data = stats.match_cross_data || [];
  if (data.length < 5) return null;

  let feudalFirstWins = 0, feudalFirstLosses = 0;
  let castleFirstWins = 0, castleFirstLosses = 0;
  let feudalSecondWins = 0, feudalSecondLosses = 0;
  let castleSecondWins = 0, castleSecondLosses = 0;

  for (const m of data) {
    if (m.player_feudal != null && m.opponent_feudal != null) {
      const first = m.player_feudal < m.opponent_feudal;
      if (first) {
        if (m.won) feudalFirstWins++; else feudalFirstLosses++;
      } else {
        if (m.won) feudalSecondWins++; else feudalSecondLosses++;
      }
    }
    if (m.player_castle != null && m.opponent_castle != null) {
      const first = m.player_castle < m.opponent_castle;
      if (first) {
        if (m.won) castleFirstWins++; else castleFirstLosses++;
      } else {
        if (m.won) castleSecondWins++; else castleSecondLosses++;
      }
    }
  }

  const feudalFirstTotal = feudalFirstWins + feudalFirstLosses;
  const feudalSecondTotal = feudalSecondWins + feudalSecondLosses;
  const castleFirstTotal = castleFirstWins + castleFirstLosses;
  const castleSecondTotal = castleSecondWins + castleSecondLosses;

  if (feudalFirstTotal === 0 && castleFirstTotal === 0) return null;

  return {
    feudal: {
      first: { wins: feudalFirstWins, losses: feudalFirstLosses, total: feudalFirstTotal, wr: wr(feudalFirstWins, feudalFirstTotal) },
      second: { wins: feudalSecondWins, losses: feudalSecondLosses, total: feudalSecondTotal, wr: wr(feudalSecondWins, feudalSecondTotal) },
    },
    castle: {
      first: { wins: castleFirstWins, losses: castleFirstLosses, total: castleFirstTotal, wr: wr(castleFirstWins, castleFirstTotal) },
      second: { wins: castleSecondWins, losses: castleSecondLosses, total: castleSecondTotal, wr: wr(castleSecondWins, castleSecondTotal) },
    },
  };
}

function wr(wins, total) {
  return total > 0 ? Math.round((wins / total) * 100) : 0;
}

// ---- Feudal Military Advantage vs Result ----
function buildFeudalAdvantage(stats) {
  const data = stats.match_cross_data || [];
  if (data.length < 5) return null;

  // Use early_pressure win/loss ratios as a simpler metric
  const ep = stats.early_pressure || {};
  const w10 = ep.before10?.wins;
  const l10 = ep.before10?.losses;
  if (w10 == null || l10 == null) return null;

  const wNum = parseFloat(w10);
  const lNum = parseFloat(l10);
  if (isNaN(wNum) || isNaN(lNum)) return null;

  return {
    militaryRatioWins: wNum.toFixed(2),
    militaryRatioLosses: lNum.toFixed(2),
    difference: (wNum - lNum).toFixed(2),
    signal: wNum > lNum * 1.3 ? 'Early military pressure correlates with wins' : wNum * 1.3 < lNum ? 'Boomear correlates with wins' : 'No clear signal',
  };
}

// ---- Matchup Behavior Model ----
function buildMatchupBehaviorModel(stats) {
  // Predict opponent opening distribution conditioned on our opening and map
  const model = { byMyOpening: {}, globalOppOpenings: {}, suggestedCounters: {} };

  // Global opponent opening frequencies
  const oppOpenings = stats.opp_openings || {};
  const totalOppOpenings = Object.values(oppOpenings).reduce((a, b) => a + b, 0) || 1;
  for (const [open, count] of Object.entries(oppOpenings)) {
    model.globalOppOpenings[open] = Math.round((count * 1000 / totalOppOpenings)) / 10; // percent
  }

  // For each of our openings, compute conditional distribution of opponent openings
  const openingVsOpp = stats.opening_vs_opponent || {};
  for (const [myOpen, oppMap] of Object.entries(openingVsOpp)) {
    const dist = [];
    let total = 0;
    for (const [oppOpen, rec] of Object.entries(oppMap)) total += (rec.wins || 0) + (rec.losses || 0);
    for (const [oppOpen, rec] of Object.entries(oppMap)) {
      const cnt = (rec.wins || 0) + (rec.losses || 0);
      if (cnt < 1) continue;
      dist.push({ opponent_opening: oppOpen, count: cnt, probability: Math.round((cnt * 1000 / Math.max(1, total))) / 10 });
    }
    dist.sort((a, b) => b.count - a.count);
    model.byMyOpening[myOpen] = dist;
  }

  // Suggested counters: use unit_effectiveness to find units with high WR when present
  const unitEff = stats.unit_effectiveness || {};
  const sortedUnits = Object.entries(unitEff)
    .filter(([, d]) => d.matches >= 3)
    .sort((a, b) => b[1].wr - a[1].wr)
    .slice(0, 6)
    .map(([name, d]) => ({ unit: name, wr: d.wr, share: d.share }));
  model.suggestedCounters = sortedUnits;

  // Predictor: dada nuestra apertura y opcionalmente el mapa, devolver probabilidades y counters
  model.predict = function predictOpponentResponse({ myOpening = null, map = null, topN = 3 } = {}) {
    const out = { predictions: [], counters: model.suggestedCounters.slice(0, 6) };
    if (!myOpening) {
      // fallback: top global opponent openings
      const sorted = Object.entries(model.globalOppOpenings).sort((a, b) => b[1] - a[1]).slice(0, topN);
      out.predictions = sorted.map(([op, pct]) => ({ opponent_opening: op, probability_pct: pct }));
      return out;
    }

    const dist = model.byMyOpening[myOpening] || [];
    if (!dist.length) return out;
    const filtered = dist.slice(0, topN).map(d => ({ opponent_opening: d.opponent_opening, probability_pct: d.probability }));
    out.predictions = filtered;
    return out;
  };

  return model;
}

// ---- Determinant Features (effect size between wins and losses) ----
function buildDeterminantFeatures(stats) {
  const featuresToCheck = [
    't_feudal', 't_castle', 't_first_barracks', 't_first_archery_range', 't_first_stable',
    'villagers_by_feudal', 'militia_by_feudal', 'maa_in_feudal', 'scouts_by_early', 'archers_by_early', 'total_military_by_early',
    'tc_count_first_15min', 'archers_per_villager_early', 'military_per_villager_early'
  ];

  const all = stats.all_match_features || [];
  const cross = stats.match_cross_data || [];
  if (!all.length || !cross.length) return null;

  function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
  function std(arr) {
    if (!arr || arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (arr.length - 1));
  }

  const results = [];
  for (const key of featuresToCheck) {
    const wins = [];
    const losses = [];
    for (let i = 0; i < all.length; i++) {
      const f = all[i] || {};
      const meta = cross[i] || {};
      const val = f[key];
      if (val == null || Number.isNaN(val)) continue;
      if (meta.won) wins.push(val); else losses.push(val);
    }
    if (wins.length < 3 || losses.length < 3) continue;
    const m1 = mean(wins), m2 = mean(losses);
    const s1 = std(wins), s2 = std(losses);
    const pooled = Math.sqrt((((wins.length - 1) * Math.pow(s1, 2)) + ((losses.length - 1) * Math.pow(s2, 2))) / (wins.length + losses.length - 2)) || 0.0001;
    const cohen = (m1 - m2) / pooled;
    const abscohen = Math.abs(cohen);
    const strength = abscohen >= 0.8 ? 'large' : abscohen >= 0.5 ? 'medium' : abscohen >= 0.2 ? 'small' : 'negligible';
    results.push({ feature: key, win_mean: Math.round(m1 * 100) / 100, loss_mean: Math.round(m2 * 100) / 100, cohen_d: Math.round(cohen * 100) / 100, strength, samples: { wins: wins.length, losses: losses.length } });
  }

  // Sort by absolute effect size descending
  results.sort((a, b) => Math.abs(b.cohen_d) - Math.abs(a.cohen_d));
  return results.slice(0, 10);
}
