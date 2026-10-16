# Technik

Poly Battle ist reines HTML, CSS und JavaScript (ES-Module) ohne Build-Schritt. Die 3D-Ansicht nutzt [Three.js](https://threejs.org/) 0.160 über eine Importmap; der Online-Modus nutzt [Supabase](https://supabase.com/).

## Starten

```bash
npm install          # einmalig: Playwright für die Browser-Tests
npm run serve        # statischer Server auf http://localhost:8080
npm test             # Logiktests
npm run test:browser # das echte Spiel in Chromium: Menü, Stadt, Einheit, Forschung, Übersicht, Kampf, Zufallstest
npm run wiki         # Datenseiten des Wikis neu erzeugen
```

## Aufbau

| Datei | Aufgabe |
|---|---|
| `index.html` | Einstieg, Importmap, alle Dialoge |
| `css/style.css` | Gestaltung |
| `js/config.js` | Spieldaten und Balancing: Einheiten, Stämme, Technologien, Gebäude |
| `js/hex.js` | Hex-Koordinaten (axial) |
| `js/rules.js` | Spielregeln als reine Funktionen auf dem Spielstand |
| `js/ai.js` | KI: `botStep` wählt einen Schritt, `applyStep` führt ihn aus |
| `js/render.js` | Three.js-Szene: Gelände, Einheiten, Städte, Animationen; zweiter kleiner Renderer für die 3D-Ansicht im Bau-Fenster |
| `js/ui.js` | Kärtchen oben, Schild am Objekt und Werkzeugreihe, Bau-Fenster, Forschung, Rundenbericht, Menüs |
| `js/main.js` | Verkabelung: Eingaben, Zugablauf, KI-Schleife, Speichern |
| `js/net.js` | Online-Partien, Profile und Bestenliste über Supabase |
| `js/save.js` | Lokaler Spielstand mit Plausibilitätsprüfung |
| `js/profile.js` | Profil, Stufen, Erfolge, Aussehen, Tages-/Wochen-Herausforderung |
| `js/campaign.js` | Kampagnen-Missionen |
| `js/admin.js`, `js/admin-panel.js` | Admin-/Kreativ-Panel zum Testen (Passwort, online nur im eigenen Zug) |
| `js/share.js` | Ergebnisbild zum Teilen |
| `js/sound.js` | Soundeffekte (Web Audio) |
| `test/logic.test.js` | Tests für Regeln, KI, Spielstand, Profil |
| `scripts/gen-wiki.mjs` | erzeugt die Datenseiten dieses Wikis |
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
- Profile und Bestenliste: `pb_claim_name`, `pb_my_profile`, `pb_save_profile`, `pb_submit_score`, `pb_leaderboard` – Namen werden geprüft, Punkte auf Plausibilität begrenzt.

Spieler-Kennungen liegen nur als SHA-256-Prüfsumme in der Datenbank. Der Server rechnet die Spielregeln nicht nach, prüft beim Speichern aber, ob der neue Stand überhaupt möglich ist (`pb_check_plausible`): Runde, Technologien, Sterne, Einheiten, Städte und Sieg im Vergleich zum gespeicherten Stand, mit großzügigen Grenzen. Testpartien aus dem Admin-Panel sind davon ausgenommen und für alle Mitspieler sichtbar markiert.

## Tests

`npm test` prüft Regeln, Kampf, KI-Partien, Spielstand, Profil und Admin-Werkzeuge, inklusive eines Zufalls-Tests (Fuzzing) der Regeln. Oberflächenänderungen sollten zusätzlich im Browser auf PC und Tablet ausprobiert werden.
