# Battle of Poly – Web

Low-Poly Rundenstrategiespiel im Stil von *The Battle of Polytopia*, komplett im Browser lauffähig (Three.js, kein Build-Schritt). Sprache: Deutsch.

## Spielprinzip

- **Große hexagonale Karte** (20×14) mit Ebenen, Wäldern (Verteidigungsbonus), Bergen (mit „Klettern" begehbar) und Wasser.
- **4 Stämme** mit eigenen Start-Technologien (Imperius, Bardur, Xin-Xi, Kickoo, Oumaji) – je 2 starten als KI, 1 steuert du, wählbar im Menü.
- **Sterne-Wirtschaft**: Städte generieren pro Runde Einkommen basierend auf der Bevölkerung.
- **Einheiten**: Krieger, Schütze, Reiter, Verteidiger, Schwertkämpfer, Katapult, Gedankenbeuger – jede mit eigenen Werten für Angriff, Verteidigung, Bewegung und Reichweite.
- **Technologiebaum** in drei Stufen: Organisation, Jagd, Klettern, Reiten, Fischerei; Landwirtschaft, Schildmacher, Forstwirtschaft, Bogenschießen, Bergbau, Freie Hände, Wege, Segeln; Philosophie, Diplomatie, Mathematik, Schmiedekunst, Navigation. Die Kosten skalieren mit der Zahl eigener Städte.
- **Städte**: Bevölkerung kaufen, pro Stadt und Runde eine Einheit ausbilden, Städte erobern.
- **Fog of War**: Unentdecktes Land ist abgedunkelt und wird durch Einheiten und Städte Schritt für Schritt aufgedeckt.
- **Sieg**: Wer als Letzter noch Städte besitzt (alle anderen eliminiert), gewinnt.

## Spielmodi

| Modus | Beschreibung |
|---|---|
| **Solo vs. 3 KI** | Dein Stamm gegen drei Bots auf einer großen Welt (lokal, kein Server nötig) |
| **Hotseat** | Zwei Spieler abwechselnd an einem Gerät (lokal) |
| **Online** | Über Supabase (`matches`-Tabelle) – Link teilen und gemeinsam spielen |

## Starten

```bash
npm run serve     # startet einen lokalen Webserver auf Port 8080
```

Einfach `index.html` über einen beliebigen statischen Server ausliefern (GitHub Pages funktioniert direkt). Voraussetzung: Internetzugang für die Three.js-Importmap (jsDelivr). Für den Online-Modus werden die Supabase-Zugangsdaten in `js/net.js` benötigt.

## Tests

```bash
npm test                      # 27 Logik-Tests (Regeln, Kampf, KI, Siegbedingung)
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
