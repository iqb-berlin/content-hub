# Verbindliche Spaltenfreigabe im Item-Explorer (#166)

Mit „Spalten verwalten → Ausgeblendete Spalten für Reviewer sperren“ wird die
veröffentlichte Spaltenauswahl zur Informationsgrenze. Die Option ist bei
bestehenden APs ausgeschaltet. Das Aktivieren, Ändern und Deaktivieren folgt
dem vorhandenen Draft-/Veröffentlichungsmodell. Speichern im Spaltendialog
ändert zunächst den Draft; erst „Änderungen prüfen → Veröffentlichen“ ändert
die Freigabe für Leser. Verwerfen lässt die bisherige Freigabe bestehen.

## Berechtigungen und Bedienung

- `item-explorer:edit` erlaubt weiterhin Bearbeiten und Veröffentlichen der
  gemeinsamen Explorer-Konfiguration. App-Administratoren behalten ihren Override.
- Explorer-Leser, Credentials und öffentliche Zugriffe unterliegen der Freigabe.
  `review:participate` und `review:manage` gewähren keine Ausnahme und ersetzen
  auch nicht `item-explorer:view`.
- AP-Verwaltungszugriffe und Explorer-Bearbeitungszugriffe behalten ihre
  administrativen Datenrechte. Die explizite Read-only-Vorschau verwendet die
  veröffentlichte eingeschränkte Ansicht.
- Der Spaltendialog ist auch für Leser erreichbar. Gesperrte Spalten werden
  dort nicht angeboten; ein Hinweis erläutert die gemeinsame Vorgabe.
- Erlaubte Spalten lassen sich zusätzlich ausblenden, anordnen und verbreitern.
  Die Item-ID bleibt verfügbar. Eigene persönliche Notizen, Tags und Bewertungen
  sind unabhängig von der gemeinsamen Freigabe verfügbar, sofern die Funktion
  für den AP eingeschaltet ist.
- Die normale Tabelle und „Nur Auswahlliste“ verwenden dieselbe Spaltenauswahl.

## Datenmodell und Durchsetzung

Die optionale boolesche Eigenschaft
`metadataColumns.restrictReviewerColumnsToManagerSelection` liegt gemeinsam
mit `metadataColumns.layout` im vorhandenen JSONB-State. Eine neue Datenbankspalte
oder Migration ist nicht erforderlich. Alte Datensätze bedeuten `false`.

Bei Aktivierung materialisiert die Oberfläche die aktuelle Auswahl als explizites
Layout. Für eingeschränkte Zugriffe gelten ausschließlich die veröffentlichten
Spalten-IDs. Ohne explizites Layout wird nur die notwendige Identität freigegeben;
neue gemeinsame Spalten werden nicht automatisch zugänglich. Neue Feldarten
müssen sowohl in der Oberfläche als auch in `ReviewerColumnPolicy` ausdrücklich
zugeordnet werden. Persönliche Spalten haben den Namensraum `personal:`.

`ReviewerColumnPolicy` ordnet gemeinsame Felder ihren Spalten zu und wird für
JSON-Projektionen und Exportspalten verwendet. Die Prüfung erfolgt nach den
Zugriffs-Guards. Ein vom Client übermitteltes `perspective=editor` verleiht keine
Bearbeitungsberechtigung. Gefilterte Ergebnisse verändern keine Parser-Caches.

Erfasst sind die Datei-Item-Liste, alternative Item-Listen und Einzelitems,
Item-/Unit-Metadaten, gemeinsame Tags und Kommentarzähler, Explorer-State,
AP-Listen sowie Unit-Ansichten. Persönliche XLSX- und Auswahllisten-CSV-Exporte
enthalten nur freigegebene gemeinsame Felder; eigene persönliche Angaben bleiben
erhalten. Review-Kommentarexporte geben gesperrte Unit-Bezeichnungen sowie gesperrte
Booklet-IDs und -Bezeichnungen nicht als zusätzliche Spalten aus. Kommentartexte und das bestehende Review-Zugriffsmodell
bleiben eigenständige Inhalte und Berechtigungen.

Die Review-Navigation behält Booklet-/Unit-IDs, Vorkommens-IDs und die
Pflichtfelder der Navigation. Gesperrte Bezeichnungen werden auch im verschachtelten
Navigationsbaum entfernt; die Oberfläche verwendet dann die jeweilige ID.
Blockbezeichnungen folgen der Booklet-Freigabe.

Leser erhalten auch unter dem kompatiblen Antwortfeld `draftState` nur den
veröffentlichten Zustand. Gesperrte Werte werden aus allen mitgelieferten
State-Projektionen entfernt. Gemeinsame Filterwerte werden bei eingeschränkten
Antworten nicht mitgegeben. Alte lokale Spalten-/Filtereinstellungen können die
Freigabe nicht erweitern. Beim Laden und Wiederfreigeben gilt das veröffentlichte
Layout; frühere persönliche Sichtbarkeit wird nicht wiederhergestellt.

## Rohdaten und Grenzen

Rohdaten können die Spaltenprojektion umgehen. Deshalb sind für eingeschränkte
Zugriffe rohe AP-Indizes, Dateilisten/-details, VOMD-/XML-/JSON-Rohdateien und
Archivdownloads gesperrt. Es wird kein scheinbar vollständiges, teilweise
entferntes Originalarchiv erzeugt. Die Oberfläche benennt diese Auswirkung beim
Aktivieren der Option.

Deklarierte Player-, Unit-Definition- und Coding-Scheme-Abhängigkeiten in den
Formaten `.html`, `.voud` und `.vocs` bleiben für die bestehende Vorschaufunktion
zugänglich. Die Zuordnung berücksichtigt auch die hochgeladene Unit-XML, wenn
die Abhängigkeitsliste im AP-Index noch nicht aktuell ist. Andere Rohformate
werden nicht allein wegen eines erlaubten Dateidownloads freigegeben.

Interne Identifikatoren (z. B. Zeilenschlüssel, Unit-/Item-/Variablen-ID und Sub-ID)
bleiben für Zuordnung, Vorschau und persönliche Eingaben erforderlich. Daraus
werden keine weiteren fachlichen Spaltenwerte freigegeben. In Exporten werden
interne Schlüssel nicht automatisch als zusätzliche Spalten ausgegeben; eine
Sub-ID-Spalte benötigt ihre eigene Freigabe. Inhalte, die bereits
vor einer Sperre heruntergeladen wurden, lassen sich nicht nachträglich entziehen.
Die Sperre gilt AP-weit; gruppenspezifische Freigaben sind nicht Teil von #166.

## Validierung

- Policy-Tests prüfen Feldzuordnung, doppelt vorliegende Metadaten, unbekannte
  Felder, persönliche Daten, State-Projektionen und unveränderte Cache-Objekte.
- Facade-Tests prüfen veraltete Layouts, direkte Toggle-Aufrufe, Reset,
  unveränderliche Item-ID und Abbrechen einer Manager-Änderung.
- `backend/test/reviewer-columns.e2e-spec.ts` prüft mit echten HTTP-Guards und
  einer isolierten PostgreSQL-Datenbank die Rollenmatrix, manipulierte Anfragen,
  Draft/Publish/Discard, Datenprojektionen, Rohdatenzugriffe und XLSX-/CSV-Ausgaben.
- Für eine manuelle Browserabnahme: Option aktivieren und eine Parameterspalte
  ausblenden; vor Veröffentlichung als Leser unveränderte Daten prüfen; danach
  Dialog, zusätzliche persönliche Ausblendung, Read-only-Vorschau und
  „Nur Auswahlliste“ prüfen. Auch Suchfilter und Player-Abhängigkeiten testen.
