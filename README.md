# Battle of Poly – Web

Low-Poly Rundenstrategiespiel im Stil von *The Battle of Polytopia*, komplett im Browser lauffähig (Three.js, kein Build-Schritt). Sprache: Deutsch.

## Spielprinzip

- **Hexagonale Karte** mit Ebenen, Wäldern (Verteidigungsbonus), Bergen (unpassierbar) und Wasser.
- **Sterne-Wirtschaft**: Städte generieren pro Runde Einkommen basierend auf der Bevölkerung.
- **Einheiten**: Krieger, Schütze, Reiter, Verteidiger, Schwertkämpfer, Katapult – jede mit eigenen Werten für Angriff, Verteidigung, Bewegung und Reichweite.
- **Technologiebaum**: Jagd, Ackerbau, Reitkunst, Bergbau, Handwerk, Mathematik schalten bessere Einheiten frei.
- **Städte**: Bevölkerung kaufen, pro Stadt und Runde eine Einheit ausbilden, Städte erobern.
- **Sieg**: Wer alle Städte des Gegners erobert, gewinnt.

## Spielmodi

| Modus | Beschreibung |
|---|---|
| **Solo vs. KI** | Ein Spieler gegen einen Bot (lokal, kein Server nötig) |
| **Hotseat** | Zwei Spieler abwechselnd an einem Gerät (lokal) |
| **Online** | Über Supabase (`matches`-Tabelle) – Link teilen und gemeinsam spielen |

## Starten

```bash
npm run serve     # startet einen lokalen Webserver auf Port 8080
```

Einfach `index.html` über einen beliebigen statischen Server ausliefern (GitHub Pages funktioniert direkt). Voraussetzung: Internetzugang für die Three.js-Importmap (jsDelivr). Für den Online-Modus werden die Supabase-Zugangsdaten in `js/net.js` benötigt.

## Tests

```bash
npm test                      # 20 Logik-Tests (Regeln, Kampf, KI, Siegbedingung)
```

## Aufbau

```
index.html        Einstieg, Importmap, Overlays
css/style.css     UI-Styling
js/config.js      Balancing-Konstanten (Einheiten, Kosten, Techs)
js/hex.js         Hex-Koordinaten-Mathematik
js/rules.js       Spielregeln (Zug, Kampf, Ausbildung, Sieg)
js/ai.js          Bot-KI
js/render.js      Three.js-Szene (Kacheln, Einheiten, Städte)
js/ui.js          DOM-Panels, Tech-Baum, Toasts
js/net.js         Supabase-Online-Partien
js/main.js        Verkabelung, Eingabe, Bot-Loop
test/logic.test.js
```
