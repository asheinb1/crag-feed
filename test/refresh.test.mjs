// End-to-end test of scripts/refresh.mjs using offline fixture files instead of the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root } from './helpers.mjs';

const script = path.join(root, 'scripts', 'refresh.mjs');
const CAM = '200484813';
const REECE = '201670934';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crag-'));
  copyFileSync(path.join(root, 'test', 'fixtures', 'cam.xml'), path.join(dir, `${CAM}.xml`));
  copyFileSync(path.join(root, 'test', 'fixtures', 'reece.xml'), path.join(dir, `${REECE}.xml`));
  return { dir, data: path.join(dir, 'ticks.json') };
}
const run = ({ dir, data }) => spawnSync(process.execPath, [script], {
  env: { ...process.env, CRAG_OFFLINE_DIR: dir, CRAG_DATA_PATH: data }, encoding: 'utf8',
});
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('end to end: first run, repeat run, one feed failing, all feeds failing', () => {
  const ctx = setup();
  try {
    let r = run(ctx);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    let s = load(ctx.data);
    assert.equal(s.ticks.length, 7);
    assert.ok(s.ticks.every((t) => t.baseline));
    assert.ok(r.stdout.includes('Feed report'));

    r = run(ctx);
    assert.equal(r.status, 0);
    s = load(ctx.data);
    assert.equal(s.ticks.length, 7, 'repeat refresh must not duplicate');

    // Reece's feed breaks (malformed XML); Cam's still works.
    copyFileSync(path.join(root, 'test', 'fixtures', 'malformed.xml'), path.join(ctx.dir, `${REECE}.xml`));
    r = run(ctx);
    assert.equal(r.status, 0, 'one failing feed is a warning, not a failed run');
    assert.match(r.stdout, /::warning::.*Reece James.*not valid XML/);
    s = load(ctx.data);
    assert.equal(s.ticks.length, 7);
    assert.equal(s.climbers.find((c) => c.id === REECE).status, 'failed');
    assert.equal(s.climbers.find((c) => c.id === CAM).status, 'ok');
    assert.ok(!/at .*\.mjs:\d+/.test(JSON.stringify(s)), 'no stack traces in published data');
    const lastOk = s.lastSuccessAt;

    // Everything breaks.
    copyFileSync(path.join(root, 'test', 'fixtures', 'not-rss.xml'), path.join(ctx.dir, `${CAM}.xml`));
    r = run(ctx);
    assert.equal(r.status, 1, 'a run where nothing refreshed must be marked failed');
    s = load(ctx.data);
    assert.equal(s.ticks.length, 7, 'previous data kept');
    assert.equal(s.lastSuccessAt, lastOk, 'last success time must not advance');
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test('a corrupted saved data file does not crash the refresh', () => {
  const ctx = setup();
  try {
    writeFileSync(ctx.data, '{ not json');
    const r = run(ctx);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(load(ctx.data).ticks.length, 7);
    assert.match(r.stdout, /could not be read/);
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});
