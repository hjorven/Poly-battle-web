# Poly Battle

Rundenbasierte Eroberung im Browser, angelehnt an *The Battle of Polytopia*: Gründe Städte, erforsche Technologien und erobere eine Welt aus Sechsecken – in Low-Poly-3D, auf PC, Tablet und Handy.

**[Jetzt spielen](https://hjorven.github.io/Poly-battle-web/)** · [Wiki](https://github.com/hjorven/Poly-battle-web/wiki) · [Fehler melden](https://github.com/hjorven/Poly-battle-web/issues/new/choose)

![Eine Partie in Runde 18: Hauptstadt mit Farmen, Leuchttürme an den Kartenecken, der Rest der Welt unter Nebel](docs/screenshot.png)

## Was dich erwartet

- **12 Stämme** mit eigener Start-Technologie und Besonderheit, dazu KI-Gegner mit Persönlichkeit (Eroberer, Händler, Seefahrer, Baumeister).
- **24 Einheiten** an Land, auf See und in der Luft – vom Krieger über Bogenreiter, Rammbock und Händlerkarren bis zum Kriegsluftschiff, mit Veteranen und Aufrüsten.
- **55 Technologien** in einem Wabenbaum mit sechs Stufen.
- **Städte ausbauen** in einer 3D-Ansicht des Stadtgebiets: Feld antippen, Gebäude wählen – jedes zeigt vorher, wie viele Sterne es pro Runde mehr bringt, auch durch Nachbarn wie Windmühle und Farm. Stadtstufen bringen Belohnungen, Monumente werden durch Erfolge freigeschaltet.
- **Nebel, Diplomatie, Handel, Brücken, Häfen, Wachtürme, Ruinen und Leuchttürme.**
- **KI-Lehrling:** Der Knopf „Tipp“ zeigt und erklärt, was die KI an deiner Stelle tun würde.
- **Wiederholung:** Nach Spielende jede Runde ansehen oder die ganze Partie im Zeitraffer ablaufen lassen.
- **Ausbalanciert:** Stämme und Einheiten werden mit KI-Turnieren gemessen (240 Partien: jeder Stamm gewinnt 16–31 %).
- **Spielmodi:** gegen die KI, Hotseat an einem Gerät, online per Link, Tutorial, 13 Kampagnen-Missionen, Tages- und Wochen-Herausforderung mit Bestenliste.
- **Profil** mit Stufen, 20 Erfolgen, freischaltbarem Aussehen und Statistik; mit dem Profil-Code geht es auf jedem Gerät weiter.
- **Freie Karte:** Die Bedienung liegt in schwebenden Kärtchen an den Rändern. Wählst du eine Stadt oder Einheit, steht ein Schild mit ihren Werten direkt daran, die Aktionen liegen als Werkzeugreihe unten – angelehnt an Mini Metro.
- **Bedienung** mit Maus und Tastatur oder Touch; Ziehen und Angreifen brauchen zwei Tipps, damit nichts aus Versehen passiert. Kein Rückgängig – jeder Zug zählt.
- **Hell oder dunkel:** folgt der Systemeinstellung oder ist fest wählbar.

![Gewählte Hauptstadt: Schild mit Stufe und Einkommen an der Stadt, unten die Werkzeugreihe mit Ausbauen, Bevölkerung und Einheiten](docs/city.png)

![Bau-Fenster: das Stadtgebiet in 3D mit Ertrag je Feld, rechts die Bauoptionen für das gewählte Feld](docs/build.png)

Regeln, Werte und Tabellen stehen im **[Wiki](https://github.com/hjorven/Poly-battle-web/wiki)**.

## Lokal starten

Kein Build-Schritt, keine Abhängigkeiten außer Node.js für die Tests und einem statischen Webserver.

```bash
git clone https://github.com/hjorven/Poly-battle-web.git
cd Poly-battle-web
npm run serve   # http://localhost:8080
npm test        # Logiktests
```

Three.js und supabase-js liegen unter `vendor/` im Repository, es wird nichts von fremden Servern nachgeladen. Ein Service Worker (`sw.js`) merkt sich die Dateien, so läuft das Spiel nach dem ersten Besuch auch ohne Verbindung. Gegen KI, Hotseat, Kampagne und Herausforderungen laufen ohne Server; Online-Partien und die Bestenliste nutzen Supabase.

## Aufbau

```
index.html            Einstieg, Importmap, Dialoge
sw.js                 Service Worker (offline spielen)
vendor/               Three.js 0.160.0 und supabase-js 2.45.4
css/style.css         Gestaltung
js/config.js          Spieldaten und Balancing
js/rules.js           Spielregeln (reine Funktionen, getestet)
js/ai.js              KI
js/render.js          3D-Darstellung mit Three.js (auch die 3D-Ansicht im Bau-Fenster)
js/ui.js              Kärtchen, Schild und Werkzeugreihe, Bau-Fenster, Forschung, Menüs
js/main.js            Verkabelung, Eingabe, Zugablauf
js/net.js             Online-Partien, Profile, Bestenliste (Supabase)
js/save.js            Lokaler Spielstand
js/profile.js         Profil, Erfolge, Herausforderungen
js/campaign.js        Kampagne
supabase/migrations/  Datenbank-Schema und Server-Funktionen
scripts/gen-wiki.mjs  erzeugt die Datenseiten des Wikis
test/logic.test.js    Tests
```

Mehr dazu auf der Wiki-Seite [Technik](https://github.com/hjorven/Poly-battle-web/wiki/Technik).

## Online und Datenschutz

Clients haben keinen direkten Zugriff auf die Tabellen. Gelesen und geschrieben wird nur über Datenbank-Funktionen, die prüfen, wer mitspielt, wer am Zug ist und ob Namen und Punkte plausibel sind. Spieler-Kennungen liegen nur als SHA-256-Prüfsumme in der Datenbank. Gespeichert werden Spielstände, Name, Profildaten und Punkte – keine E-Mail-Adressen, kein Konto.

## Mitmachen

Fehlerberichte, Ideen und Pull Requests sind willkommen. Wie das abläuft, steht in [CONTRIBUTING.md](CONTRIBUTING.md).

## Lizenz

[MIT](LICENSE). *The Battle of Polytopia* ist ein Spiel von Midjiwan; Poly Battle ist ein unabhängiges Fanprojekt und steht in keiner Verbindung dazu.
