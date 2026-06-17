// Internationalization module
// Detects language via: URL ?lang= > localStorage > IP geolocation > navigator.language
// Loads translations from data/i18n.json

const STORAGE_KEY = 'aoe2-lang';
const DEFAULT_LANG = 'en';
const SUPPORTED_LANGS = ['en', 'es'];

const SPANISH_COUNTRIES = new Set([
  'ES','MX','AR','CO','PE','VE','CL','EC','BO','PY','UY','CR','PA','GT','HN','SV','NI','DO','CU','PR'
]);

let currentLang = DEFAULT_LANG;
let translations = null;
let detectionPromise = null;

function parseNavigatorLanguage(navLang) {
  if (!navLang) return DEFAULT_LANG;
  const base = navLang.split('-')[0].toLowerCase();
  return base === 'es' ? 'es' : DEFAULT_LANG;
}

async function fetchTranslations() {
  if (translations) return translations;
  try {
    const base = document.querySelector('base')?.href || '';
    const url = new URL('data/i18n.json', base || window.location.href).toString();
    const res = await fetch(url);
    translations = await res.json();
    return translations;
  } catch (e) {
    console.warn('[i18n] Could not load translations, using fallback', e);
    translations = { en: {}, es: {} };
    return translations;
  }
}

async function detectCountryByIP() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data.country_code || null;
  } catch (e) {
    return null;
  }
}

function countryToLang(countryCode) {
  if (!countryCode) return null;
  return SPANISH_COUNTRIES.has(countryCode.toUpperCase()) ? 'es' : 'en';
}

export async function initI18n() {
  if (detectionPromise) return detectionPromise;
  detectionPromise = (async () => {
    // 1. URL override
    const params = new URLSearchParams(window.location.search);
    const urlLang = params.get('lang');
    if (urlLang && SUPPORTED_LANGS.includes(urlLang)) {
      setLanguage(urlLang);
      await fetchTranslations();
      return currentLang;
    }

    // 2. localStorage
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) {
      currentLang = saved;
      await fetchTranslations();
      return currentLang;
    }

    // 3. Try IP geolocation, fallback to navigator
    await fetchTranslations();
    const country = await detectCountryByIP();
    const ipLang = countryToLang(country);
    if (ipLang) {
      setLanguage(ipLang);
    } else {
      currentLang = parseNavigatorLanguage(navigator.language || navigator.userLanguage);
    }
    localStorage.setItem(STORAGE_KEY, currentLang);
    return currentLang;
  })();
  return detectionPromise;
}

export function setLanguage(lang) {
  if (SUPPORTED_LANGS.includes(lang)) {
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }
}

export function getLanguage() {
  return currentLang;
}

function getNested(obj, path) {
  if (!obj) return undefined;
  const parts = path.split('.');
  let value = obj;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return undefined;
    value = value[part];
  }
  return value;
}

export function t(key, params = {}) {
  const tr = translations || {};
  let value = getNested(tr[currentLang], key);
  if (value === undefined) value = getNested(tr[DEFAULT_LANG], key);
  if (value === undefined) value = key;

  if (typeof value !== 'string') return String(value);

  return value.replace(/\{([^{}]+)\}/g, (_, paramName) => {
    if (params[paramName] !== undefined) return String(params[paramName]);
    return `{${paramName}}`;
  });
}

// Translate opening names using i18n keys
export function formatOpeningName(label) {
  const key = `openings.${label}`;
  const translated = t(key);
  if (translated !== key) return translated;
  if (!label) return t('app.noData');
  return label.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Translate unit names using i18n keys
export function unitDisplayName(unitName) {
  if (!unitName) return '';
  const key = `units.${unitName.toLowerCase()}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return unitName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Format number of games with correct plural handling (simplified)
export function formatGames(count) {
  return `${count} ${t('insights.games')}`;
}
