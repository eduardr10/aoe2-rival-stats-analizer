const CIV_CANONICAL_NAMES = {
  'Villager': 'villager',
  'Scout Cavalry': 'scout_cavalry',
  'Archer': 'archer',
  'Spearman': 'spearman',
  'Militia': 'militia',
  'Men-at-Arms': 'militia',
  'Skirmisher': 'skirmisher',
  'Knight': 'knight',
  'Archery Range': 'archery_range',
  'Town Center': 'town_center',
  'Barracks': 'barracks',
  'Stable': 'stable',
  'Blacksmith': 'blacksmith',
  'Market': 'market',
  'Watch Tower': 'watch_tower',
  'Outpost': 'outpost',
  'Palisade Wall': 'palisade_wall',
  'Palisade Gate': 'palisade_gate',
  'Feudal Age': 'feudal_age',
  'Castle Age': 'castle_age',
  'Imperial Age': 'imperial_age',
  'Wheelbarrow': 'wheelbarrow',
  'Hand Cart': 'hand_cart',
};

const TECH_CATEGORIES = {
  military: [
    'forging','iron casting','blast furnace','fletching','bodkin arrow','bracer',
    'bloodlines','husbandry','scale mail armor','chain mail armor','plate mail armor',
    'scale barding armor','chain barding armor','plate barding armor','padded archer armor',
    'leather archer armor','ring archer armor','thumb ring','ballistics','chemistry',
    'siege engineers','murder holes','arrowslits','sanctity','faith','heresy',
    'conscription','hoardings','sappers','keep','bombard tower',
    'squires','arson','supplies',
  ],
  economy: [
    'wheelbarrow','hand cart','horse collar','heavy plow','crop rotation',
    'double-bit axe','bow saw','two-man saw','gold mining','gold shaft mining',
    'stone mining','stone shaft mining','coinage','banking','caravan','guilds',
  ],
  naval: [
    'careening','dry dock','shipwright','gillnets',
  ],
};

function isKeyTech(unitName) {
  if (!unitName) return false;
  const n = unitName.toLowerCase();
  return Object.values(TECH_CATEGORIES).flat().includes(n);
}

function getTechCategory(unitName) {
  if (!unitName) return 'other';
  const n = unitName.toLowerCase();
  for (const [cat, list] of Object.entries(TECH_CATEGORIES)) {
    if (list.includes(n)) return cat;
  }
  return 'other';
}

function techDisplayName(unitName) {
  const map = {
    'scale mail armor': 'Scale Mail',
    'chain mail armor': 'Chain Mail',
    'plate mail armor': 'Plate Mail',
    'scale barding armor': 'Scale Barding',
    'chain barding armor': 'Chain Barding',
    'plate barding armor': 'Plate Barding',
    'padded archer armor': 'Padded Archer',
    'leather archer armor': 'Leather Archer',
    'ring archer armor': 'Ring Archer',
    'double-bit axe': 'Double-Bit Axe',
    'gold shaft mining': 'Gold Shaft',
    'stone shaft mining': 'Stone Shaft',
    'bow saw': 'Bow Saw',
    'two-man saw': 'Two-Man Saw',
    'hand cart': 'Hand Cart',
    'horse collar': 'Horse Collar',
    'heavy plow': 'Heavy Plow',
    'crop rotation': 'Crop Rotation',
    'iron casting': 'Iron Casting',
    'blast furnace': 'Blast Furnace',
    'bodkin arrow': 'Bodkin Arrow',
    'thumb ring': 'Thumb Ring',
    'siege engineers': 'Siege Engineers',
    'murder holes': 'Murder Holes',
    'bombard tower': 'Bombard Tower',
    'arrowslits': 'Arrowslits',
  };
  const n = unitName.toLowerCase();
  return map[n] || unitName;
}

const CIVILIZATIONS = [
  ['Armenians', 45], ['Aztecs', 0], ['Bengalis', 42], ['Berbers', 1],
  ['Bohemians', 39], ['Britons', 2], ['Bulgarians', 3], ['Burgundians', 35],
  ['Burmese', 4], ['Byzantines', 5], ['Celts', 6], ['Chinese', 7],
  ['Cumans', 8], ['Dravidians', 41], ['Ethiopians', 9], ['Franks', 10],
  ['Georgians', 46], ['Goths', 11], ['Gurjaras', 43], ['Hindustanis', 40],
  ['Huns', 12], ['Incas', 13], ['Indians', 14], ['Italians', 15],
  ['Japanese', 16], ['Jurchens', 53], ['Khitans', 54], ['Khmer', 17],
  ['Koreans', 18], ['Lithuanians', 19], ['Magyars', 20], ['Malay', 21],
  ['Malians', 22], ['Mayans', 23], ['Mongols', 24], ['Persians', 25],
  ['Poles', 38], ['Portuguese', 26], ['Romans', 44], ['Saracens', 27],
  ['Shu', 50], ['Sicilians', 36], ['Slavs', 28], ['Spanish', 29],
  ['Tatars', 30], ['Teutons', 31], ['Turks', 32], ['Vietnamese', 33],
  ['Vikings', 34], ['Wei', 52], ['Wu', 51],
];

const MILITARY_UNITS = [
  'militia', 'spearman', 'scout_cavalry', 'archer', 'skirmisher',
  'man-at-arms', 'longswordsman', 'knight', 'cavalry archer', 'mangudai',
];

function resolveCivNumber(civOpt) {
  if (!civOpt) return null;
  if (typeof civOpt === 'number' || (!isNaN(civOpt) && civOpt !== '')) return parseInt(civOpt);
  const name = String(civOpt).trim().toLowerCase();
  for (const [civName, num] of CIVILIZATIONS) {
    if (civName.toLowerCase() === name) return num;
  }
  return null;
}

function parseTimestamp(timestamp) {
  if (!timestamp) return null;
  const parts = timestamp.split(':');
  if (parts.length < 3) return null;
  const h = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  const sParts = parts[2].split('.');
  const s = parseInt(sParts[0]);
  const ms = sParts[1] ? parseInt(sParts[1].substring(0, 3)) / 1000 : 0;
  return h * 3600 + m * 60 + s + ms;
}

function formatHms(seconds) {
  if (seconds == null) return 'N/A';
  if (seconds > 100000 && seconds < 100000000) {
    seconds = Math.round(seconds / 1000);
  }
  seconds = Math.floor(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function average(arr) {
  if (!arr || arr.length === 0) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export {
  CIV_CANONICAL_NAMES,
  TECH_CATEGORIES,
  MILITARY_UNITS,
  resolveCivNumber,
  parseTimestamp,
  formatHms,
  average,
  median,
  percentile,
  sleep,
  isKeyTech,
  getTechCategory,
  techDisplayName,
  escapeHtml,
};
