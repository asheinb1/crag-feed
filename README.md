# Crag Feed

One chronological, searchable feed of recent climbing ticks from friends' **public Mountain Project RSS feeds**. It is a static website on GitHub Pages. A GitHub Actions job refreshes the data about every six hours, even when your computer is off.

> **Everything here is public.** The repository, the website and the tick data it publishes can be seen by anyone. Only public Mountain Project feed data and the climber list are published. No passwords, tokens or private notes are used or needed. Only add friends whose ticks are public and who are happy to be listed.

---

## 1. Plain-English glossary

- **Repository ("repo")**: a folder of project files stored on GitHub.
- **Commit**: saving a change to the repo.
- **GitHub Actions**: GitHub's free robot that runs tasks on a schedule. Ours downloads the feeds and rebuilds the site.
- **GitHub Pages**: GitHub's free website hosting for a repo.
- **RSS feed**: a machine-readable list of recent activity that Mountain Project publishes for each user.
- **Workflow**: one automated task file (in `.github/workflows/`).

---

## 2. Setup: exact steps (about 15 minutes)

You do this once. You never need to install anything on your computer.

1. **Sign in to GitHub** at <https://github.com> (create a free account if needed; no payment details are requested).
2. **Create the repository.** Click the **+** at the top right → **New repository**.
   - Repository name: `crag-feed` (use exactly this; the site address will contain it).
   - Choose **Public**.
   - Leave "Add a README", ".gitignore" and "license" **unchecked**.
   - Click **Create repository**.
3. **Unzip the project** on your computer (double-click `crag-feed.zip`). Open the unzipped `crag-feed` folder.
   - **Mac:** press **Command + Shift + .** (period) in Finder to show hidden items. The `.github` folder must be included.
   - **Windows:** File Explorer → View → Show → Hidden items.
4. **Upload the files.** On the new empty repository page click **uploading an existing file**. Select **everything inside** the `crag-feed` folder (not the folder itself) and drag it into the browser window. Wait for the upload to finish.
   - You should be uploading: `.github`, `config`, `scripts`, `site`, `test`, `.gitignore`, `package.json`, `package-lock.json`, `README.md`.
   - Do **not** upload a `node_modules` folder if you somehow have one.
   - Scroll down and click **Commit changes**.
5. **Check the hidden workflow files arrived.** In the repo, open the `.github` folder, then `workflows`. You should see `refresh-and-deploy.yml` and `tests.yml`.
   - If `.github` is missing: click **Add file → Create new file**, type `.github/workflows/refresh-and-deploy.yml` in the name box (typing the slashes creates the folders), paste the file's contents, and commit. Repeat for `tests.yml`.
6. **Turn on GitHub Pages.** Repo → **Settings** → **Pages** (left sidebar) → under **Build and deployment**, set **Source** to **GitHub Actions**. There is no Save button; it applies immediately.
7. **Run the first refresh.** Repo → **Actions** tab → click **Refresh ticks and deploy site** (left) → **Run workflow** (right) → green **Run workflow**.
   - If you see a note that workflows are disabled, click the green button to enable them.
   - Uploading the files in step 4 may already have started a run. If that run shows a red ✗ because Pages was not on yet, just run it again now.
8. **Wait 1–3 minutes**, refresh the Actions page, and open the run. You want two green ✓ jobs: **refresh** and **deploy**.
9. **Open your site:** `https://YOUR-GITHUB-USERNAME.github.io/crag-feed/`. The deploy job also shows the exact link.

### Checking that the first deployment worked

- The Actions run is green for `refresh` and `deploy`.
- Your site opens and shows ticks, with "Last updated … ago" at the top.
- On the first run you will see a note saying these are the most recent ticks available when tracking began. That is expected (see "New ticks" below).
- **Please open the `refresh` job → "Fetch feeds and update data" step and copy the "Feed report" for each climber** (it lists which fields the feed really provides). If anything on the site looks off, that text is the fastest way to diagnose it.

---

## 3. Manage everything from the website (recommended)

Open your site and click **Manage** at the bottom, or go straight to `https://YOUR-USERNAME.github.io/crag-feed/manage.html`. From there you can add or remove friends, refresh the feed on demand, and see whether automatic updates are running, without opening the repository.

**One-time step: create a GitHub token.** A public web page cannot change your repository by itself, so it needs a key that only you hold. The page walks you through this too.
1. Open <https://github.com/settings/personal-access-tokens/new> (button labels may differ slightly).
2. Token name `Crag Feed manage`; expiration 90 days or longer.
3. **Repository access:** *Only select repositories*, then choose `crag-feed`.
4. **Repository permissions:** set **Contents** to *Read and write* and **Actions** to *Read and write*. Leave everything else alone.
5. Click **Generate token**, copy it (it starts with `github_pat_`; GitHub shows it only once), paste it into the Manage page and click **Save token**.

**What you can do there**
- **Add a friend:** paste their Mountain Project profile link (a name is optional). The page saves the change to your repository and a refresh starts automatically.
- **Remove a friend:** click Remove, then click again to confirm. The last friend cannot be removed.
- **Refresh now:** starts a refresh and shows its progress.
- **Updates panel:** shows recent runs, warns if the last run was a long time ago, and warns if GitHub has paused the schedule (it can after about 60 days of no repository activity), with a button to resume it.

**About the token (please read)**
- It is stored only in your browser, in this tab's session storage unless you tick "Remember on this device". It is sent only to GitHub. It is never put in the repository or on the website.
- Anyone who gets the token could change files in this one repository, so don't share it and don't tick "Remember" on a shared computer. It cannot change workflow files or other repositories.
- Visitors can open the Manage page, but without your token every control is disabled.
- If the token expires, the page says GitHub rejected it; create a new one the same way. Press **Disconnect** to remove it from the browser. You can also delete it any time at github.com/settings/personal-access-tokens.
- The public feed works without any of this. The Manage page is optional, and everything it does can still be done in the repository (sections 4 and 6).

---

## 4. How to refresh by hand (without the Manage page)

Repo → **Actions** → **Refresh ticks and deploy site** → **Run workflow**. Please don't do this more than a few times a day; it asks Mountain Project for data each time.

## 5. How to tell if updates have stopped

- **On the Manage page:** the Updates panel shows recent runs and flags old or paused updates.
- **On the site:** the top line says "Last updated … ago". If the last successful update is older than 18 hours, a yellow "may be out of date" notice appears automatically. If a single friend's feed is failing, a notice names them.
- **On GitHub:** the Actions tab shows red ✗ runs. GitHub emails the repo owner when a scheduled run fails.
- **Important GitHub rule:** GitHub can pause scheduled workflows in a public repo after about 60 days with no repository activity. This project saves updated data as commits when ticks change, which I expect keeps the repo active, but that has not been verified. If the yellow notice ever appears and the Actions tab says scheduled workflows are disabled, click **Enable workflow**.

## 6. Add or remove a friend (by editing the repository)

You do not edit any program logic, only one list.

**To add a friend**
1. Open their Mountain Project profile. The address looks like `https://www.mountainproject.com/user/201670934/reece-james`. The number (`201670934`) is their user ID.
2. Their ticks feed address is `https://www.mountainproject.com/rss/user-ticks/` followed by that number. Paste it in a browser tab: it should show text/XML, not a login page. (If it asks you to log in or fails, their ticks are not public and cannot be used.)
3. In the repo, open `config` → `climbers.json` → click the **pencil icon** (Edit).
4. Add a block, keeping the commas exactly like the existing ones:

```json
{
  "name": "Friend Name",
  "feedUrl": "https://www.mountainproject.com/rss/user-ticks/123456789",
  "profileUrl": "https://www.mountainproject.com/user/123456789/friend-name/ticks"
}
```

   `profileUrl` is optional. Each block except the last in the list must be followed by a comma.
5. Click **Commit changes**. This starts a refresh automatically. The new friend's current ticks appear as ordinary (not "New") entries.

**To remove a friend:** edit `config/climbers.json`, delete their whole `{ ... }` block (and fix the commas), and commit. Their ticks disappear from the site at the next refresh.

**Invalid entries are safe:** a wrong address is skipped, the other friends keep working, the workflow log says exactly what is wrong, and the website shows a short "Setup problem" line.

## 7. Troubleshooting a failed workflow

Open **Actions** → click the red run → click the red step → read the last lines.

| What you see | Meaning and fix |
|---|---|
| `config/climbers.json is not valid JSON` | A missing/extra comma, quote or bracket in your edit. Click the file's history and revert, or compare to the example above. |
| `Config problem: ... "feedUrl" must look like ...` | That friend's address is wrong. Use the exact pattern in section 6. |
| `<name>: feed failed -> Access was refused (HTTP 403)` | That feed is not public, or Mountain Project is blocking automated requests from GitHub. Other friends still update. |
| `... HTTP 404` | Wrong user ID. |
| `... HTTP 429` or `5xx` | Mountain Project is busy or limiting requests. The job retries a few times; the next scheduled run usually succeeds. |
| `... was not valid XML` / `not an RSS feed` | The feed returned something else (maybe a sign-in page). Previous data is kept. |
| `Every feed failed this run` | Run is marked failed on purpose so GitHub emails you. The site keeps showing saved data and a stale notice appears as it ages. |
| `deploy` job fails with "Pages" or "environment" errors | Settings → Pages → Source must be **GitHub Actions** (step 6). Then re-run. |
| `refresh` fails at "Save updated data" with permission denied (403) | Settings → Actions → General → Workflow permissions → **Read and write permissions** → Save, then re-run. |
| Site shows "No data has been collected yet" | The first refresh has not succeeded. Check the latest run. |

**Everything is safe to re-run.** Re-running never duplicates ticks.

---

## 8. How it works (architecture)

```
config/climbers.json ──► scripts/refresh.mjs ──► site/data/ticks.json ──► site/ (static pages)
   (who to follow)        fetch + validate +       (saved in the repo,       GitHub Pages
                          merge, every ~6 h        so it persists)
```

- **`scripts/lib/parse.mjs`**: validates and parses the XML, turns descriptions into plain text, extracts route, grade, area breadcrumbs and (only if labelled) style, notes and climb date.
- **`scripts/lib/fetch.mjs`**: polite fetching: 20 s timeout, up to 2 retries for temporary errors, 5 MB cap, one feed at a time with a pause between feeds.
- **`scripts/lib/merge.mjs`**: merges new ticks into saved state: no duplicates, remembers when each tick was first seen, keeps old data when a feed fails.
- **`site/`**: plain HTML, CSS and JavaScript, no frameworks and no third-party requests.
- **Manage page (`manage.html`, `manage.js`, `github.js`, `config-edit.js`)**: talks straight from your browser to the GitHub API to edit `config/climbers.json` and start or inspect workflow runs. It has no server of its own. A content-security rule on that page only permits connections to `api.github.com`. Saving the friends list is a normal commit, which also triggers a refresh.
- **Persistence:** `site/data/ticks.json` is committed back to the repository by the workflow when it changes. This is deliberately not a cache or artifact (those can expire or vanish). The repo is the database.
- **Permissions:** the workflow has read-only access by default; only the refresh job can write (to save the data file) and only the deploy job can publish.
- **Action versions:** only official GitHub actions are used (`checkout`, `setup-node`, `upload-pages-artifact`, `deploy-pages`), referenced by major version tags (`@v4`, `@v3`). Pinning to full commit hashes is stricter (a moved tag cannot change what runs) but needs a hash lookup and manual updates. I could not look up hashes from my build environment and chose not to guess them. You can pin them later with GitHub's Dependabot.

### New ticks and first-run behaviour

The first time a friend is fetched, all of their available ticks are saved as **baseline**, meaning "already there when tracking started". They never get a **New** badge. Only ticks discovered in later refreshes get **New** (for 3 days). The site says so explicitly on first run.

### Which date is shown

The RSS entry's publication date (`pubDate`) means "when Mountain Project published this entry", which is not necessarily the day of the climb. The site therefore:

- uses the feed's pubDate for ordering and labels it "Date is when the tick was posted"; and
- uses a real climb date only if the feed description contains an explicit labelled date (for example `Date: 2026-10-09`), in which case it says "Climb date from the tick".

---

## 9. Data-source verification report

**What I could verify**
- Mountain Project answers the two feed URLs with a `text/xml` response. A fetch tool in my build environment reached them and received an XML content type.

**What I could not verify (and why)**
- **The actual XML contents.** My build environment's network policy blocks the site from the shell, and the fetch tool returned the body as unreadable binary. So I did **not** inspect real entries. I cannot confirm: the exact title/description format, whether a real tick date is present, how many entries each feed returns, how GUIDs behave, whether edited or duplicate ticks look different, or whether GitHub's servers get through without being blocked.
- **The CSV export fallback.** I did not investigate it. It requires a logged-in manual download from your account, so it cannot be automated without storing your login, which this project deliberately never does.

**How the project handles that uncertainty**
- The parser is defensive: missing fields never crash it, and unknown formats degrade to "route name only".
- Tick identity is climber + GUID + pubDate, so the same route ticked on different days, or by different friends, stays separate whichever way the feed identifies things.
- Every refresh prints a **Feed report** (entry count, oldest/newest dates, how many entries have grade/area/style/notes/climb date, whether IDs are unique, a short sample of one description). The first real run therefore *is* the verification. If the real format differs from my assumptions, send me that report and I'll adjust the parser.
- **History limit:** RSS feeds normally list only a limited number of recent entries. Whether older ticks can be collected depends on the real feed. Because saved ticks are kept forever, the site accumulates a longer history over time, but ticks that happened and fell out of a feed between two refreshes would be missed, and complete history is **not** promised.

---

## 10. Tests

Run with `npm test` (needs Node 22). They use **synthetic** sample feeds in `test/fixtures/` (they follow your description of a real entry but were **not** recorded from the live feeds; see `test/fixtures/README.md`) and never touch the network. The same tests run automatically on GitHub in the **Tests** workflow.

| # | Requirement | Result |
|---|---|---|
| 1 | Valid RSS parses | PASS (synthetic fixtures) |
| 2 | Malformed XML gives a controlled error | PASS |
| 3 | Grades and route names extracted | PASS (synthetic fixtures; **not checked against real entries**) |
| 4 | Dates parsed consistently, newest first | PASS |
| 5 | Publication date not confused with tick date | PASS (logic); whether the real feed has a real climb date is **unverified** |
| 6 | Area breadcrumbs extracted | PASS (synthetic fixtures; real breadcrumb format **unverified**) |
| 7 | No duplicates across refreshes | PASS |
| 8 | Same route, two climbers = two ticks | PASS |
| 9 | Failed feed doesn't erase data | PASS |
| 10 | One feed can update while another fails | PASS |
| 11 | New-tick detection and first-run behaviour | PASS |
| 12 | Search and filters, alone and combined | PASS (in a simulated browser, jsdom) |
| 13 | Empty-result message | PASS |
| 14 | Invalid config reported safely | PASS |
| 15 | Works under `/crag-feed/` | PASS on a local server using that path prefix; **NOT RUN** on real GitHub Pages |
| 16 | No API key / paid service needed | PASS (static check of the code and workflow) |
| 17 | Mobile layout and console errors | PASS in real Chromium at phone (390 px) and desktop widths for the feed and Manage pages: no console errors, no horizontal scrolling, content-security rule enforced. Other browsers and real phones **NOT RUN** |
| — | Manage page: add/remove friends, refresh, token handling, error messages | PASS against a simulated GitHub API (tests in `test/manage.test.mjs`, `test/github.test.mjs`, `test/config-edit.test.mjs`) |
| — | Manage page against the real GitHub API (CORS, token permissions, workflow start) | **NOT RUN** (no access to GitHub from the build environment) |
| — | Live fetch from Mountain Project | **NOT RUN** (network blocked in build environment) |
| — | GitHub Actions run and Pages deployment | **NOT RUN** (can't access your GitHub account) |

Automated: 90 tests, 90 passing at packaging time.

## 11. Known limitations

- Real feed format unverified (section 9). The first real run is the real test.
- The site is not live: it updates every ~6 hours (GitHub may delay scheduled runs by several minutes or more at busy times).
- Complete tick history is not guaranteed (section 9).
- If someone deletes or edits a tick on Mountain Project, our saved copy is not removed or updated retroactively.
- Area filter lists every place name from the breadcrumbs (not a fixed hierarchy) because the real breadcrumb structure is unverified.
- Not affiliated with Mountain Project; if they change or restrict the feeds, the site will show stale-data notices rather than break.
- Actions use version tags, not commit hashes (explained above).
- Layout was checked in one browser (Chromium) only, with the simulated GitHub API for the Manage page.
- The Manage page was tested only against a simulated GitHub API. It is written to GitHub's documented REST API, but exact behaviour with a real token (permissions, rate limits) is unverified.
- The Manage page needs a GitHub token that expires; it must be renewed when it does.
