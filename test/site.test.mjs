import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { parseFeed } from '../scripts/lib/parse.mjs';
import { mergeState } from '../scripts/lib/merge.mjs';
import { fixture, A, B, root } from './helpers.mjs';

globalThis.__CRAG_TEST__ = true;
const { init } = await import('../site/app.js');

const NOW = Date.parse('2026-10-13T06:00:00.000Z');
const climbers = [{ ...A, profileUrl: null }, { ...B, profileUrl: null }];
const ok = (c, file) => ({ ok: true, ticks: parseFeed(fixture(file), c).ticks });
const baseState = () => mergeState({
  previous: null,
  results: new Map([[A.id, ok(A, 'cam.xml')], [B.id, ok(B, 'reece.xml')]]),
  climbers,
  now: '2026-10-13T00:00:00.000Z',
}).state;

async function mount(stateOrFailure, { now = NOW } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String(e.message || e)));
  virtualConsole.on('error', (...a) => errors.push(a.join(' ')));
  const html = readFileSync(path.join(root, 'site', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { virtualConsole, url: 'http://127.0.0.1/crag-feed/' });
  const requested = [];
  const fetchFn = async (url) => {
    requested.push(url);
    if (stateOrFailure === 'fail') throw new Error('offline');
    return { ok: true, json: async () => structuredClone(stateOrFailure) };
  };
  await init(dom.window.document, fetchFn, () => now);
  const d = dom.window.document;
  const api = {
    errors, requested, dom, d,
    text: (id) => d.getElementById(id).textContent,
    type(value) {
      const q = d.getElementById('q');
      q.value = value;
      q.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    },
    select(id, value) {
      const s = d.getElementById(id);
      s.value = value;
      s.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    },
    click(id) { d.getElementById(id).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); },
    tickCount: () => d.querySelectorAll('#feed .tick').length,
  };
  return api;
}

// Tests 12 + 13 in the page, and 17 (console errors)
test('page renders the feed with count, notices and no console errors', async () => {
  const s = await mount(baseState());
  assert.equal(s.tickCount(), 7);
  assert.equal(s.text('count'), '7 ticks');
  assert.match(s.text('updated'), /Last updated/);
  assert.match(s.text('notices'), /most recent ticks available when tracking began/, 'explicit first-run message');
  assert.equal(s.d.querySelectorAll('.badge-new').length, 0, 'first run must not mark ticks as New');
  assert.deepEqual(s.errors, []);
});

test('search, filters and reset work together and the count updates', async () => {
  const s = await mount(baseState());
  s.type('gelsa');
  assert.equal(s.tickCount(), 1);
  assert.equal(s.text('count'), '1 of 7 ticks match');
  s.click('reset');
  assert.equal(s.tickCount(), 7);
  assert.equal(s.d.getElementById('q').value, '');
  s.select('climber', B.id);
  s.type('thin');
  assert.equal(s.tickCount(), 1);
  s.select('grade', '5.8');
  assert.equal(s.tickCount(), 0);
  assert.deepEqual(s.errors, []);
});

test('empty results show a clear message and no cards', async () => {
  const s = await mount(baseState());
  s.type('zzzzzz');
  assert.equal(s.tickCount(), 0);
  assert.equal(s.d.getElementById('empty').hidden, false);
  assert.match(s.text('empty'), /No ticks match/);
  assert.equal(s.text('count'), '0 of 7 ticks match');
});

test('before the first refresh the page explains there is no data yet', async () => {
  const s = await mount({ schemaVersion: 1, generatedAt: null, lastSuccessAt: null, configErrors: [], climbers: [], ticks: [] });
  assert.match(s.text('updated'), /No data has been collected yet/);
  assert.equal(s.d.getElementById('empty').hidden, false);
  assert.deepEqual(s.errors, []);
});

test('a data load failure shows a friendly error, not a stack trace', async () => {
  const s = await mount('fail');
  assert.equal(s.d.getElementById('error').hidden, false);
  assert.match(s.text('error'), /could not be loaded/);
  assert.ok(!/Error:|at .*\.js/.test(s.text('error')));
  assert.deepEqual(s.errors, []);
});

test('stale data and failed feeds are made visible', async () => {
  const state = baseState();
  state.climbers[1].status = 'failed';
  state.climbers[1].error = 'timed out';
  const s = await mount(state, { now: Date.parse('2026-10-20T00:00:00.000Z') });
  assert.match(s.text('notices'), /may be out of date/);
  assert.match(s.text('notices'), /Test Climber B's feed could not be refreshed/);
});

test('invalid configuration is reported on the page in plain words', async () => {
  const state = baseState();
  state.configErrors = ['Climber "Pat": "feedUrl" must look like https://www.mountainproject.com/rss/user-ticks/<number>.'];
  const s = await mount(state);
  assert.match(s.text('notices'), /Setup problem: Climber "Pat"/);
});

test('ticks discovered after the first run get a New badge', async () => {
  const first = baseState();
  const fresh = parseFeed(fixture('cam.xml'), A).ticks;
  const extra = { ...fresh[0], id: 'brand-new', route: 'Brand New Route', published: '2026-10-13T05:00:00.000Z', sortDate: '2026-10-13T05:00:00.000Z' };
  const next = mergeState({
    previous: first,
    results: new Map([[A.id, { ok: true, ticks: [extra, ...fresh] }], [B.id, ok(B, 'reece.xml')]]),
    climbers, now: '2026-10-13T05:30:00.000Z',
  }).state;
  const s = await mount(next);
  assert.equal(s.d.querySelectorAll('.badge-new').length, 1);
  assert.match(s.d.querySelector('.tick').textContent, /Brand New Route/);
  assert.equal(s.d.getElementById('notices').textContent.includes('tracking began'), false);
});

test('feed text is rendered as text, never as HTML; links open safely', async () => {
  const state = baseState();
  state.ticks[0].route = '<img src=x onerror=alert(1)>Evil';
  state.ticks[0].notes = '<script>alert(1)</script>';
  state.ticks[0].url = 'https://www.mountainproject.com/route/1/x';
  const s = await mount(state);
  assert.equal(s.d.querySelectorAll('#feed img, #feed script').length, 0);
  assert.ok(s.text('feed').includes('<img src=x onerror=alert(1)>Evil'));
  const a = s.d.querySelector('#feed .route a');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(a.getAttribute('target'), '_blank');
  for (const link of s.d.querySelectorAll('#feed a')) assert.match(link.href, /^https:\/\/www\.mountainproject\.com\//);
});

test('shows "Show more" paging for long feeds', async () => {
  const state = baseState();
  const base = state.ticks[0];
  state.ticks = Array.from({ length: 120 }, (_, i) => ({ ...base, id: `x${i}`, route: `Route ${i}` }));
  const s = await mount(state);
  assert.equal(s.tickCount(), 50);
  assert.equal(s.d.getElementById('more').hidden, false);
  s.click('more');
  assert.equal(s.tickCount(), 100);
});

// Test 15
test('the page requests its data with a relative path (works under /crag-feed/)', async () => {
  const s = await mount(baseState());
  assert.deepEqual(s.requested, ['data/ticks.json']);
});

test('site served from a project sub-path (/crag-feed/) loads every file it references', async () => {
  const siteDir = path.join(root, 'site');
  const prefix = '/crag-feed/';
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith(prefix)) { res.statusCode = 404; return res.end('not found'); }
    let rel = decodeURIComponent(req.url.slice(prefix.length).split('?')[0]) || 'index.html';
    const file = path.join(siteDir, rel);
    if (!file.startsWith(siteDir)) { res.statusCode = 403; return res.end(); }
    try {
      const body = readFileSync(file);
      res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch { res.statusCode = 404; res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.equal((await fetch(new URL('styles.css', base))).status, 200);
    assert.equal((await fetch(new URL('app.js', base))).status, 200);
    assert.equal((await fetch(new URL('filters.js', base))).status, 200);
    for (const f of ['manage.html', 'manage.js', 'github.js', 'config-edit.js']) {
      assert.equal((await fetch(new URL(f, base))).status, 200, f);
    }
    const data = await fetch(new URL('data/ticks.json', base));
    assert.equal(data.status, 200);
    JSON.parse(await data.text());
    // Nothing may point at the domain root (which would break under /crag-feed/).
    for (const f of ['index.html', 'app.js', 'filters.js', 'styles.css', 'manage.html', 'manage.js', 'github.js', 'config-edit.js']) {
      const src = readFileSync(path.join(siteDir, f), 'utf8');
      assert.ok(!/(?:src|href)=["']\/(?!\/)/.test(src), `${f} has a root-absolute src/href`);
      assert.ok(!/fetch\(\s*['"`]\//.test(src), `${f} fetches a root-absolute path`);
      assert.ok(!/url\(\s*['"]?\//.test(src), `${f} has a root-absolute url()`);
      assert.ok(!/from\s+['"]\//.test(src), `${f} has a root-absolute import`);
    }
    assert.ok(html.includes('href="styles.css"') && html.includes('src="app.js"') && html.includes('href="manage.html"'));
  } finally {
    server.close();
  }
});

// Test 16
test('the public feed needs no API key or paid service; the optional Manage page only handles a token the owner pastes', () => {
  const files = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p); else files.push(p);
    }
  };
  walk(path.join(root, 'site'));
  walk(path.join(root, 'scripts'));
  const manageFiles = new Set(['manage.html', 'manage.js', 'github.js', 'config-edit.js']);
  for (const f of files) {
    if (f.endsWith('.json')) continue;
    const rel = path.relative(root, f);
    const src = readFileSync(f, 'utf8');
    // No file may contain a real-looking token.
    assert.ok(!/github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}/.test(src), `${rel} contains a token`);
    const isManage = manageFiles.has(path.basename(f)) && f.includes(`${path.sep}site${path.sep}`);
    if (!isManage) {
      assert.ok(!/api[_-]?key|secret|password|bearer|authorization/i.test(src), `${rel} mentions a credential`);
    }
    const allowed = isManage
      ? ['www.mountainproject.com', 'mountainproject.com', 'www.w3.org', 'api.github.com', 'github.com']
      : ['www.mountainproject.com', 'mountainproject.com', 'www.w3.org'];
    for (const m of src.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
      const host = new URL(m[0].replace(/[.,;]+$/, '')).hostname;
      assert.ok(allowed.includes(host), `${rel} references ${host}`);
    }
    if (f.includes(`${path.sep}scripts${path.sep}`)) {
      for (const m of src.matchAll(/process\.env\.([A-Z_]+)/g)) assert.match(m[1], /^CRAG_/, `${f} reads env ${m[1]}`);
    }
  }
  // The public feed page never loads the Manage code or talks to GitHub.
  for (const f of ['index.html', 'app.js', 'filters.js']) {
    const src = readFileSync(path.join(root, 'site', f), 'utf8');
    assert.ok(!/api\.github\.com|github\.js|manage\.js/.test(src), `${f} must not depend on the Manage code`);
  }
  // The Manage page only allows connections to GitHub's API and runs no inline script.
  const mhtml = readFileSync(path.join(root, 'site', 'manage.html'), 'utf8');
  assert.match(mhtml, /connect-src https:\/\/api\.github\.com/);
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(mhtml), 'no inline scripts');
  const wf = readFileSync(path.join(root, '.github', 'workflows', 'refresh-and-deploy.yml'), 'utf8');
  assert.ok(!/secrets\./.test(wf), 'refresh workflow must not use repository secrets');
});
