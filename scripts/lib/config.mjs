// Reading and validating config/climbers.json.

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const FEED_URL_PATTERN = /^https:\/\/www\.mountainproject\.com\/rss\/user-ticks\/(\d{1,12})\/?$/;
const PROFILE_URL_PATTERN = /^https:\/\/www\.mountainproject\.com\/user\/\d{1,12}(?:\/[A-Za-z0-9_-]+)?(?:\/ticks)?\/?$/;

/**
 * Validates the parsed JSON of climbers.json.
 * Returns { climbers, errors }. Bad entries are reported in `errors` (short, safe sentences)
 * and skipped; good entries still work.
 */
export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.climbers)) {
    throw new ConfigError('config/climbers.json must contain a "climbers" list.');
  }
  const climbers = [];
  const errors = [];
  const seen = new Set();

  raw.climbers.forEach((entry, i) => {
    const label = entry && typeof entry.name === 'string' && entry.name.trim() ? `"${entry.name.trim().slice(0, 40)}"` : `entry #${i + 1}`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`Climber ${label}: not a valid entry.`);
      return;
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) { errors.push(`Climber ${label}: "name" is missing.`); return; }
    if (name.length > 60) { errors.push(`Climber ${label}: "name" is longer than 60 characters.`); return; }

    const feedUrl = typeof entry.feedUrl === 'string' ? entry.feedUrl.trim() : '';
    const m = FEED_URL_PATTERN.exec(feedUrl);
    if (!m) {
      errors.push(`Climber ${label}: "feedUrl" must look like https://www.mountainproject.com/rss/user-ticks/<number>.`);
      return;
    }
    const id = m[1];
    if (seen.has(id)) { errors.push(`Climber ${label}: this feed is listed more than once.`); return; }

    let profileUrl = null;
    if (entry.profileUrl !== undefined && entry.profileUrl !== null && entry.profileUrl !== '') {
      if (typeof entry.profileUrl === 'string' && PROFILE_URL_PATTERN.test(entry.profileUrl.trim())) {
        profileUrl = entry.profileUrl.trim();
      } else {
        errors.push(`Climber ${label}: "profileUrl" is not a Mountain Project profile link (ignored).`);
      }
    }
    seen.add(id);
    climbers.push({ id, name, feedUrl: `https://www.mountainproject.com/rss/user-ticks/${id}`, profileUrl });
  });

  return { climbers, errors };
}
