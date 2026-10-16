# Technik

**Deutsch** · [English](Technical-Overview)

Poly Battle ist reines HTML, CSS und JavaScript (ES-Module) ohne Build-Schritt. Die 3D-Ansicht nutzt [Three.js](https://threejs.org/) 0.160 über eine Importmap (die Datei liegt unter `vendor/` im Repository, kein CDN nötig); der Online-Modus nutzt [Supabase](https://supabase.com/).

## Starten

```bash
npm install          # einmalig: Playwright für die Browser-Tests
npm run serve        # statischer Server auf http://localhost:8080
npm test             # Logiktests
npm run test:browser # das echte Spiel in Chromium: Menü, Stadt, Einheit, Forschung, Übersicht, Kampf, Zufallstest
npm run wiki         # Datenseiten des Wikis neu erzeugen (Englisch und Deutsch)
npm run screenshots  # Bilder für README und Wiki neu aufnehmen (docs/*.png)
```

## Aufbau

| Datei | Aufgabe |
|---|---|
| `index.html` | Einstieg, Importmap, alle Dialoge |
| `sw.js` | Service Worker: Spiel offline verfügbar |
| `vendor/` | Three.js und supabase-js als Dateien |
| `css/style.css` | Gestaltung |
| `js/config.js` | Spieldaten und Balancing: Einheiten, Stämme, Technologien, Gebäude |
| `js/hex.js` | Hex-Koordinaten (axial) |
| `js/rules.js` | Spielregeln als reine Funktionen auf dem Spielstand |
| `js/ai.js` | KI: `botStep` wählt einen Schritt, `applyStep` führt ihn aus |
| `js/render.js` | Three.js-Szene: Gelände, Einheiten, Städte, Animationen; zweiter kleiner Renderer für die 3D-Ansicht im Bau-Fenster |
| `js/ui.js` | Kärtchen oben, Schild am Objekt und Werkzeugreihe, Bau-Fenster, Forschung, Rundenbericht, Menüs |
| `js/main.js` | Verkabelung: Eingaben, Zugablauf, KI-Schleife, Speichern |
| `js/net.js` | Online-Partien, Profile und Bestenliste über Supabase |
| `js/actionlog.js` | Zugprotokoll der Tages- und Wochen-Herausforderung; damit wird die Partie zur Punkteprüfung nachgespielt |
| `js/save.js` | Lokaler Spielstand mit Plausibilitätsprüfung |
| `js/profile.js` | Profil, Stufen, Erfolge, Aussehen, Tages-/Wochen-Herausforderung |
| `js/campaign.js` | Kampagnen-Missionen |
| `js/admin.js`, `js/admin-panel.js` | Admin-/Kreativ-Panel zum Testen (Passwort, online nur im eigenen Zug) |
| `js/share.js` | Ergebnisbild zum Teilen |
| `js/sound.js` | Soundeffekte (Web Audio) |
| `test/logic.test.js` | Tests für Regeln, KI, Spielstand, Profil |
| `scripts/gen-wiki.mjs` | erzeugt die Datenseiten dieses Wikis auf Englisch (`docs/wiki/`) und Deutsch (`docs/wiki/de/`); englische Texte für die Spieldaten in `scripts/wiki-en.json` |
| `scripts/screenshots.mjs` | nimmt die Bilder für README und Wiki im echten Spiel auf |
| `scripts/verify-scores.mjs` | spielt eingereichte Herausforderungen aus dem Zugprotokoll nach und trägt die nachgerechnete Punktzahl ein (`.github/workflows/verify-scores.yml`, alle 10 Minuten) |
| `scripts/set-admin-password.mjs` | setzt das Admin-Passwort (`npm run admin-passwort -- "…"`; im Code landet nur ein Prüfwert) |
| `supabase/migrations/` | Datenbank-Schema und Server-Funktionen |

## Oberfläche

Angelehnt an Mini Metro: Die Karte bleibt frei, die Bedienung liegt in schwebenden Kärtchen an den Rändern, Informationen zu Stadt und Einheit als Schild am Objekt, Aktionen als Werkzeugreihe unten. Gestaltung: schlicht und eckig, eine Schrift (Systemschrift), Hauptfarbe Waldgrün, Sterne bernsteinfarben, Sechsecke nur als Marker und Abzeichen. Alle Farben liegen als CSS-Variablen in `css/style.css`, einmal hell und einmal dunkel.

## Grundsätze

- **Regeln sind rein.** `rules.js` kennt weder DOM noch Three.js; alles, was den Spielstand ändert, steht dort und ist testbar.
- **Der Spielstand ist ein JSON-Objekt.** Er wird lokal gespeichert, online übertragen und beim Laden mit `validState` geprüft.
- **Robust gegen alles.** Beschädigte Spielstände oder Profile dürfen das Spiel nie lahmlegen; Fehler in der KI oder in Nebeneffekten der Darstellung werden abgefangen.

## Online-Server

Alle Tabellen sind für Clients gesperrt (Row Level Security ohne Freigaben). Gelesen und geschrieben wird nur über Datenbank-Funktionen, die Eingaben prüfen:

- Partien: `create_match`, `join_match`, `save_match` – nur wer mitspielt und am Zug ist, darf speichern.
- Profile und Bestenliste: `pb_claim_name`, `pb_my_profile`, `pb_save_profile`, `pb_submit_score`, `pb_leaderboard` – Namen werden geprüft; Punkte der Herausforderungen zählen erst, nachdem `scripts/verify-scores.mjs` die Partie aus dem Zugprotokoll nachgespielt hat.

Spieler-Kennungen liegen nur als SHA-256-Prüfsumme in der Datenbank. Der Server rechnet die Spielregeln nicht nach, prüft beim Speichern aber, ob der neue Stand überhaupt möglich ist (`pb_check_plausible`): Runde, Technologien, Sterne, Einheiten, Städte und Sieg im Vergleich zum gespeicherten Stand, mit großzügigen Grenzen. Testpartien aus dem Admin-Panel sind davon ausgenommen und für alle Mitspieler sichtbar markiert.

## Tests

`npm test` prüft Regeln, Kampf, KI-Partien, Spielstand, Profil und Admin-Werkzeuge, inklusive eines Zufalls-Tests (Fuzzing) der Regeln. `npm run test:browser` spielt das echte Spiel in Chromium durch. GitHub führt beide Testläufe bei jedem Pull Request und jedem Push auf `main` aus (`.github/workflows/tests.yml`). Oberflächenänderungen sollten zusätzlich im Browser auf PC und Tablet ausprobiert werden.

## Wiki und Dokumentation

Das Wiki liegt als Markdown unter `docs/wiki/` im Repository: Englisch ist die Hauptsprache, die deutschen Seiten stehen unter `docs/wiki/de/`. Bei jedem Push auf `main` überträgt `.github/workflows/wiki.yml` den Ordner ins GitHub-Wiki. README und CONTRIBUTING gibt es ebenfalls auf Englisch (`README.md`, `CONTRIBUTING.md`) und Deutsch (`README.de.md`, `CONTRIBUTING.de.md`). Wer Text auf einer Seite ändert, ändert ihn in beiden Sprachen.
