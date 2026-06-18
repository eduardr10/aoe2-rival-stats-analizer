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
    'shrivamsha_rider', 'sosso_guard', 'monaspa',
    'bolas_rider', 'elite_bolas_rider'],
  archers: ['archer', 'crossbowman', 'arbalester', 'skirmisher', 'elite_skirmisher',
    'cavalry_archer', 'heavy_cavalry_archer', 'hand_cannoneer', 'genoese_crossbowman',
    'plumed_archer', 'chu_ko_nu', 'longbowman', 'war_wagon', 'elephant_archer',
    'rattan_archer', 'arambai', 'genitour', 'elite_genitour', 'camel_archer', 'elite_camel_archer',
    'slinger', 'blackwood_archer', 'elite_blackwood_archer'],
  infantry: ['militia', 'men-at-arms', 'long_swordsman', 'two-handed_swordsman', 'champion',
    'spearman', 'pikeman', 'halberdier', 'eagle_warrior', 'elite_eagle_warrior',
    'ghulam', 'teutonic_knight', 'berserk', 'jaguar_warrior', 'samurai', 'woad_raider',
    'throwing_axeman', 'huskarl', 'shotel_warrior', 'condottiero',
    'karambit_warrior', 'elite_karambit_warrior', 'serjeant', 'flemish_militia',
    'obuch', 'urumi_swordsman', 'elite_urumi_swordsman', 'chakram_thrower', 'elite_chakram_thrower',
    'champi_scout', 'champi_runner', 'champi_warrior', 'elite_champi_warrior',
    'kona', 'elite_kona', 'temple_guard', 'elite_temple_guard', 'guecha_warrior', 'elite_guecha_warrior',
    'ibirapema_warrior', 'elite_ibirapema_warrior'],
  siege: ['battering_ram', 'capped_ram', 'siege_ram', 'mangonel', 'onager', 'siege_onager',
    'scorpion', 'heavy_scorpion', 'bombard_cannon', 'trebuchet', 'siege_tower',
    'petard', 'flaming_camel', 'organ_gun', 'ballista_elephant', 'houfnice',
    'catapult_galleon'],
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
    age_times_wins: { feudal: [], castle: [], imperial: [] },
    age_times_losses: { feudal: [], castle: [], imperial: [] },
    opp_age_times: { feudal: [], castle: [], imperial: [] },
    eapm: [],
    eapm_wins: [],
    eapm_losses: [],
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
    opp_civ_stats: {},  // { civ: { wins: n, losses: n } }
    key_techs_wins: {},
    key_techs_losses: {},
    unit_cat_match_totals_wins: {},
    unit_cat_match_totals_losses: {},
    opening_map_wr: {},
    opening_civ_wr: {},
    // Opponent-derived: what do rivals do when we win vs lose?
    opp_age_times_wins: { feudal: [], castle: [], imperial: [] },
    opp_age_times_losses: { feudal: [], castle: [], imperial: [] },
    opp_key_techs_wins: {},
    opp_key_techs_losses: {},
    opp_unit_cat_match_totals_wins: {},
    opp_unit_cat_match_totals_losses: {},
    opp_unit_stats_wins: {},
    opp_unit_stats_losses: {},
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
  const matchMeta = []; // { mapName, meCiv, winner } per match

  // Early pressure tracking
  const earlyPressureWins = []; // military/villager ratio before 10 min
  const earlyPressureLosses = [];
  const midPressureWins = []; // military/villager ratio before 15 min
  const midPressureLosses = [];

  // Total military unit counts by result (for APM efficiency)
  let totalMilitaryUnitsWins = 0;
  let totalMilitaryUnitsLosses = 0;

  // Time-series aggregation
  const MAX_TIMELINE_MIN = 60;
  function makeTimelineBuckets() {
    const arr = [];
    for (let i = 0; i <= MAX_TIMELINE_MIN; i++) arr.push([]);
    return arr;
  }
  const apmCurveWins = makeTimelineBuckets();
  const apmCurveLosses = makeTimelineBuckets();
  const resourcesCurveWins = makeTimelineBuckets();
  const resourcesCurveLosses = makeTimelineBuckets();
  const objectsCurveWins = makeTimelineBuckets();
  const objectsCurveLosses = makeTimelineBuckets();

  // Age-up snapshots: resources & objects at the moment of reaching each age
  const ageSnapshotsWins = { feudal: [], castle: [], imperial: [] };
  const ageSnapshotsLosses = { feudal: [], castle: [], imperial: [] };

  // Peak values
  const apmPeaksWins = [];
  const apmPeaksLosses = [];
  const resourcePeaksWins = [];
  const resourcePeaksLosses = [];
  const objectPeaksWins = [];
  const objectPeaksLosses = [];

  // Opponent time-series for comparison
  const oppApmCurve = makeTimelineBuckets();
  const oppResourcesCurve = makeTimelineBuckets();
  const oppObjectsCurve = makeTimelineBuckets();
  const oppAgeSnapshots = { feudal: [], castle: [], imperial: [] };

  // Build-order first-occurrence tracking
  const KEY_BUILDINGS = ['barracks', 'archery_range', 'stable', 'blacksmith', 'market', 'siege_workshop', 'monastery', 'university'];
  const KEY_TECHS = ['loom', 'feudal_age', 'castle_age', 'imperial_age', 'wheelbarrow', 'hand_cart', 'double-bit_axe', 'horse_collar', 'bow_saw', 'heavy_plow', 'fletching', 'padded_archer_armor', 'forging', 'scale_barding_armor', 'scale_mail_armor'];
  function makeFirstOccurrenceTracker() {
    return {
      buildings: Object.fromEntries(KEY_BUILDINGS.map(b => [b, { times: [] }])),
      techs: Object.fromEntries(KEY_TECHS.map(t => [t, { times: [] }])),
    };
  }
  const boTrackerWins = makeFirstOccurrenceTracker();
  const boTrackerLosses = makeFirstOccurrenceTracker();
  const boTrackerOpp = makeFirstOccurrenceTracker();

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

    // Track opponent civ win/loss
    const oppCiv = oppPlayer?.civilization || null;
    if (oppCiv) {
      const canon = CIV_CANONICAL_NAMES[oppCiv.toLowerCase()] || oppCiv;
      if (!stats.opp_civ_stats[canon]) stats.opp_civ_stats[canon] = { wins: 0, losses: 0 };
      if (winner) stats.opp_civ_stats[canon].wins++;
      else stats.opp_civ_stats[canon].losses++;
    }

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
            if (winner) stats.age_times_wins[ageKey].push(seconds);
            else stats.age_times_losses[ageKey].push(seconds);
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
            if (winner) stats.age_times_wins.imperial.push(seconds);
            else stats.age_times_losses.imperial.push(seconds);
          }
        }
      }
    }

    // Unidades por categoría + individuales
    const queuedUnits = mePlayer.queuedUnits || [];
    const matchCategories = new Set();
    const matchUnits = new Set();
    const matchCatTotals = {};
    for (const u of queuedUnits) {
      if (!u.unit) continue;
      const unitName = u.unit.toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
      const amount = u.amount || 1;
      const cat = categorizeUnit(u.unit);

      // Categoría
      if (cat !== 'other') {
        matchCategories.add(cat);
        stats.unit_categories[cat] = (stats.unit_categories[cat] || 0) + amount;
        matchCatTotals[cat] = (matchCatTotals[cat] || 0) + amount;
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
    // Guardar totales por categoría de esta partida (wins/losses)
    const targetCatTotals = winner ? stats.unit_cat_match_totals_wins : stats.unit_cat_match_totals_losses;
    for (const [cat, total] of Object.entries(matchCatTotals)) {
      if (!targetCatTotals[cat]) targetCatTotals[cat] = [];
      targetCatTotals[cat].push(total);
    }

    // Early pressure ratios by result
    let earlyMilitary = 0;
    let earlyVillagers = 0;
    let midMilitary = 0;
    let midVillagers = 0;
    let matchMilitaryTotal = 0;
    for (const u of queuedUnits) {
      if (!u.unit || !u.timestamp) continue;
      const uSec = parseTimestamp(u.timestamp);
      if (uSec === null) continue;
      const rawName = u.unit.toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
      const amount = u.amount || 1;
      const isVillager = rawName === 'villager';
      if (!isVillager) matchMilitaryTotal += amount;
      if (uSec <= 600) {
        if (isVillager) earlyVillagers += amount;
        else earlyMilitary += amount;
      }
      if (uSec <= 900) {
        if (isVillager) midVillagers += amount;
        else midMilitary += amount;
      }
    }
    const earlyRatio = earlyMilitary / Math.max(1, earlyVillagers);
    const midRatio = midMilitary / Math.max(1, midVillagers);
    if (winner) {
      earlyPressureWins.push(earlyRatio);
      midPressureWins.push(midRatio);
      totalMilitaryUnitsWins += matchMilitaryTotal;
    } else {
      earlyPressureLosses.push(earlyRatio);
      midPressureLosses.push(midRatio);
      totalMilitaryUnitsLosses += matchMilitaryTotal;
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

    // --- Oponente: tiempos de edad ---
    const oppUptimes = {};
    if (oppPlayer && oppPlayer.uptimes && Array.isArray(oppPlayer.uptimes)) {
      for (const uptime of oppPlayer.uptimes) {
        if (uptime.age && uptime.timestamp) {
          const ageKey = uptime.age.replace(/_age|age/g, '').toLowerCase();
          const seconds = parseTimestamp(uptime.timestamp);
          if (seconds !== null) {
            oppUptimes[ageKey] = seconds;
            if (stats.opp_age_times[ageKey]) stats.opp_age_times[ageKey].push(seconds);
            const targetOppAge = winner ? stats.opp_age_times_wins : stats.opp_age_times_losses;
            targetOppAge[ageKey].push(seconds);
          }
        }
      }
    }
    if (oppPlayer && oppPlayer.queuedTechs) {
      for (const t of oppPlayer.queuedTechs) {
        if (t.unit && t.unit.toLowerCase() === 'imperial age' && t.timestamp) {
          const seconds = parseTimestamp(t.timestamp);
          if (seconds !== null) {
            oppUptimes.imperial = seconds;
            stats.opp_age_times.imperial.push(seconds);
            const targetOppAge = winner ? stats.opp_age_times_wins : stats.opp_age_times_losses;
            targetOppAge.imperial.push(seconds);
          }
        }
      }
    }

    // --- Oponente: categorías de unidades + específicas ---
    const oppMatchCatTotals = {};
    const oppMatchUnitTotals = {};
    if (oppPlayer && oppPlayer.queuedUnits) {
      const oppCategories = new Set();
      for (const u of oppPlayer.queuedUnits) {
        if (!u.unit) continue;
        const cat = categorizeUnit(u.unit);
        const unitName = u.unit.toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
        const amount = u.amount || 1;
        if (cat !== 'other') {
          oppCategories.add(cat);
          oppMatchCatTotals[cat] = (oppMatchCatTotals[cat] || 0) + amount;
        }
        // Track specific units for opponent
        const keyUnits = ['scout_cavalry', 'archer', 'knight', 'militia', 'skirmisher', 'spearman'];
        if (keyUnits.includes(unitName)) {
          oppMatchUnitTotals[unitName] = (oppMatchUnitTotals[unitName] || 0) + amount;
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
    // Store opponent per-match category totals by our result
    const targetOppCat = winner ? stats.opp_unit_cat_match_totals_wins : stats.opp_unit_cat_match_totals_losses;
    for (const [cat, total] of Object.entries(oppMatchCatTotals)) {
      if (!targetOppCat[cat]) targetOppCat[cat] = [];
      targetOppCat[cat].push(total);
    }
    // Store opponent per-match specific unit totals by our result
    const targetOppUnit = winner ? stats.opp_unit_stats_wins : stats.opp_unit_stats_losses;
    for (const [unit, total] of Object.entries(oppMatchUnitTotals)) {
      if (!targetOppUnit[unit]) targetOppUnit[unit] = [];
      targetOppUnit[unit].push(total);
    }

    // --- Oponente: key techs ---
    if (oppPlayer && oppPlayer.queuedTechs) {
      for (const t of oppPlayer.queuedTechs) {
        if (!t.timestamp || !t.unit) continue;
        const tSec = parseTimestamp(t.timestamp);
        if (tSec === null) continue;
        if (isKeyTech(t.unit)) {
          const targetOppTech = winner ? stats.opp_key_techs_wins : stats.opp_key_techs_losses;
          if (!targetOppTech[t.unit]) targetOppTech[t.unit] = [];
          targetOppTech[t.unit].push(tSec);
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
        const targetTech = winner ? stats.key_techs_wins : stats.key_techs_losses;
        if (!targetTech[unit]) targetTech[unit] = [];
        targetTech[unit].push(tSec);
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

    if (meEapm !== null) {
      stats.eapm.push(meEapm);
      if (winner) stats.eapm_wins.push(meEapm);
      else stats.eapm_losses.push(meEapm);
    }
    // ============================================================================
    // BUILD ORDER FIRST-OCCURRENCE TRACKING
    // ============================================================================
    function recordFirst(events, names, tracker) {
      const seen = new Set();
      for (const ev of events) {
        if (!names.includes(ev.name)) continue;
        if (seen.has(ev.name)) continue;
        seen.add(ev.name);
        tracker[ev.name].times.push(ev.time);
      }
    }

    const targetBo = winner ? boTrackerWins : boTrackerLosses;
    recordFirst(mePlayer.events || [], KEY_BUILDINGS, targetBo.buildings);
    recordFirst(mePlayer.events || [], KEY_TECHS, targetBo.techs);
    if (oppPlayer && oppPlayer.events) {
      recordFirst(oppPlayer.events, KEY_BUILDINGS, boTrackerOpp.buildings);
      recordFirst(oppPlayer.events, KEY_TECHS, boTrackerOpp.techs);
    }

    // ============================================================================
    // TIME-SERIES EXTRACTION (APM, resources, objects)
    // ============================================================================
    function sampleTimeseries(curve, targetMinutes) {
      // For each target minute, find the closest sample
      const result = {};
      for (const min of targetMinutes) {
        const targetSec = min * 60;
        let best = null;
        let bestDiff = Infinity;
        for (const pt of curve) {
          const diff = Math.abs(pt.time - targetSec);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = pt;
          }
        }
        if (best) result[min] = best;
      }
      return result;
    }

    function extractSnapshot(curve, targetSec) {
      if (!curve || curve.length === 0 || targetSec == null) return null;
      // Find sample just before or at target time
      let best = null;
      for (const pt of curve) {
        if (pt.time <= targetSec) best = pt;
        else break;
      }
      return best;
    }

    const timelineMinutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

    // Player APM curve
    if (mePlayer.apmCurve && mePlayer.apmCurve.length > 0) {
      const peak = mePlayer.apmCurve.reduce((max, pt) => pt.apm > max.apm ? pt : max, mePlayer.apmCurve[0]);
      const targetArr = winner ? apmCurveWins : apmCurveLosses;
      for (const pt of mePlayer.apmCurve) {
        if (pt.minute <= MAX_TIMELINE_MIN) {
          targetArr[pt.minute].push(pt.apm);
        }
      }
      const peakBucket = winner ? apmPeaksWins : apmPeaksLosses;
      peakBucket.push({ value: peak.apm, minute: peak.minute });
    }

    // Player resources/objects curve
    if (mePlayer.timeseriesCurve && mePlayer.timeseriesCurve.length > 0) {
      const resPeak = mePlayer.timeseriesCurve.reduce((max, pt) => pt.resources > max.resources ? pt : max, mePlayer.timeseriesCurve[0]);
      const objPeak = mePlayer.timeseriesCurve.reduce((max, pt) => pt.objects > max.objects ? pt : max, mePlayer.timeseriesCurve[0]);
      const sampled = sampleTimeseries(mePlayer.timeseriesCurve, timelineMinutes);
      const resTarget = winner ? resourcesCurveWins : resourcesCurveLosses;
      const objTarget = winner ? objectsCurveWins : objectsCurveLosses;
      for (const min of timelineMinutes) {
        if (sampled[min]) {
          resTarget[min].push(sampled[min].resources);
          objTarget[min].push(sampled[min].objects);
        }
      }
      const resPeakBucket = winner ? resourcePeaksWins : resourcePeaksLosses;
      const objPeakBucket = winner ? objectPeaksWins : objectPeaksLosses;
      resPeakBucket.push({ value: resPeak.resources, minute: Math.round(resPeak.minute) });
      objPeakBucket.push({ value: objPeak.objects, minute: Math.round(objPeak.minute) });

      // Age-up snapshots
      const snapTarget = winner ? ageSnapshotsWins : ageSnapshotsLosses;
      for (const age of AGES) {
        const t = meUptimes[age];
        if (t != null) {
          const snap = extractSnapshot(mePlayer.timeseriesCurve, t);
          if (snap) snapTarget[age].push({ resources: snap.resources, objects: snap.objects, time: t });
        }
      }
    }

    // Opponent time-series for comparison (not split by result, just averaged)
    if (oppPlayer) {
      if (oppPlayer.apmCurve) {
        for (const pt of oppPlayer.apmCurve) {
          if (pt.minute <= MAX_TIMELINE_MIN) oppApmCurve[pt.minute].push(pt.apm);
        }
      }
      if (oppPlayer.timeseriesCurve) {
        const sampled = sampleTimeseries(oppPlayer.timeseriesCurve, timelineMinutes);
        for (const min of timelineMinutes) {
          if (sampled[min]) {
            oppResourcesCurve[min].push(sampled[min].resources);
            oppObjectsCurve[min].push(sampled[min].objects);
          }
        }
        for (const age of AGES) {
          const t = oppUptimes[age];
          if (t != null) {
            const snap = extractSnapshot(oppPlayer.timeseriesCurve, t);
            if (snap) oppAgeSnapshots[age].push({ resources: snap.resources, objects: snap.objects, time: t });
          }
        }
      }
    }

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
    matchMeta.push({ mapName, meCiv, winner });
  }

  const baselines = computePlayerBaselines(playerId, allMatchFeatures);
  stats.baselines = baselines;
  for (const features of allMatchFeatures) features.opening = classifyOpening(features, baselines);
  stats.all_match_features = allMatchFeatures;

  // Clasificar openings del oponente usando los mismos baselines
  for (const opp of allOppFeatures) {
    const oppOpeningObj = classifyOpening(opp.features, baselines);
    const oppOpening = oppOpeningObj.chosen_opening || 'Standard/Unknown';
    stats.opp_openings[oppOpening] = (stats.opp_openings[oppOpening] || 0) + 1;
    // resultKey = our player's result when rival played this opening
    const resultKey = opp.winner ? 'wins' : 'losses';
    stats.opp_openings_vs_result[resultKey][oppOpening] = (stats.opp_openings_vs_result[resultKey][oppOpening] || 0) + 1;
  }

  // Opening x Map / Opening x Civ cross-tabulation
  stats.opening_map_wr = {};
  stats.opening_civ_wr = {};
  for (let i = 0; i < allMatchFeatures.length; i++) {
    const opening = allMatchFeatures[i].opening?.chosen_opening || 'Unknown';
    const meta = matchMeta[i] || {};
    const map = meta.mapName || 'Unknown';
    const civ = meta.meCiv || 'Unknown';
    const won = meta.winner;

    if (!stats.opening_map_wr[opening]) stats.opening_map_wr[opening] = {};
    if (!stats.opening_map_wr[opening][map]) stats.opening_map_wr[opening][map] = { wins: 0, losses: 0 };
    if (won) stats.opening_map_wr[opening][map].wins++; else stats.opening_map_wr[opening][map].losses++;

    if (!stats.opening_civ_wr[opening]) stats.opening_civ_wr[opening] = {};
    if (!stats.opening_civ_wr[opening][civ]) stats.opening_civ_wr[opening][civ] = { wins: 0, losses: 0 };
    if (won) stats.opening_civ_wr[opening][civ].wins++; else stats.opening_civ_wr[opening][civ].losses++;
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
  stats.avg_eapm_wins = average(stats.eapm_wins);
  stats.avg_eapm_losses = average(stats.eapm_losses);

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

  // Opponent civ win rates
  stats.opp_civ_win_percent = {};
  for (const [civ, data] of Object.entries(stats.opp_civ_stats)) {
    const total = (data.wins || 0) + (data.losses || 0);
    if (total >= 3) {
      stats.opp_civ_win_percent[civ] = total ? Math.round((data.wins * 100 / total) * 100) / 100 : 0;
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

  // Age time averages: wins vs losses
  stats.age_time_win_avg = {};
  stats.age_time_loss_avg = {};
  for (const age of AGES) {
    stats.age_time_win_avg[age] = avgArr(stats.age_times_wins[age]);
    stats.age_time_loss_avg[age] = avgArr(stats.age_times_losses[age]);
  }

  // Key tech averages: wins vs losses
  stats.key_tech_win_avg = {};
  stats.key_tech_loss_avg = {};
  for (const [techName, times] of Object.entries(stats.key_techs_wins)) {
    stats.key_tech_win_avg[techName] = avgArr(times);
  }
  for (const [techName, times] of Object.entries(stats.key_techs_losses)) {
    stats.key_tech_loss_avg[techName] = avgArr(times);
  }

  // Unit category per-match averages: wins vs losses
  stats.unit_cat_win_avg = {};
  stats.unit_cat_loss_avg = {};
  for (const [cat, totals] of Object.entries(stats.unit_cat_match_totals_wins)) {
    stats.unit_cat_win_avg[cat] = avgArr(totals);
  }
  for (const [cat, totals] of Object.entries(stats.unit_cat_match_totals_losses)) {
    stats.unit_cat_loss_avg[cat] = avgArr(totals);
  }

  // Opponent-derived averages: what do rivals do when we win vs lose?
  stats.opp_age_time_win_avg = {};
  stats.opp_age_time_loss_avg = {};
  for (const age of AGES) {
    stats.opp_age_time_win_avg[age] = avgArr(stats.opp_age_times_wins[age]);
    stats.opp_age_time_loss_avg[age] = avgArr(stats.opp_age_times_losses[age]);
  }

  stats.opp_key_tech_win_avg = {};
  stats.opp_key_tech_loss_avg = {};
  for (const [techName, times] of Object.entries(stats.opp_key_techs_wins)) {
    stats.opp_key_tech_win_avg[techName] = avgArr(times);
  }
  for (const [techName, times] of Object.entries(stats.opp_key_techs_losses)) {
    stats.opp_key_tech_loss_avg[techName] = avgArr(times);
  }

  stats.opp_unit_cat_win_avg = {};
  stats.opp_unit_cat_loss_avg = {};
  for (const [cat, totals] of Object.entries(stats.opp_unit_cat_match_totals_wins)) {
    stats.opp_unit_cat_win_avg[cat] = avgArr(totals);
  }
  for (const [cat, totals] of Object.entries(stats.opp_unit_cat_match_totals_losses)) {
    stats.opp_unit_cat_loss_avg[cat] = avgArr(totals);
  }

  stats.opp_unit_stats_win_avg = {};
  stats.opp_unit_stats_loss_avg = {};
  for (const [unit, totals] of Object.entries(stats.opp_unit_stats_wins)) {
    stats.opp_unit_stats_win_avg[unit] = avgArr(totals);
  }
  for (const [unit, totals] of Object.entries(stats.opp_unit_stats_losses)) {
    stats.opp_unit_stats_loss_avg[unit] = avgArr(totals);
  }

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

  // ============================================================================
  // INSIGHT METRICS (real behavior, not civ archetypes)
  // ============================================================================

  function stdDev(arr) {
    if (!arr || arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length;
    return Math.round(Math.sqrt(variance) * 100) / 100;
  }

  // Unit effectiveness: WR when unit is produced, plus signature
  const totalMilitaryUnits = Object.entries(stats.unit_stats || {})
    .filter(([name]) => name !== 'villager')
    .reduce((sum, [, d]) => sum + d.total, 0);
  const MIN_ARMY_SHARE = 0.05;
  stats.unit_effectiveness = {};
  for (const [unitName, data] of Object.entries(stats.unit_stats || {})) {
    if (unitName === 'villager' || data.matches < 3) continue;
    const share = totalMilitaryUnits > 0 ? data.total / totalMilitaryUnits : 0;
    const rawLabel = data.wr >= 65 ? 'strong' : data.wr <= 40 ? 'weak' : 'neutral';
    stats.unit_effectiveness[unitName] = {
      total: data.total,
      avg: data.avg,
      matches: data.matches,
      wins: data.wins,
      losses: data.losses,
      wr: data.wr,
      share: Math.round(share * 1000) / 10,
      label: share >= MIN_ARMY_SHARE ? rawLabel : 'neutral',
    };
  }

  // Age consistency + slow impact
  stats.age_time_std = {};
  stats.age_slow_impact = {};
  for (const age of AGES) {
    const times = stats.age_times[age] || [];
    const std = stdDev(times);
    stats.age_time_std[age] = std;
    const avgTime = stats['avg_' + age] || 0;
    if (avgTime > 0 && times.length >= 5) {
      const slowTimes = times.filter(t => t > avgTime);
      const slowCount = slowTimes.length;
      const slowWinsCount = (stats.age_times_wins[age] || []).filter(t => t > avgTime).length;
      stats.age_slow_impact[age] = {
        std,
        slowCount,
        slowWins: slowWinsCount,
        slowWr: slowCount > 0 ? Math.round((slowWinsCount * 100 / slowCount) * 100) / 100 : 0,
      };
    }
  }

  // Civ dependency
  const sortedCivsByPlay = Object.entries(stats.civ_played || {}).sort((a, b) => b[1] - a[1]);
  if (sortedCivsByPlay.length > 0) {
    const [mainCiv, mainGames] = sortedCivsByPlay[0];
    const mainWins = stats.civ_win[mainCiv] || 0;
    const mainLosses = stats.civ_loss[mainCiv] || 0;
    let otherWins = 0;
    let otherLosses = 0;
    for (let i = 1; i < sortedCivsByPlay.length; i++) {
      const [civ] = sortedCivsByPlay[i];
      otherWins += stats.civ_win[civ] || 0;
      otherLosses += stats.civ_loss[civ] || 0;
    }
    const totalCivGames = (stats.civ_played && Object.values(stats.civ_played).reduce((a, b) => a + b, 0)) || 0;
    stats.civ_dependency = {
      mainCiv,
      mainPct: totalCivGames ? Math.round((mainGames * 100 / totalCivGames) * 100) / 100 : 0,
      mainGames,
      mainWr: mainGames > 0 ? Math.round((mainWins * 100 / mainGames) * 100) / 100 : 0,
      otherGames: otherWins + otherLosses,
      otherWr: (otherWins + otherLosses) > 0 ? Math.round((otherWins * 100 / (otherWins + otherLosses)) * 100) / 100 : 0,
    };
  }

  // Opening x Map performance (best/worst map per opening)
  stats.opening_map_performance = {};
  for (const [opening, maps] of Object.entries(stats.opening_map_wr || {})) {
    let best = null;
    let worst = null;
    for (const [mapName, data] of Object.entries(maps)) {
      const total = (data.wins || 0) + (data.losses || 0);
      if (total < 2) continue;
      const wr = Math.round((data.wins * 100 / total) * 100) / 100;
      if (!best || wr > best.wr) best = { map: mapName, wr, total };
      if (!worst || wr < worst.wr) worst = { map: mapName, wr, total };
    }
    if (best && worst && best.map !== worst.map) {
      stats.opening_map_performance[opening] = { best, worst };
    }
  }

  // Critical economic timings: wins vs losses gaps
  stats.economic_gaps = [];
  const ecoChecks = [
    { key: 'wheel_barrow', win: stats.wheel_barrow_win_avg, loss: stats.wheel_barrow_loss_avg, name: 'Wheelbarrow' },
    { key: 'hand_cart', win: stats.hand_cart_win_avg, loss: stats.hand_cart_loss_avg, name: 'Hand Cart' },
    { key: 'tc2', win: null, loss: null },
  ];
  for (const check of ecoChecks) {
    if (check.key === 'tc2') {
      // TC2 times not stored per result; skip for now
      continue;
    }
    if (check.win != null && check.loss != null && check.loss - check.win > 30) {
      stats.economic_gaps.push({
        tech: check.name,
        gap: Math.round((check.loss - check.win) * 100) / 100,
        winAvg: formatHms(check.win),
        lossAvg: formatHms(check.loss),
      });
    }
  }

  // Early pressure ratios (military / villager before 10 and 15 min)
  stats.early_pressure = {
    before10: { wins: avgArr(earlyPressureWins), losses: avgArr(earlyPressureLosses) },
    before15: { wins: avgArr(midPressureWins), losses: avgArr(midPressureLosses) },
  };

  // Matchup weaknesses: opponent civs with low WR and their units in our losses
  stats.matchup_weaknesses = [];
  for (const [civ, wr] of Object.entries(stats.opp_civ_win_percent || {})) {
    if (wr > 40) continue;
    const total = ((stats.opp_civ_stats[civ]?.wins || 0) + (stats.opp_civ_stats[civ]?.losses || 0));
    if (total < 3) continue;
    const lossUnitAvgs = {};
    for (const [unit, totals] of Object.entries(stats.opp_unit_stats_losses || {})) {
      lossUnitAvgs[unit] = avgArr(totals);
    }
    const topLossUnits = Object.entries(lossUnitAvgs)
      .filter(([_, avg]) => avg > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([name, avg]) => ({ name, avg: Math.round(avg * 100) / 100 }));
    stats.matchup_weaknesses.push({ civ, wr, games: total, topLossUnits });
  }

  // ============================================================================
  // TIME-SERIES AGGREGATES
  // ============================================================================
  function avgOrNull(arr) {
    return arr && arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;
  }

  stats.timeline_minutes = [];
  for (let i = 0; i <= MAX_TIMELINE_MIN; i++) stats.timeline_minutes.push(i);

  stats.apm_curve_wins = apmCurveWins.map(avgOrNull);
  stats.apm_curve_losses = apmCurveLosses.map(avgOrNull);
  stats.resources_curve_wins = resourcesCurveWins.map(avgOrNull);
  stats.resources_curve_losses = resourcesCurveLosses.map(avgOrNull);
  stats.objects_curve_wins = objectsCurveWins.map(avgOrNull);
  stats.objects_curve_losses = objectsCurveLosses.map(avgOrNull);

  stats.opp_apm_curve = oppApmCurve.map(avgOrNull);
  stats.opp_resources_curve = oppResourcesCurve.map(avgOrNull);
  stats.opp_objects_curve = oppObjectsCurve.map(avgOrNull);

  stats.apm_peak = {
    wins: avgOrNull(apmPeaksWins.map(p => p.value)),
    losses: avgOrNull(apmPeaksLosses.map(p => p.value)),
    win_minute: avgOrNull(apmPeaksWins.map(p => p.minute)),
    loss_minute: avgOrNull(apmPeaksLosses.map(p => p.minute)),
  };
  stats.resource_peak = {
    wins: avgOrNull(resourcePeaksWins.map(p => p.value)),
    losses: avgOrNull(resourcePeaksLosses.map(p => p.value)),
    win_minute: avgOrNull(resourcePeaksWins.map(p => p.minute)),
    loss_minute: avgOrNull(resourcePeaksLosses.map(p => p.minute)),
  };
  stats.object_peak = {
    wins: avgOrNull(objectPeaksWins.map(p => p.value)),
    losses: avgOrNull(objectPeaksLosses.map(p => p.value)),
    win_minute: avgOrNull(objectPeaksWins.map(p => p.minute)),
    loss_minute: avgOrNull(objectPeaksLosses.map(p => p.minute)),
  };

  stats.age_snapshots = {};
  for (const age of AGES) {
    stats.age_snapshots[age] = {
      wins: {
        resources: avgOrNull(ageSnapshotsWins[age].map(s => s.resources)),
        objects: avgOrNull(ageSnapshotsWins[age].map(s => s.objects)),
      },
      losses: {
        resources: avgOrNull(ageSnapshotsLosses[age].map(s => s.resources)),
        objects: avgOrNull(ageSnapshotsLosses[age].map(s => s.objects)),
      },
      opp: {
        resources: avgOrNull(oppAgeSnapshots[age].map(s => s.resources)),
        objects: avgOrNull(oppAgeSnapshots[age].map(s => s.objects)),
      },
    };
  }

  // APM dropoff: difference between peak minute and late-game (min 40-60 avg)
  function lateGameAvg(curve) {
    const vals = [];
    for (let i = 40; i <= Math.min(60, curve.length - 1); i++) {
      if (curve[i] != null) vals.push(curve[i]);
    }
    return avgOrNull(vals);
  }
  stats.apm_dropoff = {
    wins: stats.apm_peak.wins != null ? Math.round((stats.apm_peak.wins - lateGameAvg(stats.apm_curve_wins)) * 100) / 100 : null,
    losses: stats.apm_peak.losses != null ? Math.round((stats.apm_peak.losses - lateGameAvg(stats.apm_curve_losses)) * 100) / 100 : null,
  };

  // Build-order averages
  function aggregateBuildOrder(tracker) {
    const result = { buildings: {}, techs: {} };
    for (const [name, data] of Object.entries(tracker.buildings)) {
      if (data.times.length > 0) {
        result.buildings[name] = {
          avg: avgOrNull(data.times),
          avg_hms: formatHms(avgOrNull(data.times)),
          games: data.times.length,
        };
      }
    }
    for (const [name, data] of Object.entries(tracker.techs)) {
      if (data.times.length > 0) {
        result.techs[name] = {
          avg: avgOrNull(data.times),
          avg_hms: formatHms(avgOrNull(data.times)),
          games: data.times.length,
        };
      }
    }
    return result;
  }
  stats.build_order = {
    wins: aggregateBuildOrder(boTrackerWins),
    losses: aggregateBuildOrder(boTrackerLosses),
    opp: aggregateBuildOrder(boTrackerOpp),
  };

  // APM efficiency
  if (stats.avg_eapm_wins != null && stats.avg_eapm_losses != null) {
    const winGames = stats.total_wins || 1;
    const lossGames = (stats.analyzed - stats.total_wins) || 1;
    const durs = [];
    for (const m of matches) {
      if (m.started && m.finished) {
        const dur = (new Date(m.finished) - new Date(m.started)) / 1000;
        if (dur > 0 && dur < 7200) durs.push(dur);
      }
    }
    const avgDurationMin = durs.length ? (durs.reduce((a, b) => a + b, 0) / durs.length) / 60 : 25;
    stats.apm_efficiency = {
      winApm: Math.round(stats.avg_eapm_wins),
      lossApm: Math.round(stats.avg_eapm_losses),
      winUnitsPerMin: Math.round((totalMilitaryUnitsWins / winGames / avgDurationMin) * 100) / 100,
      lossUnitsPerMin: Math.round((totalMilitaryUnitsLosses / lossGames / avgDurationMin) * 100) / 100,
    };
  }

  return stats;
}
