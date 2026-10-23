# Synthetischer ASPECT-Testaufgabenpool

Der [versionierte Pool](../../test-fixtures/synthetic-aspect/README.md) ergänzt die
schnellen Tests mit vereinfachten Verona-Testplayern um Prüfungen mit echtem ASPECT.
Er benutzt dieselbe isolierte Datenbank und dieselben Server wie die regulären
Playwright-Tests. Seed und Konfiguration verweigern den Betrieb außerhalb der
E2E-Umgebung; bestehende Entwicklungsserver werden nicht wiederverwendet.

## Ausführen

Voraussetzungen: Node.js, installierte Backend-/Frontend-Abhängigkeiten und Docker
mit laufendem Daemon. Aus dem Repository:

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
gemeinsame Entwicklungsdatenbank verwenden. Dateien entstehen unter dem bestehenden
`BROWSER_E2E_FIXTURE_DIR` (Standard `/tmp/content-pool-browser-e2e`).

## Prüfumfang

Je Browser werden 19 unabhängige Tests ausgeführt, insgesamt 57. Sie prüfen die
echten API-Dateiverweise und die Player-Version, Mehrseitigkeit und Alias-Zuordnung,
sofortiges Umschalten nach Eingaben, Wiederherstellung, Suchfilter, interaktive und
Druckdarstellungen, Teilmusterlösungen, offene und mehrdeutige Kodierung, fehlende
und beschädigte Kodierung, verzögerte Downloads, Auswahlfelder, Aufgabenwechsel
und Desktop-/Tablet-/Mobilansichten. Jeder Test prüft zusätzlich, dass keine
unbehandelten Browserfehler und keine schreibenden API-Aufrufe entstehen.

Die sechs Soll-Ergebnisse aus `pool.json` werden zusätzlich in der regulären
Komponentensuite gegen die Review-Komponente geprüft. Der Seed verifiziert die
SHA-256-Prüfsumme des originalen ASPECT-Releaseplayers vor seiner Registrierung.

## Bilder und Videos reproduzieren

Derselbe Befehl erzeugt nach jedem Lauf:

- `frontend/synthetic-review-report/index.html`: eigenständig lokal öffnende Galerie,
- `manifest.json`: Ergebnis je Test und Browser, Git-Revision, Player-/Definitionsversion,
  Fixture-Prüfsummen und Prüfsummen der Medien,
- je Browser drei Ansichten (390, 768 und 1440 Pixel), sieben Bilder des geprüften
  Rundgangs, eine Druckansicht und ein WebM-Video des tatsächlichen Browserablaufs.

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

Eine neue ausschließlich synthetische JSON-Aufgabe und ihren Eintrag mit festen
Sollwerten in `pool.json` anlegen. Die Definition muss zur festgelegten Player-Version
passen. Neue Browserfälle auf die öffentlich sichtbaren Werte prüfen; die
Musterlösung nicht durch vorbefüllte Antworten im Testplayer simulieren. Für einen
neuen Rundgang-Zustand das Bild nach einer erfolgreichen Zustandsprüfung anhängen
und die erwartete Bildanzahl im Medien-Reporter bewusst anpassen.
