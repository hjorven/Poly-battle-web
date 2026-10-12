# Battle of Poly – Web

Low-Poly Rundenstrategiespiel im Stil von *The Battle of Polytopia*, komplett im Browser lauffähig (Three.js, kein Build-Schritt). Sprache: Deutsch.

## Spielprinzip

- **Große hexagonale Karte** (26×18) mit Feldern, Wäldern (Verteidigungsbonus), Bergen (mit „Klettern" begehbar), Wasser, Ozean und Eis.
- **12 Stämme** mit eigener Start-Technologie und Starteinheit – du wählst deinen Stamm, 1 bis 5 KI-Gegner (Spieleinstellungen).
- **Sterne-Wirtschaft**: Städte generieren pro Runde Einkommen basierend auf der Bevölkerung.
- **Einheiten**: Krieger, Schütze, Reiter, Verteidiger, Schwertkämpfer, Katapult, Gedankenbeuger – jede mit eigenen Werten für Angriff, Verteidigung, Bewegung und Reichweite.
- **Technologiebaum** in drei Stufen: Organisation, Jagd, Klettern, Reiten, Fischerei; Landwirtschaft, Schildmacher, Forstwirtschaft, Bogenschießen, Bergbau, Freie Hände, Wege, Segeln; Philosophie, Diplomatie, Mathematik, Schmiedekunst, Navigation. Die Kosten skalieren mit der Zahl eigener Städte.
- **Städte**: Bevölkerung kaufen, pro Stadt und Runde eine Einheit ausbilden, Städte erobern.
- **Fog of War**: Unentdecktes Land ist abgedunkelt. Feindliche Einheiten sieht (und trifft) man nur, solange sie in Sichtweite einer eigenen Einheit oder Stadt stehen.
- **Sieg**: Wer als Letzter noch Städte besitzt (alle anderen eliminiert), gewinnt. Verlierst du gegen die KI deine letzte Stadt, endet die Partie mit „Besiegt".
- **Spielstand**: Partien gegen die KI und Hotseat-Partien werden nach jeder Aktion im Browser gespeichert und lassen sich über „Weiterspielen" im Menü fortsetzen.

## Spielmodi

| Modus | Beschreibung |
|---|---|
| **Gegen KI** | Dein Stamm gegen 1–5 Bots auf einer großen Welt (lokal, kein Server nötig) |
| **Hotseat** | Zwei Spieler abwechselnd an einem Gerät (lokal) |
| **Online** | Über Supabase (`matches`-Tabelle) – Link teilen und gemeinsam spielen |

## Starten

```bash
npm run serve     # startet einen lokalen Webserver auf Port 8080
```

Einfach `index.html` über einen beliebigen statischen Server ausliefern (GitHub Pages funktioniert direkt). Voraussetzung: Internetzugang für die Three.js-Importmap (jsDelivr). Für den Online-Modus werden die Supabase-Zugangsdaten in `js/net.js` benötigt.

### Online-Modus (Supabase)

Die Tabelle `matches` ist nur lesbar. Geschrieben wird ausschließlich über die Datenbank-Funktionen `create_match`, `join_match` und `save_match` aus `supabase/migrations/20261012_secure_matches.sql`. Sie prüfen, ob du Spieler der Partie bist, ob du am Zug bist und ob der Stand neuer ist. Spieler-Kennungen liegen nur als SHA-256-Hash in der Datenbank.

Grenze: Der Server prüft nicht die Spielregeln selbst. Wer am Zug ist, könnte theoretisch einen manipulierten Spielstand senden.

## Tests

```bash
npm test                      # Logik-Tests (Regeln, Kampf, KI, Spielstand, komplette KI-Partien)
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
js/save.js        Lokaler Spielstand (Weiterspielen)
js/main.js        Verkabelung, Eingabe, Bot-Loop
test/logic.test.js
```
