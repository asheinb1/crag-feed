import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { toBase64, fromBase64 } from '../site/github.js';
import { root } from './helpers.mjs';

globalThis.__CRAG_TEST__ = true;
const { init, deriveRepo } = await import('../site/manage.js');

const TOKEN = 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef';
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const shippedConfig = () => readFileSync(path.join(root, 'config', 'climbers.json'), 'utf8');

const res = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers });

/** A small fake of the parts of the GitHub API that the Manage page uses. */
function fakeGitHub(opts = {}) {
  const st = {
    file: shippedConfig(), version: 1, canPush: true, wfState: 'active', calls: [], dispatches: 0, enables: 0,
    failNext: null, runs: [{ id: 1, status: 'completed', conclusion: 'success', event: 'schedule', created_at: new Date(NOW - 2 * 3600e3).toISOString(), html_url: 'https://github.com/amy/crag-feed/actions/runs/1' }],
    ...opts,
  };
  const sha = () => `sha${st.version}`;
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    st.calls.push({ method, path: u.pathname, auth: init.headers && init.headers.Authorization, body });
    if (st.failNext && st.failNext.test(`${method} ${u.pathname}`)) { const s = st.failNext.status; st.failNext = null; return res({ message: 'nope' }, s); }
    const p = u.pathname.replace('/repos/amy/crag-feed', '');
    if (p === '' && method === 'GET') return res({ default_branch: 'main', private: false, permissions: { push: st.canPush } });
    if (p === '/contents/config/climbers.json' && method === 'GET') return res({ content: toBase64(st.file), sha: sha(), encoding: 'base64' });
    if (p === '/contents/config/climbers.json' && method === 'PUT') {
      if (body.sha !== sha()) return res({ message: 'conflict' }, 409);
      st.file = fromBase64(body.content); st.version += 1;
      st.runs.unshift({ id: 100 + st.version, status: 'completed', conclusion: 'success', event: 'push', created_at: new Date(NOW).toISOString(), html_url: 'https://github.com/amy/crag-feed/actions/runs/9' });
      return res({ commit: {} });
    }
    if (p.endsWith('/dispatches') && method === 'POST') {
      st.dispatches += 1;
      st.runs.unshift({ id: 200 + st.dispatches, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', created_at: new Date(NOW).toISOString(), html_url: null });
      return new Response(null, { status: 204 });
    }
    if (p.endsWith('/enable') && method === 'PUT') { st.enables += 1; st.wfState = 'active'; return new Response(null, { status: 204 }); }
    if (p.includes('/actions/workflows/refresh-and-deploy.yml/runs')) return res({ workflow_runs: st.runs });
    if (p.endsWith('/actions/workflows/refresh-and-deploy.yml')) return res({ state: st.wfState });
    return res({ message: 'unexpected' }, 404);
  };
  return { st, fetchFn };
}

async function mount({ gh = fakeGitHub(), storedToken = '', url = 'https://amy.github.io/crag-feed/manage.html' } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const html = readFileSync(path.join(root, 'site', 'manage.html'), 'utf8');
  const dom = new JSDOM(html, { virtualConsole: vc, url });
  const w = dom.window;
  if (storedToken) w.sessionStorage.setItem('cragfeed.token', storedToken);
  await init(w.document, { fetchFn: gh.fetchFn, local: w.localStorage, session: w.sessionStorage, location: w.location, sleep: async () => {}, nowFn: () => NOW });
  const d = w.document;
  const api = {
    gh, w, d, errors,
    text: (id) => d.getElementById(id).textContent,
    names: () => [...d.querySelectorAll('.climber-name')].map((n) => n.textContent),
    settle: async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); },
    async connect(token = TOKEN, remember = false) {
      d.getElementById('token').value = token;
      d.getElementById('remember').checked = remember;
      d.getElementById('token-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await api.settle();
    },
    async add(input, name = '') {
      d.getElementById('add-input').value = input;
      d.getElementById('add-name').value = name;
      d.getElementById('add-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await api.settle();
    },
    async click(el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await api.settle(); },
    removeBtn: (name) => d.querySelector(`button[aria-label="Remove ${name}"]`),
  };
  return api;
}

test('repository is derived from a GitHub Pages address', () => {
  assert.equal(deriveRepo({ hostname: 'amy.github.io', pathname: '/crag-feed/manage.html' }), 'amy/crag-feed');
  assert.equal(deriveRepo({ hostname: 'amy.github.io', pathname: '/manage.html' }), '');
  assert.equal(deriveRepo({ hostname: 'example.com', pathname: '/crag-feed/' }), '');
});

test('without a token the page shows status but offers no working edit controls', async () => {
  const m = await mount();
  assert.deepEqual(m.names(), ['cam-maam', 'Reece James']);
  assert.match(m.text('conn-status'), /Not connected/);
  assert.equal(m.d.getElementById('add-btn').disabled, true);
  assert.equal(m.d.getElementById('refresh-now').disabled, true);
  assert.ok([...m.d.querySelectorAll('.climber-row button')].every((b) => b.disabled));
  assert.match(m.text('run-summary'), /Last finished run: succeeded 2 hours ago/);
  assert.equal(m.d.querySelectorAll('.runs li').length, 1);
  assert.ok(m.gh.st.calls.every((c) => !c.auth), 'no token is sent when there is none');
  assert.deepEqual(m.errors, []);
});

test('connecting keeps the token out of the page and out of long-term storage by default', async () => {
  const m = await mount();
  await m.connect();
  assert.match(m.text('conn-status'), /Connected/);
  assert.equal(m.d.getElementById('token').value, '', 'input is cleared');
  assert.ok(!m.d.documentElement.outerHTML.includes(TOKEN), 'token is never written into the page');
  assert.equal(m.w.sessionStorage.getItem('cragfeed.token'), TOKEN);
  assert.equal(m.w.localStorage.getItem('cragfeed.token'), null);
  assert.equal(m.d.getElementById('add-btn').disabled, false);
  assert.equal(m.d.getElementById('disconnect').hidden, false);
});

test('"remember" stores the token on this device; disconnect removes it everywhere', async () => {
  const m = await mount();
  await m.connect(TOKEN, true);
  assert.equal(m.w.localStorage.getItem('cragfeed.token'), TOKEN);
  assert.equal(m.w.sessionStorage.getItem('cragfeed.token'), null);
  await m.click(m.d.getElementById('disconnect'));
  assert.equal(m.w.localStorage.getItem('cragfeed.token'), null);
  assert.equal(m.w.sessionStorage.getItem('cragfeed.token'), null);
  assert.match(m.text('conn-status'), /Not connected/);
  assert.equal(m.d.getElementById('add-btn').disabled, true);
});

test('a malformed token is refused before anything is sent', async () => {
  const m = await mount();
  const before = m.gh.st.calls.length;
  await m.connect('not a token!');
  assert.equal(m.d.getElementById('problem').hidden, false);
  assert.match(m.text('problem'), /does not look like a GitHub token/);
  assert.equal(m.gh.st.calls.length, before);
});

test('a token that cannot write is called out', async () => {
  const m = await mount({ gh: fakeGitHub({ canPush: false }) });
  await m.connect();
  assert.match(m.text('conn-status'), /cannot write/);
  assert.equal(m.d.getElementById('add-btn').disabled, true);
});

test('adding a friend commits the new list with the token, then shows progress', async () => {
  const m = await mount({ storedToken: TOKEN });
  await m.add('https://www.mountainproject.com/user/123456789/jamie-rose');
  const put = m.gh.st.calls.find((c) => c.method === 'PUT' && c.path.endsWith('climbers.json'));
  assert.ok(put, 'file was written');
  assert.equal(put.auth, `Bearer ${TOKEN}`);
  assert.equal(put.body.branch, 'main');
  const saved = JSON.parse(m.gh.st.file);
  assert.deepEqual(saved.climbers.map((c) => c.name), ['cam-maam', 'Reece James', 'Jamie Rose']);
  assert.equal(saved.climbers[2].feedUrl, 'https://www.mountainproject.com/rss/user-ticks/123456789');
  assert.deepEqual(m.names(), ['cam-maam', 'Reece James', 'Jamie Rose']);
  assert.match(m.text('message'), /Added Jamie Rose\. A refresh starts automatically/);
  assert.equal(m.d.getElementById('add-input').value, '', 'form cleared');
  assert.equal(m.d.querySelector('.runs li .run-meta').textContent.includes('after a change'), true);
  assert.deepEqual(m.errors, []);
});

test('bad input shows a message and writes nothing', async () => {
  const m = await mount({ storedToken: TOKEN });
  await m.add('hello world');
  assert.match(m.text('problem'), /does not look like a Mountain Project profile link/);
  await m.add('201670934', 'Dupe');
  assert.match(m.text('problem'), /already in the list/);
  assert.equal(m.gh.st.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('removing takes two clicks, then commits; the last friend cannot be removed', async () => {
  const m = await mount({ storedToken: TOKEN });
  await m.click(m.removeBtn('Reece James'));
  assert.equal(m.gh.st.calls.filter((c) => c.method === 'PUT').length, 0, 'first click only asks for confirmation');
  assert.match(m.removeBtn('Reece James').textContent, /Click again/);
  await m.click(m.removeBtn('Reece James'));
  assert.deepEqual(JSON.parse(m.gh.st.file).climbers.map((c) => c.name), ['cam-maam']);
  assert.deepEqual(m.names(), ['cam-maam']);
  assert.match(m.text('message'), /Removed Reece James/);
  assert.equal(m.removeBtn('cam-maam').disabled, true, 'last climber is protected');
});

test('Refresh now triggers the workflow on the default branch and shows the new run', async () => {
  const m = await mount({ storedToken: TOKEN });
  await m.click(m.d.getElementById('refresh-now'));
  assert.equal(m.gh.st.dispatches, 1);
  const post = m.gh.st.calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { ref: 'main' });
  assert.equal(post.auth, `Bearer ${TOKEN}`);
  assert.match(m.text('message'), /Refresh started/);
  assert.ok(m.text('runs').includes('manual'));
});

test('paused automatic updates are called out and can be resumed', async () => {
  const m = await mount({ storedToken: TOKEN, gh: fakeGitHub({ wfState: 'disabled_inactivity' }) });
  assert.equal(m.d.getElementById('workflow-warning').hidden, false);
  assert.match(m.text('workflow-warning-text'), /paused/);
  await m.click(m.d.getElementById('enable-workflow'));
  assert.equal(m.gh.st.enables, 1);
  assert.equal(m.d.getElementById('workflow-warning').hidden, true);
});

test('an old last run is flagged as possibly stopped', async () => {
  const old = [{ id: 1, status: 'completed', conclusion: 'success', event: 'schedule', created_at: new Date(NOW - 3 * 24 * 3600e3).toISOString(), html_url: null }];
  const m = await mount({ gh: fakeGitHub({ runs: old }) });
  assert.match(m.text('run-summary'), /updates may have stopped/);
});

test('an expired token gives a friendly message, not a stack trace', async () => {
  const gh = fakeGitHub();
  const m = await mount({ storedToken: TOKEN, gh });
  gh.st.failNext = Object.assign(/^PUT /, { status: 401 });
  await m.add('555', 'Newbie');
  assert.match(m.text('problem'), /rejected the token/);
  assert.ok(!/Error:|at .*\.js|nope/.test(m.text('problem')));
  assert.deepEqual(m.errors, []);
});

test('if the file changed on GitHub meanwhile, the page reloads the list and asks to retry', async () => {
  const gh = fakeGitHub();
  const m = await mount({ storedToken: TOKEN, gh });
  gh.st.version += 1; // someone else committed
  await m.add('555', 'Newbie');
  assert.match(m.text('problem'), /changed on GitHub/);
  await m.add('555', 'Newbie');
  assert.ok(m.names().includes('Newbie'), 'second try succeeds');
});

test('a missing repository setting is explained, and entering it works', async () => {
  const gh = fakeGitHub();
  const m = await mount({ gh, url: 'https://example.com/manage.html' });
  assert.match(m.text('conn-status'), /Repository not set/);
  assert.equal(m.d.getElementById('advanced').open, true);
  const input = m.d.getElementById('repo-input');
  input.value = 'amy/crag-feed';
  input.dispatchEvent(new m.w.Event('change', { bubbles: true }));
  await m.settle();
  assert.deepEqual(m.names(), ['cam-maam', 'Reece James']);
  assert.equal(m.w.localStorage.getItem('cragfeed.repo'), 'amy/crag-feed');
});

test('names from GitHub are rendered as text only', async () => {
  const gh = fakeGitHub({ file: JSON.stringify({ climbers: [
    { name: '<img src=x onerror=alert(1)>', feedUrl: 'https://www.mountainproject.com/rss/user-ticks/1' },
    { name: 'Ok', feedUrl: 'https://www.mountainproject.com/rss/user-ticks/2' },
  ] }) });
  const m = await mount({ gh });
  assert.equal(m.d.querySelectorAll('.climbers img').length, 0);
  assert.equal(m.names()[0], '<img src=x onerror=alert(1)>');
});
