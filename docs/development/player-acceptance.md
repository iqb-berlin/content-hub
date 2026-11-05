# Funktionale Player-Abnahme

Die 15 Aufgaben `aspect-m3-acceptance-*` ergänzen die Einstellungsinventur.
Jeder Browserfall importiert eine Aufgabe in den originalen ASPECT-3.1-Editor,
ändert eine ID, speichert, importiert den Export erneut und ändert/speichert
noch einmal. Anschließend wird genau dieser Export im echten Player bedient.
Die Laufzeitkorrekturen unten gelten auch für diesen Testhost.

| Aufgabe | Beobachtbare Wirkung |
| --- | --- |
| Eingabegrenzen | Pflichtfeld, Mindestlänge, Musterprüfung und Abschneiden an der Höchstlänge |
| Schreibschutz | Text unveränderlich und ohne Löschknopf; Checkbox/Dropdown auch per Tastatur gesperrt |
| Eingabehilfe | Zahlentastatur und Beschränkung auf erlaubte Zeichen |
| Textbereich | Vier Zeilen, Wortzähler, keine Größenänderung |
| Auswahl | Andere Optionen durchstreichen; Dropdownauswahl wieder aufheben |
| Likert | Vorgegebene Zeile auch per Tastatur gesperrt, freie Zeile bedienbar |
| Tabelle | Sichtbare Rahmen und feststehende Kopfzeile beim Scrollen über 20 Zeilen |
| Lückentext | Eingebettete Antwortfelder bedienbar |
| Zuordnung | Echte Zeigerbewegung zwischen verbundenen Ablagen |
| Mathematik | Eingabe mit den aktivierten Tastaturvorgaben |
| Audio | Tatsächliche Wiedergabe, Pause/Fortsetzen, Mindestlautstärke und nur ein Durchlauf |
| GeoGebra | Punkt im echten Applet bewegen und zurücksetzen |
| tet.folio | Synthetisches HTML-Experiment startet und meldet seinen Zustand zurück |
| Hotspot | Gedrehtes Dreieck an einem tatsächlichen Trefferpunkt auswählen |
| Sichtbarkeit | UND-Verknüpfung zweier Bedingungen und erneutes Verbergen |

Alle Fälle laufen bei 390 und 1440 Pixeln in Chromium, Firefox und WebKit:
90 zusätzliche Prüfungen. Das belegt die aufgeführten Wirkungen; die 3.304
inventarisierten Einstellungen sind weiterhin Werte-/Editorabdeckung und kein
vollständiger Laufzeittest aller denkbaren Kombinationen.

## Gefundene und behobene Releasefehler

ASPECT 3.1.0 zeigt bei `readOnly: true, clearable: true` weiterhin den Löschknopf.
Außerdem verhindert `pointer-events: none` bei Auswahlfeldern nur die Mausbedienung;
eine vorgegebene Likert-Antwort lässt sich per Pfeiltaste verändern. Der Backport
blendet den Löschknopf aus und deaktiviert die FormControls schreibgeschützter
Auswahlfelder. Textfelder bleiben mit ihrem nativen Schreibschutz kopierbar.
Der ursprüngliche Wert bleibt als Antwort erhalten.

ABI 2.0.1 initialisiert `isProductionMode` nicht. Dadurch startet das veröffentlichte
HTML seine interne Demo und übernimmt die Host-Aufgabe nicht. Der Backport setzt
den Produktionsmodus für den Hostbetrieb und entfernt die interne Debugmeldung. Die ABI-2-Aufgabe verwendet nur
Eingabeformate, die diese Generation tatsächlich unterstützt.

Die App wendet die Korrekturen ausschließlich beim Rendern an, nach Prüfung von
Länge und vollständigem SHA-256 des bekannten Release-HTMLs. Geänderte oder neue
Module werden nicht gepatcht. Die ursprünglichen Dateien in Speicher, API-Download
und Testpool bleiben bytegleich. Die Profile und Tests liegen unter
`frontend/src/app/core/utils/player-html-compatibility.*`. Nachvollziehbare
Quellpatches für die festgelegten Upstream-Versionen liegen unter
`scripts/player-coverage/patches/`; sie werden nicht automatisch upstream veröffentlicht.

## ABI-Legacy und echte Widgets

Der Legacy-Adapter übersetzt `vo.*`-Start, Antwort-/Restore-Daten und Navigation in
das aktuelle Hostprotokoll. Er verwaltet Protokoll und Sitzung pro Playerfenster,
berücksichtigt die Start-/Ready-Reihenfolge und räumt beim Aufgabenwechsel auf.
Einzelansicht, Aufgabenansicht und Explorer-Vorschau nutzen denselben Adapter.
ABI 1 und das korrigierte ABI 2 werden zusätzlich über die echte App/API mit einer
eigenen Texteingabe geprüft. Die Diagnose des unveränderten ABI-2-Releases bleibt
getrennt bestehen.

Content Hub liefert die unveränderten offiziellen Chemistry-Widgets **1.1.0**
(Periodensystem und Molekül-Editor) selbst aus. MIT-Lizenz, Release-URLs und SHA-256
liegen in `backend/src/assets/widgets/`. Die Dateien werden beim Backend-Build
nach `dist/assets/widgets/` kopiert und über `/api/shared-assets/widgets/` angeboten.
Die Dialoge verwenden die echten `vow*`-Meldungen und geben den Zustand mit
`vopWidgetReturn` an die ursprüngliche Playersitzung zurück. Fremde Fenster,
falsche Sitzungen und veraltete Antworten werden verworfen. Abbrechen verändert
die Antwort nicht; auch ein absichtlich leerer Zustand lässt sich übernehmen.

Vier Aufgaben und sechs Integrationsfälle pro Browser prüfen ABI 1/2 sowie
Periodensystem-Auswahlgrenze, Wiederöffnen, Abbrechen, Leeren, automatisches Schließen,
reinen Anzeigemodus bei schmalem Bildschirm und Molekülbearbeitung mit Rückgabe und
Wiederherstellung. Es gibt keine simulierte Ersatzoberfläche.

## Nachweise

`npm run e2e:synthetic` im Frontend führt insgesamt 642 Prüfungen aus und erzeugt
die lokale Galerie mit Prüfsummen. `acceptanceCoverage` und `compatibilityCoverage`
im Manifest enthalten nur tatsächlich ausgeführte Fälle und deren Ergebnis.
`compatibilityVerifiedIn` unterscheidet die erfolgreiche App-Integration von
der Interaktion mit unveränderten Originalmodulen (`verifiedIn`) und der
ABI-2-Diagnose (`diagnosedIn`). Ein Teil- oder Fehllauf ist keine vollständige Abnahme.
