import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, splitTitle, htmlToText, FeedError, compareTicksNewestFirst, tickId, feedReport } from '../scripts/lib/parse.mjs';
import { fixture, A, B } from './helpers.mjs';

// Test 1
test('valid RSS parses into normalised ticks', () => {
  const r = parseFeed(fixture('cam.xml'), A);
  assert.equal(r.itemCount, 5);
  assert.equal(r.ticks.length, 5);
  assert.equal(r.skipped.length, 0);
  const t = r.ticks[0];
  assert.equal(t.climberId, A.id);
  assert.equal(t.climberName, A.name);
  assert.equal(t.url, 'https://www.mountainproject.com/route/105800000/thin-slabs-direct');
  assert.equal(t.published, '2026-10-12T14:30:00.000Z');
});

test('an RSS feed with no items is valid and empty', () => {
  const r = parseFeed(fixture('empty-channel.xml'), A);
  assert.deepEqual(r.ticks, []);
  assert.equal(r.itemCount, 0);
});

// Test 2
test('malformed XML throws a controlled FeedError', () => {
  assert.throws(() => parseFeed(fixture('malformed.xml'), A), (e) => e instanceof FeedError && e.code === 'MALFORMED_XML');
});

test('empty body, non-RSS XML and DOCTYPE/ENTITY input are all rejected safely', () => {
  assert.throws(() => parseFeed('', A), (e) => e instanceof FeedError && e.code === 'EMPTY');
  assert.throws(() => parseFeed(fixture('not-rss.xml'), A), (e) => e instanceof FeedError && e.code === 'NOT_RSS');
  assert.throws(() => parseFeed(fixture('doctype.xml'), A), (e) => e instanceof FeedError && e.code === 'UNSAFE_XML');
});

// Test 3
test('route name and grade are split correctly', () => {
  const [slabs, exposure, , mystery, variation] = parseFeed(fixture('cam.xml'), A).ticks;
  assert.equal(slabs.route, 'Thin Slabs / Thin Slabs Direct');
  assert.equal(slabs.grade, '5.7+');
  assert.equal(exposure.route, 'High Exposure');
  assert.equal(exposure.grade, '5.6 PG13');
  assert.equal(mystery.route, 'Mystery Boulder Problem');
  assert.equal(mystery.grade, null);
  assert.equal(variation.route, 'Route With Name (Variation)');
  assert.equal(variation.grade, '5.9');
  assert.deepEqual(splitTitle('Boulder Thing (V3)'), { route: 'Boulder Thing', grade: 'V3' });
  assert.deepEqual(splitTitle('Easy One (VB)'), { route: 'Easy One', grade: 'VB' });
  assert.deepEqual(splitTitle('Name (Alt Name)'), { route: 'Name (Alt Name)', grade: null });
});

// Test 4
test('dates are ISO strings and sort newest first', () => {
  const ticks = [...parseFeed(fixture('cam.xml'), A).ticks, ...parseFeed(fixture('reece.xml'), B).ticks];
  const sorted = [...ticks].sort(compareTicksNewestFirst);
  const dates = sorted.map((t) => t.sortDate);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.equal(sorted[0].published, '2026-10-12T14:30:00.000Z');
  for (const t of ticks) assert.match(t.published, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

// Test 5
test('publication date is never silently treated as the climb date', () => {
  const plain = parseFeed(fixture('cam.xml'), A).ticks[0];
  assert.equal(plain.climbDate, null);
  assert.equal(plain.dateSource, 'published');

  const [labelled, other] = parseFeed(fixture('labelled.xml'), { id: '200000003', name: 'C' }).ticks;
  assert.equal(labelled.climbDate, '2026-10-09');
  assert.equal(labelled.dateSource, 'tick');
  assert.notEqual(labelled.climbDate, labelled.published.slice(0, 10));
  // The tick with a real climb date (Oct 9) sorts BELOW a tick published on Oct 11, even though
  // its feed pubDate (Oct 12) is newer.
  assert.equal([labelled, other].sort(compareTicksNewestFirst)[0].route, 'Leaf First Route');
});

// Test 6
test('area breadcrumbs are extracted when present and empty when absent', () => {
  const [slabs, , , mystery] = parseFeed(fixture('cam.xml'), A).ticks;
  assert.deepEqual(slabs.areaPath, ['Destinations', 'New York', 'Shawangunks', 'Trapps', 'Thin Slabs']);
  assert.equal(slabs.area, 'Trapps › Thin Slabs');
  assert.deepEqual(mystery.areaPath, []);
  assert.equal(mystery.area, null);
});

test('double-escaped HTML, labels, leaf-first breadcrumbs and unsafe links are handled', () => {
  const [a, b] = parseFeed(fixture('labelled.xml'), { id: '200000003', name: 'C' }).ticks;
  assert.equal(a.route, 'Test Route & Friends');
  assert.equal(a.grade, 'V3');
  assert.deepEqual(a.areaPath, ['All Locations', 'Colorado', 'Test Crag']);
  assert.equal(a.style, 'Lead, Redpoint');
  assert.ok(!/[<>]/.test(a.notes), 'notes must be plain text');
  assert.deepEqual(b.areaPath, ['All Locations', 'Colorado', 'Test Crag', 'Test Wall']);
  assert.equal(b.url, null, 'javascript: links must be dropped');
});

test('htmlToText never returns markup and does not strip a leading "In" from real names', () => {
  assert.equal(htmlToText('<b>Hi</b> &lt;i&gt;there&lt;/i&gt;<br>line 2'), 'Hi there\nline 2');
  const { areaPath } = parseFeed(
    '<rss><channel><item><title>X (5.9)</title><guid>1</guid><description>Indian Creek &gt; Utah &gt; All Locations</description></item></channel></rss>', A,
  ).ticks[0];
  assert.equal(areaPath[0], 'All Locations');
  assert.ok(areaPath.includes('Indian Creek'));
});

test('items missing essentials are skipped, not fatal', () => {
  const xml = '<rss><channel><item><guid>1</guid></item><item><title>Ok (5.9)</title><guid>2</guid></item></channel></rss>';
  const r = parseFeed(xml, A);
  assert.equal(r.ticks.length, 1);
  assert.equal(r.skipped.length, 1);
});

// Tests 7/8 at the identity level (merge tests cover the storage level)
test('tick ids are stable, and differ between climbers and between dates', () => {
  assert.equal(tickId('1', 'g', 'l', '2026-01-01T00:00:00.000Z'), tickId('1', 'g', 'l', '2026-01-01T00:00:00.000Z'));
  assert.notEqual(tickId('1', 'g', 'l', '2026-01-01T00:00:00.000Z'), tickId('2', 'g', 'l', '2026-01-01T00:00:00.000Z'));
  assert.notEqual(tickId('1', 'g', 'l', '2026-01-01T00:00:00.000Z'), tickId('1', 'g', 'l', '2026-01-02T00:00:00.000Z'));
});

test('same route ticked on two different days by one person stays two ticks', () => {
  const ticks = parseFeed(fixture('cam.xml'), A).ticks.filter((t) => t.route.startsWith('Thin Slabs'));
  assert.equal(ticks.length, 2);
  assert.notEqual(ticks[0].id, ticks[1].id);
});

test('feedReport summarises what the feed contains', () => {
  const rep = feedReport(parseFeed(fixture('cam.xml'), A));
  assert.equal(rep.itemsInFeed, 5);
  assert.equal(rep.uniqueTickIds, 5);
  assert.equal(rep.withLabelledClimbDate, 0);
  assert.equal(rep.oldestPublished, '2026-10-01T12:00:00.000Z');
});
