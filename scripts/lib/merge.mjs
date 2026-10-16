// Merging freshly fetched ticks into the saved state (site/data/ticks.json).
//
// The saved file is committed to the repository by the workflow, so it survives between runs
// (no reliance on caches or artifacts that can expire).
//
// Rules:
//  * A tick is identified by its `id`. Seeing it again never duplicates it.
//  * `firstSeenAt` is set the first time we see a tick and never changed afterwards.
//  * The first time a climber is ever fetched ("seeding"), all their ticks are marked
//    `baseline: true`, meaning "already existed when we started watching" -> never shown as New.
//  * A failed (or suspiciously empty) fetch keeps that climber's previous ticks untouched.
//  * Ticks that later disappear from a feed are kept (history accumulates over time).
//  * Climbers removed from the config are dropped from the output.

import { compareTicksNewestFirst } from './parse.mjs';

export const SCHEMA_VERSION = 1;
export const MAX_TICKS = 5000;

/**
 * @param previous  parsed previous ticks.json, or null
 * @param results   Map<climberId, {ok:true, ticks:[]} | {ok:false, error:string}>
 * @param climbers  validated climbers from config
 * @param now       ISO timestamp for this run
 * @param configErrors  array of short strings
 */
export function mergeState({ previous, results, climbers, now, configErrors = [] }) {
  const prev = previous && Array.isArray(previous.ticks) ? previous : null;
  const wanted = new Set(climbers.map((c) => c.id));
  const byId = new Map();
  for (const t of prev ? prev.ticks : []) {
    if (wanted.has(t.climberId)) byId.set(t.id, t);
  }
  const prevClimbers = new Map((prev && Array.isArray(prev.climbers) ? prev.climbers : []).map((c) => [c.id, c]));

  const climberStates = [];
  let anyOk = false;
  let newTickCount = 0;

  for (const c of climbers) {
    const before = prevClimbers.get(c.id) || null;
    const hadTicks = [...byId.values()].some((t) => t.climberId === c.id);
    const seeded = Boolean(before && before.seededAt) || hadTicks;
    const result = results.get(c.id);
    const state = {
      id: c.id,
      name: c.name,
      profileUrl: c.profileUrl,
      status: 'failed',
      error: null,
      lastAttemptAt: now,
      lastSuccessAt: before ? before.lastSuccessAt || null : null,
      seededAt: before ? before.seededAt || null : null,
    };

    if (!result) {
      state.error = 'Feed was not fetched.';
    } else if (!result.ok) {
      state.error = result.error;
    } else if (result.ticks.length === 0 && hadTicks) {
      // A feed that used to have ticks and now has none is more likely broken than empty.
      state.error = 'The feed returned no entries; previous data was kept.';
    } else {
      anyOk = true;
      state.status = 'ok';
      state.lastSuccessAt = now;
      if (!state.seededAt) state.seededAt = hadTicks ? (before && before.seededAt) || now : now;
      for (const t of result.ticks) {
        const existing = byId.get(t.id);
        if (existing) {
          byId.set(t.id, { ...t, firstSeenAt: existing.firstSeenAt, baseline: existing.baseline });
        } else {
          byId.set(t.id, { ...t, firstSeenAt: now, baseline: !seeded });
          if (seeded) newTickCount++;
        }
      }
    }
    climberStates.push(state);
  }

  let ticks = [...byId.values()].sort(compareTicksNewestFirst);
  if (ticks.length > MAX_TICKS) ticks = ticks.slice(0, MAX_TICKS);

  const tickCounts = new Map();
  for (const t of ticks) tickCounts.set(t.climberId, (tickCounts.get(t.climberId) || 0) + 1);
  for (const s of climberStates) s.tickCount = tickCounts.get(s.id) || 0;

  const state = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now,
    lastSuccessAt: anyOk ? now : (prev && prev.lastSuccessAt) || null,
    configErrors,
    climbers: climberStates,
    ticks,
  };
  return { state, anyOk, newTickCount };
}
