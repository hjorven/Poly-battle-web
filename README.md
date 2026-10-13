# Battle of Poly – Web

Low-Poly Rundenstrategiespiel im Stil von *The Battle of Polytopia*, komplett im Browser lauffähig (Three.js, kein Build-Schritt). Sprache: Deutsch.

## Spielprinzip

- **Große hexagonale Karte** (26×18) mit Feldern, Wäldern (Verteidigungsbonus), Bergen (mit „Klettern" begehbar), Wasser, Ozean und Eis.
- **12 Stämme** mit eigener Start-Technologie und Starteinheit – du wählst deinen Stamm, 1 bis 5 KI-Gegner (Spieleinstellungen).
- **Sterne-Wirtschaft**: Städte generieren pro Runde Einkommen basierend auf der Bevölkerung.
- **Einheiten**: Krieger, Schütze, Reiter, Verteidiger, Schwertkämpfer, Katapult, Gedankenbeuger – jede mit eigenen Werten für Angriff, Verteidigung, Bewegung und Reichweite.
- **Technologiebaum** in drei Stufen: Organisation, Jagd, Klettern, Reiten, Fischerei; Landwirtschaft, Schildmacher, Forstwirtschaft, Bogenschießen, Bergbau, Freie Hände, Wege, Segeln; Philosophie, Diplomatie, Mathematik, Schmiedekunst, Navigation. Die Kosten skalieren mit der Zahl eigener Städte.
- **Städte**: Bevölkerung kaufen, pro Stadt und Runde eine Einheit ausbilden, Städte erobern.
- **Stadtstufen**: Jede neue Bevölkerungsstufe (2 bis 5) bringt eine Belohnung zur Wahl – Werkstatt oder Erkunder, Stadtmauer oder Vorräte, Wachstum oder Grenzerweiterung, Park oder Riese.
- **Ruinen** auf der Karte geben beim Betreten Sterne, eine Technologie, einen Schwertkämpfer, Bevölkerung oder eine aufgedeckte Umgebung.
- **Spielmodi**: Eroberung (bis nur noch ein Stamm übrig ist) oder Perfektion (30 Runden, höchste Punktzahl gewinnt). Am Ende gibt es eine Auswertung mit Punkteverlauf.
- **KI-Stärke** Leicht, Normal oder Schwer (Einkommen, Startsterne, Angriffsverhalten).
- **Fog of War**: Unentdecktes Land liegt unter treibendem Nebel, entdecktes, aber unbeobachtetes Land unter leichtem Dunst. Feindliche Einheiten sieht (und trifft) man nur in Sichtweite; Städte im Dunst zeigen den Stand, in dem man sie zuletzt gesehen hat.
- **Wasser & Brücken**: Alle Gewässer sind zu einem Netz verbunden. An schmalen Stellen gibt es natürliche Brücken; mit „Wege“ bauen Landeinheiten eigene Brücken über 1–2 Felder Flachwasser (5 Sterne pro Feld). Schiffe fahren darunter durch oder reißen sie ein.
- **Spion**: Günstiger Späher (Bewegung 2, Sicht 2, auf Bergen 3), betritt Berge ohne Klettern, greift nicht an.
- **Einheiten auflösen** (halbe Kosten zurück) und **Regeneration**: Einheiten heilen zu Rundenbeginn, wenn sie nicht angegriffen haben und kein Gegner sie erreichen kann.
- **Tipps**: Der Knopf „N bereit“ springt reihum zu Einheiten, die noch handeln können; diese tragen eine gelbe Markierung.
- **Veteranen**: Nach 3 Siegen wird eine Einheit befördert (+5 Leben, voll geheilt, ★ an der Lebensanzeige).
- **Einschiffen**: Landeinheiten fahren über einen eigenen Hafen aufs Wasser und als Boot weiter; an Land gehen beendet den Zug.
- **Kontrollzonen**: Wer neben eine feindliche Einheit zieht, muss dort anhalten.
- **Diplomatie**: Mit „Diplomatie“ lässt sich Stämmen, denen man begegnet ist, Frieden anbieten (Übersicht). Im Frieden kein Angriff und kein Betreten der Städte des anderen; Kriegserklärung jederzeit, danach 3 Runden Pause.
- **Stammes-Fähigkeiten**: Jeder Stamm hat eine Besonderheit (z. B. Xin-Xi: Berge kosten 1 Bewegung, Kickoo: Schiffe +1 Bewegung, Luxidoor: Hauptstadt +2 Sterne).
- **Karten**: Größe Klein/Normal/Groß und Typ Kontinente/Pangäa/Archipel in den Spieleinstellungen.
- **Komfort**: Minikarte (antippen springt dorthin), Rückgängig für Aktionen im laufenden Zug (nicht nach Kampf, Eroberung oder Ruinen; nicht online), Soundeffekte (🔊 schaltet stumm).
- **KI**: verteidigt bedrohte Städte, schickt Spione, baut Schiffe und Brücken und bricht Frieden, wenn sie sonst keine Ziele hat. Züge im Nebel laufen ohne Animation durch.
- **Kamera**: verschieben (ziehen), zoomen (Mausrad/zwei Finger), drehen und neigen (rechte Maustaste, Zwei-Finger-Drehgeste, Knöpfe unten rechts oder Q/E und R/F; N = Standardansicht).
- **Städte** wachsen sichtbar: Hütten, Dorf mit Wachturm, Steinturm mit Markt, Halle, Burg; Hauptstadt mit Krone, Mauer/Park/Werkstatt am Modell erkennbar.
- **Einheiten** drehen sich in Lauf- und Angriffsrichtung; die Lebensanzeige trägt die Teamfarbe.
- **Online mit KI**: Beim Erstellen einer Online-Partie lassen sich 0–3 KI-Gegner hinzufügen. Die KI-Züge rechnet das Gerät des Spielers, der gerade seinen Zug beendet hat.
- **Sieg**: Wer als Letzter noch Städte besitzt (alle anderen eliminiert), gewinnt. Verlierst du gegen die KI deine letzte Stadt, endet die Partie mit „Besiegt".
- **Spielstand**: Partien gegen die KI und Hotseat-Partien werden nach jeder Aktion im Browser gespeichert und lassen sich über „Weiterspielen" im Menü fortsetzen.

## Spielmodi

| Modus | Beschreibung |
|---|---|
| **Gegen KI** | Dein Stamm gegen 1–5 Bots auf einer großen Welt (lokal, kein Server nötig) |
| **Hotseat** | Zwei Spieler abwechselnd an einem Gerät, mit Übergabe-Bildschirm zwischen den Zügen (lokal) |
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
