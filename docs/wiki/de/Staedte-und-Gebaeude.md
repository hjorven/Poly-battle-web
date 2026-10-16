# Städte und Gebäude

**Deutsch** · [English](Cities-and-Buildings)

> Diese Seite wird aus den Spieldaten erzeugt (`npm run wiki`). Änderungen bitte in `js/config.js` bzw. `js/campaign.js` machen.

## Stadtstufen

Wächst eine Stadt auf eine neue Stufe, wählst du eine von zwei Belohnungen:

| Stufe | Wahl 1 | Wahl 2 |
| --- | --- | --- |
| 2 | **Werkstatt**: +1 Stern pro Runde | **Erkunder**: Deckt die Umgebung im Umkreis von 4 Feldern auf |
| 3 | **Stadtmauer**: Verteidiger in dieser Stadt erhalten 4-fache Verteidigung | **Vorräte**: +5 Sterne sofort |
| 4 | **Wachstum**: +1 Bevölkerung (nächste Stufe) | **Grenzerweiterung**: Stadtgebiet wächst auf 2 Felder Umkreis |
| 5 | **Park**: +1 Stern pro Runde | **Riese**: Ein Riese (40 Leben) erscheint bei der Stadt |

## Gebäude

Gebaut wird im Stadtmenü über **Ausbauen**: Feld im Stadtgebiet antippen, dann das Gebäude wählen.

| Gebäude | Kosten | Gelände | Technologie | Ertrag |
| --- | --- | --- | --- | --- |
| **Farm** | 6 | Feld | Landwirtschaft | +1 pro Runde |
| **Sägewerk** | 7 | Wald | Forstwirtschaft | +1 pro Runde |
| **Mine** | 6 | Berg, Hügel | Bergbau | +1 pro Runde |
| **Hafen** | 7 | Flachwasser, Ozean | Segeln | +1 pro Runde |
| **Tempel** | 10 | Feld | Meditation | +2 pro Runde |
| **Ballonplatz** | 8 | Feld | Ballonfahrt | +1 pro Runde |
| **Windmühle** | 6 | Feld | Mühlenbau | +1, +1 je angrenzender Farm |
| **Schmelzhütte** | 6 | Feld | Verhüttung | +1, +2 je angrenzender Mine, +1 je angrenzendem Berg ohne Gebäude |
| **Markt** | 8 | Feld | Märkte | +1 je angrenzendem Gebäude (bis 5), Rohstoffe zählen mit |
| **Wachturm** | 5 | Feld, Berg, Hügel | Schildmacher | Sicht 3 Felder; Einheiten darauf und daneben verteidigen anderthalbfach |
| **Fischerhütte** | 5 | Flachwasser | Fischerei | +1 pro Runde, +1 je angrenzendem Fischgrund |
| **Burg** | 10 | Feld, Wald, Hügel | Burgbau | Einheiten darauf verteidigen dreifach |
| **Kloster** | 12 | Feld | Klosterwesen | +2, Einheiten im Gebiet heilen mehr |
| **Weg** | 3 | Land | Wege | Schritt von Weg zu Weg kostet halbe Bewegung |
| **Brücke** | 5 je Feld | Flachwasser, bis 2 Felder | Wege | Landeinheiten überqueren Wasser |

## Monumente

Monumente sind kostenlos, jeder Stamm baut jedes einmal, auf Feld oder Wald im Stadtgebiet. Jedes bringt der Stadt +3 Bevölkerung und 200 Punkte.

| Monument | Freigeschaltet durch |
| --- | --- |
| **Turm der Weisheit** | 20 Technologien erforscht |
| **Tor der Tapferkeit** | 10 gegnerische Einheiten besiegt |
| **Auge der Welt** | Alle Leuchttürme gefunden |
| **Schatzkammer** | 100 Sterne auf einmal besessen |
| **Großer Park** | Drei Städte auf Stufe 5 |
| **Kaiserpalast** | 8 Städte besessen |

## Gelände und Rohstoffe

| Gelände | Begehbar | Bewegung | Verteidigung | Betreten mit | Besonderheit |
| --- | --- | --- | --- | --- | --- |
| Feld | ja | 1 | 1-fach | – | – |
| Wald | ja | 2 | 1,5-fach | – | – |
| Berg | ja | 2 | 1,5-fach | Klettern | – |
| Flachwasser | nein (Schiffe) | 2 | 1,5-fach | – | – |
| Ozean | nein (Schiffe) | 2 | 1,5-fach | – | – |
| Eis | ja | 1 | 1-fach | – | – |
| Hügel | ja | 1 | 1,5-fach | – | Einheiten darauf sehen 1 Feld weiter |
| Sumpf | ja | 1 | 0,75-fach | – | Betreten beendet die Bewegung |

Rohstoffe im Stadtgebiet bringen Ertrag, solange nichts darauf gebaut ist: Obst (Feld), Wildtiere (Wald), Fische (Flachwasser), Mineralien (Berg).

## Söldnerlager

Je nach Kartengröße gibt es 2 (klein), 3 (normal), 4 (groß) Lager. Eine eigene Landeinheit auf dem Lager wirbt die angebotene Einheit an, ohne die nötige Technologie. Jeder Stamm nutzt jedes Lager einmal, das verbraucht den Zug der Einheit. Preis: normale Kosten + 2 Sterne.

| Mögliches Angebot | Preis |
| --- | --- |
| Schwertkämpfer | 7 |
| Armbrustschütze | 8 |
| Ritter | 11 |
| Pikenier | 6 |
| Bogenreiter | 8 |
| Katapult | 10 |
