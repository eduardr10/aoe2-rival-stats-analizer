import { t, unitDisplayName } from './i18n.js';
import { formatHms } from './utils.js';

export function generateInsights(stats, knowledgeBase = {}) {
  const insights = [];
  const totalGames = stats.analyzed || 0;

  function add(insight) {
    insights.push(insight);
  }

  function confidenceFromSample(n, total = totalGames) {
    const pct = total > 0 ? (n / total) * 100 : 0;
    if (n >= 10 && pct >= 30) return 'high';
    if (n >= 5 && pct >= 20) return 'medium';
    return 'low';
  }

  function addSampleSizeWarning(insight, sampleSize, total = totalGames) {
    if (sampleSize < 5 || (total > 0 && (sampleSize / total) < 0.15)) {
      insight.warning = 'small_sample';
    }
  }

  // 1. Effective unit
  const effectiveness = Object.entries(stats.unit_effectiveness || {})
    .map(([name, d]) => ({ name, ...d }))
    .filter(d => d.label === 'strong' && d.matches >= 3 && (d.share || 0) >= 5)
    .sort((a, b) => b.wr - a.wr || b.matches - a.matches);
  if (effectiveness.length > 0) {
    const top = effectiveness[0];
    const insight = {
      id: 'unit_strength',
      category: 'army',
      type: 'strength',
      priority: 9,
      confidence: confidenceFromSample(top.matches),
      titleKey: 'insights.unit_strength.title',
      bodyKey: 'insights.unit_strength.body',
      params: {
        unit: unitDisplayName(top.name),
        wr: top.wr,
        avg: top.avg,
        games: top.matches,
        share: top.share,
      },
      tooltipKey: 'insights.unit_strength.tooltip',
    };
    addSampleSizeWarning(insight, top.matches);
    add(insight);
  }

  // 3. Ineffective unit
  const weaknesses = Object.entries(stats.unit_effectiveness || {})
    .map(([name, d]) => ({ name, ...d }))
    .filter(d => d.label === 'weak' && d.matches >= 3 && (d.share || 0) >= 5)
    .sort((a, b) => a.wr - b.wr || b.matches - a.matches);
  if (weaknesses.length > 0) {
    const top = weaknesses[0];
    const insight = {
      id: 'unit_weakness',
      category: 'army',
      type: 'weakness',
      priority: 8,
      confidence: confidenceFromSample(top.matches),
      titleKey: 'insights.unit_weakness.title',
      bodyKey: 'insights.unit_weakness.body',
      params: {
        unit: unitDisplayName(top.name),
        wr: top.wr,
        avg: top.avg,
        games: top.matches,
        share: top.share,
      },
      tooltipKey: 'insights.unit_weakness.tooltip',
    };
    addSampleSizeWarning(insight, top.matches);
    add(insight);
  }

  // 4. Civ dependency
  const dep = stats.civ_dependency;
  if (dep && dep.mainGames >= 3) {
    if (dep.otherGames >= 3 && dep.mainWr - dep.otherWr >= 15) {
      add({
        id: 'civ_dependency',
        category: 'context',
        type: 'weakness',
        priority: 8,
        confidence: confidenceFromSample(dep.mainGames + dep.otherGames),
        titleKey: 'insights.civ_dependency.title',
        bodyKey: 'insights.civ_dependency.body',
        params: {
          civ: dep.mainCiv,
          mainWr: dep.mainWr,
          mainGames: dep.mainGames,
          otherWr: dep.otherWr,
          otherGames: dep.otherGames,
        },
        tooltipKey: 'insights.civ_dependency.tooltip',
      });
    }
  }

  // 5. Opening x Map performance
  const omp = stats.opening_map_performance || {};
  const openingMapEntries = Object.entries(omp)
    .map(([opening, data]) => ({
      opening,
      diff: data.best.wr - data.worst.wr,
      ...data,
    }))
    .filter(d => d.diff >= 25 && d.best.total >= 2 && d.worst.total >= 2)
    .sort((a, b) => b.diff - a.diff);
  if (openingMapEntries.length > 0) {
    const top = openingMapEntries[0];
    add({
      id: 'opening_map',
      category: 'pattern',
      type: 'pattern',
      priority: 7,
      confidence: confidenceFromSample(top.best.total + top.worst.total),
      titleKey: 'insights.opening_map.title',
      bodyKey: 'insights.opening_map.body',
      params: {
        opening: formatOpeningNameI18n(top.opening),
        bestMap: top.best.map,
        bestWr: top.best.wr,
        bestGames: top.best.total,
        worstMap: top.worst.map,
        worstWr: top.worst.wr,
        worstGames: top.worst.total,
      },
      tooltipKey: 'insights.opening_map.tooltip',
    });
  }

  // 6. Age consistency
  for (const age of ['feudal', 'castle', 'imperial']) {
    const data = stats.age_slow_impact?.[age];
    if (!data) continue;
    if (data.std >= 25 && data.slowCount >= 3) {
      add({
        id: `age_consistency_${age}`,
        category: 'economy',
        type: 'weakness',
        priority: data.slowWr <= 40 ? 9 : 7,
        confidence: confidenceFromSample(data.slowCount),
        titleKey: 'insights.age_consistency.title',
        bodyKey: 'insights.age_consistency.body',
        params: {
          age: age.charAt(0).toUpperCase() + age.slice(1),
          std: `${data.std}s`,
          gap: `${Math.round(data.std)}s`,
          slowWr: data.slowWr,
        },
        tooltipKey: 'insights.age_consistency.tooltip',
      });
    }
  }

  // 7. Critical economic timings
  for (const gap of stats.economic_gaps || []) {
    if (gap.gap < 45) continue;
    add({
      id: `timing_${gap.tech}`,
      category: 'economy',
      type: 'weakness',
      priority: 8,
      confidence: 'medium',
      titleKey: 'insights.timing_critical.title',
      bodyKey: 'insights.timing_critical.body',
      params: {
        tech: gap.tech,
        gap: `${gap.gap}s`,
        winAvg: gap.winAvg,
        lossAvg: gap.lossAvg,
      },
      tooltipKey: 'insights.timing_critical.tooltip',
    });
  }

  // 8. Matchup weaknesses
  const matchups = stats.matchup_weaknesses || [];
  if (matchups.length > 0) {
    const top = matchups.sort((a, b) => a.wr - b.wr)[0];
    const topUnit = top.topLossUnits[0];
    add({
      id: 'matchup_weakness',
      category: 'matchups',
      type: 'weakness',
      priority: 8,
      confidence: confidenceFromSample(top.games),
      titleKey: 'insights.matchup_weakness.title',
      bodyKey: 'insights.matchup_weakness.body',
      params: {
        civ: top.civ,
        wr: top.wr,
        games: top.games,
        unitAvg: topUnit ? topUnit.avg : '?',
        unit: topUnit ? unitDisplayName(topUnit.name) : '?',
      },
      tooltipKey: 'insights.matchup_weakness.tooltip',
    });
  }

  // 9. Early pressure impact
  const ep = stats.early_pressure?.before10;
  if (ep && ep.wins != null && ep.losses != null) {
    const winRatio = Math.round(ep.wins * 100) / 100;
    const lossRatio = Math.round(ep.losses * 100) / 100;
    if (winRatio > lossRatio * 1.3 && stats.analyzed >= 5) {
      add({
        id: 'early_pressure',
        category: 'army',
        type: 'pattern',
        priority: 7,
        confidence: confidenceFromSample(stats.analyzed),
        titleKey: 'insights.early_pressure.title',
        bodyKey: 'insights.early_pressure.body',
        params: { winRatio, lossRatio, minutes: 10 },
        tooltipKey: 'insights.early_pressure.tooltip',
      });
    }
  }

  // 10. APM efficiency
  const apm = stats.apm_efficiency;
  if (apm) {
    add({
      id: 'apm_efficiency',
      category: 'pattern',
      type: 'pattern',
      priority: 6,
      confidence: confidenceFromSample(stats.analyzed),
      titleKey: 'insights.apm_efficiency.title',
      bodyKey: 'insights.apm_efficiency.body',
      params: {
        winApm: apm.winApm,
        lossApm: apm.lossApm,
        winUnits: apm.winUnitsPerMin,
        lossUnits: apm.lossUnitsPerMin,
      },
      tooltipKey: 'insights.apm_efficiency.tooltip',
    });
  }

  // Sort by priority desc
  insights.sort((a, b) => b.priority - a.priority);

  return insights;
}

function formatOpeningNameI18n(label) {
  const key = `openings.${label}`;
  const translated = t(key);
  if (translated !== key) return translated;
  if (!label) return t('app.noData');
  return label.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export function renderInsightCard(insight) {
  const title = t(insight.titleKey, insight.params);
  const body = t(insight.bodyKey, insight.params);
  const tooltip = t(insight.tooltipKey);
  const confidenceLabel = t(`insights.confidence${
    insight.confidence === 'high' ? 'High' : insight.confidence === 'medium' ? 'Medium' : 'Low'
  }`);
  const typeLabel = t(`insights.${insight.type}`);
  const typeClass = insight.type;

  const warningHtml = insight.warning === 'small_sample'
    ? `<div class="insight-warning">${t('insights.smallSampleWarning')}</div>`
    : '';

  return `<div class="card insight-card insight-${typeClass}">
    <div class="insight-header">
      <span class="insight-type">${escapeHtml(typeLabel)}</span>
      <div class="insight-meta">
        <span class="insight-confidence">${escapeHtml(confidenceLabel)}</span>
        <span class="tooltip-trigger" data-tooltip="${escapeHtml(tooltip)}">ℹ</span>
      </div>
    </div>
    <div class="insight-title">${escapeHtml(title)}</div>
    <div class="insight-body">${escapeHtml(body)}</div>
    ${warningHtml}
  </div>`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
