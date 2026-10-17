import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseClimberInput, addClimber, removeClimber, serializeConfig, climberId, slugToName, UserError } from '../site/config-edit.js';
import { validateConfig } from '../scripts/lib/config.mjs';
import { root } from './helpers.mjs';

const shipped = () => JSON.parse(readFileSync(path.join(root, 'config', 'climbers.json'), 'utf8'));

test('accepts a profile link, a ticks link, a feed link or a bare number', () => {
  assert.deepEqual(parseClimberInput('https://www.mountainproject.com/user/201670934/reece-james'), { id: '201670934', slug: 'reece-james' });
  assert.deepEqual(parseClimberInput('https://www.mountainproject.com/user/201670934/reece-james/ticks'), { id: '201670934', slug: 'reece-james' });
  assert.deepEqual(parseClimberInput('  https://www.mountainproject.com/rss/user-ticks/201670934  '), { id: '201670934', slug: null });
  assert.deepEqual(parseClimberInput('201670934'), { id: '201670934', slug: null });
  assert.deepEqual(parseClimberInput('https://www.mountainproject.com/user/201670934/ticks'), { id: '201670934', slug: null });
});

test('rejects anything else with a plain-English message', () => {
  for (const bad of ['', '   ', 'hello', 'http://www.mountainproject.com/user/1/x', 'https://example.com/user/123/x', 'https://www.mountainproject.com/route/123/x']) {
    assert.throws(() => parseClimberInput(bad), (e) => e instanceof UserError && e.message.length > 10, bad);
  }
});

test('names come from the typed name, else from the link', () => {
  const cfg = shipped();
  const a = addClimber(cfg, { name: '', input: 'https://www.mountainproject.com/user/123456789/jamie-lee-rose' });
  assert.equal(a.climbers.at(-1).name, 'Jamie Lee Rose');
  assert.equal(slugToName('mary_jane-w'), 'Mary Jane W');
  const b = addClimber(cfg, { name: '  Pat  ', input: '123456789' });
  assert.equal(b.climbers.at(-1).name, 'Pat');
  assert.throws(() => addClimber(cfg, { name: '', input: '123456789' }), UserError, 'a bare number with no name needs a name');
  assert.throws(() => addClimber(cfg, { name: 'x'.repeat(61), input: '123456789' }), UserError);
});

test('an added climber passes the same validation the refresh script uses', () => {
  const cfg = shipped();
  const withProfile = addClimber(cfg, { name: 'Jamie', input: 'https://www.mountainproject.com/user/123456789/jamie-rose' });
  const withoutProfile = addClimber(withProfile, { name: 'Sam', input: '987654321' });
  const { climbers, errors } = validateConfig(JSON.parse(serializeConfig(withoutProfile)));
  assert.deepEqual(errors, []);
  assert.deepEqual(climbers.map((c) => c.id), ['200484813', '201670934', '123456789', '987654321']);
  assert.equal(climbers[2].profileUrl, 'https://www.mountainproject.com/user/123456789/jamie-rose/ticks');
});

test('duplicates are refused and the original config is never mutated', () => {
  const cfg = shipped();
  const before = JSON.stringify(cfg);
  assert.throws(() => addClimber(cfg, { name: 'Again', input: '201670934' }), /already in the list/);
  addClimber(cfg, { name: 'New', input: '555' });
  assert.equal(JSON.stringify(cfg), before);
});

test('removing works, unknown ids are refused, and the last climber cannot be removed', () => {
  const cfg = shipped();
  const one = removeClimber(cfg, '201670934');
  assert.deepEqual(one.climbers.map(climberId), ['200484813']);
  assert.throws(() => removeClimber(one, '200484813'), /At least one/);
  assert.throws(() => removeClimber(cfg, '999'), /not in the list/);
});

test('serialised output is stable JSON with a trailing newline and keeps unknown fields', () => {
  const out = serializeConfig({ extra: 1, climbers: [{ name: 'A', feedUrl: 'https://www.mountainproject.com/rss/user-ticks/1' }] });
  assert.ok(out.endsWith('}\n'));
  assert.equal(JSON.parse(out).extra, 1);
  assert.equal(serializeConfig(shipped()), readFileSync(path.join(root, 'config', 'climbers.json'), 'utf8'), 'format matches the shipped file');
});
