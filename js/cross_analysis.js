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
