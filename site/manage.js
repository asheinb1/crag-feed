// Manage page: add/remove friends, refresh now, and see whether automatic updates are running.
// Talks to the GitHub REST API directly from the browser using a fine-grained token that the owner
// pastes in. The token is kept in sessionStorage (or localStorage if "Remember" is ticked) and is
// only ever sent to api.github.com. All GitHub-supplied text is inserted with textContent.

import { createClient, GitHubError } from './github.js';
import { addClimber, removeClimber, serializeConfig, climberId, UserError } from './config-edit.js';
import { timeAgo, isStale } from './filters.js';

const TOKEN_KEY = 'cragfeed.token';
const REPO_KEY = 'cragfeed.repo';
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function deriveRepo(loc) {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec((loc && loc.hostname) || '');
  const seg = ((loc && loc.pathname) || '').split('/').filter(Boolean)[0];
  if (m && seg && !/\.html?$/i.test(seg)) return `${m[1]}/${seg}`;
  return '';
}

function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

export async function init(doc, deps) {
  const {
    fetchFn, local, session, location,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    nowFn = () => Date.now(),
  } = deps;
  const $ = (id) => doc.getElementById(id);
  const el = {
    message: $('message'), problem: $('problem'), connStatus: $('conn-status'), tokenForm: $('token-form'),
    token: $('token'), remember: $('remember'), disconnect: $('disconnect'), repoInput: $('repo-input'),
    advanced: $('advanced'), climbers: $('climbers'), addForm: $('add-form'), addInput: $('add-input'),
    addName: $('add-name'), addBtn: $('add-btn'), runSummary: $('run-summary'), wfWarn: $('workflow-warning'),
    wfWarnText: $('workflow-warning-text'), enableWf: $('enable-workflow'), refreshNow: $('refresh-now'), runs: $('runs'),
  };

  let token = safe(() => session.getItem(TOKEN_KEY)) || safe(() => local.getItem(TOKEN_KEY)) || '';
  let repoSlug = safe(() => local.getItem(REPO_KEY)) || deriveRepo(location);
  let branch = 'main';
  let config = null;
  let sha = '';
  let canWrite = false;
  let busy = false;
  let watching = false;
  let workflowActive = true;
  let pendingRemove = null;
  let pendingTimer = null;

  const h = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };
  const client = () => {
    const [owner, repo] = repoSlug.split('/');
    return createClient({ owner, repo, token, fetchFn });
  };
  const say = (text) => { el.problem.hidden = true; el.message.hidden = !text; el.message.textContent = text || ''; };
  const problem = (text) => { el.problem.hidden = !text; el.problem.textContent = text || ''; };
  const errText = (e) => (e instanceof GitHubError || e instanceof UserError ? e.message : 'Something unexpected went wrong. Please reload the page and try again.');

  function updateControls() {
    const editable = Boolean(token) && canWrite && Boolean(repoSlug);
    el.addBtn.disabled = !editable || busy;
    el.refreshNow.disabled = !editable || busy;
    el.enableWf.disabled = !editable || busy;
    el.disconnect.hidden = !token;
    for (const b of el.climbers.querySelectorAll('button')) {
      b.disabled = !editable || busy || (config && config.climbers.length <= 1);
    }
  }

  function renderConnection() {
    if (!repoSlug) {
      el.connStatus.textContent = 'Repository not set. Open "Repository settings" below and enter it as your-username/crag-feed.';
      el.advanced.open = true;
    } else if (!token) {
      el.connStatus.textContent = 'Not connected. You can look around, but changing anything needs a token.';
    } else if (!canWrite) {
      el.connStatus.textContent = 'Token saved, but it cannot write to this repository yet. Check its permissions.';
    } else {
      el.connStatus.textContent = 'Connected. You can change the friends list and refresh the feed.';
    }
    el.repoInput.value = repoSlug;
  }

  function renderClimbers() {
    el.climbers.replaceChildren();
    if (!config) return;
    for (const c of config.climbers) {
      const id = climberId(c);
      const li = h('li', 'climber-row');
      const label = h('span', 'climber-name', c.name);
      const sub = h('span', 'climber-id', id ? ` · user ${id}` : ' · invalid entry');
      li.append(label, sub);
      if (id) {
        const b = h('button', 'secondary small', pendingRemove === id ? 'Click again to remove' : 'Remove');
        b.type = 'button';
        b.setAttribute('aria-label', `Remove ${c.name}`);
        b.addEventListener('click', () => onRemove(id));
        li.append(b);
      }
      el.climbers.append(li);
    }
    updateControls();
  }

  function renderRuns(runs) {
    el.runs.replaceChildren();
    const nowMs = nowFn();
    if (!runs.length) {
      el.runs.append(h('li', '', 'No runs yet.'));
      el.runSummary.textContent = 'No refresh has run yet.';
      return;
    }
    const labelOf = (r) => (r.status !== 'completed' ? (r.status === 'queued' ? 'Waiting to start' : 'Running') :
      r.conclusion === 'success' ? 'Succeeded' : r.conclusion === 'cancelled' ? 'Cancelled' : 'Failed');
    const eventOf = (r) => ({ schedule: 'automatic', workflow_dispatch: 'manual', push: 'after a change' }[r.event] || r.event || '');
    for (const r of runs) {
      const li = h('li', `run run-${r.status === 'completed' ? r.conclusion : r.status}`);
      li.append(h('span', 'run-label', labelOf(r)), h('span', 'run-meta', ` · ${eventOf(r)} · ${timeAgo(r.createdAt, nowMs)}`));
      if (r.url) {
        const a = h('a', '', ' details');
        a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        li.append(a);
      }
      el.runs.append(li);
    }
    const lastDone = runs.find((r) => r.status === 'completed');
    const running = runs.find((r) => r.status !== 'completed');
    let text = lastDone
      ? `Last finished run: ${labelOf(lastDone).toLowerCase()} ${timeAgo(lastDone.createdAt, nowMs)}.`
      : 'No run has finished yet.';
    if (running) text += ' A run is in progress.';
    if (workflowActive && lastDone && isStale(lastDone.createdAt, nowMs) && !running) {
      text += ' That was a while ago, so updates may have stopped. Try "Refresh now".';
    }
    el.runSummary.textContent = text;
  }

  async function loadWorkflow() {
    try {
      const wf = await client().getWorkflow();
      workflowActive = wf.state === 'active';
      el.wfWarn.hidden = workflowActive;
      el.wfWarnText.textContent = workflowActive ? '' :
        'GitHub has paused the automatic updates (this can happen after about 60 days without repository activity). Resume them to keep the feed fresh.';
    } catch (e) {
      problem(errText(e));
    }
  }

  async function loadRuns() {
    try { renderRuns(await client().listRuns()); } catch (e) { problem(errText(e)); }
  }

  async function loadConfig() {
    try {
      const got = await client().readConfig(branch);
      sha = got.sha;
      let parsed;
      try { parsed = JSON.parse(got.text); } catch { parsed = null; }
      if (!parsed || !Array.isArray(parsed.climbers)) {
        config = null;
        problem('The friends list on GitHub (config/climbers.json) is not valid, so it cannot be edited here. Fix or restore it on GitHub first.');
      } else {
        config = parsed;
      }
    } catch (e) {
      config = null;
      problem(errText(e));
    }
    renderClimbers();
  }

  async function watchRuns(poll) {
    if (watching) return;
    watching = true;
    const since = nowFn();
    try {
      if (poll) await sleep(4000);
      for (let i = 0; i < (poll ? 36 : 1); i++) {
        const runs = await client().listRuns();
        renderRuns(runs);
        const latest = runs[0];
        const fresh = latest && Date.parse(latest.createdAt) >= since - 15000;
        if (!poll || (fresh && latest.status === 'completed')) break;
        await sleep(10000);
      }
    } catch (e) {
      problem(errText(e));
    } finally {
      watching = false;
    }
  }

  async function loadAll() {
    problem('');
    renderConnection();
    if (!repoSlug || !REPO_PATTERN.test(repoSlug)) { updateControls(); return; }
    canWrite = false;
    try {
      const info = await client().getRepo();
      branch = info.defaultBranch;
      canWrite = Boolean(token) && info.canPush;
    } catch (e) {
      problem(errText(e));
    }
    renderConnection();
    await Promise.all([loadConfig(), loadWorkflow(), loadRuns()]);
    updateControls();
  }

  async function guarded(fn) {
    if (busy) return;
    busy = true;
    updateControls();
    try { await fn(); } catch (e) { problem(errText(e)); if (e instanceof GitHubError && e.kind === 'conflict') await loadConfig(); } finally { busy = false; updateControls(); }
  }

  async function save(newConfig, doneText) {
    await client().writeConfig(serializeConfig(newConfig), sha, branch, 'Update climbers (from the site)');
    await loadConfig();
    say(`${doneText} A refresh starts automatically and takes about one to three minutes; the home page updates when it finishes.`);
    watchRuns(true);
  }

  function onRemove(id) {
    if (busy) return;
    if (pendingRemove !== id) {
      pendingRemove = id;
      renderClimbers();
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { pendingRemove = null; renderClimbers(); }, 6000);
      return;
    }
    pendingRemove = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    const name = (config.climbers.find((c) => climberId(c) === id) || {}).name || 'Friend';
    guarded(async () => {
      problem('');
      await save(removeClimber(config, id), `Removed ${name}.`);
    });
  }

  el.tokenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = el.token.value.trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(v)) {
      problem('That does not look like a GitHub token. Copy the whole token, including the part that starts with github_pat_.');
      return;
    }
    token = v;
    el.token.value = '';
    safe(() => { session.removeItem(TOKEN_KEY); local.removeItem(TOKEN_KEY); });
    safe(() => (el.remember.checked ? local : session).setItem(TOKEN_KEY, v));
    say('Token saved on this device.');
    await loadAll();
  });

  el.disconnect.addEventListener('click', async () => {
    token = '';
    safe(() => { session.removeItem(TOKEN_KEY); local.removeItem(TOKEN_KEY); });
    say('Disconnected. The token was removed from this browser.');
    await loadAll();
  });

  el.repoInput.addEventListener('change', async () => {
    const v = el.repoInput.value.trim();
    if (!REPO_PATTERN.test(v)) { problem('Enter the repository as owner/name, for example your-username/crag-feed.'); return; }
    repoSlug = v;
    safe(() => local.setItem(REPO_KEY, v));
    await loadAll();
  });

  el.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(async () => {
      problem('');
      if (!config) throw new UserError('The friends list could not be loaded, so nothing can be added right now.');
      const updated = addClimber(config, { name: el.addName.value, input: el.addInput.value });
      const added = updated.climbers[updated.climbers.length - 1];
      await save(updated, `Added ${added.name}.`);
      el.addName.value = '';
      el.addInput.value = '';
    });
  });

  el.refreshNow.addEventListener('click', () => {
    guarded(async () => {
      problem('');
      await client().dispatch(branch);
      say('Refresh started. It takes about one to three minutes; the home page updates when it finishes.');
      watchRuns(true);
    });
  });

  el.enableWf.addEventListener('click', () => {
    guarded(async () => {
      problem('');
      await client().enableWorkflow();
      say('Automatic updates resumed.');
      await loadWorkflow();
    });
  });

  await loadAll();
}

if (typeof document !== 'undefined' && !globalThis.__CRAG_TEST__) {
  init(document, {
    fetchFn: (...a) => fetch(...a),
    local: safe(() => window.localStorage),
    session: safe(() => window.sessionStorage),
    location: window.location,
  });
}
