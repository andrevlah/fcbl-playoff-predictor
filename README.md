# FCBL Playoff Predictor ⚾

**Live playoff odds for the 2026 Futures League, with the Lowell Spinners front and center.**

This is a website that answers one question all summer: *who's making the FCBL playoffs?*
It watches thefuturesleague.com, updates itself after every game, re-runs 25,000 simulated
seasons, and shows the odds FiveThirtyEight-style. Once it's set up, **it runs itself. You
don't have to touch anything.**

---

## What you're looking at

- **The big table**: every team's chance to make the playoffs and win the championship,
  with seed odds and a projected final record.
- **Odds over time**: how each team's chances have risen or fallen all season.
- **Spinners Watch**: Lowell's remaining schedule with a win probability for every game,
  the "what record gets us in?" curve, and flags (⚑) on the biggest games left.
- **Play GM**: sliders to ask "what if?" What if Vermont loses their ace to the draft?
  What if Lowell sweeps Norwich? What if Lowell goes 18–7 the rest of the way?
  These run instantly in your browser and never change the official numbers.

---

## One-time setup (about 15 minutes)

You need a free [GitHub](https://github.com) account. That's it: GitHub hosts the site
AND runs the auto-updates, all on the free tier.

**1. Create the repository**
- On GitHub, click the **+** in the top-right → **New repository**.
- Name it `fcbl-playoff-predictor`, keep it **Public**, click **Create repository**.

**2. Upload this project**
- Easiest way: install [GitHub Desktop](https://desktop.github.com), sign in,
  **File → Add local repository**, choose this folder, then **Publish repository**
  (uncheck "keep this code private").
- Command-line way, from inside this folder:
  ```
  git init
  git add .
  git commit -m "initial"
  git branch -M main
  git remote add origin https://github.com/YOUR-USERNAME/fcbl-playoff-predictor.git
  git push -u origin main
  ```

**3. Turn on the website (GitHub Pages)**
- On the repo page: **Settings → Pages** (left sidebar).
- Under "Build and deployment" → Source: **Deploy from a branch**.
- Branch: **main**, Folder: **/docs**. Click **Save**.
- After a minute or two your site is live at
  `https://YOUR-USERNAME.github.io/fcbl-playoff-predictor/`. Bookmark it!

**4. Allow the robot to save updates**
- **Settings → Actions → General** → scroll to "Workflow permissions" →
  choose **Read and write permissions** → **Save**.

**5. Run the first update**
- Click the **Actions** tab → **Update FCBL data** (left sidebar) →
  **Run workflow** button → green **Run workflow**.
- Wait ~2 minutes. It scrapes the league site, checks its own math, and publishes
  fresh numbers. From now on this happens automatically **every 30 minutes during
  game hours** (10 AM–11:30 PM Eastern).

Done. The site now maintains itself.

---

## Everyday things you might want to do

**Force a refresh right now** (say, right after a Spinners walk-off):
Actions tab → **Update FCBL data** → **Run workflow**.

**Edit the roster news notes** (the box next to the strength dials):
open `docs/js/teams.js`, find `newsNotes`, and edit the quoted lines. Commit the change
(GitHub Desktop: write a summary, click Commit, then Push). The site updates in ~1 minute.

**Record a Home-Run-Derby loss** (worth 1 standings point; the league site doesn't
mark these, so it's manual): in the same file, find `derbyLossOverrides` and follow the
example in the comment. E.g. if Westfield loses a derby game:
`export const derbyLossOverrides = { WF: 1 };`

**Turn it off after the season** (playoffs start Aug 10):
Actions tab → **Update FCBL data** → the **···** menu (top right) → **Disable workflow**.
The site stays up forever; it just stops checking for new games.
(While it's on, the cost is nothing: ~28 short runs a day is comfortably inside
GitHub's free allowance for public repos.)

---

## If the numbers look stale

1. Check the **Actions** tab. Green checkmarks = updates are running.
2. A **red X**? Click it and read the log. The scraper is deliberately paranoid:
   if the league site is down, changes its page layout, or anything doesn't add up
   (it re-checks every team's record against the official schedule page before
   publishing), it **keeps the previous good data and stops** rather than publish
   garbage. Usually the next run fixes itself.
3. Red X's for days in a row means the league site changed something structural.
   That's the one case that needs a developer (or Claude) to look at
   `scripts/lib/parse.js`.
4. Also note: the odds only *change* when a game goes final. A quiet Tuesday
   afternoon with no new finals = no new history point. That's normal.

---

## How the predictions work (plain English)

Full write-up lives in the "How this works" section at the bottom of the site. The
one-paragraph version: each team's strength is estimated from **runs scored and allowed**
(more predictive than won-lost record), blended with the actual record, and regressed
toward .500 because 30-odd games is a small sample. Every remaining game gets a win
probability (including home-field advantage, since Lowell's home/away split is notably real),
and we simulate the rest of the season 25,000 times, applying the league's actual rules:
points percentage standings, total-points and head-to-head tiebreakers, and best-of-3
playoff series where the higher seed hosts games 1 and 3.

Because summer-league rosters churn (MLB Draft, school commitments; see Nashua's 2025
fade from playoff position to 24-36, and .459 Norwich winning it all), every simulated
season also gives each team a random mid-summer strength swing ("roster churn," default
±12%). That keeps the model humble: no team gets written off or crowned in early July.
What it still can't know is *which* roster will change. If you have that intel, that's
exactly what the "Play GM" strength dials are for.

**Odds are estimates, not promises.** A 90% favorite loses one time in ten.

---

## For the technically curious

| Where | What |
|---|---|
| `docs/` | The website (GitHub Pages serves this folder). No build step, no framework. |
| `docs/data/` | The published data: `teams`, `schedule`, `results`, `odds`, `history` (all JSON). |
| `docs/js/sim.js` | The simulation engine: the **same file** runs on the server and in your browser. |
| `docs/js/teams.js` | Team config + the two manual overrides described above. |
| `scripts/scrape.js` | The scraper (Node 20 + cheerio). Polite: 1 request/second, identifies itself, 8–10 pages per run. |
| `.github/workflows/update.yml` | The every-30-minutes schedule. |
| `test/` | `npm test`: the automated test suite, including the locked worked-example from the model spec. |

Local development: `npm install`, `npm test`, `npm run scrape` (fetches live data),
`npm run seed` (restores the built-in July 5 snapshot), and `npx serve docs` to preview.

Data source: [thefuturesleague.com](https://thefuturesleague.com) (PrestoSports).
This is an unofficial fan project, not affiliated with the FCBL or any club.
