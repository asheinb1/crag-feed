// Pure helper functions for searching, filtering, sorting and grouping ticks.
// No DOM access here so these can be tested directly in Node.

export function haystack(t) {
  return [t.climberName, t.route, t.grade || '', (t.areaPath || []).join(' '), t.style || '', t.notes || '']
    .join(' ')
    .toLowerCase();
}

/**
 * filters: { q, climber, grade, area }  (empty string = no filter)
 * q: every space-separated word must appear somewhere in climber, route, grade, area (and style/notes if present).
 */
export function applyFilters(ticks, filters) {
  const words = (filters.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return ticks.filter((t) => {
    if (filters.climber && t.climberId !== filters.climber) return false;
    if (filters.grade && t.grade !== filters.grade) return false;
    if (filters.area && !(t.areaPath || []).includes(filters.area)) return false;
    if (words.length) {
      const h = haystack(t);
      for (const w of words) if (!h.includes(w)) return false;
    }
    return true;
  });
}

/** Sort key so 5.9 < 5.10a < 5.10d < 5.11a etc. Non-YDS grades follow, alphabetically. */
export function gradeSortKey(g) {
  const m = /^5\.(\d{1,2})([abcd])?([+-])?/.exec(g || '');
  if (m) {
    const n = Number(m[1]);
    const letter = m[2] ? 'abcd'.indexOf(m[2]) + 1 : 0;
    const mod = m[3] === '+' ? 0.5 : m[3] === '-' ? -0.5 : 0;
    return [0, n * 10 + letter + mod, ''];
  }
  const v = /^V(\d{1,2})/i.exec(g || '');
  if (v) return [1, Number(v[1]), ''];
  return [2, 0, String(g || '')];
}

export function compareGrades(a, b) {
  const ka = gradeSortKey(a);
  const kb = gradeSortKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  return ka[2].localeCompare(kb[2]);
}

export function gradeOptions(ticks) {
  const set = new Set(ticks.map((t) => t.grade).filter(Boolean));
  return [...set].sort(compareGrades);
}

/** Every breadcrumb segment (except generic roots) is offered as an area filter, most common first. */
const GENERIC_ROOTS = new Set(['all locations', 'destinations']);
export function areaOptions(ticks) {
  const counts = new Map();
  for (const t of ticks) {
    for (const seg of new Set(t.areaPath || [])) {
      if (GENERIC_ROOTS.has(seg.toLowerCase())) continue;
      counts.set(seg, (counts.get(seg) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

/**
 * "YYYY-MM-DD" key used for grouping the feed under day headings.
 * A real tick date is a plain calendar date. A feed publication time is converted to the
 * viewer's local day so late-evening posts are not shown under the next day.
 */
export function dayKey(t) {
  if (t.dateSource === 'tick' && t.climbDate) return t.climbDate;
  if (t.published) {
    const d = new Date(t.published);
    if (!Number.isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
  }
  return 'undated';
}

export function groupByDay(ticks) {
  const groups = [];
  for (const t of ticks) {
    const k = dayKey(t);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.ticks.push(t);
    else groups.push({ key: k, ticks: [t] });
  }
  return groups;
}

export const NEW_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const STALE_AFTER_MS = 18 * 60 * 60 * 1000;

/** A tick is "New" if we discovered it after seeding and within the last 3 days. */
export function isNew(t, nowMs) {
  if (t.baseline) return false;
  const seen = Date.parse(t.firstSeenAt);
  return Number.isFinite(seen) && nowMs - seen >= 0 && nowMs - seen <= NEW_WINDOW_MS;
}

export function isStale(iso, nowMs) {
  const ms = Date.parse(iso);
  return !Number.isFinite(ms) || nowMs - ms > STALE_AFTER_MS;
}

export function timeAgo(iso, nowMs) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'unknown';
  const mins = Math.max(0, Math.round((nowMs - ms) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} days ago`;
}
