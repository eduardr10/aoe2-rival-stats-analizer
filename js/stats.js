import { fetchAnalysis } from './api.js';
import { parseGameJson, extractEarlyFeatures, computePlayerBaselines, classifyOpening } from './analysis.js';
import { parseTimestamp, formatHms, average, CIV_CANONICAL_NAMES, sleep, isKeyTech, getTechCategory } from './utils.js';

const AGES = ['feudal', 'castle', 'imperial'];
const AGE_TECH_FILTER = ['feudal age', 'castle age', 'imperial age'];

const UNIT_CATEGORIES = {
  cavalry: ['scout_cavalry', 'knight', 'cavalier', 'paladin', 'camel_rider', 'heavy_camel_rider',
    'imperial_camel_rider', 'camel', 'savar',
    'battle_elephant', 'elite_battle_elephant', 'steppe_lancer', 'elite_steppe_lancer',
    'hussar', 'light_cavalry', 'winged_hussar', 'tarkan', 'elite_tarkan', 'konnik', 'keshik', 'leitis',
    'boyar', 'magyar_huszar', 'war_elephant', 'mameluke', 'cataphract',
    'shrivamsha_rider', 'sosso_guard', 'monaspa'],
  archers: ['archer', 'crossbowman', 'arbalester', 'skirmisher', 'elite_skirmisher',
    'cavalry_archer', 'heavy_cavalry_archer', 'hand_cannoneer', 'genoese_crossbowman',
    'plumed_archer', 'chu_ko_nu', 'longbowman', 'war_wagon', 'elephant_archer',
    'rattan_archer', 'arambai', 'genitour', 'elite_genitour', 'camel_archer', 'elite_camel_archer',
    'slinger'],
  infantry: ['militia', 'men-at-arms', 'long_swordsman', 'two-handed_swordsman', 'champion',
    'spearman', 'pikeman', 'halberdier', 'eagle_warrior', 'elite_eagle_warrior',
    'ghulam', 'teutonic_knight', 'berserk', 'jaguar_warrior', 'samurai', 'woad_raider',
    'throwing_axeman', 'huskarl', 'shotel_warrior', 'condottiero',
    'karambit_warrior', 'elite_karambit_warrior', 'serjeant', 'flemish_militia',
    'obuch', 'urumi_swordsman', 'elite_urumi_swordsman', 'chakram_thrower', 'elite_chakram_thrower'],
  siege: ['battering_ram', 'capped_ram', 'siege_ram', 'mangonel', 'onager', 'siege_onager',
    'scorpion', 'heavy_scorpion', 'bombard_cannon', 'trebuchet', 'siege_tower',
    'petard', 'flaming_camel', 'organ_gun', 'ballista_elephant', 'houfnice'],
};

function categorizeUnit(unitName) {
  if (!unitName) return 'other';
  const n = unitName.toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
  for (const [cat, units] of Object.entries(UNIT_CATEGORIES)) {
    if (units.includes(n)) return cat;
  }
  // Debug: log unidades no categorizadas para expandir la lista
  console.log('[unit debug] uncategorized:', unitName, '->', n);
  return 'other';
}

export async function analyzeMatches(matches, playerId, playedCiv, opponentCiv, dataMainPlayer, onProgress = null) {
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
    civ_win: {},
    civ_loss: {},
    market_resources_by_age: {
      feudal: { buy: {}, sell: {} },
      castle: { buy: {}, sell: {} },
      imperial: { buy: {}, sell: {} },
    },
    market_times_by_age: { feudal: [], castle: [], imperial: [] },
    market_transactions_by_age: { feudal: 0, castle: 0, imperial: 0 },
    analyzed: 0,
    skipped: 0,
    all_match_features: [],
    ladder_counts: {},  // { rm_1v1: 5, unranked: 8 }
    unit_categories: {},
    unit_categories_wins: {},
    unit_categories_losses: {},
    unit_stats: {},
    unit_upgrades: {},
    opp_unit_categories_wins: {},
    opp_unit_categories_losses: {},
    opp_openings: {},
    opp_openings_vs_result: { wins: {}, losses: {} },
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
  const wheelBarrowWins = [];
  const wheelBarrowLosses = [];
  const handCartWins = [];
  const handCartLosses = [];
  const keyTechsData = {};
  const tc2Times = [];
  const tc3Times = [];
  const allMatchFeatures = [];
  const allOppFeatures = [];

  // Unidades por periodo de edad
  const unitsByAgePeriod = {
    'pre-feudal': {},
    'pre-castle': {},
    'pre-imperial': {},
  };

  // Unidades individuales (todas las categorías)
  const unitStats = {};

  // Mejoras de unidades (forja, armor, etc.)
  const UNIT_UPGRADES = [
    'forging', 'iron casting', 'blast furnace',
    'scale mail armor', 'chain mail armor', 'plate mail armor',
    'scale barding armor', 'chain barding armor', 'plate barding armor',
    'padded archer armor', 'leather archer armor', 'ring archer armor',
    'fletching', 'bodkin arrow', 'bracer',
    'bloodlines', 'husbandry',
    'thumb ring', 'ballistics', 'chemistry',
    'siege engineers',
  ];
  const unitUpgrades = {};

  // Contexto de techs: unidades presentes al investigar
  const techContextData = {
    'wheelbarrow': { unitTypes: ['villager'], values: [] },
    'hand cart': { unitTypes: ['villager'], values: [] },
    'fletching': { unitTypes: ['archer'], values: [] },
    'bodkin arrow': { unitTypes: ['archer', 'crossbowman'], values: [] },
    'bloodlines': { unitTypes: ['scout_cavalry'], values: [] },
    'scale barding armor': { unitTypes: ['knight', 'scout_cavalry', 'light_cavalry'], values: [] },
    'forging': { unitTypes: ['militia', 'men-at-arms', 'spearman', 'scout_cavalry', 'knight'], values: [] },
    'iron casting': { unitTypes: ['militia', 'men-at-arms', 'long_swordsman', 'knight', 'cavalier'], values: [] },
  };

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const matchId = match.match_id;
    const { data, fromCache } = await fetchAnalysis(matchId);

    if (!fromCache && i < matches.length - 1) await sleep(500);

    if (!data) { stats.skipped++; continue; }

    const gameRecord = parseGameJson(data, playerId);
    const mePlayer = gameRecord.player || null;
    const oppPlayer = gameRecord.opponent || null;

    if (!mePlayer) { stats.skipped++; continue; }

    const features = extractEarlyFeatures(gameRecord.player);
    const oppFeatures = extractEarlyFeatures(gameRecord.opponent);
    features.match_id = matchId;

    const meCiv = mePlayer.civilization || null;
    const meEapm = mePlayer.eapm || null;
    const mePreferRandom = mePlayer.preferRandom || null;
    const mapName = data.map?.name || data.map || match.map_name || null;
    const winner = !!(mePlayer.winner || false);

    const techs = mePlayer.queuedTechs || [];

    // Parse uptimes PRIMERO (lo necesitamos para clasificar unidades por edad)
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

    // Unidades por categoría + individuales
    const queuedUnits = mePlayer.queuedUnits || [];
    const matchCategories = new Set();
    const matchUnits = new Set();
    for (const u of queuedUnits) {
      if (!u.unit) continue;
      const unitName = u.unit.toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
      const amount = u.amount || 1;
      const cat = categorizeUnit(u.unit);

      // Categoría
      if (cat !== 'other') {
        matchCategories.add(cat);
        stats.unit_categories[cat] = (stats.unit_categories[cat] || 0) + amount;
      }

      // Individual
      if (!unitStats[unitName]) {
        unitStats[unitName] = { total: 0, matches: 0, wins: 0, losses: 0 };
      }
      unitStats[unitName].total += amount;
      matchUnits.add(unitName);
    }
    for (const cat of matchCategories) {
      if (winner) {
        stats.unit_categories_wins[cat] = (stats.unit_categories_wins[cat] || 0) + 1;
      } else {
        stats.unit_categories_losses[cat] = (stats.unit_categories_losses[cat] || 0) + 1;
      }
    }
    for (const unitName of matchUnits) {
      unitStats[unitName].matches++;
      if (winner) unitStats[unitName].wins++;
      else unitStats[unitName].losses++;
    }

    // Unidades por periodo de edad
    const matchUnitsByPeriod = { 'pre-feudal': new Set(), 'pre-castle': new Set(), 'pre-imperial': new Set() };
    for (const u of queuedUnits) {
      if (!u.unit || !u.timestamp) continue;
      const uSec = parseTimestamp(u.timestamp);
      if (uSec === null) continue;
      const unitName = u.unit.toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
      const amount = u.amount || 1;

      let period = null;
      if (meUptimes.feudal != null && uSec < meUptimes.feudal) {
        period = 'pre-feudal';
      } else if (meUptimes.castle != null && uSec < meUptimes.castle) {
        period = 'pre-castle';
      } else if (meUptimes.imperial != null && uSec < meUptimes.imperial) {
        period = 'pre-imperial';
      }

      if (period) {
        if (!unitsByAgePeriod[period][unitName]) {
          unitsByAgePeriod[period][unitName] = { total: 0, matches: 0 };
        }
        unitsByAgePeriod[period][unitName].total += amount;
        matchUnitsByPeriod[period].add(unitName);
      }
    }
    for (const period of Object.keys(matchUnitsByPeriod)) {
      for (const unitName of matchUnitsByPeriod[period]) {
        unitsByAgePeriod[period][unitName].matches++;
      }
    }

    if (mapName && typeof mapName === 'string') {
      stats.map_played[mapName] = (stats.map_played[mapName] || 0) + 1;
      if (winner) stats.win_maps[mapName] = (stats.win_maps[mapName] || 0) + 1;
      else stats.lose_maps[mapName] = (stats.lose_maps[mapName] || 0) + 1;
    }

    // TCs post-castle (2do y 3er)
    if (meUptimes.castle != null && mePlayer.events) {
      const tcEvents = mePlayer.events
        .filter(e => e.type === 'building' && e.name === 'town_center' && e.time > meUptimes.castle)
        .sort((a, b) => a.time - b.time);
      if (tcEvents.length >= 1 && tcEvents[0]) tc2Times.push(tcEvents[0].time);
      if (tcEvents.length >= 2 && tcEvents[1]) tc3Times.push(tcEvents[1].time);
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
          if (seconds !== null) stats.opp_age_times.imperial.push(seconds);
        }
      }
    }

    // --- Oponente: categorías de unidades ---
    if (oppPlayer && oppPlayer.queuedUnits) {
      const oppCategories = new Set();
      for (const u of oppPlayer.queuedUnits) {
        if (!u.unit) continue;
        const cat = categorizeUnit(u.unit);
        if (cat !== 'other') {
          oppCategories.add(cat);
        }
      }
      for (const cat of oppCategories) {
        if (winner) {
          stats.opp_unit_categories_wins[cat] = (stats.opp_unit_categories_wins[cat] || 0) + 1;
        } else {
          stats.opp_unit_categories_losses[cat] = (stats.opp_unit_categories_losses[cat] || 0) + 1;
        }
      }
    }

    // Guardar oppFeatures para clasificación posterior
    allOppFeatures.push({ features: oppFeatures, winner });

    for (const t of techs) {
      if (!t.timestamp || !t.unit) continue;
      const tSec = parseTimestamp(t.timestamp);
      if (tSec === null) continue;
      const unit = t.unit;
      const canon = CIV_CANONICAL_NAMES[unit];
      if (canon === 'wheelbarrow') {
        if (winner) wheelBarrowWins.push(tSec); else wheelBarrowLosses.push(tSec);
      }
      if (canon === 'hand_cart') {
        if (winner) handCartWins.push(tSec); else handCartLosses.push(tSec);
      }
      if (isKeyTech(unit)) {
        if (!keyTechsData[unit]) keyTechsData[unit] = { count: 0, times: [] };
        keyTechsData[unit].count++;
        keyTechsData[unit].times.push(tSec);
      }

      // Mejoras de unidades
      if (UNIT_UPGRADES.includes(unit.toLowerCase())) {
        if (!unitUpgrades[unit]) unitUpgrades[unit] = { count: 0, wins: 0, losses: 0 };
        unitUpgrades[unit].count++;
        if (winner) unitUpgrades[unit].wins++;
        else unitUpgrades[unit].losses++;
      }

      // Contexto: unidades presentes al investigar esta tech
      const techKey = unit.toLowerCase();
      if (techContextData[techKey]) {
        let unitCount = 0;
        for (const u of queuedUnits) {
          if (!u.unit || !u.timestamp) continue;
          const uSec = parseTimestamp(u.timestamp);
          if (uSec === null || uSec > tSec) continue;
          const queuedUnit = u.unit.toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
          if (techContextData[techKey].unitTypes.includes(queuedUnit)) {
            unitCount += u.amount || 1;
          }
        }
        techContextData[techKey].values.push(unitCount);
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
            if (inRange) { marketAge = age; break; }
          }
        }
        if (marketAge) {
          if (!stats.market_resources_by_age[marketAge][mu.type]) {
            stats.market_resources_by_age[marketAge][mu.type] = {};
          }
          stats.market_resources_by_age[marketAge][mu.type][mu.unit] =
            (stats.market_resources_by_age[marketAge][mu.type][mu.unit] || 0) + mu.amount;
          stats.market_times_by_age[marketAge].push(marketSec);
          stats.market_transactions_by_age[marketAge]++;
          if (!marketSums[marketAge][mu.type]) marketSums[marketAge][mu.type] = {};
          if (!marketCounts[marketAge][mu.type]) marketCounts[marketAge][mu.type] = {};
          marketSums[marketAge][mu.type][mu.unit] = (marketSums[marketAge][mu.type][mu.unit] || 0) + mu.amount;
          marketCounts[marketAge][mu.type][mu.unit] = (marketCounts[marketAge][mu.type][mu.unit] || 0) + 1;
        }
      }
    }

    stats.analyzed++;
    const lb = match.leaderboard || 'unknown';
    stats.ladder_counts[lb] = (stats.ladder_counts[lb] || 0) + 1;

    if (onProgress) {
      onProgress({ current: i + 1, total: matches.length, matchId, fromCache });
    }

    if (meEapm !== null) stats.eapm.push(meEapm);
    if (mePreferRandom !== null) stats.prefer_random.push(mePreferRandom ? 1 : 0);
    if (meCiv) {
      stats.civ_played[meCiv] = (stats.civ_played[meCiv] || 0) + 1;
      if (winner) {
        stats.civ_win[meCiv] = (stats.civ_win[meCiv] || 0) + 1;
      } else {
        stats.civ_loss[meCiv] = (stats.civ_loss[meCiv] || 0) + 1;
      }
    }

    allMatchFeatures.push(features);
  }

  const baselines = computePlayerBaselines(playerId, allMatchFeatures);
  stats.baselines = baselines;
  for (const features of allMatchFeatures) features.opening = classifyOpening(features, baselines);
  stats.all_match_features = allMatchFeatures;

  // Clasificar openings del oponente usando los mismos baselines
  for (const opp of allOppFeatures) {
    const oppOpening = classifyOpening(opp.features, baselines);
    stats.opp_openings[oppOpening] = (stats.opp_openings[oppOpening] || 0) + 1;
    // resultKey = our player's result when rival played this opening
    const resultKey = opp.winner ? 'wins' : 'losses';
    stats.opp_openings_vs_result[resultKey][oppOpening] = (stats.opp_openings_vs_result[resultKey][oppOpening] || 0) + 1;
  }

  if (allMatchFeatures.length > 0) {
    stats.current_opening = allMatchFeatures[0].opening;
  } else {
    stats.current_opening = null;
  }

  for (const age of AGES) {
    stats['avg_' + age] = average(stats.age_times[age]);
    stats['avg_' + age + '_hms'] = stats['avg_' + age] !== null ? formatHms(stats['avg_' + age]) : 'N/A';
    stats['opp_avg_' + age] = average(stats.opp_age_times[age]);
    stats['opp_avg_' + age + '_hms'] = stats['opp_avg_' + age] !== null ? formatHms(stats['opp_avg_' + age]) : 'N/A';
  }

  stats.avg_eapm = average(stats.eapm);

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
  stats.civ_win_percent = {};
  for (const [civ, count] of Object.entries(stats.civ_played)) {
    if (count >= 2) {
      stats.civ_played_percent[civ] = totalCivs ? Math.round((count * 100 / totalCivs) * 100) / 100 : 0;
      const wins = stats.civ_win[civ] || 0;
      stats.civ_win_percent[civ] = count ? Math.round((wins * 100 / count) * 100) / 100 : 0;
    }
  }

  stats.market_avg_by_age = {};
  stats.market_totals_by_age = {};
  for (const age of AGES) {
    stats.market_avg_by_age[age] = { buy: {}, sell: {} };
    stats.market_totals_by_age[age] = { buy: {}, sell: {} };
    for (const type of ['buy', 'sell']) {
      if (stats.market_resources_by_age[age][type]) {
        for (const [resource, total] of Object.entries(stats.market_resources_by_age[age][type])) {
          const count = marketCounts[age][type]?.[resource] || 0;
          const avg = count > 0 ? Math.round((total / count) * 100) / 100 : null;
          stats.market_avg_by_age[age][type][resource] = avg;
          stats.market_totals_by_age[age][type][resource] = total;
        }
      }
    }
  }

  const avgArr = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  stats.wheel_barrow_avg = avgArr([...wheelBarrowWins, ...wheelBarrowLosses]);
  stats.wheel_barrow_win_avg = avgArr(wheelBarrowWins);
  stats.wheel_barrow_loss_avg = avgArr(wheelBarrowLosses);
  stats.hand_cart_avg = avgArr([...handCartWins, ...handCartLosses]);
  stats.hand_cart_win_avg = avgArr(handCartWins);
  stats.hand_cart_loss_avg = avgArr(handCartLosses);

  stats.tc2_time_avg = tc2Times.length ? tc2Times.reduce((a, b) => a + b, 0) / tc2Times.length : null;
  stats.tc3_time_avg = tc3Times.length ? tc3Times.reduce((a, b) => a + b, 0) / tc3Times.length : null;
  stats.tc2_pct = stats.analyzed > 0 ? Math.round((tc2Times.length * 100 / stats.analyzed) * 100) / 100 : null;
  stats.tc3_pct = stats.analyzed > 0 ? Math.round((tc3Times.length * 100 / stats.analyzed) * 100) / 100 : null;

  // Normalize unit_categories to objects with count + avg per game
  const normalizedUnitCats = {};
  const analyzedGames = stats.analyzed || 1;
  for (const [cat, count] of Object.entries(stats.unit_categories)) {
    normalizedUnitCats[cat] = { count, avg: Math.round((count / analyzedGames) * 100) / 100 };
  }
  stats.unit_categories = normalizedUnitCats;

  stats.tc_timing = {
    tc2_avg_hms: stats.tc2_time_avg != null ? formatHms(stats.tc2_time_avg) : 'N/A',
    tc3_avg_hms: stats.tc3_time_avg != null ? formatHms(stats.tc3_time_avg) : 'N/A',
    tc2_pct: stats.tc2_pct || 0,
    tc3_pct: stats.tc3_pct || 0,
  };

  // Boom tendency based on FC % and TC count
  const fcFreq = stats.all_match_features ? 
    stats.all_match_features.filter(f => f.opening?.chosen_opening === 'fast_castle').length : 0;
  const totalFeatures = stats.all_match_features?.length || 1;
  const fcPct = (fcFreq * 100 / totalFeatures);
  if (fcPct >= 40 || (stats.tc3_pct && stats.tc3_pct > 20)) {
    stats.boom_tendency = 'High (FC + multi-TC)';
  } else if (fcPct >= 20 || (stats.tc2_pct && stats.tc2_pct > 50)) {
    stats.boom_tendency = 'Medium';
  } else {
    stats.boom_tendency = 'Low (aggression focused)';
  }

  stats.key_techs = {};
  const totalMatchesAnalyzed = stats.analyzed || 1;
  for (const [techName, data] of Object.entries(keyTechsData)) {
    const freq = Math.round((data.count * 100 / totalMatchesAnalyzed) * 100) / 100;
    if (freq < 10) continue;
    const avgTime = data.times.length ? Math.round((data.times.reduce((a, b) => a + b, 0) / data.times.length) * 100) / 100 : null;
    stats.key_techs[techName] = {
      count: data.count,
      frequency: freq,
      avg_time: avgTime,
      category: getTechCategory(techName),
    };
  }

  // --- Core tech timings grouped by category ---
  stats.core_tech_timings = {
    wood: {}, farm: {}, blacksmith: {}, archery_range: {}, barracks: {}, stable: {}, university: {}, other: {},
  };
  for (const [techName, data] of Object.entries(stats.key_techs)) {
    const cat = data.category || 'other';
    const target = stats.core_tech_timings[cat] || stats.core_tech_timings.other;
    target[techName] = { avg_time: data.avg_time, frequency: data.frequency };
  }

  // --- Unidades por periodo de edad ---
  stats.units_by_age_period = {};
  for (const [period, units] of Object.entries(unitsByAgePeriod)) {
    const sorted = Object.entries(units)
      .sort((a, b) => b[1].total - a[1].total)
      .reduce((obj, [unitName, data]) => {
        obj[unitName] = { total: data.total, matches: data.matches, avg: Math.round((data.total / data.matches) * 100) / 100 };
        return obj;
      }, {});
    stats.units_by_age_period[period] = sorted;
  }

  // --- Unidades individuales (todas las categorías) ---
  stats.unit_stats = {};
  const sortedUnits = Object.entries(unitStats)
    .sort((a, b) => b[1].total - a[1].total);
  for (const [unitName, data] of sortedUnits) {
    stats.unit_stats[unitName] = {
      total: data.total,
      matches: data.matches,
      avg: Math.round((data.total / data.matches) * 100) / 100,
      wins: data.wins,
      losses: data.losses,
      wr: data.matches > 0 ? Math.round((data.wins * 100 / data.matches) * 100) / 100 : 0,
    };
  }

  // --- Mejoras de unidades ---
  stats.unit_upgrades = {};
  const sortedUpgrades = Object.entries(unitUpgrades)
    .sort((a, b) => b[1].count - a[1].count);
  for (const [upgradeName, data] of sortedUpgrades) {
    const games = data.wins + data.losses;
    stats.unit_upgrades[upgradeName] = {
      count: data.count,
      wins: data.wins,
      losses: data.losses,
      wr: games > 0 ? Math.round((data.wins * 100 / games) * 100) / 100 : 0,
    };
  }

  // --- Contexto de techs (unidades presentes al investigar) ---
  stats.tech_context = {};
  for (const [techKey, ctx] of Object.entries(techContextData)) {
    if (ctx.values.length === 0) continue;
    const avg = Math.round((ctx.values.reduce((a, b) => a + b, 0) / ctx.values.length) * 100) / 100;
    stats.tech_context[techKey] = {
      unit_types: ctx.unitTypes,
      avg_count: avg,
      samples: ctx.values.length,
    };
  }

  return stats;
}
