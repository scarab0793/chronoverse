# CHRONOVERSE

Open-world historical time-travel RPG – browser prototype (HTML5, ES modules, Three.js).

* **Play:** open `index.html` through a web server (create a character → start in 2032).
* **Developer tools:** `debug.html` (legacy dashboards + unified GameState editor).
* **Docs:** [`docs/AUDIT.md`](docs/AUDIT.md) (Phase 0 audit), [`docs/PHASE1_CHRONOWORLDSYNC.md`](docs/PHASE1_CHRONOWORLDSYNC.md) (architecture, state, save format, tests, limitations).

```bash
python3 -m http.server 8123   # http://localhost:8123/
npm test                      # unit + data tests (Node 22, no dependencies)
npm run test:browser          # end-to-end test in headless Chromium (Playwright)
```

Controls: WASD move · mouse look (click the view) · E interact · T time device · H time anchor · I inventory · V camera · M menu/save · F1 help.
