import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeedText, FetchError } from '../scripts/lib/fetch.mjs';

const resp = (body, status = 200, headers = {}) => new Response(body, { status, headers });

test('returns body text on success', async () => {
  const text = await fetchFeedText('https://x/', { fetchImpl: async () => resp('<rss/>'), backoffMs: 1 });
  assert.equal(text, '<rss/>');
});

test('retries temporary server errors then succeeds', async () => {
  let calls = 0;
  const text = await fetchFeedText('https://x/', {
    backoffMs: 1,
    fetchImpl: async () => (++calls < 3 ? resp('', 503) : resp('<rss/>')),
  });
  assert.equal(calls, 3);
  assert.equal(text, '<rss/>');
});

test('gives up after retries with a safe message (rate limiting)', async () => {
  let calls = 0;
  await assert.rejects(
    fetchFeedText('https://x/', { backoffMs: 1, retries: 1, fetchImpl: async () => { calls++; return resp('', 429); } }),
    (e) => e instanceof FetchError && e.code === 'RATE_LIMITED' && !/stack|at /.test(e.message),
  );
  assert.equal(calls, 2);
});

test('does not retry permanent errors (404/403)', async () => {
  let calls = 0;
  await assert.rejects(
    fetchFeedText('https://x/', { backoffMs: 1, fetchImpl: async () => { calls++; return resp('', 404); } }),
    (e) => e.code === 'HTTP_404',
  );
  assert.equal(calls, 1);
});

test('times out hung requests', async () => {
  const hang = (_u, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(fetchFeedText('https://x/', { fetchImpl: hang, timeoutMs: 20, retries: 0 }), (e) => e.code === 'TIMEOUT');
});

test('network failures become a safe FetchError', async () => {
  await assert.rejects(
    fetchFeedText('https://x/', { retries: 0, fetchImpl: async () => { throw new TypeError('fetch failed: secret internals'); } }),
    (e) => e instanceof FetchError && e.code === 'NETWORK' && !/secret/.test(e.message),
  );
});

test('rejects responses over the size limit', async () => {
  const big = 'x'.repeat(5 * 1024 * 1024 + 10);
  await assert.rejects(fetchFeedText('https://x/', { retries: 0, fetchImpl: async () => resp(big) }), (e) => e.code === 'TOO_LARGE');
});
