// AgentRank Score: 0–100, computed only from public GitHub data. It measures traction and upkeep, not task
// performance (that's the benchmark score). Weights and steps are published on /methodology/#score.
export const WEIGHTS = { popularity: 30, adoption: 20, activity: 25, momentum: 15, openness: 10 };
export const PARTS = {
  popularity: 'Popularity: stars, percentile vs. every listed agent (log scale)',
  adoption: 'Adoption: forks, percentile (log scale)',
  activity: 'Activity: how recently code was pushed',
  momentum: 'Momentum: stars gained per day since creation, percentile',
  openness: 'Openness: OSI open-source licence detected',
};
const DAY = 864e5;

/** Percentile (0–100) of each value within the list; ties share the midpoint rank. */
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const lower = (v) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] < v ? lo = m + 1 : hi = m; } return lo; };
  const upper = (v) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] <= v ? lo = m + 1 : hi = m; } return lo; };
  return values.map((v) => n < 2 ? 100 : (((lower(v) + upper(v) - 1) / 2) / (n - 1)) * 100);
}

export function activityPoints(pushedAt, now = Date.now()) {
  if (!pushedAt) return 0;
  const days = (now - new Date(pushedAt)) / DAY;
  return days <= 7 ? 100 : days <= 30 ? 85 : days <= 90 ? 60 : days <= 180 ? 35 : days <= 365 ? 15 : 0;
}

/** Mutates each item: adds item.arScore (int) and item.arParts ({part: 0–100}). Needs stars, forks, pushedAt, createdAt, license. */
export function scoreAll(items, now = Date.now()) {
  const pop = percentiles(items.map((d) => Math.log10((d.stars || 0) + 1)));
  const adp = percentiles(items.map((d) => Math.log10((d.forks || 0) + 1)));
  const mom = percentiles(items.map((d) => {
    const age = d.createdAt ? Math.max(30, (now - new Date(d.createdAt)) / DAY) : 3650;
    return Math.log10((d.stars || 0) / age + 1);
  }));
  items.forEach((d, i) => {
    const parts = { popularity: pop[i], adoption: adp[i], activity: activityPoints(d.pushedAt, now), momentum: mom[i], openness: d.license ? 100 : 0 };
    d.arParts = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)]));
    d.arScore = Math.round(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + (parts[k] * w) / 100, 0));
  });
  return items;
}
