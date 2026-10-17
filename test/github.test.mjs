import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, GitHubError, toBase64, fromBase64 } from '../site/github.js';

const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers });
const none = (status = 204) => new Response(null, { status });

function client(handler, token = 'tok_123456789012345678901') {
  const calls = [];
  const fetchFn = async (url, opts) => { calls.push({ url, opts }); return handler(url, opts); };
  return { c: createClient({ owner: 'amy', repo: 'crag-feed', token, fetchFn }), calls };
}

test('base64 helpers round-trip non-ASCII text and tolerate GitHub line breaks', () => {
  const s = '{"name":"Zoë Öberg — 🧗"}\n';
  assert.equal(fromBase64(toBase64(s)), s);
  const b = toBase64(s);
  assert.equal(fromBase64(`${b.slice(0, 6)}\n${b.slice(6)}`), s);
});

test('requests go only to api.github.com, with the token in the Authorization header only', async () => {
  const { c, calls } = client(() => json({ default_branch: 'main', private: false, permissions: { push: true } }));
  const info = await c.getRepo();
  assert.deepEqual(info, { defaultBranch: 'main', canPush: true, isPrivate: false });
  assert.equal(calls[0].url, 'https://api.github.com/repos/amy/crag-feed');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok_123456789012345678901');
  assert.ok(!calls[0].url.includes('tok_'));
});

test('no Authorization header is sent when there is no token', async () => {
  const { c, calls } = client(() => json({ default_branch: 'main' }), '');
  await c.getRepo();
  assert.equal(calls[0].opts.headers.Authorization, undefined);
});

test('readConfig decodes the file and returns its sha; writeConfig sends base64 + sha + branch', async () => {
  const text = '{"climbers":[]}\n';
  const { c, calls } = client((url, opts) => (opts.method === 'GET'
    ? json({ content: toBase64(text), sha: 'abc123', encoding: 'base64' })
    : json({ commit: {} })));
  const got = await c.readConfig('main');
  assert.deepEqual(got, { text, sha: 'abc123' });
  assert.match(calls[0].url, /contents\/config\/climbers\.json\?ref=main$/);
  await c.writeConfig('NEW\n', 'abc123', 'main', 'msg');
  const body = JSON.parse(calls[1].opts.body);
  assert.deepEqual(body, { message: 'msg', content: toBase64('NEW\n'), sha: 'abc123', branch: 'main' });
  assert.equal(calls[1].opts.method, 'PUT');
});

test('dispatch, enable and run listing use the right endpoints', async () => {
  const { c, calls } = client((url) => (url.includes('/runs') ? json({ workflow_runs: [
    { id: 1, status: 'completed', conclusion: 'success', event: 'schedule', created_at: '2026-10-15T10:00:00Z', html_url: 'https://github.com/amy/crag-feed/actions/runs/1' },
    { id: 2, status: 'queued', conclusion: null, event: 'push', created_at: '2026-10-15T11:00:00Z', html_url: 'https://evil.example/x' },
  ] }) : none()));
  await c.dispatch('main');
  assert.equal(calls[0].url, 'https://api.github.com/repos/amy/crag-feed/actions/workflows/refresh-and-deploy.yml/dispatches');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { ref: 'main' });
  await c.enableWorkflow();
  assert.match(calls[1].url, /refresh-and-deploy\.yml\/enable$/);
  const runs = await c.listRuns();
  assert.equal(runs[0].url, 'https://github.com/amy/crag-feed/actions/runs/1');
  assert.equal(runs[1].url, null, 'non-GitHub links are dropped');
});

test('errors become short friendly messages with no internals', async () => {
  const cases = [
    [401, 'auth', /rejected the token/],
    [403, 'forbidden', /Contents.*Actions/],
    [404, 'notfound', /could not find/],
    [409, 'conflict', /changed on GitHub/],
    [500, 'server', /temporary problem/],
    [422, 'invalid', /HTTP 422/],
  ];
  for (const [status, kind, re] of cases) {
    const { c } = client(() => json({ message: 'secret internals', documentation_url: 'x' }, status));
    await assert.rejects(c.getRepo(), (e) => e instanceof GitHubError && e.kind === kind && re.test(e.message) && !/secret internals/.test(e.message), String(status));
  }
});

test('rate limiting is recognised; 422 on a write means the file changed', async () => {
  let { c } = client(() => json({}, 403, { 'x-ratelimit-remaining': '0' }));
  await assert.rejects(c.getRepo(), (e) => e.kind === 'ratelimit');
  ({ c } = client(() => json({}, 422)));
  await assert.rejects(c.writeConfig('x', 's', 'main', 'm'), (e) => e.kind === 'conflict');
});

test('network failures are reported without leaking details', async () => {
  const { c } = client(() => { throw new TypeError('NetworkError secret'); });
  await assert.rejects(c.getRepo(), (e) => e.kind === 'network' && !/secret/.test(e.message));
});
