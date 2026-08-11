import { formatHms } from './utils.js';
import { formatOpeningName } from './i18n.js';

// ============================================================================
// CROSS ANALYSIS — Cross-referenced intelligence from all extracted data
// ============================================================================

export function buildCrossAnalysis(stats) {
  if (!stats || stats.analyzed < 5) return null;

  return {
    breakpoints: findBreakpoints(stats),
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

// ---- Breakpoints (max-gap binary split per age) ----
function findBreakpoints(stats) {
  const ages = ['feudal', 'castle', 'imperial'];
  const result = {};
  for (const age of ages) {
    const times = stats.age_times?.[age] || [];
    const wins = stats.age_times_wins?.[age] || [];
    if (times.length < 6) continue;

    let best = null;
    const sorted = [...new Set(times)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const t = sorted[i];
      const fast = times.filter(x => x <= t);
      const slow = times.filter(x => x > t);
      if (fast.length < 3 || slow.length < 3) continue;
      const fastWin = wins.filter(x => x <= t).length;
      const slowWin = wins.filter(x => x > t).length;
      const fastWR = fastWin / fast.length;
      const slowWR = slowWin / slow.length;
      const gap = fastWR - slowWR;
      if (!best || gap > best.gap) {
        best = {
          age,
          threshold: t,
          thresholdHms: formatHms(Math.round(t)),
          fastWR: Math.round(fastWR * 100),
          slowWR: Math.round(slowWR * 100),
          gap: Math.round(gap * 100),
          nFast: fast.length,
          nSlow: slow.length,
        };
      }
    }
    if (best && best.gap >= 15) result[age] = best;
  }
  return result;
}

// ---- Matchup Behavior Model ----
function buildMatchupBehaviorModel(stats) {
  const model = {
    byMyOpening: {},
    byMyOpeningMap: {},
    byMyOpeningOppCiv: {},
    byMyOpeningMapOppCiv: {},
    globalOppOpenings: {},
    suggestedCounters: {},
  };

  const oppOpenings = stats.opp_openings || {};
  const totalOppOpenings = Object.values(oppOpenings).reduce((a, b) => a + b, 0) || 1;
  for (const [open, count] of Object.entries(oppOpenings)) {
    model.globalOppOpenings[open] = Math.round((count * 1000 / totalOppOpenings)) / 10;
  }

  const openingVsOpp = stats.opening_vs_opponent || {};
  for (const [myOpen, oppMap] of Object.entries(openingVsOpp)) {
    model.byMyOpening[myOpen] = buildDistributionFromRecord(oppMap);
  }

  const conditionalByMap = {};
  const conditionalByOppCiv = {};
  const conditionalByMapOppCiv = {};
  const cross = stats.match_cross_data || [];
  for (const match of cross) {
    const myOpen = match.player_opening || 'Unknown';
    const oppOpen = match.opponent_opening || 'Unknown';
    const mapName = match.map || 'Unknown';
    const oppCiv = match.opponent_civ || 'Unknown';

    if (!conditionalByMap[myOpen]) conditionalByMap[myOpen] = {};
    if (!conditionalByMap[myOpen][mapName]) conditionalByMap[myOpen][mapName] = {};
    conditionalByMap[myOpen][mapName][oppOpen] = (conditionalByMap[myOpen][mapName][oppOpen] || 0) + 1;

    if (!conditionalByOppCiv[myOpen]) conditionalByOppCiv[myOpen] = {};
    if (!conditionalByOppCiv[myOpen][oppCiv]) conditionalByOppCiv[myOpen][oppCiv] = {};
    conditionalByOppCiv[myOpen][oppCiv][oppOpen] = (conditionalByOppCiv[myOpen][oppCiv][oppOpen] || 0) + 1;

    if (!conditionalByMapOppCiv[myOpen]) conditionalByMapOppCiv[myOpen] = {};
    if (!conditionalByMapOppCiv[myOpen][mapName]) conditionalByMapOppCiv[myOpen][mapName] = {};
    if (!conditionalByMapOppCiv[myOpen][mapName][oppCiv]) conditionalByMapOppCiv[myOpen][mapName][oppCiv] = {};
    conditionalByMapOppCiv[myOpen][mapName][oppCiv][oppOpen] = (conditionalByMapOppCiv[myOpen][mapName][oppCiv][oppOpen] || 0) + 1;
  }

  for (const [myOpen, byMap] of Object.entries(conditionalByMap)) {
    model.byMyOpeningMap[myOpen] = {};
    for (const [mapName, oppCounts] of Object.entries(byMap)) {
      model.byMyOpeningMap[myOpen][mapName] = buildDistributionFromCounts(oppCounts);
    }
  }

  for (const [myOpen, byCiv] of Object.entries(conditionalByOppCiv)) {
    model.byMyOpeningOppCiv[myOpen] = {};
    for (const [oppCiv, oppCounts] of Object.entries(byCiv)) {
      model.byMyOpeningOppCiv[myOpen][oppCiv] = buildDistributionFromCounts(oppCounts);
    }
  }

  for (const [myOpen, byMap] of Object.entries(conditionalByMapOppCiv)) {
    model.byMyOpeningMapOppCiv[myOpen] = {};
    for (const [mapName, byCiv] of Object.entries(byMap)) {
      model.byMyOpeningMapOppCiv[myOpen][mapName] = {};
      for (const [oppCiv, oppCounts] of Object.entries(byCiv)) {
        model.byMyOpeningMapOppCiv[myOpen][mapName][oppCiv] = buildDistributionFromCounts(oppCounts);
      }
    }
  }

  const unitEff = stats.unit_effectiveness || {};
  const sortedUnits = Object.entries(unitEff)
    .filter(([, d]) => d.matches >= 3)
    .sort((a, b) => b[1].wr - a[1].wr)
    .slice(0, 6)
    .map(([name, d]) => ({ unit: name, wr: d.wr, share: d.share }));
  model.suggestedCounters = sortedUnits;

  const MIN_SAMPLES = 3;

  model.predict = function predictOpponentResponse({ myOpening = null, map = null, opponentCiv = null, topN = 3 } = {}) {
    const out = { predictions: [], counters: model.suggestedCounters.slice(0, 6), source: 'global', confidence: 'low' };

    function totalSamples(dist) { return (dist || []).reduce((s, d) => s + d.count, 0); }

    if (!myOpening) {
      const sorted = Object.entries(model.globalOppOpenings).sort((a, b) => b[1] - a[1]).slice(0, topN);
      out.predictions = sorted.map(([op, pct]) => ({ opponent_opening: op, probability_pct: pct }));
      out.confidence = 'high';
      return out;
    }

    const branch = (cond, sourceLabel, dist) => {
      if (!cond || totalSamples(dist) < MIN_SAMPLES) return false;
      out.predictions = dist.slice(0, topN).map(d => ({ opponent_opening: d.opponent_opening, probability_pct: d.probability }));
      out.source = sourceLabel;
      const total = totalSamples(dist);
      out.confidence = total >= 10 ? 'high' : total >= 5 ? 'medium' : 'low';
      out.sample = total;
      return true;
    };

    if (branch(
      map && opponentCiv && model.byMyOpeningMapOppCiv[myOpening]?.[map]?.[opponentCiv],
      'opening+map+opponentCiv',
      model.byMyOpeningMapOppCiv[myOpening]?.[map]?.[opponentCiv]
    )) return out;

    if (branch(
      map && model.byMyOpeningMap[myOpening]?.[map],
      'opening+map',
      model.byMyOpeningMap[myOpening]?.[map]
    )) return out;

    if (branch(
      opponentCiv && model.byMyOpeningOppCiv[myOpening]?.[opponentCiv],
      'opening+opponentCiv',
      model.byMyOpeningOppCiv[myOpening]?.[opponentCiv]
    )) return out;

    if (branch(model.byMyOpening[myOpening], 'opening', model.byMyOpening[myOpening])) return out;

    const sorted = Object.entries(model.globalOppOpenings).sort((a, b) => b[1] - a[1]).slice(0, topN);
    out.predictions = sorted.map(([op, pct]) => ({ opponent_opening: op, probability_pct: pct }));
    return out;
  };

  return model;
}

function buildDistributionFromRecord(record) {
  const counts = {};
  for (const [oppOpen, rec] of Object.entries(record)) {
    counts[oppOpen] = (rec.wins || 0) + (rec.losses || 0);
  }
  return buildDistributionFromCounts(counts);
}

function buildDistributionFromCounts(counts) {
  const dist = [];
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  for (const [oppOpen, count] of Object.entries(counts)) {
    if (count < 1) continue;
    dist.push({ opponent_opening: oppOpen, count, probability: Math.round((count * 1000 / Math.max(1, total))) / 10 });
  }
  dist.sort((a, b) => b.count - a.count);
  return dist;
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
