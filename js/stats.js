import { fetchAnalysis } from './api.js';
import { parseGameJson, extractEarlyFeatures, computePlayerBaselines, classifyOpening, computePlayerPrimaryOpenings } from './analysis.js';
import { parseTimestamp, formatHms, average, CIV_CANONICAL_NAMES, sleep, isKeyTech, getTechCategory } from './utils.js';

const AGES = ['feudal', 'castle', 'imperial'];
const AGE_TECH_FILTER = ['feudal age', 'castle age', 'imperial age'];

export async function analyzeMatches(matches, playerId, playedCiv, opponentCiv, dataMainPlayer) {
  const stats = {
    total: matches.length,
    player_name: matches.length > 0 ? (matches[0].player_name || 'Unknown') : 'Unknown',
    victories: 0,
    map_counts: {},
    win_maps: {},
    lose_maps: {},
    age_times: { feudal: [], castle: [], imperial: [] },
    opp_age_times: { feudal: [], castle: [], imperial: [] },
    eapm: [],
    prefer_random: [],
    techs_after_age: { feudal: [], castle: [], imperial: [] },
    tech_times_after_age: { feudal: [], castle: [], imperial: [] },
    techs_top5_after_age: { feudal: [], castle: [], imperial: [] },
    techs_full_after_age: { feudal: [], castle: [], imperial: [] },
    map_played: {},
    map_win_percent: {},
    civ_played: {},
    market_resources_by_age: {
      feudal: { buy: {}, sell: {} },
      castle: { buy: {}, sell: {} },
      imperial: { buy: {}, sell: {} },
    },
    market_times_by_age: { feudal: [], castle: [], imperial: [] },
    analyzed: 0,
    skipped: 0,
    all_match_features: [],
  };

  const marketSums = {
    feudal: { buy: {}, sell: {} },
    castle: { buy: {}, sell: {} },
    imperial: { buy: {}, sell: {} },
  };
  const marketCounts = {
    feudal: { buy: {}, sell: {} },
    castle: { buy: {}, sell: {} },
    imperial: { buy: {}, sell: {} },
  };
  const techTimesGlobal = { feudal: {}, castle: {}, imperial: {} };
  const wheelBarrow = [];
  const handCart = [];
  const keyTechsData = {};
  const allMatchFeatures = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const matchId = match.match_id;
    const data = await fetchAnalysis(matchId);

    // delay entre requests de analisis para evitar rate limiting
    if (i < matches.length - 1) {
      await sleep(500);
    }

    if (!data) {
      stats.skipped++;
      continue;
    }

    const gameRecord = parseGameJson(data, playerId);
    const mePlayer = gameRecord.player || null;
    const oppPlayer = gameRecord.opponent || null;

    if (!mePlayer) {
      stats.skipped++;
      continue;
    }

    const features = extractEarlyFeatures(gameRecord);
    features.match_id = matchId;

    const meCiv = mePlayer.civilization || null;
    const meEapm = mePlayer.eapm || null;
    const mePreferRandom = mePlayer.preferRandom || null;
    const mapName = data.map?.name || data.map || match.map_name || null;
    const winner = !!(mePlayer.winner || false);

    const techs = mePlayer.queuedTechs || [];

    if (mapName && typeof mapName === 'string') {
      stats.map_played[mapName] = (stats.map_played[mapName] || 0) + 1;
      if (winner) {
        stats.win_maps[mapName] = (stats.win_maps[mapName] || 0) + 1;
      } else {
        stats.lose_maps[mapName] = (stats.lose_maps[mapName] || 0) + 1;
      }
    }

    const meUptimes = {};
    if (mePlayer.uptimes && Array.isArray(mePlayer.uptimes)) {
      for (const uptime of mePlayer.uptimes) {
        if (uptime.age && uptime.timestamp) {
          const ageKey = uptime.age.replace(/_age|age/g, '').toLowerCase();
          const seconds = parseTimestamp(uptime.timestamp);
          if (seconds !== null) {
            meUptimes[ageKey] = seconds;
            if (stats.age_times[ageKey]) stats.age_times[ageKey].push(seconds);
          }
        }
      }
    }
    if (!meUptimes.imperial && mePlayer.queuedTechs) {
      for (const t of mePlayer.queuedTechs) {
        if (t.unit && t.unit.toLowerCase() === 'imperial age' && t.timestamp) {
          const seconds = parseTimestamp(t.timestamp);
          if (seconds !== null) {
            meUptimes.imperial = seconds;
            stats.age_times.imperial.push(seconds);
          }
        }
      }
    }

    if (oppPlayer && oppPlayer.uptimes && Array.isArray(oppPlayer.uptimes)) {
      for (const uptime of oppPlayer.uptimes) {
        if (uptime.age && uptime.timestamp) {
          const ageKey = uptime.age.replace(/_age|age/g, '').toLowerCase();
          const seconds = parseTimestamp(uptime.timestamp);
          if (seconds !== null) {
            if (stats.opp_age_times[ageKey]) stats.opp_age_times[ageKey].push(seconds);
          }
        }
      }
    }
    if (oppPlayer && oppPlayer.queuedTechs) {
      for (const t of oppPlayer.queuedTechs) {
        if (t.unit && t.unit.toLowerCase() === 'imperial age' && t.timestamp) {
          const seconds = parseTimestamp(t.timestamp);
          if (seconds !== null) {
            stats.opp_age_times.imperial.push(seconds);
          }
        }
      }
    }

    // Wheelbarrow / Hand Cart absolute timings + key techs
    for (const t of techs) {
      if (!t.timestamp || !t.unit) continue;
      const tSec = parseTimestamp(t.timestamp);
      if (tSec === null) continue;
      const unit = t.unit;
      const canon = CIV_CANONICAL_NAMES[unit];
      if (canon === 'wheelbarrow') {
        wheelBarrow.push(tSec);
      }
      if (canon === 'hand_cart') {
        handCart.push(tSec);
      }
      if (isKeyTech(unit)) {
        if (!keyTechsData[unit]) keyTechsData[unit] = { count: 0, times: [] };
        keyTechsData[unit].count++;
        keyTechsData[unit].times.push(tSec);
      }
    }

    for (let idx = 0; idx < AGES.length; idx++) {
      const age = AGES[idx];
      if (meUptimes[age] != null) {
        const ageTime = meUptimes[age];
        const nextAgeTime = (idx < AGES.length - 1) ? meUptimes[AGES[idx + 1]] : null;
        const techsAfter = [];
        const techTimes = [];
        const techsFull = [];
        for (const t of techs) {
          if (t.timestamp && t.unit) {
            const tSec = parseTimestamp(t.timestamp);
            const unit = t.unit;
            if (tSec !== null && !AGE_TECH_FILTER.includes(unit.toLowerCase())) {
              const inRange = tSec > ageTime && (nextAgeTime === null || tSec < nextAgeTime);
              if (inRange) {
                techsAfter.push(unit);
                techTimes.push(tSec - ageTime);
                techsFull.push({ unit, time: tSec - ageTime, abs_time: tSec });
                if (!techTimesGlobal[age][unit]) techTimesGlobal[age][unit] = [];
                techTimesGlobal[age][unit].push(tSec - ageTime);
              }
            }
          }
        }
        stats.techs_after_age[age].push(techsAfter);
        stats.tech_times_after_age[age].push(techTimes);
        stats.techs_full_after_age[age].push(techsFull);
      }
    }

    for (const age of AGES) {
      const allTechs = {};
      const techTimesAbs = {};
      for (const arr of stats.techs_full_after_age[age]) {
        for (const techData of arr) {
          const tech = techData.unit;
          allTechs[tech] = (allTechs[tech] || 0) + 1;
          if (techData.abs_time != null) {
            if (!techTimesAbs[tech]) techTimesAbs[tech] = [];
            techTimesAbs[tech].push(techData.abs_time);
          }
        }
      }
      const sortedTechs = Object.entries(allTechs).sort((a, b) => b[1] - a[1]);
      stats.techs_top5_after_age[age] = sortedTechs.slice(0, 5).map(t => t[0]);
      stats.techs_top5_avg_time = stats.techs_top5_avg_time || {};
      stats.techs_top5_avg_time[age] = stats.techs_top5_avg_time[age] || {};
      for (const tech of stats.techs_top5_after_age[age]) {
        const times = techTimesAbs[tech] || [];
        stats.techs_top5_avg_time[age][tech] = times.length
          ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100
          : null;
      }
    }

    const marketUses = mePlayer.market || [];
    for (const mu of marketUses) {
      if (mu.timestamp && mu.type && mu.unit && mu.amount != null) {
        const marketSec = parseTimestamp(mu.timestamp);
        let marketAge = null;
        for (let idx = 0; idx < AGES.length; idx++) {
          const age = AGES[idx];
          if (meUptimes[age] != null) {
            const ageTime = meUptimes[age];
            const nextAgeTime = (idx < AGES.length - 1) ? meUptimes[AGES[idx + 1]] : null;
            const inRange = marketSec >= ageTime && (nextAgeTime === null || marketSec < nextAgeTime);
            if (inRange) {
              marketAge = age;
              break;
            }
          }
        }
        if (marketAge) {
          if (!stats.market_resources_by_age[marketAge][mu.type]) {
            stats.market_resources_by_age[marketAge][mu.type] = {};
          }
          stats.market_resources_by_age[marketAge][mu.type][mu.unit] =
            (stats.market_resources_by_age[marketAge][mu.type][mu.unit] || 0) + mu.amount;
          stats.market_times_by_age[marketAge].push(marketSec);
          if (!marketSums[marketAge][mu.type]) marketSums[marketAge][mu.type] = {};
          if (!marketCounts[marketAge][mu.type]) marketCounts[marketAge][mu.type] = {};
          marketSums[marketAge][mu.type][mu.unit] =
            (marketSums[marketAge][mu.type][mu.unit] || 0) + mu.amount;
          marketCounts[marketAge][mu.type][mu.unit] =
            (marketCounts[marketAge][mu.type][mu.unit] || 0) + 1;
        }
      }
    }

    stats.analyzed++;
    if (meEapm !== null) stats.eapm.push(meEapm);
    if (mePreferRandom !== null) stats.prefer_random.push(mePreferRandom ? 1 : 0);
    if (meCiv) {
      stats.civ_played[meCiv] = (stats.civ_played[meCiv] || 0) + 1;
    }

    allMatchFeatures.push(features);
  }

  const baselines = computePlayerBaselines(playerId, allMatchFeatures);
  stats.baselines = baselines;

  for (const features of allMatchFeatures) {
    features.opening = classifyOpening(features, baselines);
  }

  stats.all_match_features = allMatchFeatures;

  if (dataMainPlayer.match_id !== 'self' && allMatchFeatures.length > 0) {
    stats.current_opening = allMatchFeatures[0].opening;
  } else if (allMatchFeatures.length > 0) {
    stats.current_opening = allMatchFeatures[0].opening;
  } else {
    stats.current_opening = null;
  }

  for (const age of AGES) {
    stats['avg_' + age] = average(stats.age_times[age]);
    stats['avg_' + age + '_hms'] = stats['avg_' + age] !== null ? formatHms(stats['avg_' + age]) : 'N/A';
    stats['opp_avg_' + age] = average(stats.opp_age_times[age]);
    stats['opp_avg_' + age + '_hms'] = stats['opp_avg_' + age] !== null ? formatHms(stats['opp_avg_' + age]) : 'N/A';
    stats['avg_techs_after_' + age] = average(stats.techs_after_age[age].map(t => t.length));
    const allTechTimes = stats.tech_times_after_age[age].flat();
    stats['avg_tech_time_after_' + age] = average(allTechTimes);
  }

  stats.avg_eapm = average(stats.eapm);
  stats.percent_prefer_random = stats.prefer_random.length
    ? Math.round((stats.prefer_random.reduce((a, b) => a + b, 0) * 100) / stats.prefer_random.length * 100) / 100
    : null;

  const totalMaps = Object.values(stats.map_played).reduce((a, b) => a + b, 0);
  stats.map_played_percent = {};
  stats.map_win_percent = {};
  if (totalMaps > 0) {
    for (const [map, count] of Object.entries(stats.map_played)) {
      const winCount = stats.win_maps[map] || 0;
      stats.map_win_percent[map] = count ? Math.round((winCount * 100 / count) * 100) / 100 : 0;
      stats.map_played_percent[map] = Math.round((count * 100 / totalMaps) * 100) / 100;
    }
  }

  const totalCivs = Object.values(stats.civ_played).reduce((a, b) => a + b, 0);
  stats.civ_played_percent = {};
  for (const [civ, count] of Object.entries(stats.civ_played)) {
    if (count >= 2) {
      stats.civ_played_percent[civ] = totalCivs ? Math.round((count * 100 / totalCivs) * 100) / 100 : 0;
    }
  }

  const maxWins = Math.max(...Object.values(stats.win_maps), 0);
  if (maxWins > 0) {
    for (const [map, wins] of Object.entries(stats.win_maps)) {
      if (wins === maxWins) {
        stats.best_map = map;
        break;
      }
    }
  } else {
    stats.best_map = null;
  }

  stats.market_avg_by_age = {};
  for (const age of AGES) {
    stats.market_avg_by_age[age] = { buy: {}, sell: {} };
    for (const type of ['buy', 'sell']) {
      if (stats.market_resources_by_age[age][type]) {
        for (const [resource, total] of Object.entries(stats.market_resources_by_age[age][type])) {
          const count = marketCounts[age][type]?.[resource] || 0;
          const avg = count > 0 ? Math.round((total / count) * 100) / 100 : null;
          stats.market_avg_by_age[age][type][resource] = avg;
        }
      }
    }
  }

  stats.techs_first5_after_age = {};
  for (const age of AGES) {
    const allTechs = stats.techs_full_after_age[age].flat();
    allTechs.sort((a, b) => (a.abs_time || 0) - (b.abs_time || 0));
    stats.techs_first5_after_age[age] = allTechs.slice(0, 5);
  }

  stats.wheel_barrow_avg = wheelBarrow.length
    ? wheelBarrow.reduce((a, b) => a + b, 0) / wheelBarrow.length
    : null;
  stats.hand_cart_avg = handCart.length
    ? handCart.reduce((a, b) => a + b, 0) / handCart.length
    : null;

  stats.key_techs = {};
  const totalMatchesAnalyzed = stats.analyzed || 1;
  for (const [techName, data] of Object.entries(keyTechsData)) {
    const freq = Math.round((data.count * 100 / totalMatchesAnalyzed) * 100) / 100;
    if (freq < 10) continue;
    const avgTime = data.times.length
      ? Math.round((data.times.reduce((a, b) => a + b, 0) / data.times.length) * 100) / 100
      : null;
    stats.key_techs[techName] = {
      count: data.count,
      frequency: freq,
      avg_time: avgTime,
      category: getTechCategory(techName),
    };
  }

  return stats;
}
