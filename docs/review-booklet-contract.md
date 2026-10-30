# Booklet-Navigation (#59)

Diese Implementierung wurde auf ausdrücklichen Wunsch vor der fachlichen
Abstimmung gebaut. Die Testfixture ist technisch geprüft, **nicht fachlich
bestätigt**. #60 und die weiteren Review-Tickets sind nicht Teil dieser Änderung.

## Upload und Auffindbarkeit

Die bestehende Upload-Nachverarbeitung erkennt Booklet-XMLs und trägt ihre
Metadaten-ID sowie den Dateinamen automatisch im ACP-Index ein. Neue Booklets
werden im ersten Assessment-Part in einem eigenen Instrument registriert.
Vorhandene Dateiverknüpfungen werden an ihrer bisherigen Position ergänzt;
manuelle Namen, Modulzuordnungen und andere Instrumente bleiben erhalten.
Wiederholtes Synchronisieren erzeugt keine doppelten Einträge. ID-Konflikte,
mehrere Dateien mit derselben Booklet-ID und ungültige Booklet-Dateien werden
als Warnungen gemeldet und nicht stillschweigend neu zugeordnet.

Nach abgeschlossener Upload-Verarbeitung erscheinen Booklets in der
ACP-Übersicht als „Testheft“ beziehungsweise unter „Testhefte und Aufgabenfolgen“.
Ein erneuter Upload stößt die Synchronisierung auch für bereits vorhandene
Booklet-Dateien an; alternativ steht die bestehende Synchronisierungs-API zur Verfügung. Aufgaben und Player-Dateien müssen
weiterhin vorhanden sein; fehlende Unit-Referenzen meldet die Validierung.

## Unterstützte Eingaben

- Referenzen unter `assessmentParts[].instruments[].testcenterBooklet[]`.
- `definitionId` benennt eine im selben ACP hochgeladene Booklet-XML-Datei.
- Die kanonische ID stammt aus `testcenterBooklet.id`, alternativ aus
  `Booklet/Metadata/Id`. Sind beide angegeben, müssen sie übereinstimmen.
- `Booklet/Units` enthält Units und rekursive `Testlet`-Blöcke in Dokumentreihenfolge.
- Unit-Referenzen verwenden `id`, optional `alias` und `label`.
- Bestehende `bookletModules` und ihre bisherigen Aufgabenfolge-URLs bleiben
  unterstützt. Die Reihenfolge aus `order` wird auf einer Kopie ausgewertet.
- Booklets ohne kanonische ID werden nur als Legacy-Navigation behandelt;
  daraus wird keine neue fachliche Kommentaridentität abgeleitet.

Die aktuelle Testlet-Struktur wurde mit dem Schema
`iqb-berlin/testcenter/backend/test/unit/testdata/schemas/testcenter-booklet-xml.xsd`
abgeglichen. Es handelt sich um Navigationsextraktion mit Strukturprüfungen,
nicht um eine vollständige Validierung aller Testcenter-XSD-Funktionen.

## Vorläufiger Markeradapter

`ProgressStart id="…" label="…"` und `ProgressEnd` werden vorläufig als
zusammenhängender Navigationsblock interpretiert. Eine beim Ende angegebene ID
muss zur zuletzt geöffneten ID passen. Verschachtelung ist erlaubt; Bereiche
müssen innerhalb desselben XML-Containers geschlossen werden. Leere Bereiche,
doppelte Block-IDs und ungepaarte Marker sind ungültig. Units außerhalb eines
Blocks bleiben erreichbar. Diese Regeln sind Annahmen bis zur fachlichen
Bestätigung und liegen isoliert in `booklet-parser.ts`.

## Navigation und Download

Neue Booklet-Links verwenden `?kind=booklet`. Dieselbe Kennzeichnung wird an
Aufgabenfolge-API und ZIP-Download übergeben. URLs ohne Kennzeichnung behalten
ihre bisherige Bedeutung als Modulfolge, auch wenn eine Booklet-ID gleich lautet.
Der Booklet-Download verwendet das Manifest und exportiert mehrfach referenzierte
Units nur einmal. Bei einer unbekannten Booklet-ID erfolgt kein Rückfall auf ein
zufällig gleichnamiges Modul.

### Direktlinks zu Aufgaben (#245)

In der Testheftansicht bietet „Direktlink zur Aufgabe“ einen Link zur aktuellen
Aufgabe. Ein normaler Klick kopiert die vollständige Linkadresse und bestätigt
dies mit „Link kopiert.“. Blockiert der Browser den Zugriff auf die Zwischenablage,
erscheint die Adresse als markierbarer Text zum manuellen Kopieren. Die Rückmeldung
wird beim Aufgaben- oder Testheftwechsel entfernt.
Die Aufgabenliste enthält für jedes Vorkommen einen eigenen Link.
Alle Links lassen sich weiterhin über das Browsermenü kopieren oder in einem neuen
Tab öffnen; Strg-/Cmd-Klick behält ebenfalls das native Browserverhalten bei.
Zurück, Weiter und die Aufgabenliste aktualisieren ebenfalls die URL;
Neuladen sowie Zurück/Vorwärts im Browser stellen die Auswahl wieder her.

`/view/:acpId/sequence/:bookletId?kind=booklet&occurrence=:linkId`
adressiert ein bestimmtes Vorkommen, auch wenn dieselbe Aufgabe mehrmals im
Testheft enthalten ist. Neue Links verwenden eine 16-stellige, URL-sichere
`linkId`, zum Beispiel `?kind=booklet&occurrence=Y5gRx3-5hT2cV0WQ`.
Das Backend berechnet sie ohne Speicherung aus Booklet-ID, geordnetem
Navigationsbaum und Position des Vorkommens. Der Baum berücksichtigt Unit-IDs,
Aliase sowie Block-IDs und Verschachtelung. Änderungen an dieser Struktur
machen alle bisherigen Kurzlinks dieses Testhefts ungültig. Anzeigetitel,
XML-Formatierung und Dateinamen ändern die Kurzlinks nicht; Änderungen an
anderen Testheften ebenfalls nicht.

Das Format verwendet SHA-256 mit der Kennzeichnung `booklet-task-link-v1`:
Zuerst wird der Navigationsbaum gehasht, dann zusammen mit dem
nullbasierten Vorkommensindex erneut gehasht. Die ersten 16
Base64url-Zeichen (96 Bit) bilden die `linkId`. Die Baumdarstellung enthält
`[kind, id, children]` für Blöcke und `[kind, id, alias-or-null]` für Units;
Bezeichnungen und Quellpfade sind ausgeschlossen. Dieses Format ist Teil
des Linkvertrags und muss bei unveränderter Struktur stabil bleiben.

Bisherige lange `occurrenceId`-Links werden weiterhin aufgelöst. Ältere
Antworten ohne `linkId` verwenden beim Erzeugen von Links die vorhandene
`occurrenceId`; ohne beide Kennungen gibt es `position` als einsbasierte
Position in der Aufgabenliste. Diese älteren Linkformen bieten keine
Absicherung gegen Strukturänderungen. Links ohne Auswahl öffnen weiterhin
die erste Aufgabe. Beim Testheftwechsel wird die Auswahl zurückgesetzt.

Bei unbekannten, mehrdeutigen oder ungültigen Zielen erscheint der Hinweis,
dass der Direktlink ungültig oder veraltet ist; die Ansicht zeigt die erste
Aufgabe an. Veraltete Kurzlinks fallen nicht auf eine inzwischen anders
belegte Strukturposition zurück. Der nächste Navigationsschritt erzeugt
wieder einen gültigen Link. Die Links verwenden weiterhin die reguläre
ACP-Zugriffsprüfung.

## Laufzeitmodell und Fehler

Ein gemeinsames Manifest enthält Booklets, verschachtelte Blöcke, geordnete
Unit-Vorkommen und einen separaten ACP-weiten Inhaltskatalog. Eine
`occurrenceId` unterscheidet Navigationspositionen anhand von Booklet-ID und
Strukturpfad; die Unit-ID bleibt bei wiederholter Verwendung identisch.
Navigationspositionen sind nicht als dauerhafte Kommentar-IDs vorgesehen.

Uploadvalidierung und ACP-Konsistenzprüfung melden XML-Fehler, fehlende
Referenzen und ID-Konflikte mit dem jeweiligen Strukturpfad. Ein Booklet mit
fehlender XML-Datei kann über vorhandene Legacy-Module angezeigt werden;
der fehlende Dateibezug wird weiterhin gemeldet. Es gibt keine automatische
Kommentar-Migration und keine Aktivierung einer neuen Review-Funktion.

Die Aufgabenfolge zeigt Blockpfade und Aliase an. Wiederholte Unit-Vorkommen
bleiben einzeln auswählbar. Die vorhandene ACP-Oberfläche bleibt der gemeinsame
Einstiegspunkt für das Content Package.

## Beispiel und Prüfung

`backend/src/review/fixtures/review-booklet.xml` enthält eine Unit außerhalb von
Blöcken, verschachtelte Testlets, Fortschrittsmarker und eine wiederholte Unit
mit Alias. Die zugehörigen Tests ergänzen mehrere Booklets, fehlende Referenzen,
ID-Konflikte, ungültige Marker, Legacy-Module und fehlerhaftes XML.

Offen bleibt die fachliche Bestätigung der Markerregeln und der erwarteten
Navigation anhand eines repräsentativen Originalpakets.
