// A tiny wrapper around the parts of the GitHub REST API that the Manage page needs.
// Runs in the visitor's browser. The token (if any) is passed in by the caller and is only ever
// sent to https://api.github.com in an Authorization header. Nothing here stores it.

export const WORKFLOW_FILE = 'refresh-and-deploy.yml';
export const CONFIG_PATH = 'config/climbers.json';
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = status;
  }
}

export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function friendly(status, res, conflictStatuses) {
  if (conflictStatuses.includes(status)) {
    return new GitHubError('conflict', 'The file changed on GitHub after this page loaded it. The list has been reloaded, so please try again.', status);
  }
  if (status === 401) return new GitHubError('auth', 'GitHub rejected the token. It may have expired or been pasted incorrectly. Create a new one and reconnect.', status);
  if (status === 403 || status === 429) {
    const remaining = res.headers && res.headers.get ? res.headers.get('x-ratelimit-remaining') : null;
    if (status === 429 || remaining === '0') return new GitHubError('ratelimit', 'GitHub is limiting requests right now. Please wait a few minutes and try again.', status);
    return new GitHubError('forbidden', 'The token does not have permission for this. It needs "Contents" and "Actions" set to Read and write on this repository.', status);
  }
  if (status === 404) return new GitHubError('notfound', 'GitHub could not find that. Check the repository name, and that the token has access to this repository.', status);
  if (status >= 500) return new GitHubError('server', 'GitHub is having a temporary problem. Please try again in a minute.', status);
  return new GitHubError('invalid', `GitHub refused the request (HTTP ${status}).`, status);
}

export function createClient({ owner, repo, token = '', fetchFn }) {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function request(method, path, body, { conflictStatuses = [409] } = {}) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchFn(`${API}${path}`, {
        method, headers, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new GitHubError('network', 'Could not reach GitHub. Check your internet connection and try again.');
    }
    if (!res.ok) throw friendly(res.status, res, conflictStatuses);
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch {
      throw new GitHubError('invalid', 'GitHub sent a reply this page could not read.');
    }
  }

  return {
    async getRepo() {
      const d = await request('GET', base);
      return { defaultBranch: d.default_branch || 'main', canPush: Boolean(d.permissions && d.permissions.push), isPrivate: Boolean(d.private) };
    },
    async readConfig(branch) {
      const d = await request('GET', `${base}/contents/${CONFIG_PATH}?ref=${encodeURIComponent(branch)}`);
      if (!d || typeof d.content !== 'string' || !d.sha) throw new GitHubError('invalid', 'GitHub did not return the climber list.');
      return { text: fromBase64(d.content), sha: d.sha };
    },
    async writeConfig(text, sha, branch, message) {
      await request('PUT', `${base}/contents/${CONFIG_PATH}`, { message, content: toBase64(text), sha, branch }, { conflictStatuses: [409, 422] });
    },
    async dispatch(branch) {
      await request('POST', `${base}/actions/workflows/${WORKFLOW_FILE}/dispatches`, { ref: branch });
    },
    async getWorkflow() {
      const d = await request('GET', `${base}/actions/workflows/${WORKFLOW_FILE}`);
      return { state: d.state || 'unknown' };
    },
    async enableWorkflow() {
      await request('PUT', `${base}/actions/workflows/${WORKFLOW_FILE}/enable`);
    },
    async listRuns(perPage = 6) {
      const d = await request('GET', `${base}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${perPage}`);
      return (Array.isArray(d.workflow_runs) ? d.workflow_runs : []).map((r) => ({
        id: r.id,
        status: r.status,
        conclusion: r.conclusion,
        event: r.event,
        createdAt: r.created_at,
        url: typeof r.html_url === 'string' && r.html_url.startsWith('https://github.com/') ? r.html_url : null,
      }));
    },
  };
}
