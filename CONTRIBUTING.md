# Mitmachen bei Poly Battle

Danke, dass du helfen willst. Diese Seite erklärt, wie Fehlerberichte, Ideen und Pull Requests ablaufen.

## Fehler melden und Ideen einbringen

Über [Issues → Neues Issue](https://github.com/hjorven/Poly-battle-web/issues/new/choose) gibt es Vorlagen für:

- **Fehler** – etwas funktioniert nicht oder sieht falsch aus.
- **Idee** – eine neue Funktion oder Verbesserung.
- **Balance** – etwas ist zu stark, zu schwach oder unfair.

Ein guter Fehlerbericht sagt, was du getan hast, was du erwartet hast und was stattdessen passiert ist, auf welchem Gerät und in welchem Browser. Ein Screenshot hilft fast immer. Hat ein Spielstand den Fehler ausgelöst, häng ihn an, falls möglich.

## Lokal entwickeln

Du brauchst nur Git, Node.js (für die Tests) und Python oder einen anderen statischen Webserver.

```bash
git clone https://github.com/hjorven/Poly-battle-web.git
cd Poly-battle-web
npm run serve   # http://localhost:8080
npm test
```

Es gibt keinen Build-Schritt und keine npm-Abhängigkeiten. Änderungen im Code sind nach dem Neuladen der Seite sichtbar.

## Ablauf für Pull Requests

1. Lege einen Branch vom aktuellen `main` an, zum Beispiel `feature/handelsrouten` oder `fix/bruecke-schiff`.
2. Halte den Pull Request bei einem Thema. Mehrere unabhängige Änderungen lieber getrennt einreichen.
3. Führe `npm test` aus – alle Tests müssen grün sein. Neue Regeln brauchen neue Tests in `test/logic.test.js`.
4. Probiere Oberflächenänderungen im Browser aus: am PC mit Maus und Tastatur und auf einem Tablet oder in der Gerätesimulation mit Touch, hochkant und quer.
5. Hast du Spieldaten in `js/config.js` oder `js/campaign.js` geändert, führe `npm run wiki` aus und committe die erzeugten Seiten unter `docs/wiki/` mit.
6. Beschreibe im Pull Request, was sich für Spielende ändert und wie du es getestet hast. Screenshots bei sichtbaren Änderungen.

## Richtlinien

### Spiel und Oberfläche

- **Sprache:** Alle Texte im Spiel sind Deutsch, in einfachen Worten. Knöpfe sagen, was passiert („Zug beenden“, nicht „OK“).
- **Keine Emojis und keine Textsymbole** in der Oberfläche (keine Pfeile, Sterne oder Häkchen als Zeichen). Wo ein Symbol nötig ist, als SVG.
- **Kein Rückgängig.** Jeder Zug zählt; stattdessen verhindern zweistufige Aktionen (erst markieren, dann ausführen) Fehlbedienung.
- **Stil:** realistisch-mittelalterlich im Low-Poly-Look. Neue Modelle und Farben passen sich daran an.
- **Für alle Geräte:** Bedienbar mit Maus, Tastatur und Touch. Tippziele mindestens 36 px hoch, wichtige Dialoge passen ohne Scrollen auf ein iPad (810×950 hochkant, 1080×700 quer).
- **Robust:** Beschädigte Spielstände, Profile oder unerwartete Eingaben dürfen das Spiel nie lahmlegen.

### Code

- Reines JavaScript als ES-Module, kein Framework, kein Build-Schritt.
- **Regeln gehören nach `js/rules.js`** und sind reine Funktionen auf dem Spielstand – ohne DOM und ohne Three.js. So sind sie testbar und laufen auch in Online-Partien gleich.
- Balancing-Werte stehen in `js/config.js`, nicht verstreut im Code.
- Kommentare sind Deutsch und erklären das Warum, nicht das Was.
- Schreibe so wie der umliegende Code: gleiche Benennung, gleiche Kommentardichte.

### Datenbank (Supabase)

- Änderungen nur als neue Datei in `supabase/migrations/`, nie bestehende Migrationen ändern.
- Tabellen bleiben für Clients gesperrt (Row Level Security ohne Freigaben). Zugriff nur über `security definer`-Funktionen mit `set search_path = ''`, die alle Eingaben prüfen.
- Keine Klartext-Kennungen speichern, nur Prüfsummen.

## Verhalten

Sei freundlich und sachlich. Kritik gilt dem Code, nicht der Person.

## Lizenz

Mit einem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE) des Projekts steht.
