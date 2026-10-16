# Contributing to Poly Battle

**English** · [Deutsch](CONTRIBUTING.de.md)

Thanks for wanting to help. This page explains how bug reports, ideas and pull requests work. Issues and pull requests are welcome in English or German.

## Reporting bugs and suggesting ideas

Under [Issues → New issue](https://github.com/hjorven/Poly-battle-web/issues/new/choose) there are templates for:

- **Bug** – something does not work or looks wrong.
- **Idea** – a new feature or improvement.
- **Balance** – something is too strong, too weak or unfair.

A good bug report says what you did, what you expected and what happened instead, on which device and in which browser. A screenshot almost always helps. If a save game triggered the bug, attach it if possible.

## Developing locally

You only need Git, Node.js (for the tests) and Python or another static web server.

```bash
git clone https://github.com/hjorven/Poly-battle-web.git
cd Poly-battle-web
npm run serve   # http://localhost:8080
npm test
```

There is no build step; `npm install` only fetches Playwright for the browser tests. Code changes are visible after reloading the page.

## Pull request workflow

1. Create a branch from the current `main`, for example `feature/trade-routes` or `fix/bridge-ship`.
2. Keep the pull request to one topic. Submit several independent changes separately.
3. Run `npm test` and `npm run test:browser` – all tests must pass (run `npm install` once beforehand). New rules need new tests in `test/logic.test.js`, new interaction flows in `test/browser.test.mjs`. GitHub runs both test suites automatically on every pull request (`.github/workflows/tests.yml`); the pull request is only merged once they pass.
4. Try interface changes in the browser: on a PC with mouse and keyboard and on a tablet or in device emulation with touch, in portrait and landscape.
5. If you changed game data in `js/config.js` or `js/campaign.js`, run `npm run wiki` and commit the generated pages under `docs/wiki/` (English) and `docs/wiki/de/` (German). New or changed texts from the game data need an English version in `scripts/wiki-en.json`; if one is missing, `npm run wiki` lists the missing texts. If the interface changed visibly, retake the images with `npm run screenshots`.
6. Describe in the pull request what changes for players and how you tested it. Add screenshots for visible changes.

## Documentation

README, CONTRIBUTING and the wiki exist in English (main language) and German. Always change both versions: `README.md` and `README.de.md`, `CONTRIBUTING.md` and `CONTRIBUTING.de.md`, the wiki pages under `docs/wiki/` and `docs/wiki/de/`. After merging, GitHub copies the wiki automatically.

## Guidelines

### Game and interface

- **Language:** all texts in the game are German, in simple words. Buttons say what happens („Zug beenden“, not „OK“).
- **No emojis and no text symbols** in the interface (no arrows, stars or check marks as characters). Where a symbol is needed, use SVG.
- **No undo.** Every move counts; two-step actions (mark first, then execute) prevent mistakes instead.
- **World style:** realistic medieval in a low-poly look. New models should fit in.
- **Interface style:** plain like Mini Metro – the map stays clear, controls in floating cards, information as a sign on the object, actions as a toolbar at the bottom. Square corners, one typeface, main colour forest green via the CSS variables (light and dark), hexagons only as markers and badges. No gradients, textures or decorative fonts.
- **For all devices:** usable with mouse, keyboard and touch. Tap targets at least 36 px high, important dialogs fit on an iPad without scrolling (810×950 portrait, 1080×700 landscape).
- **Phone view:** on phones (detected by the device, not the window width) `index.html` sets the class `phone` on `<html>`. Phone rules live at the end of `css/style.css` under `html.phone`, so PC and tablet stay untouched. On a phone, show only what is needed at once and put the rest behind „Mehr“.
- **Robust:** corrupted save games, profiles or unexpected input must never break the game.

### Code

- Plain JavaScript as ES modules, no framework, no build step.
- **Rules belong in `js/rules.js`** as pure functions on the game state – without DOM and without Three.js. That keeps them testable and makes them behave the same in online matches.
- Balancing values live in `js/config.js`, not scattered across the code.
- Code comments are in German and explain the why, not the what.
- Write like the surrounding code: same naming, same comment density.

### Database (Supabase)

- Changes only as a new file in `supabase/migrations/`, never edit existing migrations.
- File name `YYYYMMDDHHMMSS_name.sql` (full time). The same version number appears in the Supabase migration list after applying, so repository and database stay in sync and `supabase db push` only applies what is new.
- Tables stay locked for clients (row level security without grants). Access only via `security definer` functions with `set search_path = ''` that validate all input.
- Never store plain-text IDs, only checksums.
- New server functions get tests in `test/db/` (`npm run test:db` with a local Postgres).

## Code of conduct

Be friendly and objective. Criticism is about the code, not the person.

## License

By contributing, you agree that your contribution is licensed under the project's [MIT license](LICENSE).
