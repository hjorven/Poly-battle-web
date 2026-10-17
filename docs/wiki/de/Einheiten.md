# Einheiten

**Deutsch** · [English](Units)

> Diese Seite wird aus den Spieldaten erzeugt (`npm run wiki`). Änderungen bitte in `js/config.js` bzw. `js/campaign.js` machen.

Werte: Kosten in Sternen, Leben, Angriff, Verteidigung, Bewegung, Reichweite. Veteranen (nach 3 Siegen) bekommen zusätzliches Leben.

## Landeinheiten

| Einheit | Kosten | Leben | Angriff | Verteidigung | Bewegung | Reichweite | Technologie | Fähigkeiten |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Krieger** | 2 | 10 | 2 | 2 | 1 | 1 | – | Sturm, Verschanzen |
| **Bogenschütze** | 3 | 10 | 2 | 1 | 1 | 2 | Bogenschießen | Sturm, Verschanzen |
| **Waldläufer** | 4 | 10 | 2 | 2 | 1 | 1 | Forstwirtschaft | Sturm, Verschanzen, Pfadfinder |
| **Reiter** | 3 | 10 | 2 | 1 | 2 | 1 | Reiten | Sturm, Rückzug, Verschanzen |
| **Verteidiger** | 3 | 15 | 1 | 3 | 1 | 1 | Schildmacher | Verschanzen |
| **Pikenier** | 4 | 10 | 2 | 3 | 1 | 1 | Pikeniere | Sturm, Verschanzen, Pikenwall |
| **Schwertkämpfer** | 5 | 15 | 3 | 3 | 1 | 1 | Schmiedekunst | Sturm |
| **Armbrustschütze** | 6 | 10 | 3 | 1 | 1 | 2 | Armbrust | Sturm, Verschanzen |
| **Katapult** | 8 | 10 | 4 | 0 | 1 | 3 | Mathematik | Starr |
| **Rammbock** | 6 | 15 | 1 | 1 | 1 | 1 | Baukunst | Belagerung |
| **Gedankenbeuger** | 5 | 10 | 0 | 1 | 1 | 1 | Philosophie | Heilen, Bekehren, Starr |
| **Bannerträger** | 6 | 10 | 1 | 2 | 1 | 1 | Freier Geist | Verschanzen, Banner |
| **Bogenreiter** | 6 | 10 | 2 | 1 | 2 | 2 | Hufeisen | Sturm, Rückzug |
| **Ritter** | 11 | 10 | 3 | 1 | 3 | 1 | Ritterlichkeit | Sturm, Durchhalten, Verschanzen |
| **Paladin** | 15 | 15 | 4 | 2 | 3 | 1 | Ritterorden | Sturm, Durchhalten, Verschanzen |
| **Händlerkarren** | 5 | 6 | 0 | 1 | 2 | 1 | Handel | Handel |
| **Riese** (nur als Belohnung) | 25 | 40 | 5 | 4 | 1 | 1 | – | Statisch |
| **Spion** | 4 | 6 | 0 | 1 | 2 | 1 | – | Spähen |
| **Siedler** | 5 | 10 | 0 | 0 | 1 | 1 | – | Statisch, Siedeln |

## Schiffe

| Einheit | Kosten | Leben | Angriff | Verteidigung | Bewegung | Reichweite | Technologie | Fähigkeiten |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Boot** | 3 | 10 | 2 | 0 | 2 | 1 | Segeln | Sturm, Verschanzen |
| **Schiff** | 5 | 14 | 3 | 1 | 2 | 2 | Segeln | Sturm, Verschanzen |
| **Brander** | 6 | 8 | 4 | 0 | 3 | 1 | Aquatismus | Sturm, Brandsatz |
| **Kriegsschiff** | 8 | 18 | 4 | 2 | 3 | 2 | Navigation | Sturm, Verschanzen |

## Luft-Einheiten

| Einheit | Kosten | Leben | Angriff | Verteidigung | Bewegung | Reichweite | Technologie | Fähigkeiten |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Heißluftballon** | 4 | 4 | 0 | 1 | 3 | 1 | Ballonfahrt | Fliegen, Zerbrechlich |
| **Kriegsluftschiff** | 12 | 12 | 3 | 2 | 2 | 2 | Luftschiffbau | Fliegen, Große Hülle |

## Fähigkeiten

| Fähigkeit | Wirkung |
| --- | --- |
| **Sturm** | Kann nach dem Ziehen angreifen. |
| **Verschanzen** | Heilt, wenn sie nichts tut; erhält Stadt-Verteidigungsbonus. |
| **Rückzug** | Kann nach dem Angriff weiterziehen. |
| **Durchhalten** | Kann nach dem Angriff weiterziehen. |
| **Starr** | Kann nicht nach dem Ziehen angreifen und nicht zurückschlagen. |
| **Statisch** | Keine besonderen Fähigkeiten. |
| **Heilen** | Heilt benachbarte Verbündete zu Rundenbeginn um 4. |
| **Bekehren** | Übernimmt eine benachbarte feindliche Einheit. |
| **Land** | Kann auf Land stehen. |
| **Wasser** | Kann sich ausschließlich auf Wasser und Ozean bewegen. |
| **Siedeln** | Gründet auf einem freien Feld eine neue Stadt (mind. 2 Felder von anderen Städten entfernt). |
| **Spähen** | Greift nicht an, betritt Berge ohne Klettern und sieht von Bergen 1 Feld weiter. |
| **Fliegen** | Fliegt über Wasser, Berge und Wald (je 1 Bewegung) und ignoriert Kontrollzonen. Nahkämpfer erreichen sie nicht. Erobert keine Städte, heilt nur im eigenen Gebiet. |
| **Zerbrechlich** | Ein Treffer eines Fernkämpfers (Bogenschütze, Katapult, Schiff, Luftschiff) zerstört sie sofort. |
| **Große Hülle** | Nimmt von Fernkämpfern doppelten Schaden. |
| **Transport** | Nimmt eine benachbarte eigene Landeinheit auf und setzt sie anderswo ab. |
| **Belagerung** | Dreifacher Schaden gegen Einheiten in Städten und auf Burgen; dort ohne Gegenschlag. |
| **Handel** | In oder neben einer anderen Stadt: einmalig Sterne, mehr je weiter von der Heimatstadt entfernt. Erobert keine Städte. |
| **Pikenwall** | Anderthalbfacher Schaden gegen Reiter, Ritter und Paladine – auch beim Gegenschlag. |
| **Pfadfinder** | Wald, Hügel und Sumpf kosten nur 1 Bewegung und halten nicht auf; aus dem Wald +1 Angriff. |
| **Banner** | Eigene Einheiten direkt daneben haben +0,5 Angriff (mehrere Banner zählen nicht doppelt). |
| **Brandsatz** | Geht beim Angriff unter, trifft aber auch alle Feinde neben dem Ziel mit halbem Schaden. Kein Gegenschlag. |

## Aufrüsten

Steht eine Einheit zu Zugbeginn im eigenen Gebiet, kann sie gegen den Preisunterschied aufgerüstet werden (Technologie nötig, verbraucht den Zug):

- Krieger wird zu Schwertkämpfer
- Bogenschütze wird zu Armbrustschütze
- Reiter wird zu Ritter
- Ritter wird zu Paladin
- Boot wird zu Schiff
- Schiff wird zu Kriegsschiff
- Heißluftballon wird zu Kriegsluftschiff
