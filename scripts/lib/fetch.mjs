// Polite, defensive HTTP fetching of one RSS feed.

export class FetchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
  }
}

const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = 'crag-feed/1.0 (personal friends feed; reads public RSS; every ~6 hours)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new FetchError('TOO_LARGE', 'The feed was larger than 5 MB.');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/**
 * Fetches `url` and returns the body text. Retries only temporary problems
 * (timeouts, network errors, HTTP 429 and 5xx) with a short backoff.
 * Throws FetchError with a short, visitor-safe message.
 */
export async function fetchFeedText(url, { timeoutMs = 20000, retries = 2, fetchImpl = fetch, backoffMs = 3000 } = {}) {
  let lastError = new FetchError('NETWORK', 'Could not reach Mountain Project.');
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let retryAfterMs = 0;
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        retryAfterMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 0;
        lastError = new FetchError(res.status === 429 ? 'RATE_LIMITED' : 'HTTP_5XX',
          res.status === 429 ? 'Mountain Project asked us to slow down (HTTP 429).' : `Mountain Project had a temporary problem (HTTP ${res.status}).`);
      } else if (!res.ok) {
        throw new FetchError('HTTP_' + res.status,
          res.status === 404 ? 'Feed not found (HTTP 404). Check the feed URL.'
            : res.status === 401 || res.status === 403 ? `Access was refused (HTTP ${res.status}). The feed may not be public.`
              : `Unexpected response (HTTP ${res.status}).`);
      } else {
        return await readLimited(res);
      }
    } catch (err) {
      if (err instanceof FetchError && !['NETWORK', 'TIMEOUT'].includes(err.code)) throw err;
      lastError = err instanceof FetchError ? err
        : err && err.name === 'AbortError' ? new FetchError('TIMEOUT', 'The request timed out.')
          : new FetchError('NETWORK', 'Could not reach Mountain Project.');
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(retryAfterMs || backoffMs * (attempt + 1));
  }
  throw lastError;
}
