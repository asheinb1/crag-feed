import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../scripts/lib/parse.mjs';
import { mergeState } from '../scripts/lib/merge.mjs';
import { isNew } from '../site/filters.js';
import { fixture, A, B } from './helpers.mjs';

const climbers = [{ ...A, profileUrl: null }, { ...B, profileUrl: null }];
const okA = () => ({ ok: true, ticks: parseFeed(fixture('cam.xml'), A).ticks });
const okB = () => ({ ok: true, ticks: parseFeed(fixture('reece.xml'), B).ticks });
const T1 = '2026-10-13T00:00:00.000Z';
const T2 = '2026-10-13T06:00:00.000Z';
const T3 = '2026-10-13T12:00:00.000Z';

function run(previous, results, now, cl = climbers) {
  return mergeState({ previous, results: new Map(results), climbers: cl, now });
}

// Tests 7, 8, 11 (first run)
test('first run stores everything as baseline: nothing is marked new', () => {
  const { state, newTickCount } = run(null, [[A.id, okA()], [B.id, okB()]], T1);
  assert.equal(state.ticks.length, 7);
  assert.equal(newTickCount, 0);
  assert.ok(state.ticks.every((t) => t.baseline === true && t.firstSeenAt === T1));
  assert.ok(state.ticks.every((t) => !isNew(t, Date.parse(T1))));
  assert.deepEqual(state.climbers.map((c) => c.status), ['ok', 'ok']);
  assert.equal(state.lastSuccessAt, T1);
});

// Test 7
test('repeated refreshes do not duplicate ticks or reset firstSeenAt', () => {
  const r1 = run(null, [[A.id, okA()], [B.id, okB()]], T1);
  const r2 = run(r1.state, [[A.id, okA()], [B.id, okB()]], T2);
  assert.equal(r2.state.ticks.length, 7);
  assert.equal(new Set(r2.state.ticks.map((t) => t.id)).size, 7);
  assert.ok(r2.state.ticks.every((t) => t.firstSeenAt === T1));
  assert.equal(r2.newTickCount, 0);
  assert.equal(r2.state.lastSuccessAt, T2);
});

// Test 8
test('the same route by two different climbers stays two ticks', () => {
  const { state } = run(null, [[A.id, okA()], [B.id, okB()]], T1);
  const slabs = state.ticks.filter((t) => t.route.startsWith('Thin Slabs'));
  // A has two Thin Slabs ticks (different days), B has one.
  assert.equal(slabs.length, 3);
  assert.deepEqual([...new Set(slabs.map((t) => t.climberId))].sort(), [A.id, B.id]);
});

// Test 11
test('a tick discovered on a later run is new; baseline ticks never become new', () => {
  const r1 = run(null, [[A.id, okA()], [B.id, okB()]], T1);
  const fresh = parseFeed(fixture('cam.xml'), A).ticks;
  const extra = { ...fresh[0], id: 'brand-new', route: 'Brand New Route', published: '2026-10-13T08:00:00.000Z', sortDate: '2026-10-13T08:00:00.000Z' };
  const r2 = run(r1.state, [[A.id, { ok: true, ticks: [extra, ...fresh] }], [B.id, okB()]], T2);
  assert.equal(r2.newTickCount, 1);
  const added = r2.state.ticks.find((t) => t.id === 'brand-new');
  assert.equal(added.baseline, false);
  assert.equal(added.firstSeenAt, T2);
  assert.equal(r2.state.ticks[0].id, 'brand-new', 'newest tick sorts first');
  assert.ok(isNew(added, Date.parse(T3)));
  assert.ok(!isNew(added, Date.parse('2026-10-20T00:00:00.000Z')), 'New badge expires after 3 days');
  assert.equal(r2.state.ticks.filter((t) => isNew(t, Date.parse(T3))).length, 1);
});

test('a climber added later is seeded as baseline without making older climbers\' ticks baseline', () => {
  const r1 = run(null, [[A.id, okA()]], T1, [climbers[0]]);
  const r2 = run(r1.state, [[A.id, okA()], [B.id, okB()]], T2);
  assert.ok(r2.state.ticks.filter((t) => t.climberId === B.id).every((t) => t.baseline && t.firstSeenAt === T2));
  assert.equal(r2.newTickCount, 0);
});

test('removing a climber from the config removes their ticks from the output', () => {
  const r1 = run(null, [[A.id, okA()], [B.id, okB()]], T1);
  const r2 = run(r1.state, [[A.id, okA()]], T2, [climbers[0]]);
  assert.equal(r2.state.ticks.length, 5);
  assert.equal(r2.state.climbers.length, 1);
});

// Test 9
test('a failed feed does not erase previously valid data', () => {
  const r1 = run(null, [[A.id, okA()], [B.id, okB()]], T1);
  const r2 = run(r1.state, [[A.id, { ok: false, error: 'The request timed out.' }], [B.id, { ok: false, error: 'x' }]], T2);
  assert.equal(r2.state.ticks.length, 7);
  assert.equal(r2.anyOk, false);
  assert.equal(r2.state.lastSuccessAt, T1, 'last success must not advance on total failure');
  const a = r2.state.climbers.find((c) => c.id === A.id);
  assert.equal(a.status, 'failed');
  assert.equal(a.lastSuccessAt, T1);
  assert.equal(a.lastAttemptAt, T2);
  assert.equal(a.error, 'The request timed out.');
});

test('an unexpectedly empty feed does not wipe a climber who had ticks', () => {
  const r1 = run(null, [[A.id, okA()], [B.id, okB()]], T1);
  const r2 = run(r1.state, [[A.id, { ok: true, ticks: [] }], [B.id, okB()]], T2);
  assert.equal(r2.state.ticks.filter((t) => t.climberId === A.id).length, 5);
  assert.equal(r2.state.climbers.find((c) => c.id === A.id).status, 'failed');
});

// Test 10
test('a good feed still updates when another feed fails', () => {
  const r1 = run(null, [[A.id, okA()], [B.id, okB()]], T1);
  const fresh = parseFeed(fixture('cam.xml'), A).ticks;
  const extra = { ...fresh[0], id: 'brand-new', published: '2026-10-13T08:00:00.000Z', sortDate: '2026-10-13T08:00:00.000Z' };
  const r2 = run(r1.state, [[A.id, { ok: true, ticks: [extra, ...fresh] }], [B.id, { ok: false, error: 'HTTP 500' }]], T2);
  assert.equal(r2.anyOk, true);
  assert.equal(r2.newTickCount, 1);
  assert.equal(r2.state.ticks.length, 8);
  assert.equal(r2.state.ticks.filter((t) => t.climberId === B.id).length, 2, 'B kept');
  assert.equal(r2.state.lastSuccessAt, T2);
  const statuses = Object.fromEntries(r2.state.climbers.map((c) => [c.id, c.status]));
  assert.deepEqual(statuses, { [A.id]: 'ok', [B.id]: 'failed' });
});

test('a first run where every feed fails produces an empty but valid state', () => {
  const r = run(null, [[A.id, { ok: false, error: 'x' }], [B.id, { ok: false, error: 'y' }]], T1);
  assert.equal(r.state.ticks.length, 0);
  assert.equal(r.state.lastSuccessAt, null);
});
