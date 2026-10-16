# Technical Overview

**English** · [Deutsch](Technik)

Poly Battle is plain HTML, CSS and JavaScript (ES modules) with no build step. The 3D view uses [Three.js](https://threejs.org/) 0.160 via an import map (the file lives under `vendor/` in the repository, no CDN needed); online mode uses [Supabase](https://supabase.com/).

## Getting started

```bash
npm install          # once: Playwright for the browser tests
npm run serve        # static server at http://localhost:8080
npm test             # logic tests
npm run test:browser # the real game in Chromium: menu, city, unit, research, overview, combat, random test
npm run wiki         # regenerate the wiki data pages (English and German)
npm run screenshots  # retake the images for README and wiki (docs/*.png)
```

## Structure

| File | Purpose |
|---|---|
| `index.html` | entry point, import map, all dialogs |
| `sw.js` | service worker: game available offline |
| `vendor/` | Three.js and supabase-js as files |
| `css/style.css` | styling |
| `js/config.js` | game data and balancing: units, tribes, technologies, buildings |
| `js/hex.js` | hex coordinates (axial) |
| `js/rules.js` | game rules as pure functions on the game state |
| `js/ai.js` | AI: `botStep` picks a step, `applyStep` carries it out |
| `js/render.js` | Three.js scene: terrain, units, cities, animations; a second small renderer for the 3D view in the build window |
| `js/ui.js` | top cards, sign on the object and toolbar, build window, research, turn report, menus |
| `js/main.js` | wiring: input, turn flow, AI loop, saving |
| `js/net.js` | online matches, profiles and leaderboard via Supabase |
| `js/actionlog.js` | move log of the daily and weekly challenge; used to replay the game for score verification |
| `js/save.js` | local save game with plausibility checks |
| `js/profile.js` | profile, levels, achievements, cosmetics, daily/weekly challenge |
| `js/campaign.js` | campaign missions |
| `js/admin.js`, `js/admin-panel.js` | admin/creative panel for testing (password, online only during your own turn) |
| `js/share.js` | result image for sharing |
| `js/sound.js` | sound effects (Web Audio) |
| `test/logic.test.js` | tests for rules, AI, game state, profile |
| `scripts/gen-wiki.mjs` | generates the data pages of this wiki in English (`docs/wiki/`) and German (`docs/wiki/de/`); English texts for the game data live in `scripts/wiki-en.json` |
| `scripts/screenshots.mjs` | takes the images for README and wiki in the real game |
| `scripts/verify-scores.mjs` | replays submitted challenges from the move log and stores the recomputed score (`.github/workflows/verify-scores.yml`, every 10 minutes) |
| `scripts/set-admin-password.mjs` | sets the admin password (`npm run admin-passwort -- "…"`; only a hash ends up in the code) |
| `supabase/migrations/` | database schema and server functions |

## Interface

Inspired by Mini Metro: the map stays clear, the controls sit in floating cards along the edges, information about cities and units appears as a sign on the object, and actions as a toolbar at the bottom. Design: plain and angular, one typeface (system font), main colour forest green, stars in amber, hexagons only as markers and badges. All colours are CSS variables in `css/style.css`, once for light and once for dark.

The game interface is German only; code comments are German as well.

## Principles

- **Rules are pure.** `rules.js` knows neither the DOM nor Three.js; everything that changes the game state lives there and is testable.
- **The game state is a JSON object.** It is saved locally, sent online and checked with `validState` on load.
- **Robust against everything.** Corrupted save games or profiles must never break the game; errors in the AI or in rendering side effects are caught.

## Online server

All tables are locked for clients (row level security without grants). Reading and writing only happens through database functions that validate their input:

- Matches: `create_match`, `join_match`, `save_match` – only players in the match whose turn it is may save.
- Profiles and leaderboard: `pb_claim_name`, `pb_my_profile`, `pb_save_profile`, `pb_submit_score`, `pb_leaderboard` – names are checked; challenge scores only count after `scripts/verify-scores.mjs` has replayed the game from the move log.

Player IDs are stored in the database only as SHA-256 checksums. The server does not recompute the game rules, but when saving it checks whether the new state is possible at all (`pb_check_plausible`): turn, technologies, stars, units, cities and victory compared with the stored state, with generous limits. Test matches from the admin panel are exempt and visibly marked for all players.

## Tests

`npm test` checks rules, combat, AI games, game state, profile and admin tools, including a random test (fuzzing) of the rules. `npm run test:browser` plays the real game in Chromium. GitHub runs both test suites on every pull request and every push to `main` (`.github/workflows/tests.yml`). Interface changes should also be tried in the browser on PC and tablet.

## Wiki and documentation

The wiki lives as Markdown under `docs/wiki/` in the repository: English is the main language, the German pages are under `docs/wiki/de/`. On every push to `main`, `.github/workflows/wiki.yml` copies the folder to the GitHub wiki. README and CONTRIBUTING also exist in English (`README.md`, `CONTRIBUTING.md`) and German (`README.de.md`, `CONTRIBUTING.de.md`). If you change text on a page, change it in both languages.
