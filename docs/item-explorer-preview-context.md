# Itembezogene Player-Vorschau

Die ACP-Option `enableItemExplorerConditionalVisibility` erhält die originale
Aufgabendefinition. Sie wird durch diesen Code nicht in bestehenden ACPs aktiviert.

## Ansichten

- **Referenzansicht des Items** ist der Standard bei aktivierter Option. Gespeicherte
  Antworten und Fallback-Antwortzustände bestimmen diese Ansicht nicht.
- **Bearbeitungsstand** lädt gespeicherte Antworten und lässt echte Eingaben weiterhin
  speichern. Die Sichtbarkeit folgt diesem ausdrücklich gewählten Bearbeitungsstand.
- **Regulärer Aufgabenablauf** startet die Originalaufgabe ohne vorbereitete Antworten.
  Damit können auch Antwort-, Zeit- und andere interaktive Abhängigkeiten durchlaufen
  werden. Dies ist auch bei fehlender Item-Zuordnung möglich.

Spätere Frame-Neustarts und Musterlösungswechsel erhalten die aktuellen Eingaben und
im regulären Ablauf die erreichte Seite. Ein erneuter Wechsel in den regulären Ablauf
beginnt wieder mit den Vorgaben der Originaldefinition. Der Bearbeitungsstand verwendet
bei einem Neustart die neuesten Sitzungsdaten vor einem älteren Wechselcache.
Ein Ansichtswechsel bei aktiver Musterlösung oder direkt nach ihrem Ausblenden
erhält den letzten echten Antwortstand auch vor der nächsten Player-Meldung.

Vorbereitete Referenzzustände und Musterlösungen sind keine speicherbaren Antworten.
Ein Itemwechsel erzeugt eine neue Protokollsitzung; verspätete Player-, Speicher- oder
Löschmeldungen dürfen deren Daten nicht verändern.

## Ermittlung des Referenzkontexts

Eindeutige Gleichheitsbedingungen können direkt einen Startzustand liefern. Bei
Medien und geordneten Triggern wird der Originalplayer in Seitenreihenfolge zum Item
geführt. Die frühere Forderung, dass alle sichtbaren Trigger gleichzeitig denselben
Endzustand schreiben müssen, gilt für diesen Ablauf nicht.

Für monotone Audio-/Videoabhängigkeiten wird nur der Fortschritt der für das Item
benötigten Medien vorbereitet. Das gilt nur, wenn auf dem Weg zum Item keine
bedingten Abschnitte nach ihrer Einblendung dauerhaft sichtbar bleiben. Solche
Medienverläufe werden im regulären Ablauf durchlaufen und können anschließend
als Kontext übernommen werden. Ein vorbereiteter Endfortschritt würde ihre
frühere Einblendung überspringen. Abhängige Medien werden über ihre internen IDs
zugeordnet; beim Import der Playerzustände werden deren öffentliche Aliasnamen
verwendet. Diese beiden Namensräume dürfen sich überschneiden. Andere Antworten
werden nicht erfunden. Alle Sichtbarkeitsregeln bleiben im Originalplayer aktiv.

Definition, Ziel, Seiten und Zustandsvariablen werden einmal gemeinsam ausgewertet.
Direkter Start und geordneter Ablauf verwenden dieselbe Regelprüfung. Abschnitte,
die nach dem Einblenden sichtbar bleiben, erfordern bei Zustandstriggern den Ablauf
ab der ersten Seite; das gilt auch auf normalen Aufgabenseiten. Der Endzustand allein
enthält ihre Sichtbarkeitshistorie nicht. Die Trigger-Vorbereitung beobachtet den
tatsächlichen Eintritt in den sichtbaren Bereich und das anschließende Rendering.

Frei wählbare Ansichten folgen zunächst dem konfigurierten Originalablauf und dessen
Standardwerten. Bearbeitende können Zustandswerte, eine Kontextseite für dauerhaft
sichtbare Ziele oder einen übernommenen Kontext festlegen. Für Antwort-/Zeitverläufe,
die sich nicht automatisch vorbereiten lassen, bleibt der Originalablauf im Explorer
bedienbar.

## Ansicht ausdrücklich übernehmen

Mit **Diese Itemansicht als Kontext übernehmen** kann eine im Player erreichte,
sichtbare Itemansicht als gemeinsame Explorer-Konfiguration übernommen werden.
Dafür sind Bearbeitungsrechte erforderlich. Die Musterlösungsansicht ist ausgeschlossen.
Der Kontext wird im Explorer-Entwurf unter `previewStart.context` gespeichert und
folgt dessen bestehendem Veröffentlichungsprozess. Der Antwortspeicher wird nicht
verwendet.

Ein Kontext enthält einen Versionsschlüssel der vollständigen Definition, das
Player-Ziel, die Aufgabenseite und die serialisierten Standard-Datenteile des Players.
Der Schlüssel dient der Erkennung veralteter Kontexte, nicht als Sicherheitsnachweis.
Bei geänderter Definition, geändertem Ziel oder ungültiger Seite wird der Kontext
abgewiesen. **Übernommenen Kontext zurücksetzen** stellt die automatische Ermittlung
wieder her. Zustandswerte und Kontextseite können separat bearbeitet werden; diese
Änderung ersetzt einen zuvor übernommenen Kontext.

Die Sichtbarkeitsprüfung unterscheidet interne Modell-IDs und öffentliche Aliase.
Ein gleichlautender Alias eines anderen Elements genügt nicht zur Übernahme. Bei
normalen Itemzielen muss außerdem die aktuelle Aufgabenseite zum Ziel passen.
Nach Eingaben, Aktionen und Medienänderungen bleibt die Kontextübernahme gesperrt,
bis der Player einen danach erzeugten Antwortzustand gemeldet hat. Der Empfang
einer älteren, noch wartenden Nachricht genügt dafür nicht. Damit werden die
sichtbare Ansicht und ein veralteter Antwortsnapshot nicht zusammen gespeichert.

## Fehlende Zuordnungen und Abnahme

Fehlende Metadatenreferenzen werden nicht aus Itemnummern geraten. Die Definition
und die verfügbaren Player-Ziele werden auch für solche Zeilen geladen. Über den
regulären Ablauf kann die Aufgabe geprüft und anschließend ein explizites Sprungziel
festgelegt werden. Ohne verbindliche Metadaten kann der Code die fachliche Zuordnung
nicht selbst herstellen.

Automatisierte Regressionstests abstrahieren die Fälle in kleine synthetische
VOUD-Definitionen: sichtbare und verborgene Stimulusvarianten, Wechsel A → B → A,
Medien- und Triggerfolgen, bleibende Sichtbarkeit auf normalen und permanenten Seiten,
bleibende Medien-Stimuli, verzögerte Zustandsmeldungen nach Eingaben, übernommene
Kontexte, gespeicherte Antworten und Sitzungswechsel. Die Browserprüfungen
verwenden diese Fixtures mit dem fest gepinnten Aspect-Releaseplayer. Originale
Aufgabenarchive und Medien sind dafür nicht erforderlich und werden nicht aufgenommen.
Die technische Qualifikation ersetzt die fachliche Prüfung der Referenzansichten und
der fehlenden Metadatenzuordnungen nicht.

Refs #150
