# Synthetischer Formate- und Player-Testaufgabenpool

Der [versionierte Pool](../../test-fixtures/synthetic-aspect/README.md) ergänzt die
schnellen Tests mit vereinfachten Verona-Testplayern um Prüfungen mit echtem ASPECT.
Zusätzlich enthält der [Formate- und Playerpool](../../test-fixtures/synthetic-players/README.md)
44 weitere synthetische Aufgaben: insgesamt 50 Aufgaben für sechs Playerfamilien. Der gemeinsame Aufbau benutzt
dieselbe isolierte Datenbank und dieselben Server wie die regulären
Playwright-Tests. Seed und Konfiguration verweigern den Betrieb außerhalb der
E2E-Umgebung; bestehende Entwicklungsserver werden nicht wiederverwendet.

## Ausführen

Voraussetzungen: Node.js, `curl`, installierte Backend-/Frontend-Abhängigkeiten und Docker
mit laufendem Daemon. Der erste Seed benötigt HTTPS-Zugriff auf die festgelegten
GeoGebra- und DIPF-Runtime-Dateien. Weitere Läufe nutzen einen weiterhin
prüfsummengeprüften Cache unter `backend/node_modules/.cache/synthetic-player-resources`. Aus dem Repository:

```bash
cd frontend
npm run e2e:synthetic:check
npm run e2e:synthetic
```

Der zweite Befehl startet eine temporäre PostgreSQL-Datenbank, setzt sie zurück,
registriert den Testpool, startet Backend auf Port 3100 und Frontend auf Port 4300
und prüft Chromium, Firefox und WebKit. Die Ports müssen frei sein. Chromium allein:

```bash
npm run e2e:synthetic -- --project=chromium
```

Die Suite läuft auch bei `npm run e2e` automatisch mit. `--headed` zeigt den Browser.
Für einen eigenen **wegwerfbaren** PostgreSQL-Testserver unterstützt der bestehende
Wrapper `BROWSER_E2E_USE_EXISTING_DATABASE=true` und `BROWSER_E2E_DATABASE_PORT`.
Dabei wird die Datenbank `contentpool_e2e` vollständig zurückgesetzt. Keine
gemeinsame Entwicklungsdatenbank verwenden. Aufgaben-, Upload- und Snapshot-Dateien entstehen in einem frischen temporären
Laufverzeichnis und werden nach dem Lauf entfernt. Der Downloadcache bleibt erhalten.

## Prüfumfang

Der ursprüngliche Formate-/Reviewpool führt je Browser 69 unabhängige Tests aus: die bisherigen
19 ASPECT-Reviewfälle, 44 Formatprüfungen und sechs Playerfamilien-Rundgänge. Sie prüfen die
echten API-Dateiverweise und die Player-Version, Mehrseitigkeit und Alias-Zuordnung,
sofortiges Umschalten nach Eingaben, Wiederherstellung, Suchfilter, interaktive und
Druckdarstellungen, Teilmusterlösungen, offene und mehrdeutige Kodierung, fehlende
und beschädigte Kodierung, verzögerte Downloads, Auswahlfelder, Aufgabenwechsel
und Desktop-/Tablet-/Mobilansichten. Jeder Test prüft zusätzlich, dass keine
unbehandelten Browserfehler und keine schreibenden API-Aufrufe entstehen.

Die sechs bisherigen Soll-Ergebnisse aus `synthetic-aspect/pool.json` werden zusätzlich in der regulären
Komponentensuite gegen die Review-Komponente geprüft. Der Seed verifiziert die
SHA-256-Prüfsummen sämtlicher Originalplayer und externer Runtimes. Ein weiterer
Test prüft den [versionierten Formatkatalog](../../test-fixtures/synthetic-players/catalogue.json)
gegen die tatsächlichen Definitionen: alle 30 ASPECT-Elementtypen, alle ABI-Eingaben
und sämtliche Speedtest-Multi-Stimulus- und Antwortarten.

Die zusätzlichen Browserfälle kontrollieren echte Eingaben, Auswahlen,
Drag-and-drop, Sortierung, Textmarkierung, Medienwiedergabe, Formeln und GeoGebra.
Periodensystem und Molekül-Editor werden als Verona-Widget-Anfrage geprüft;
Content Pool besitzt dafür noch keinen Host-Widgetanbieter. Dieser begrenzte
Prüfumfang ist in der Matrix ausdrücklich als `widget-request-only` markiert.


## Major-Versionen und vollständige ASPECT-Einstellungsaufgaben

Der zusätzliche [Generationenpool](../../test-fixtures/player-generations/README.md)
enthält 405 weitere Aufgaben mit 20 Playergenerationen aus sechs Familien. Die
[Matrix](../../test-fixtures/player-generations/GENERATED-COVERAGE.md) umfasst
alle 31 aktuellen ASPECT-Elementtypen sowie 11/22/27 Typen der älteren Majors,
3.304 Einstellungen mit konkreten Werten und Seiten und 66 echte Exporte aus
allen zehn Assistenten des Originaleditors 3.1. Endliche Auswahllisten und
boolesche Schalter sind vollständig aufgezählt; offene Zahlen-/Text-/Dateifelder
werden mit Beispielen und Randwerten geprüft. Eine vollständige Kombination
sämtlicher Einstellungen wird nicht behauptet.

109 zusätzliche Prüfungen pro Browser kontrollieren die Generationen,
Import/Änderung/Export der aktuellen ASPECT-Einstellungsaufgaben, verbundene
Laufzeitregeln, tet.folio und alle UI-Assistentenaufgaben durch die App. Zusammen
mit den bisherigen 69 Fällen sind das 534 Prüfungen in Chromium, Firefox und
WebKit. Die UI-Rundläufe prüfen die gespeicherten Einstellungswerte; sie ersetzen
keinen Verhaltenstest jeder einzelnen Kombination. Historische Majors erhalten
generationsgerechte Aufgaben und einen echten Interaktionstest je Player.

ABI 2.0.1 ist im Original ein Entwicklungsbuild, der seine interne Demo startet
und keine eigene Aufgabe übernimmt. Der Test bestätigt diese Einschränkung,
keine erfolgreiche Aufgabeninteraktion. ABI 1 läuft im kompatiblen Legacy-Testhost;
Content Hub selbst bietet dafür keinen `vo.*`-Host. Nicht veröffentlichte Majors
werden nicht ergänzt; insbesondere existiert kein Simple-3-Release/Tag.

Das Galerie-Manifest führt `generationCoverage` und `authoringCoverage` separat
und bestätigt nur tatsächlich erfolgreiche Prüfungen. Die Originalmodule sind
unverändert und anhand ihrer SHA-256 geprüft. Vollständige Quellen, Grenzen,
Rezepte und Wiederholungsbefehle stehen im Generationenpool.

## Bilder und Videos reproduzieren

Derselbe Befehl erzeugt nach jedem Lauf:

- `frontend/synthetic-review-report/index.html`: eigenständig lokal öffnende Galerie,
- `manifest.json`: Ergebnis je Test und Browser, Git-Revision, Player-/Definitionsversion,
  Fixture-Prüfsummen, Player-/Runtime-Herkunft, tatsächlich geprüfte Formate
  je Browser und Prüfsummen der Medien,
- je Browser drei Ansichten (390, 768 und 1440 Pixel), sieben Bilder des geprüften
  Rundgangs, eine Druckansicht und ein WebM-Video des tatsächlichen Browserablaufs;
  zusätzlich je Formatprüfung ein Bild und je Playerfamilie ein Reviewbild sowie
  ein Video. Dieser ursprüngliche Teil erzeugt 183 Bilder und 21 WebM-Videos. Die zusätzlichen Generations- und UI-Prüfungen ergänzen weitere Bilder und Ergebnisse.

Den gesamten Ordner kopieren oder als ZIP weitergeben. Er enthält keine externen
Medienverweise, Traces oder Sitzungsdateien. Bei Fehlern zeigt die Galerie den
Fehlerstatus und gegebenenfalls vorhandene Aufnahmen; sie ist dann keine erfolgreiche
Abnahme. Playwright behält zusätzliche Fehlerdiagnosen im regulären Testverzeichnis.
Bei Testauswahl mit `--grep` oder `--project` beschreibt die Galerie nur die tatsächlich
ausgeführte Teilmenge. Vorherige Galerieinhalte werden zu Beginn entfernt.

Reproduzierbar sind Aufgaben, Sollwerte, Prüfschritte, Auflösungen und Bildzustände.
Videodauer, Schrift-Rendering und Dateibytes können je Betriebssystem und Laufzeit
abweichen; die Suite führt keinen Pixelvergleich gegen Bild-Baselines aus.

## CI

Der verpflichtende Job **Browser E2E** führt die Suite auf jedem PR aus und geht in
das bestehende `release-gate` ein. Er lädt die Galerie inklusive Bildern, Videos
und Manifest bei Erfolg und Fehler als **synthetic-aspect-review** für 14 Tage hoch.
Fehlerdiagnosen bleiben im separaten bestehenden Playwright-Artefakt. Die neuen
Playwright-Dateien haben außerdem einen eigenen TypeScript-, ESLint- und Formatcheck
im verpflichtenden Frontend-Lint-Job.

## Erweitern

Neue Format-/Familienfälle gehören nach `test-fixtures/synthetic-players/`; die
Abdeckungsmatrix und ein echter Browser-Prüfschritt sind mitzuführen. Die Herkunft
und Prüfsummen neuer Player und Runtime-Ressourcen müssen feststehen.

Für ein weiteres ASPECT-Review-Szenario eine ausschließlich synthetische JSON-Aufgabe
und ihren Eintrag mit festen
Sollwerten in `pool.json` anlegen. Die Definition muss zur festgelegten Player-Version
passen. Neue Browserfälle auf die öffentlich sichtbaren Werte prüfen; die
Musterlösung nicht durch vorbefüllte Antworten im Testplayer simulieren. Für einen
neuen Rundgang-Zustand das Bild nach einer erfolgreichen Zustandsprüfung anhängen
und die erwartete Bildanzahl im Medien-Reporter bewusst anpassen.
