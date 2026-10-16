// Crag Feed front end. Plain JavaScript, no frameworks, no external requests except the
// site's own data file (loaded with a relative path so it works under /crag-feed/).
// All feed-derived text is inserted with textContent, never innerHTML.

import { applyFilters, gradeOptions, areaOptions, groupByDay, isNew, isStale, timeAgo } from './filters.js';

const PAGE_SIZE = 50;

export async function init(doc, fetchFn, nowFn = () => Date.now()) {
  const $ = (id) => doc.getElementById(id);
  const el = {
    updated: $('updated'), notices: $('notices'), form: $('filters'), q: $('q'), climber: $('climber'),
    grade: $('grade'), area: $('area'), reset: $('reset'), count: $('count'), loading: $('loading'),
    error: $('error'), empty: $('empty'), feed: $('feed'), more: $('more'),
  };

  function h(tag, className, text) {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  let data;
  try {
    const res = await fetchFn('data/ticks.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('bad status');
    data = await res.json();
    if (!data || !Array.isArray(data.ticks) || !Array.isArray(data.climbers)) throw new Error('bad shape');
  } catch {
    el.loading.hidden = true;
    el.updated.textContent = 'Could not load the feed data.';
    el.error.hidden = false;
    el.error.textContent = 'Sorry, the tick data could not be loaded. Please try reloading the page in a few minutes.';
    return;
  }

  const nowMs = nowFn();
  el.loading.hidden = true;
  const ticks = data.ticks;
  let shown = PAGE_SIZE;

  // ---- status line and notices -------------------------------------------------------------
  const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (data.lastSuccessAt) {
    el.updated.textContent = `Last updated ${timeAgo(data.lastSuccessAt, nowMs)} (${fmtDateTime(data.lastSuccessAt)}).`;
  } else {
    el.updated.textContent = 'No data has been collected yet.';
  }

  const notice = (text, kind) => {
    const p = h('p', `notice notice-${kind}`, text);
    el.notices.appendChild(p);
  };

  if (!data.lastSuccessAt) {
    notice('The first refresh has not finished yet. Check back after the next scheduled update.', 'info');
  } else if (isStale(data.lastSuccessAt, nowMs)) {
    notice('This data may be out of date: the last successful update was a while ago. Newer ticks may exist on Mountain Project.', 'warn');
  }
  for (const c of data.climbers) {
    if (c.status === 'failed') {
      const since = c.lastSuccessAt ? `last updated ${timeAgo(c.lastSuccessAt, nowMs)}` : 'never updated successfully';
      notice(`${c.name}'s feed could not be refreshed (${since}). Showing what was saved earlier.`, 'warn');
    }
  }
  for (const e of data.configErrors || []) notice(`Setup problem: ${e}`, 'warn');
  if (data.lastSuccessAt && ticks.length > 0 && ticks.every((t) => t.baseline)) {
    notice('These are the most recent ticks available when tracking began, not brand-new activity. "New" badges will appear only on ticks discovered in later updates.', 'info');
  }

  // ---- filter controls ---------------------------------------------------------------------
  for (const c of data.climbers) {
    const o = h('option', '', c.name);
    o.value = c.id;
    el.climber.appendChild(o);
  }
  for (const g of gradeOptions(ticks)) {
    const o = h('option', '', g);
    o.value = g;
    el.grade.appendChild(o);
  }
  for (const a of areaOptions(ticks)) {
    const o = h('option', '', `${a.name} (${a.count})`);
    o.value = a.name;
    el.area.appendChild(o);
  }

  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  function currentFilters() {
    return { q: el.q.value, climber: el.climber.value, grade: el.grade.value, area: el.area.value };
  }

  function render() {
    const filters = currentFilters();
    const results = applyFilters(ticks, filters);
    const active = Boolean(filters.q.trim() || filters.climber || filters.grade || filters.area);
    el.reset.disabled = !active;
    el.feed.replaceChildren();
    el.empty.hidden = true;
    el.more.hidden = true;

    if (ticks.length === 0) {
      el.count.textContent = '';
      el.empty.hidden = false;
      el.empty.textContent = data.lastSuccessAt
        ? 'No ticks were found in the configured feeds yet.'
        : 'Nothing to show yet. Ticks will appear after the first successful refresh.';
      return;
    }
    el.count.textContent = active
      ? `${results.length} of ${ticks.length} ticks match`
      : `${ticks.length} ticks`;
    if (results.length === 0) {
      el.empty.hidden = false;
      el.empty.textContent = 'No ticks match your search and filters. Try removing a filter or use "Reset filters".';
      return;
    }

    const visible = results.slice(0, shown);
    for (const group of groupByDay(visible)) {
      const section = h('section', 'day');
      let label = 'Date unknown';
      if (group.key !== 'undated') {
        const d = new Date(`${group.key}T12:00:00Z`);
        label = dayFmt.format(d);
      }
      section.appendChild(h('h3', 'day-heading', label));
      const list = h('ul', 'ticks');
      for (const t of group.ticks) list.appendChild(renderTick(t));
      section.appendChild(list);
      el.feed.appendChild(section);
    }
    if (results.length > shown) {
      el.more.hidden = false;
      el.more.textContent = `Show more (${results.length - shown} remaining)`;
    }
  }

  function renderTick(t) {
    const li = h('li', 'tick');
    const top = h('p', 'tick-who');
    top.appendChild(h('span', 'who', t.climberName));
    if (isNew(t, nowMs)) top.appendChild(h('span', 'badge-new', 'New'));
    li.appendChild(top);

    const title = h('h4', 'route');
    if (t.url) {
      const a = h('a', '', t.route);
      a.href = t.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      title.appendChild(a);
      title.appendChild(h('span', 'visually-hidden', ' (opens Mountain Project in a new tab)'));
    } else {
      title.textContent = t.route;
    }
    if (t.grade) title.appendChild(h('span', 'grade', t.grade));
    li.appendChild(title);

    if (t.area) li.appendChild(h('p', 'area', t.area));

    const meta = h('p', 'meta');
    if (t.dateSource === 'tick') meta.textContent = 'Climb date from the tick';
    else if (t.dateSource === 'published') {
      meta.textContent = 'Date is when the tick was posted';
      meta.title = 'The feed did not give the actual climb date, so this is when the tick appeared in the feed.';
    }
    if (t.style) meta.textContent += `${meta.textContent ? ' · ' : ''}${t.style}`;
    if (meta.textContent) li.appendChild(meta);
    if (t.notes) li.appendChild(h('p', 'notes', t.notes));
    return li;
  }

  el.form.addEventListener('submit', (e) => e.preventDefault());
  for (const c of [el.q, el.climber, el.grade, el.area]) {
    c.addEventListener('input', () => { shown = PAGE_SIZE; render(); });
    c.addEventListener('change', () => { shown = PAGE_SIZE; render(); });
  }
  el.reset.addEventListener('click', () => {
    el.q.value = ''; el.climber.value = ''; el.grade.value = ''; el.area.value = '';
    shown = PAGE_SIZE;
    render();
    el.q.focus();
  });
  el.more.addEventListener('click', () => { shown += PAGE_SIZE; render(); });

  render();
}

if (typeof document !== 'undefined' && !globalThis.__CRAG_TEST__) {
  init(document, (...a) => fetch(...a));
}
