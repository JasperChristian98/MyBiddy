## Patch v4.1: bluff button restored

Fixes a missing `bidLimit` HTML element that caused JavaScript to stop updating bidding controls. The **Call their bluff** button is enabled for the next player after a bid is recorded, including when the maximum has been bid. The app now guards against a missing limit label, too. The existing v4 session key is unchanged, so refreshing should restore an in-progress game as long as the same `players.json` has been loaded.

To update an existing GitHub Pages repository, replace root `index.html`, `app.js` and `styles.css`. Keep your own `data/players.json` untouched. Hard-refresh the browser after GitHub Pages deploys.

---

# MY BIDDY AUNT — Referee desk / GitHub Pages

A no-backend football-club bidding game for a referee with **2–6 players**, clickable club adjudication, an ordered player queue, random-player familiarity filters and a searchable Player Explorer.

**Important: This ZIP intentionally does not include `data/players.json`, so unpacking it will not overwrite your 3,378+ real footballers.** It includes `data/players.demo.json` with three **fictional** players purely for testing the UI. Copy your current dataset into `data/players.json` before playing for real or publishing.

## Install into your existing project (Windows PowerShell)

1. **Back up** your current `data/players.json`, `data/cache/` and scraper first.
2. Unzip this archive into a **separate folder** or copy `index.html`, `app.js`, `styles.css` and `.nojekyll` into the root of your static site.
3. Copy your existing real `data/players.json` into the extracted project's `data/` folder. Keep your own cache/processed-candidates files with your existing local scraper setup. No scraping is needed to test the new site.
4. Open PowerShell in the folder containing `index.html`, then run:

   ```powershell
   py -m http.server 8000
   ```

   Open `http://127.0.0.1:8000/` in Chrome. No Flask required. Do not double-click `index.html` expecting all browsers to fetch local JSON from a `file://` URL.

5. If you haven't copied your real JSON yet, the site offers an explicitly labelled **fictional demo** button. That is *not* a real footballer dataset.

## Rules and operation

- Enter **2–6 players** and a points target (1–100).
- Opening bid rotates each round. Bids advance around the group; a challenged bidder must name their claimed number of clubs.
- The referee sees every eligible club in a **clickable answer sheet**, with years and appearances. Click one as it is correctly named; no manual club-name typing. A search box filters the buttons if a career list is long.
- Click **Wrong club** for an incorrect or repeated club; one point is awarded to **everybody except the challenged bidder**.
- If all required clubs are clicked, the bidder gets **one point**. The first to the target wins; simultaneous winners share the win.
- **Skip player** awards no points, discards the currently displayed footballer and draws again **without advancing the round or its starting bidder**. If bidding has begun, the referee is asked to confirm cancellation.
- Repeats of the same club are not valid; the referee presses Wrong club if the bidder repeats a previously ticked club.

## Queue

The Player Explorer has **+ Queue** and **Play next** controls. The Queue & Pool tab also includes quick name/club search. Reorder with the ↑/↓ buttons, remove entries with ✕, or clear the whole queue.

Every new draw takes the first queued player. If the queue is empty, the app draws randomly from your filtered pool. Queue entries are intentionally allowed to override pool filters; already-played players won't be randomly drawn again within a game until the selected pool is exhausted. You can deliberately requeue a player if you want a repeat.

**Queue and pool settings persist only in that browser** via `localStorage`. They aren't shared between phones or devices. The live match score is held in the page; keep the browser tab open while playing.

## Familiarity filters

Default: **Regulars** — the 250 most experienced records matching 250+ recorded senior domestic league appearances, 3+ eligible clubs and career overlap since 1992. Other presets: Familiar faces, Deep cuts, Anything goes. You can also set:

- Top 100 / 250 / 500 / 1,000 or all matching players
- Rank by **total senior league appearances**, or **Premier League appearances** when a separate `pl_appearances` field is actually present
- Minimum senior/PL appearances, qualifying club count, career year range and position

**These are appearance-based familiarity proxies, not evidence that a footballer is famous.** Most of the current scraper's Wikipedia career records do not contain a verified *Premier League-only* appearance total. Until you import one, PL rankings are disabled and the app clearly labels its default metric as **total senior league appearances**.

If no players match, you get an obvious empty-pool message instead of a crash; widen filters or queue someone explicitly.

## Publishing a second GitHub Pages website

GitHub Pages supports one personal/organization site and a separate **project site for each repository**. If you already use `YOURNAME.github.io`, make **another repository**, e.g. `my-biddy-aunt`:

1. On GitHub, create a **new repository** called `my-biddy-aunt`. Don't replace your existing Pages repo.
2. Push this project to the repository's `main` branch, including `data/players.json`. The workflow publishes only the app files and player JSON; scraper scripts, caches and backups are not included in the site artifact.
3. Under **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main` (or run **Actions → Deploy GitHub Pages → Run workflow**). The first run publishes at `https://YOUR-GITHUB-USERNAME.github.io/my-biddy-aunt/` (unless your personal Pages custom domain changes the default domain behavior). Your previous website remains untouched.
5. When you scrape more players locally, update `data/players.json` and push. Pages republishes that snapshot; the web app does not scrape live.

Every asset uses **relative paths** (`./app.js`, `./data/players.json`) so the site works beneath `/my-biddy-aunt/` as well as localhost.

### Existing Python scraper

This ZIP also contains the **resumable batched Premier League scraper** from your previous upgrade under `scripts/scrape.py`. It is separate from the website. **Keep your currently running scraper untouched**; you only need to copy new UI files to the Pages project. If you choose to use the bundled scraper later, remember that PowerShell uses:

```powershell
$env:MBA_CONTACT = 'your-email@example.com'
py scripts\scrape.py --target 10000 --delay 6
```

The target includes all existing saved players, and the scraper's own category may exhaust its available candidates before reaching 10,000.

### Data and privacy

`data/players.json` becomes **publicly downloadable** from a public GitHub Pages site. Check it for secrets before committing (the scraper normally stores public career facts, source URLs and scrape timestamps). The Wikipedia source may be incomplete or incorrect; the referee remains the final adjudicator. Keep the underlying source URLs available for challenges. If you republish Wikipedia prose or images later, check their attribution/license requirements.

## v4 game-state safeguards

- Bids are capped at the current footballer's number of eligible clubs. Once the maximum is bid, the next player must challenge.
- **End game** closes the match immediately and declares the current leader(s).
- Active games are stored in browser `sessionStorage`, including names, scores, target, current round/player, bidding trail, accepted clubs, challenged result and round history. Refreshing the page in the same browser tab/session restores the match. Starting a new game clears that session record.
- Queue and pool preferences remain in `localStorage`, so they survive browser restarts.
