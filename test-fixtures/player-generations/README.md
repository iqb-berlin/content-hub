# Playergenerationen und ASPECT-Aufgabenerstellung

Dieser zusätzliche, ausschließlich synthetische Pool ergänzt die 50 Aufgaben in
`synthetic-aspect` und `synthetic-players`. Er wird über denselben isolierten
Browser-E2E-Seed geladen. Die Aufgaben lassen sich einzeln in Content Hub öffnen.
Die Varianten einer ASPECT-Elementaufgabe sind ihre gewöhnlichen Aufgabenseiten.

## Versionsumfang

Stand: 3. November 2026. Pro veröffentlichter Major-Version wird der letzte
verfügbare stabile Player verwendet; für Major 0 von Speedtest Multi existiert nur
eine Vorabversion. Herkunft, Release/Tag, exakte Version und SHA-256 stehen in
[pool.json](pool.json), die Release-Inventur in [release-index.json](release-index.json).

| Familie | Enthaltene Generationen |
| --- | --- |
| ABI | 1.0.0, 2.0.1, 3.3.3, 4.0.0, 5.0.0 |
| ASPECT | 0.1.0, 1.32.0, 2.12.6, 3.1.0 |
| Simple | 1.1.2, 2.1.0, 4.0.0, 5.2.0, 6.0.4 |
| Speedtest Mono | 1.2.0 |
| Speedtest Multi | 0.6.0-beta, 1.0.0, 2.1.2, 3.3.0 |
| ItemBuilder | 0.2.0, auf einen Quellcode-Commit festgelegt |

Simple 3 hat keinen veröffentlichten Release/Tag. Simple 1/2 sind die originalen
HTML-Dateien der festgelegten historischen Tags. Beim ItemBuilder gibt es keine
Release-Historie; er wird als experimenteller Wrapper samt echter DIPF-Runtime
geführt. Der ABI-Quellordner `releases/0.3.0` enthält dieselben Playerbytes wie der
Release 1.0.0 und meldet Protokollversion 1; daraus wird keine zusätzliche
Player-Major-Version erfunden.

**ABI-Kompatibilität:** Das unveränderte Release-HTML 2.0.1 startet seine interne
Entwicklungsdemo. Dieser Fehler wird weiterhin separat am Original nachgewiesen.
Content Hub korrigiert beim Rendern ausschließlich das bekannte, SHA-256-geprüfte
Release und startet damit die eigene Aufgabe. ABI 1 wird zusätzlich über einen
Legacy-Protokolladapter in der echten App bedient. Gespeicherte und heruntergeladene
Originalmodule bleiben bytegleich. Details und Quellpatches stehen in
[der Abnahmedokumentation](../../docs/development/player-acceptance.md).

## Was die ASPECT-Aufgaben abdecken

[GENERATED-COVERAGE.md](GENERATED-COVERAGE.md) zeigt Aufgaben, Elementtypen und
Varianten. Die zugrunde liegenden Quellen sind die unveränderten Editormodelle
und die Standard-/Expertenpanels der jeweiligen Generation. Es sind 11, 22, 27
beziehungsweise 31 registrierte Elementtypen. Aktuell gehört auch **tet.folio**
dazu. Es enthält ein eigenständiges synthetisches HTML-Experiment mit echten
Zustandsmeldungen über die ASPECT-Brücke; die tet.folio-Software selbst wird damit
nicht vollständig geprüft. Unterelemente wie Likert-Zeilen, einfache Textfelder und eingebettete
Lückentext-/Tabellenfelder sind berücksichtigt.

- Jede endliche Aufzählung erhält jede deklarierte Auswahl, jeder gespeicherte
  boolesche Schalter beide Zustände. Verschachtelte Gruppen wie Position,
  Abstände, Maße, Gestaltung, Mediensteuerung und Mathematik-Tastatur werden
  aufgelöst. Seiten-, Abschnitts- und Aufgabeneinstellungen sind eigene Aufgaben.
- Für Zahlen, Text, Farben, Formeln, Dateien und Listen stehen repräsentative
  Werte und geeignete Randwerte. Zahlenfelder sind keine vollständige Aufzählung
  aller darstellbaren Zahlen. Die Matrix ist kein kartesisches Produkt aller
  Schalterkombinationen.
- Referenzen werden mit gültigen verbundenen Aufgaben ergänzt: alle zehn
  Sichtbarkeitsoperatoren, UND/ODER, erneutes Verbergen, Verzögerung/Animation,
  die fünf Aufgabennavigationsziele, Seitennavigation, Textanker,
  Zustandsvariablen, die drei Auslöseraktionen, Medienverkettung und Hotspots.
- **66 Aufgaben werden tatsächlich über die Assistentendialoge des originalen
  ASPECT-3.1-Editors erstellt und exportiert.** Darunter sind alle zehn Assistenten,
  ihre Varianten, Sprachen, Nummerierungen, Antwortfeldlängen, Bild/Text-Optionen,
  Begründungsfelder, Formelvarianten, Zuordnung/Sortieren, Hilfebilder und die drei
  Rechenarten. Die bedienten Auswahlfelder und Rezepte stehen in
  [ui-created-tasks.json](authoring/ui-created-tasks.json).

[coverage.json](authoring/coverage.json) ordnet jede Einstellung konkreten
Aufgaben, Seiten und Werten zu. [ui-controls.json](authoring/ui-controls.json)
enthält 62 Standard-/Expertenpanels samt Quellverweisen und Prüfsummen;
[ui-control-mapping.json](authoring/ui-control-mapping.json) erklärt Gruppen,
Getter und reine Editoraktionen. Undo, Löschen und Mehrfachauswahl sind
Bearbeitungsschritte, keine zusätzlichen gespeicherten Aufgabenformate.

## Reproduzieren und prüfen

Nach `npm ci` im Frontend und Backend:

```bash
# Gewöhnliche JSON-Aufgaben und Abdeckungsmatrix neu erzeugen:
node scripts/player-coverage/generate-authoring.mjs

# Optional: alle Assistentenaufgaben erneut mit echten Browseraktionen erstellen:
(cd frontend && npx playwright install chromium)
node scripts/player-coverage/author-ui.mjs
node scripts/player-coverage/generate-authoring.mjs

# Optional: Quellsnapshots aus den festgelegten Tags aktualisieren:
node scripts/player-coverage/refresh-authoring.cjs /tmp/content-hub-aspect-sources

# Datenintegrität, Typen, Formatierung sowie alle Browserprüfungen:
(cd frontend && npm run test -- --run src/app/testing/synthetic-generation-pool.spec.ts)
(cd frontend && npm run e2e:synthetic:check)
(cd frontend && npm run e2e:synthetic)
```

Die Assistentenexporte stammen aus dem originalen Editor-HTML. Nur zum Extrahieren
der Modellvorgaben wird ein temporäres Node-Bundle ohne Angular-Renderingmethoden
erstellt. Das verändert weder Editor noch Player. Quellpfade, Tags und SHA-256
bleiben in `authoring/aspect-*.json` nachvollziehbar.

Der Browserlauf trennt die Prüfaussagen: echte Eingaben pro lauffähiger Generation,
Import/Änderung/Export sämtlicher aktueller Element-Einstellungsvarianten,
verbundene Laufzeitszenarien und Darstellung der UI-erstellten Aufgaben durch die
reale App/API. Ein erfolgreicher Import belegt allein noch nicht die Laufzeitwirkung
jeder einzelnen Einstellung. Historische ASPECT-Generationen erhalten Modell- und
Aufgabenabdeckung sowie einen echten Interaktionstest pro Major; der UI-Rundlauf
aller Einstellungen wird mit Editor 3.1 geprüft.
Die tet.folio-Einstellungsvarianten werden dabei in Gruppen von acht Seiten
importiert, geändert und exportiert. Der Editor startet auch für unsichtbare
Seiten je eine eigene Runtime; die Aufteilung begrenzt gleichzeitig laufende
Frames, ohne eine Variante auszulassen.

Die Galerie `frontend/synthetic-review-report/index.html` und ihr Manifest führen
nur tatsächlich ausgeführte Prüfungen als bestätigt auf. Bei Teil- oder Fehlläufen
entsteht kein pauschales Vollständigkeitsurteil. 15 zusätzliche Abnahmeaufgaben
prüfen Einstellungen nach Editor-Rundlauf im Player bei 390 und 1440 Pixeln.
Vier Aufgaben nutzen die originalen Chemistry-Widgets 1.1.0: Periodensystem mit
Auswahlgrenze, automatischem Schließen und reinem Anzeigemodus sowie Molekül-Editor.
Der Pool enthält damit 424 Aufgaben, mit den beiden bisherigen Pools insgesamt 474.

Die Originalmodule enthalten ihre eigenen Metadaten und Lizenzangaben. Die
vorhandenen Upstream-Lizenzdateien liegen bei den Playern. ASPECT deklariert MIT in
den Modulmetadaten; der festgelegte Quelltag enthält keine separate LICENSE-Datei.
