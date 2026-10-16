import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../scripts/lib/parse.mjs';
import { applyFilters, gradeOptions, areaOptions, compareGrades, groupByDay, isStale, timeAgo } from '../site/filters.js';
import { fixture, A, B } from './helpers.mjs';

const ticks = [...parseFeed(fixture('cam.xml'), A).ticks, ...parseFeed(fixture('reece.xml'), B).ticks];
const none = { q: '', climber: '', grade: '', area: '' };
const f = (o) => applyFilters(ticks, { ...none, ...o });

// Test 12
test('no filters returns everything (this is what "reset" restores)', () => {
  assert.equal(f({}).length, 7);
});

test('search matches climber, route, grade and area, case-insensitively', () => {
  assert.equal(f({ q: 'gelsa' }).length, 1);
  const named = [{ ...ticks[0], climberName: 'Reece James' }, { ...ticks[1], climberName: 'Someone Else' }];
  assert.equal(applyFilters(named, { ...none, q: 'REECE' }).length, 1, 'climber name is searchable');
  assert.equal(f({ q: '5.7+' }).length, 3);
  assert.equal(f({ q: 'uberfall' }).length, 1);
  assert.equal(f({ q: 'shawangunks' }).length, 7 - 1); // all except the one with no area
});

test('search words are combined with AND', () => {
  assert.equal(f({ q: 'thin trapps' }).length, 3);
  assert.equal(f({ q: 'thin gelsa' }).length, 0);
});

test('climber, grade and area filters work individually', () => {
  assert.equal(f({ climber: B.id }).length, 2);
  assert.equal(f({ grade: '5.7+' }).length, 3);
  assert.equal(f({ area: 'Near Trapps' }).length, 1);
  assert.equal(f({ area: 'Trapps' }).length, 5);
});

test('filters work together', () => {
  assert.equal(f({ climber: B.id, grade: '5.7+' }).length, 1);
  assert.equal(f({ climber: A.id, grade: '5.7+', q: 'slabs' }).length, 2);
  assert.equal(f({ climber: B.id, area: 'Near Trapps' }).length, 0);
  assert.equal(f({ climber: A.id, q: 'exposure', area: 'Uberfall' }).length, 1);
});

test('grade options are listed in climbing order, not alphabetically', () => {
  assert.deepEqual(gradeOptions(ticks), ['5.6 PG13', '5.7+', '5.8', '5.9']);
  const sorted = ['V3', '5.10a', '5.9', '5.10d', '5.11a', '5.9+', 'WI4', '5.10'].sort(compareGrades);
  assert.deepEqual(sorted, ['5.9', '5.9+', '5.10', '5.10a', '5.10d', '5.11a', 'V3', 'WI4']);
});

test('area options skip generic roots and are ordered by frequency', () => {
  const opts = areaOptions(ticks);
  assert.equal(opts[0].count, 6);
  assert.deepEqual(opts.slice(0, 2).map((o) => o.name), ['New York', 'Shawangunks'], 'ties are broken alphabetically');
  assert.ok(opts.every((o, i) => i === 0 || opts[i - 1].count >= o.count), 'most common first');
  assert.ok(!opts.some((o) => /^destinations$/i.test(o.name)));
  assert.ok(opts.find((o) => o.name === 'Trapps').count === 5);
});

test('grouping puts adjacent same-day ticks together and keeps order', () => {
  const groups = groupByDay([...ticks].sort((a, b) => (a.sortDate < b.sortDate ? 1 : -1)));
  assert.equal(groups.reduce((n, g) => n + g.ticks.length, 0), 7);
  assert.ok(groups.length >= 4);
});

test('staleness and relative time helpers', () => {
  const now = Date.parse('2026-10-14T00:00:00Z');
  assert.equal(isStale('2026-10-13T20:00:00Z', now), false);
  assert.equal(isStale('2026-10-12T00:00:00Z', now), true);
  assert.equal(isStale(null, now), true);
  assert.equal(timeAgo('2026-10-13T20:00:00Z', now), '4 hours ago');
});
