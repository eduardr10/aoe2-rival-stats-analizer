export function initWebSocket(playerId, existingMatchId, onNewMatch = null) {
  const analyzedMatchIds = new Set();

  if (existingMatchId && existingMatchId !== 'self') {
    analyzedMatchIds.add(existingMatchId);
  }

  function getRivalProfileId(matchData, myProfileId) {
    if (!matchData || !Array.isArray(matchData.players)) return null;
    const rival = matchData.players.find(p => p.profileId !== myProfileId);
    return rival ? rival.profileId : null;
  }

  function createSocket(handlerName) {
    const socketUrl = `wss://socket.aoe2companion.com/listen?handler=${handlerName}&profile_ids=${playerId}`;
    let socket = new WebSocket(socketUrl);

    socket.onopen = () => {
      console.log(`Connected to ${handlerName}`);
    };

    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.warn('Could not parse message:', event.data);
        return;
      }

      let matchData = Array.isArray(msg) && msg.length > 0 ? msg[0].data : msg.data;
      if (!matchData || !matchData.matchId || analyzedMatchIds.has(matchData.matchId) || matchData.leaderboardId !== 'rm_1v1') {
        return;
      }

      const lsKey = `aoe2_analysis_${matchData.matchId}`;
      const lastAnalysis = localStorage.getItem(lsKey);
      const now = Date.now();
      if (lastAnalysis && now - parseInt(lastAnalysis) < 2 * 60 * 1000) {
        return;
      }
      localStorage.setItem(lsKey, now.toString());
      analyzedMatchIds.add(matchData.matchId);

      const rivalProfileId = getRivalProfileId(matchData, playerId);
      if (!rivalProfileId) {
        console.warn('Could not extract rival profile_id');
        return;
      }

      if (onNewMatch) {
        onNewMatch({ matchData, rivalProfileId });
      } else {
        const newUrl = `${window.location.pathname}?matchId=${matchData.matchId}&rivalProfileId=${rivalProfileId}&t=${Date.now()}`;
        window.location.replace(newUrl);
      }
    };

    socket.onclose = (event) => {
      console.warn(`Connection closed in ${handlerName}, retrying in 3s...`, event.code, event.reason);
      setTimeout(() => {
        socket = createSocket(handlerName);
      }, 3000);
    };

    socket.onerror = (error) => {
      console.error(`WebSocket error ${handlerName}`, error);
      socket.close();
    };

    return socket;
  }

  createSocket('ongoing-matches');
}
