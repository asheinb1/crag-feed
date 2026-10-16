// Entry point run by the GitHub Actions workflow:  node scripts/refresh.mjs
//
// Reads config/climbers.json, fetches each feed (politely, one at a time), merges the result into
// site/data/ticks.json, and prints a plain-language report to the log.
//
// Exit code: 0 if at least one feed was refreshed (individual failures are logged as warnings),
//            1 if nothing could be refreshed or the config file is unusable.
// In every case previously saved data is preserved.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, ConfigError } from './lib/config.mjs';
import { parseFeed, feedReport, FeedError } from './lib/parse.mjs';
import { fetchFeedText, FetchError } from './lib/fetch.mjs';
import { mergeState } from './lib/merge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(root, 'config', 'climbers.json');
const DATA_PATH = process.env.CRAG_DATA_PATH || path.join(root, 'site', 'data', 'ticks.json');
// Developer/test aid only: read "<dir>/<userId>.xml" instead of using the network.
const OFFLINE_DIR = process.env.CRAG_OFFLINE_DIR || '';
const DELAY_BETWEEN_FEEDS_MS = OFFLINE_DIR ? 0 : 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const warn = (msg) => console.log(`::warning::${msg}`);
const fail = (msg) => console.log(`::error::${msg}`);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function main() {
  let rawConfig;
  try {
    rawConfig = await readJson(CONFIG_PATH);
    if (rawConfig === null) throw new ConfigError('config/climbers.json was not found.');
  } catch (err) {
    fail(err instanceof ConfigError ? err.message : 'config/climbers.json is not valid JSON (check for a missing comma, quote or bracket).');
    return 1;
  }

  let climbers, configErrors;
  try {
    ({ climbers, errors: configErrors } = validateConfig(rawConfig));
  } catch (err) {
    fail(err.message);
    return 1;
  }
  configErrors.forEach((e) => warn(`Config problem: ${e}`));
  if (climbers.length === 0) {
    fail('No valid climbers are configured, so nothing was refreshed. Existing data was left untouched.');
    return 1;
  }

  let previous = null;
  try {
    previous = await readJson(DATA_PATH);
  } catch {
    warn('The saved data file could not be read; continuing as if this is a first run.');
  }

  const results = new Map();
  let first = true;
  for (const c of climbers) {
    if (!first) await sleep(DELAY_BETWEEN_FEEDS_MS);
    first = false;
    console.log(`\n== ${c.name} (${c.feedUrl})`);
    try {
      const xml = OFFLINE_DIR
        ? await readFile(path.join(OFFLINE_DIR, `${c.id}.xml`), 'utf8')
        : await fetchFeedText(c.feedUrl);
      const parsed = parseFeed(xml, c);
      results.set(c.id, { ok: true, ticks: parsed.ticks });
      console.log('Feed report:');
      console.log(JSON.stringify(feedReport(parsed), null, 2));
      if (parsed.skipped.length) warn(`${c.name}: ${parsed.skipped.length} feed item(s) were skipped (${[...new Set(parsed.skipped.map((s) => s.reason))].join(', ')}).`);
    } catch (err) {
      const safe = err instanceof FetchError || err instanceof FeedError ? err.message
        : err && err.code === 'ENOENT' ? 'Offline fixture not found.' : 'Unexpected problem while reading this feed.';
      results.set(c.id, { ok: false, error: safe });
      warn(`${c.name}: feed failed -> ${safe} Previous data for this climber was kept.`);
    }
  }

  const now = new Date().toISOString();
  const { state, anyOk, newTickCount } = mergeState({ previous, results, climbers, now, configErrors });

  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  const tmp = `${DATA_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await rename(tmp, DATA_PATH);

  console.log('\n== Summary');
  for (const s of state.climbers) {
    console.log(`${s.status === 'ok' ? 'OK    ' : 'FAILED'} ${s.name}: ${s.tickCount} ticks stored${s.error ? ` (${s.error})` : ''}`);
  }
  console.log(`New ticks discovered this run: ${newTickCount}`);
  console.log(`Total ticks stored: ${state.ticks.length}`);

  if (!anyOk) {
    fail('Every feed failed this run. The site keeps showing the last saved data and will show a "may be out of date" notice as it ages.');
    return 1;
  }
  return 0;
}

main().then((code) => { process.exitCode = code; }, (err) => {
  fail(`Unexpected error: ${err && err.message ? err.message : 'unknown'}`);
  process.exitCode = 1;
});
