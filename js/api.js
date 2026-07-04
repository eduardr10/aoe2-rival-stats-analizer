import {
  getCachedMatches, setCachedMatches,
  getCachedAnalysis, setCachedAnalysis,
  getCachedProfile, setCachedProfile,
} from './cache.js';

const API_BASE = 'https://data.aoe2companion.com';
const UA_HEADER = 'eduardr10-stats-script';

async function apiFetch(url, timeoutMs = 15000) {
  const cacheBuster = url.includes('?') ? '&_t=' : '?_t=';
  try {
    const resp = await fetch(url + cacheBuster + Date.now(), {
      headers: {
        'User-Agent': UA_HEADER,
        'X-User-Agent': UA_HEADER,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      console.error('API error:', url, resp.status);
      return null;
    }
    return await resp.json();
  } catch (e) {
    if (e.name === 'TimeoutError') {
      console.error('API timeout:', url);
    } else {
      console.error('API error:', url, e);
    }
    return null;
  }
}

export async function fetchRating(playerId) {
  const cached = await getCachedProfile(playerId);
  if (cached) return cached;

  try {
    const data = await apiFetch(`${API_BASE}/api/profiles/${playerId}`);
    if (!data || !data.leaderboards || !data.leaderboards[0]) return null;
    const rating = data.leaderboards[0].rating || null;
    await setCachedProfile(playerId, rating);
    return rating;
  } catch (e) {
    console.error('fetchRating error:', e);
    return null;
  }
}

export async function fetchFullProfile(playerId) {
  try {
    const data = await apiFetch(`${API_BASE}/api/profiles/${playerId}?extend=stats,profiles.avatar_medium_url,profiles.avatar_full_url`);
    return data;
  } catch (e) {
    console.error('fetchFullProfile error:', e);
    return null;
  }
}

export async function fetchMatches(playerId, leaderboard, page, perPage) {
  const cached = await getCachedMatches(playerId, leaderboard, page, perPage);
  if (cached) {
    console.log(`[cache] matches page ${page} (${cached.length} items)`);
    return cached;
  }

  try {
    const url = new URL(`${API_BASE}/api/matches`);
    url.searchParams.set('direction', 'forward');
    url.searchParams.set('profile_ids', playerId);
    url.searchParams.set('leaderboard_ids', leaderboard);
    url.searchParams.set('page', page);
    url.searchParams.set('per_page', perPage);
    const data = await apiFetch(url.toString());
    const matches = data?.matches || [];
    await setCachedMatches(playerId, leaderboard, page, perPage, matches);
    return matches;
  } catch (e) {
    console.error('fetchMatches exception:', e);
    return [];
  }
}

export async function fetchAnalysis(matchId) {
  const cached = await getCachedAnalysis(matchId);
  if (cached) {
    console.log(`[cache] analysis ${matchId}`);
    return { data: cached, fromCache: true };
  }

  try {
    const url = `${API_BASE}/api/matches/${matchId}/analysis?language=es`;
    const data = await apiFetch(url);
    if (data) {
      await setCachedAnalysis(matchId, data);
    }
    return { data, fromCache: false };
  } catch (e) {
    console.error(`fetchAnalysis error for ${matchId}:`, e);
    return { data: null, fromCache: false };
  }
}
