import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateConfig, ConfigError } from '../scripts/lib/config.mjs';
import { root } from './helpers.mjs';

const good = (extra = {}) => ({ name: 'Pat', feedUrl: 'https://www.mountainproject.com/rss/user-ticks/123456', ...extra });

test('the shipped config is valid and contains the two known feeds', () => {
  const raw = JSON.parse(readFileSync(path.join(root, 'config', 'climbers.json'), 'utf8'));
  const { climbers, errors } = validateConfig(raw);
  assert.deepEqual(errors, []);
  assert.deepEqual(climbers.map((c) => c.id), ['200484813', '201670934']);
});

// Test 14
test('invalid entries are reported with short safe messages and skipped', () => {
  const { climbers, errors } = validateConfig({
    climbers: [
      good(),
      good({ name: 'Http', feedUrl: 'http://www.mountainproject.com/rss/user-ticks/1' }),
      good({ name: 'Other site', feedUrl: 'https://example.com/rss/user-ticks/1' }),
      good({ name: 'Wrong path', feedUrl: 'https://www.mountainproject.com/user/1/x/ticks' }),
      good({ name: '', feedUrl: 'https://www.mountainproject.com/rss/user-ticks/2' }),
      good({ name: 'Dup', feedUrl: 'https://www.mountainproject.com/rss/user-ticks/123456' }),
      'not an object',
      good({ name: 'Bad profile', feedUrl: 'https://www.mountainproject.com/rss/user-ticks/9', profileUrl: 'https://evil.example/x' }),
    ],
  });
  assert.deepEqual(climbers.map((c) => c.name), ['Pat', 'Bad profile']);
  assert.equal(climbers[1].profileUrl, null);
  assert.equal(errors.length, 7);
  for (const e of errors) {
    assert.ok(e.length < 200);
    assert.ok(!/\bat\s.+\.m?js:\d+/.test(e), 'no stack traces');
  }
});

test('a config without a climbers list throws a ConfigError', () => {
  assert.throws(() => validateConfig({}), ConfigError);
  assert.throws(() => validateConfig(null), ConfigError);
  assert.throws(() => validateConfig({ climbers: 'nope' }), ConfigError);
});

test('feed URLs are normalised (trailing slash and whitespace allowed)', () => {
  const { climbers } = validateConfig({ climbers: [good({ feedUrl: '  https://www.mountainproject.com/rss/user-ticks/42/  ' })] });
  assert.equal(climbers[0].feedUrl, 'https://www.mountainproject.com/rss/user-ticks/42');
});
