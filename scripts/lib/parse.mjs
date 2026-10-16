// Parsing and normalising Mountain Project "ticks" RSS feeds.
//
// Design rules (see README, "How the data is handled"):
//  * XML is validated before parsing; DOCTYPE/ENTITY declarations are rejected.
//  * Feed text is only ever converted to plain text. No HTML from a feed is kept.
//  * Dates: the RSS <pubDate> is stored as `published`. It is NEVER presented as the
//    climb date. A climb date is only recorded if the feed description contains an
//    explicit labelled date (for example "Date: 2026-10-12"). `dateSource` says which.

import { XMLParser, XMLValidator } from 'fast-xml-parser';

export class FeedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FeedError';
    this.code = code;
  }
}

const MAX_TEXT = 500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'item',
});

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code < 0x110000) {
        try { return String.fromCodePoint(code); } catch { return ''; }
      }
      return '';
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Turn an HTML fragment into plain text lines. Never returns markup. */
export function htmlToText(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  // The second decode pass handles feeds that double-escape their HTML.
  s = s.replace(/<[^>]*>/g, '');
  return s
    .split(/\r?\n/)
    .map((l) => l.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function textOf(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return textOf(v['#text']);
  return String(v).trim();
}

/**
 * "Thin Slabs / Thin Slabs Direct (5.7+)" -> { route: "Thin Slabs / Thin Slabs Direct", grade: "5.7+" }
 * The trailing parentheses only count as a grade if they plausibly are one (contain a digit
 * or are "VB"), so "Route (Variation)" keeps its name intact.
 */
export function splitTitle(title) {
  const t = (title || '').trim();
  const m = /^(.*\S)\s*\(([^()]{1,24})\)\s*$/.exec(t);
  if (m && /^[A-Za-z0-9.+\-/ ]+$/.test(m[2]) && (/\d/.test(m[2]) || /^vb$/i.test(m[2].trim()))) {
    return { route: m[1].trim(), grade: m[2].trim() };
  }
  return { route: t, grade: null };
}

/** Only accept https links to mountainproject.com; anything else becomes null. */
export function safeMountainProjectUrl(u) {
  try {
    const url = new URL(String(u).trim());
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'www.mountainproject.com' && url.hostname !== 'mountainproject.com') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parsePubDate(s) {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Returns "YYYY-MM-DD" or null. Calendar dates are kept timezone-free on purpose. */
export function parseLabelledDate(s) {
  if (!s) return null;
  const v = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const ms = Date.parse(`${v}T12:00:00Z`);
    return Number.isNaN(ms) ? null : v;
  }
  const ms = Date.parse(`${v} 12:00:00 GMT`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

const SEP = /\s*(?:>|»|›)\s*/;

/** Finds an area breadcrumb ("A > B > C") in plain description text. */
export function extractAreaPath(lines) {
  for (const line of lines) {
    if (!SEP.test(line)) continue;
    const cleaned = line.replace(/^(?:(?:location|area|route in|in)\s*:\s*|route in\s+)/i, '');
    const parts = cleaned.split(SEP).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      // Normalise to root-first. If the generic root ("All Locations"/"Destinations") is last, the
      // feed wrote the breadcrumb leaf-first, so reverse it.
      const isRoot = (p) => /^(?:all locations|destinations)$/i.test(p);
      const ordered = isRoot(parts[parts.length - 1]) && !isRoot(parts[0]) ? [...parts].reverse() : parts;
      return ordered.slice(0, 12).map((p) => p.slice(0, 120));
    }
  }
  return [];
}

const LABELS = {
  style: /^(?:style|lead style|climb style)\s*:\s*(.+)$/i,
  notes: /^(?:notes?|comments?)\s*:\s*(.+)$/i,
  date: /^(?:date|tick date|climbed|climbed on)\s*:\s*(.+)$/i,
};

function extractLabelled(lines) {
  const out = { style: null, notes: null, date: null };
  for (const line of lines) {
    for (const key of Object.keys(LABELS)) {
      if (out[key] !== null) continue;
      const m = LABELS[key].exec(line);
      if (m) out[key] = m[1].trim().slice(0, MAX_TEXT);
    }
  }
  return out;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Identity of a tick: climber + feed GUID + pubDate. The climber is part of the key so two
 * people climbing the same route stay two ticks. The pubDate is part of the key so that one
 * person climbing the same route on two different days stays two ticks even if the feed's
 * GUID is the route (this is checked by the feed report on the first real run).
 */
export function tickId(climberId, guid, link, published) {
  const base = guid || link || '';
  return `${climberId}:${fnv1a(`${base}|${published || ''}`)}`;
}

/**
 * Parse one feed. Returns { ticks, itemCount, skipped, feedTitle, rawFirstDescription }.
 * Throws FeedError (never a raw parser error) for unusable input.
 */
export function parseFeed(xml, climber) {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new FeedError('EMPTY', 'The feed response was empty.');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new FeedError('UNSAFE_XML', 'The feed contained a DOCTYPE/ENTITY declaration and was rejected.');
  }
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new FeedError('MALFORMED_XML', 'The feed was not valid XML.');
  }
  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new FeedError('MALFORMED_XML', 'The feed could not be parsed.');
  }
  const channel = doc && doc.rss && doc.rss.channel;
  if (!channel || typeof channel !== 'object') {
    throw new FeedError('NOT_RSS', 'The response was XML but not an RSS feed.');
  }
  const items = Array.isArray(channel.item) ? channel.item : [];
  const ticks = [];
  const skipped = [];
  let rawFirstDescription = null;

  items.forEach((item, index) => {
    const title = textOf(item.title);
    const link = safeMountainProjectUrl(textOf(item.link));
    const guid = textOf(item.guid);
    const published = parsePubDate(textOf(item.pubDate));
    const descRaw = textOf(item.description);
    if (rawFirstDescription === null && descRaw) rawFirstDescription = descRaw.slice(0, 400);

    if (!title) { skipped.push({ index, reason: 'missing title' }); return; }
    if (!guid && !link) { skipped.push({ index, reason: 'missing guid and link' }); return; }

    const { route, grade } = splitTitle(title);
    const lines = htmlToText(descRaw).split('\n').filter(Boolean);
    const areaPath = extractAreaPath(lines);
    const labelled = extractLabelled(lines);
    const climbDate = parseLabelledDate(labelled.date);
    const sortDate = climbDate ? `${climbDate}T12:00:00.000Z` : published;

    ticks.push({
      id: tickId(climber.id, guid, link, published),
      climberId: climber.id,
      climberName: climber.name,
      route: route.slice(0, 200),
      grade,
      url: link,
      areaPath,
      area: areaPath.length ? areaPath.slice(-2).join(' › ') : null,
      published,
      climbDate,
      dateSource: climbDate ? 'tick' : (published ? 'published' : 'none'),
      sortDate: sortDate || null,
      style: labelled.style,
      notes: labelled.notes,
    });
  });

  return {
    ticks,
    itemCount: items.length,
    skipped,
    feedTitle: textOf(channel.title).slice(0, 200),
    rawFirstDescription,
  };
}

/** Newest first; ticks without any date sink to the bottom; stable tie-breaks. */
export function compareTicksNewestFirst(a, b) {
  const ad = a.sortDate || '';
  const bd = b.sortDate || '';
  if (ad !== bd) return ad < bd ? 1 : -1;
  const ap = a.published || '';
  const bp = b.published || '';
  if (ap !== bp) return ap < bp ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Summarises what a feed actually contains. Printed to the workflow log on every run. */
export function feedReport(parsed) {
  const t = parsed.ticks;
  const pubs = t.map((x) => x.published).filter(Boolean).sort();
  const count = (fn) => t.filter(fn).length;
  const ids = new Set(t.map((x) => x.id));
  return {
    itemsInFeed: parsed.itemCount,
    parsedTicks: t.length,
    skippedItems: parsed.skipped.length,
    uniqueTickIds: ids.size,
    withGrade: count((x) => x.grade),
    withArea: count((x) => x.areaPath.length),
    withRouteUrl: count((x) => x.url),
    withLabelledClimbDate: count((x) => x.climbDate),
    withStyle: count((x) => x.style),
    withNotes: count((x) => x.notes),
    oldestPublished: pubs[0] || null,
    newestPublished: pubs[pubs.length - 1] || null,
    firstDescriptionSample: parsed.rawFirstDescription,
  };
}
