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
    castleEco: buildCastleEco(stats),
    ageOrder: buildAgeOrder(stats),
    feudalAdvantage: buildFeudalAdvantage(stats),
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

// ---- Castle Eco Benchmarks (vills at Castle × resources) ----
function buildCastleEco(stats) {
  const cc = stats.castle_context || {};
  const w = cc.wins || {};
  const l = cc.losses || {};
  if (w.villagers == null || l.villagers == null) return null;

  // Aggregate: villagers grouped in brackets
  const data = stats.match_cross_data || [];
  const brackets = [
    { min: 0, max: 25, label: '<25 vills' },
    { min: 25, max: 32, label: '25–32 vills' },
    { min: 32, max: 40, label: '32–40 vills' },
    { min: 40, max: 999, label: '40+ vills' },
  ];

  // Need per-match vils at Castle to classify. We have aggregate (wins/loss arrays).
  // Use the aggregate averages as the primary insight, brackets as supplementary.
  const vilsW = Math.round(w.villagers);
  const vilsL = Math.round(l.villagers);
  const milW = Math.round(w.military);
  const milL = Math.round(l.military);
  const farmsW = Math.round(w.farms);
  const farmsL = Math.round(l.farms);
  const resW = Math.round(w.resources);
  const resL = Math.round(l.resources);

  if (vilsW === 0 && vilsL === 0) return null;

  return {
    wins: { vills: vilsW, military: milW, farms: farmsW, resources: resW },
    losses: { vills: vilsL, military: milL, farms: farmsL, resources: resL },
    vilDiff: vilsW - vilsL,
    milDiff: milW - milL,
    resDiff: resW - resL,
  };
}

// ---- Age-up Order vs Result ----
function buildAgeOrder(stats) {
  const data = stats.match_cross_data || [];
  if (data.length < 5) return null;

  let feudalFirst = { wins: 0, total: 0 };
  let castleFirst = { wins: 0, total: 0 };

  for (const m of data) {
    if (m.player_feudal != null && m.opponent_feudal != null) {
      feudalFirst.total++;
      if (m.player_feudal < m.opponent_feudal && m.won) feudalFirst.wins++;
      else if (m.player_feudal < m.opponent_feudal && !m.won) { /* loss when first */ }
      if (m.won) feudalFirst.wins++;
    }
    if (m.player_castle != null && m.opponent_castle != null) {
      castleFirst.total++;
      if (m.player_castle < m.opponent_castle && m.won) castleFirst.wins++;
      else if (m.player_castle < m.opponent_castle && !m.won) { /* loss */ }
      if (m.won) castleFirst.wins++;
    }
  }

  // Count matches where player reached age first AND won, vs first AND lost
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

  return {
    feudal: {
      first: { wins: feudalFirstWins, losses: feudalFirstLosses, total: feudalFirstTotal, wr: feudalFirstTotal > 0 ? Math.round((feudalFirstWins / feudalFirstTotal) * 100) : 0 },
      second: { wins: feudalSecondWins, losses: feudalSecondLosses, total: feudalSecondTotal, wr: feudalSecondTotal > 0 ? Math.round((feudalSecondWins / feudalSecondTotal) * 100) : 0 },
    },
    castle: {
      first: { wins: castleFirstWins, losses: castleFirstLosses, total: castleFirstTotal, wr: castleFirstTotal > 0 ? Math.round((castleFirstWins / castleFirstTotal) * 100) : 0 },
      second: { wins: castleSecondWins, losses: castleSecondLosses, total: castleSecondTotal, wr: castleSecondTotal > 0 ? Math.round((castleSecondWins / castleSecondTotal) * 100) : 0 },
    },
  };
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
