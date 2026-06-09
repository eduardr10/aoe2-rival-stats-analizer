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

function normalizeCiv(name) {
  if (!name) return '';
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function getArchetypeStrength(kbEntry, age) {
  if (!kbEntry || !kbEntry.strong_ages) return 5;
  const ages = kbEntry.strong_ages;
  if (ages.includes(age)) return 8;
  return 5;
}

function rateCivInAge(kbEntry, age) {
  if (!kbEntry) return { rating: 5, traits: [] };
  const base = getArchetypeStrength(kbEntry, age);
  const traits = [];

  if (age === 'early') {
    if (kbEntry.archetype?.includes('cavalry') || kbEntry.archetype?.includes('scout')) traits.push('strong scout opening');
    if (kbEntry.archetype?.includes('archer')) traits.push('strong archer opening');
    if (kbEntry.archetype?.includes('infantry')) traits.push('maa pressure');
    if (kbEntry.archetype?.includes('defensive')) traits.push('survives early pressure');
  }
  if (age === 'castle') {
    if (kbEntry.power_spikes?.some(p => ['crossbow', 'knight', 'camel', 'unique'].includes(p))) traits.push('strong power spike');
    if (kbEntry.archetype?.includes('boom')) traits.push('boom potential');
  }
  if (age === 'imperial') {
    if (kbEntry.late_game_rating >= 8) traits.push('dominant late game');
    if (kbEntry.late_game_rating <= 5) traits.push('falls off late');
    if (kbEntry.archetype?.includes('gunpowder')) traits.push('gunpowder threat');
  }

  return { rating: base + (traits.length * 0.5), traits };
}

export function analyzeMatchup(playerCiv, rivalCiv) {
  const kb = knowledgeBase || {};
  const p = normalizeCiv(playerCiv);
  const r = normalizeCiv(rivalCiv);
  const pData = kb[p] || {};
  const rData = kb[r] || {};

  const pEarly = rateCivInAge(pData, 'early');
  const rEarly = rateCivInAge(rData, 'early');
  const pCastle = rateCivInAge(pData, 'castle');
  const rCastle = rateCivInAge(rData, 'castle');
  const pImp = rateCivInAge(pData, 'imperial');
  const rImp = rateCivInAge(rData, 'imperial');

  const earlyDiff = pEarly.rating - rEarly.rating;
  const castleDiff = pCastle.rating - rCastle.rating;
  const impDiff = pImp.rating - rImp.rating;

  let earlyAdvantage = 'Balanced';
  if (earlyDiff >= 2) earlyAdvantage = `${p} Advantage`;
  else if (earlyDiff <= -2) earlyAdvantage = `${r} Advantage`;

  let castleAdvantage = 'Balanced';
  if (castleDiff >= 2) castleAdvantage = `${p} Advantage`;
  else if (castleDiff <= -2) castleAdvantage = `${r} Advantage`;

  let imperialAdvantage = 'Balanced';
  if (impDiff >= 2) imperialAdvantage = `${p} Advantage`;
  else if (impDiff <= -2) imperialAdvantage = `${r} Advantage`;

  // Key threats from rival to player
  const threats = [];
  if (rData.power_spikes) {
    for (const spike of rData.power_spikes.slice(0, 3)) {
      threats.push(spike);
    }
  }
  if (rData.archetype?.includes('cavalry') && pData.weaknesses?.includes('cavalry')) threats.push('cavalry rush');
  if (rData.archetype?.includes('archer') && pData.weaknesses?.includes('archers')) threats.push('archer pressure');
  if (rData.archetype?.includes('gunpowder') && pData.weaknesses?.includes('hand_cannoneer')) threats.push('gunpowder');

  // Win condition recommendation
  let winCondition = 'Standard macro game';
  if (earlyAdvantage.includes(p)) winCondition = 'Apply early pressure and snowball';
  else if (castleAdvantage.includes(p)) winCondition = 'Survive early, dominate Castle Age';
  else if (imperialAdvantage.includes(p)) winCondition = 'Defend and scale to Imperial';
  else if (earlyAdvantage.includes(r)) winCondition = 'Wall up and survive to Castle';
  else if (imperialAdvantage.includes(r)) winCondition = 'Close the game before Imperial';

  return {
    player_civ: p,
    rival_civ: r,
    early_advantage: earlyAdvantage,
    castle_advantage: castleAdvantage,
    imperial_advantage: imperialAdvantage,
    player_early_traits: pEarly.traits,
    rival_early_traits: rEarly.traits,
    key_threats: [...new Set(threats)].slice(0, 4),
    recommended_win_condition: winCondition,
  };
}
