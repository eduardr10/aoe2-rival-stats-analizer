const DB_NAME = 'aoe2_rival_stats_cache';
const DB_VERSION = 1;
const STORE_MATCHES = 'matches';
const STORE_ANALYSIS = 'analysis';
const STORE_PROFILE = 'profile';

const TTL = {
  matches: 30 * 60 * 1000,
  analysis: 24 * 60 * 60 * 1000,
  profile: 5 * 60 * 1000,
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_MATCHES)) {
        db.createObjectStore(STORE_MATCHES, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_ANALYSIS)) {
        db.createObjectStore(STORE_ANALYSIS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_PROFILE)) {
        db.createObjectStore(STORE_PROFILE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function get(storeName, key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => {
        const item = request.result;
        if (!item) { resolve(null); return; }
        if (Date.now() - item.timestamp > TTL[storeName]) {
          resolve(null);
          return;
        }
        resolve(item.data);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function set(storeName, key, data) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put({ key, data, timestamp: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function getCachedMatches(playerId, leaderboard, page, perPage) {
  return get(STORE_MATCHES, `${playerId}:${leaderboard}:${page}:${perPage}`);
}

export async function setCachedMatches(playerId, leaderboard, page, perPage, data) {
  return set(STORE_MATCHES, `${playerId}:${leaderboard}:${page}:${perPage}`, data);
}

export async function getCachedAnalysis(matchId) {
  return get(STORE_ANALYSIS, matchId);
}

export async function setCachedAnalysis(matchId, data) {
  return set(STORE_ANALYSIS, matchId, data);
}

export async function getCachedProfile(playerId) {
  return get(STORE_PROFILE, playerId);
}

export async function setCachedProfile(playerId, data) {
  return set(STORE_PROFILE, playerId, data);
}

export async function clearCache() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_MATCHES, STORE_ANALYSIS, STORE_PROFILE], 'readwrite');
      tx.objectStore(STORE_MATCHES).clear();
      tx.objectStore(STORE_ANALYSIS).clear();
      tx.objectStore(STORE_PROFILE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function getCacheStats() {
  try {
    const db = await openDB();
    const countStore = (name) => new Promise((resolve) => {
      const tx = db.transaction(name, 'readonly');
      const store = tx.objectStore(name);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
    return {
      matches: await countStore(STORE_MATCHES),
      analysis: await countStore(STORE_ANALYSIS),
      profile: await countStore(STORE_PROFILE),
    };
  } catch {
    return { matches: 0, analysis: 0, profile: 0 };
  }
}
