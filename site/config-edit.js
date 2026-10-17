// Pure helpers for editing config/climbers.json from the Manage page.
// No DOM and no network here, so they can be tested directly in Node.

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

const FEED_ID_IN_URL = /^https:\/\/www\.mountainproject\.com\/rss\/user-ticks\/(\d{1,12})\/?$/;

/** The Mountain Project user number of an existing config entry, or null. */
export function climberId(entry) {
  const m = entry && typeof entry.feedUrl === 'string' ? FEED_ID_IN_URL.exec(entry.feedUrl.trim()) : null;
  return m ? m[1] : null;
}

/**
 * Accepts a profile link, a ticks-feed link, or a bare user number.
 * Returns { id, slug } where slug is the profile-name part of the link when present.
 */
export function parseClimberInput(text) {
  const t = String(text || '').trim();
  if (!t) throw new UserError("Paste your friend's Mountain Project profile link (or their user number).");
  if (/^\d{1,12}$/.test(t)) return { id: t, slug: null };
  let m = /^https:\/\/(?:www\.)?mountainproject\.com\/user\/(\d{1,12})(?:\/([A-Za-z0-9_-]+))?/i.exec(t);
  if (m) return { id: m[1], slug: m[2] && m[2].toLowerCase() !== 'ticks' ? m[2] : null };
  m = /^https:\/\/(?:www\.)?mountainproject\.com\/rss\/user-ticks\/(\d{1,12})\/?$/i.exec(t);
  if (m) return { id: m[1], slug: null };
  throw new UserError('That does not look like a Mountain Project profile link. It should look like https://www.mountainproject.com/user/123456789/their-name');
}

export function slugToName(slug) {
  return String(slug || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Returns a new config object with the friend added. Throws UserError for anything wrong. */
export function addClimber(config, { name, input }) {
  const list = Array.isArray(config && config.climbers) ? config.climbers : [];
  const { id, slug } = parseClimberInput(input);
  if (list.some((c) => climberId(c) === id)) throw new UserError('That climber is already in the list.');
  const finalName = (String(name || '').trim() || slugToName(slug)).trim();
  if (!finalName) throw new UserError('Please type a name to show on the site.');
  if (finalName.length > 60) throw new UserError('Please use a name of 60 characters or fewer.');
  const entry = { name: finalName, feedUrl: `https://www.mountainproject.com/rss/user-ticks/${id}` };
  if (slug) entry.profileUrl = `https://www.mountainproject.com/user/${id}/${slug}/ticks`;
  return { ...config, climbers: [...list, entry] };
}

/** Returns a new config object without the friend. The list may never become empty. */
export function removeClimber(config, id) {
  const list = Array.isArray(config && config.climbers) ? config.climbers : [];
  if (!list.some((c) => climberId(c) === id)) throw new UserError('That climber is not in the list any more. Reload the page.');
  if (list.length <= 1) throw new UserError('At least one climber must stay in the list.');
  return { ...config, climbers: list.filter((c) => climberId(c) !== id) };
}

export function serializeConfig(config) {
  return JSON.stringify(config, null, 2) + '\n';
}
