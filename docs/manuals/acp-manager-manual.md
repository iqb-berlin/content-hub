# ACP-Manager Handbuch

## Ziel und Zielgruppe

Dieses Handbuch richtet sich an Personen mit der ACP-Rolle `ACP_MANAGER`. Es beschreibt die
typischen Arbeitsablaeufe in der Anwendung aus Sicht der Paketverantwortlichen:

- ACP oeffnen und ueberblicken
- ACP-Index importieren oder exportieren
- Rollen zuweisen
- Dateien hochladen, pruefen und loeschen
- Zugriffsmodell und Features konfigurieren
- Snapshots fuer Sicherung und Wiederherstellung verwenden
- Vorschau, Item-Liste und Item-Explorer fuer die fachliche Kontrolle nutzen

Nicht alle Funktionen dieses Handbuchs stehen jeder Person zur Verfuegung. App-Admins haben
zusaetzliche Rechte, zum Beispiel fuer das Anlegen und Loeschen von ACPs oder fuer die
Benutzerverwaltung.

## Grundprinzipien

- Ein ACP ist ein inhaltliches Paket mit Metadaten, ACP-Index, Dateien, Rollen, Kommentaren und
  optionalen Zugangsdaten.
- Die Verwaltung erfolgt ueber die Route `Verwalten`.
- Die fachliche Pruefung erfolgt ueber die Route `Vorschau`.
- Viele Einstellungen wirken nur auf die Nur-Lese-Sicht fuer andere Nutzerinnen und Nutzer.
  ACP-Manager und App-Admins sehen teilweise mehr als normale Betrachter.

## Anmeldung und Einstieg

### 1. Anmelden

Die Anmeldung fuer ContentPool-Nutzerinnen und -Nutzer erfolgt ueber Keycloak / OIDC.
Separate ACP-Zugangsdaten werden nur fuer entsprechend geschuetzte Nur-Lese-Zugaenge
verwendet.

Nach erfolgreicher Anmeldung oeffnen Sie die ACP-Liste ueber:

- die Startseite, falls dort eine Schaltflaeche `Verwalten` sichtbar ist, oder
- direkt ueber `/acps`.

### 2. ACP auswaehlen

In der ACP-Liste sehen Sie:

- `Meine ACP-Pakete`, wenn Sie normale ACP-Rechte besitzen
- `Assessment Content Packages`, wenn Sie App-Admin sind

Zu jedem ACP gibt es die Schaltflaeche `Verwalten`, sofern Sie Verwaltungsrechte besitzen.

## Die Verwaltungsuebersicht

Nach dem Oeffnen eines ACPs gelangen Sie auf die Uebersicht. Dort finden Sie die wichtigsten
Bereiche:

- `Dateien`
- `Snapshots`
- `Zugriffskonfiguration`
- `Applikationstoken`
- `Vorschau`

Zusatzfunktionen direkt auf der Uebersichtsseite:

- ACP-Namen umbenennen
- ACP-Index anzeigen, exportieren, importieren oder loeschen
- Rollenzuweisungen verwalten

### Applikationstoken fuer ein ACP verwalten

Im Bereich `Applikationstoken` koennen ACP-Manager Tokens fuer externe Anwendungen
anlegen, die ausschliesslich auf das aktuelle ACP begrenzt sind.

Typischer Ablauf:

1. `Applikationstoken` in der Verwaltungsuebersicht oeffnen.
2. `Token anlegen` klicken.
3. Namen, optionale Ablaufzeit und benoetigte Berechtigungen auswaehlen.
4. Den neu angezeigten Klartext-Token sofort in der externen Anwendung hinterlegen.

Wichtige Hinweise:

- Der Klartext-Token wird nur einmal direkt nach dem Anlegen angezeigt.
- ACP-Manager koennen keine globalen Tokens erstellen.
- Tokens aus diesem Bereich gelten nur fuer das aktuelle ACP.
- Ein Token kann spaeter widerrufen werden; die Aktion kann nicht rueckgaengig gemacht werden.

### ACP umbenennen

1. Auf das Stiftsymbol neben dem ACP-Namen klicken.
2. Neuen Namen eingeben.
3. Mit `Speichern` bestaetigen.

### ACP-Index verwalten

Im Bereich `ACP-Index` koennen Sie:

- `Anzeigen`: aktuellen Index als JSON einblenden
- `Exportieren`: Index als JSON herunterladen
- `Importieren`: Index aus einer JSON-Datei ersetzen
- `Index loeschen`: Index auf einen Standardzustand zuruecksetzen

Wichtige Hinweise:

- Beim Import muss die Datei gueltiges JSON sein.
- Das Loeschen betrifft den gesamten Index, nicht jedoch die bereits hochgeladenen Dateien.
- Nach groesseren Index-Aenderungen sollten Sie einen Snapshot erstellen.

### Rollen zuweisen

Im Bereich `Rollenzuweisungen` koennen Sie Personen einem ACP zuordnen.

Verfuegbare Rollen:

- `ACP-Manager`
- `Nur Lesen`

Typischer Ablauf:

1. Benutzerin oder Benutzer aus der Liste auswaehlen.
2. Rolle auswaehlen.
3. `Zuweisen` klicken.

Wichtig:

- App-Admins koennen `ACP_MANAGER` vergeben und entziehen.
- Nicht-adminische ACP-Manager koennen in der Praxis in der Regel nur `READ_ONLY` vergeben.
- Entfernen Sie Rollen, wenn ein ACP nicht mehr betreut oder eingesehen werden soll.

## Dateien verwalten

Der Bereich `Dateien` ist die zentrale Stelle fuer Upload, Validierung und Dateikontrolle.

### Was der Bereich leistet

- Einzeldateien oder ZIP-Archive hochladen
- Dateikonflikte beim Upload entscheiden
- automatische Index-Synchronisation ausfuehren
- syntaktische und semantische Validierung anzeigen
- Dateien filtern, vorschauen, herunterladen und loeschen

### Dateien oder ZIP hochladen

1. `Dateien oder ZIP hochladen` klicken.
2. Eine oder mehrere Dateien oder ein ZIP-Archiv auswaehlen.
3. Den Upload abwarten.

Beim Upload passieren im Hintergrund mehrere Schritte:

1. Dateien werden gespeichert.
2. ZIP-Dateien werden automatisch entpackt.
3. Der ACP-Index wird mit den hochgeladenen Dateien synchronisiert.
4. Dateien werden automatisch validiert.
5. Eine semantische ACP-Pruefung wird ausgefuehrt.

### Dateikonflikte behandeln

Wenn Dateinamen bereits vorhanden sind, erscheint ein Konfliktdialog.

Pro Datei koennen Sie waehlen:

- `Ersetzen`
- `Ueberspringen`

Zusatzfunktionen:

- `Alle ersetzen`
- `Alle ueberspringen`

Empfehlung:

- `Ersetzen`, wenn eine Datei bewusst aktualisiert wurde
- `Ueberspringen`, wenn die vorhandene Datei gueltig bleiben soll

Nach dem Ersetzen bereinigt die Anwendung fehlende Referenzen und veraltete Antwortdaten
automatisch.

### Upload-Ergebnisse lesen

Nach einem Upload sehen Sie typischerweise:

- Upload-Fortschritt
- Verarbeitungsstatus
- Konfliktzusammenfassung
- `Index-Sync` mit Zahlen zu hinzugefuegten oder aktualisierten Units und Items
- `Auto-Validierung` mit Gesamtstatus

### Dateien manuell pruefen

Mit `Dateien pruefen` starten Sie die Validierung erneut.

Die Ergebnisse zeigen:

- `OK`
- `Fehler`
- `Nicht geprueft`

Falls Unit-Dateien unvollstaendig sind, sehen Sie zusaetzlich Hinweise zu fehlenden Bestandteilen,
zum Beispiel:

- Definition
- Coding Scheme
- Metadaten
- Player

### Dateien filtern und kontrollieren

Sie koennen die Dateitabelle filtern nach:

- Dateiname
- Dateityp
- Pruefstatus

Zu jeder Datei stehen folgende Aktionen zur Verfuegung:

- `Ansehen`
- `Download`
- `Loeschen`

Die Vorschau zeigt, sofern moeglich:

- Text
- strukturierte JSON/XML/CSV-Zusammenfassungen
- Bilder
- PDF
- Audio/Video

### Alle Dateien loeschen

Mit `Alle loeschen` entfernen Sie den gesamten Dateibestand des ACP.

Das ist ein starker Eingriff. Erstellen Sie vorher einen Snapshot, wenn Sie den bisherigen Stand
noch brauchen.

## Zugriffskonfiguration

Im Bereich `Zugriffskonfiguration` verwalten Sie sowohl das Zugriffsmodell als auch die
Nur-Lese-Features fuer andere Nutzerinnen und Nutzer.

Die Aktion `Änderungen speichern` speichert Zugangsart, Funktionen und Darstellung gemeinsam.
Die Speicherleiste zeigt ungespeicherte Änderungen und Fehler an. Technische Optionen
stehen im eingeklappten Bereich `Erweiterte Einstellungen`.

### Zugriffsmodell waehlen

Sie koennen eines der Basismodelle waehlen:

- `Nur zugewiesene Personen`
- `Öffentlich – ohne Anmeldung`
- `Zugang mit ACP-Zugangsdaten`

App-Admins und Personen mit zugewiesener ACP-Rolle haben unabhängig von der
Zugangsart Zugriff. Eine Registrierung allein reicht nicht. Die Rollen werden
unter `Personen und Rollen verwalten` auf der ACP-Übersicht gepflegt.

#### 1. Privat

Verwendung:

- fuer interne Vorbereitung
- fuer ACPs, die noch nicht sichtbar sein sollen

Wirkung:

- keine anonyme Sichtbarkeit
- Zugriff nur fuer App-Admins und Personen mit ACP-Rolle

#### 2. Oeffentlich

Verwendung:

- fuer frei einsehbare Inhalte

Wirkung:

- Zugriff ohne Anmeldung
- sichtbare Funktionen haengen weiterhin von den Feature-Schaltern ab

#### 3. Zugangsliste

Verwendung:

- fuer befristete, klar abgegrenzte Review-Zugaenge

Wirkung:

- Zugriff nur mit ACP-spezifischen Zugangsdaten

Zusaetzliche Einstellungen:

- `Gueltig von`
- `Gueltig bis`

Die Gueltigkeit ist auf maximal drei Monate begrenzt.

### Zugangsdaten manuell pflegen

Im Modus `Zugangsliste` koennen Sie einzelne Zugangsdaten anlegen:

1. Benutzername eintragen.
2. Kennwort vergeben.
3. `Hinzufuegen` klicken.

Kennwoerter muessen stark sein. Erwartet werden mindestens:

- 12 Zeichen
- Grossbuchstabe
- Kleinbuchstabe
- Zahl
- Sonderzeichen

Bestehende Eintraege koennen ueber `Bearbeiten` angepasst oder ueber `Loeschen` entfernt werden.

### Zugangsdaten per CSV importieren

Fuer groessere Mengen nutzen Sie den `CSV-Import`.

Format:

- pro Zeile `Benutzername, Kennwort`

Import-Modi:

- `Liste ersetzen`
- `Nur neue hinzufuegen`
- `Aktualisieren`

Vor dem Import sehen Sie eine Vorschau mit:

- Gesamtzahl
- neu hinzuzufuegende Eintraege
- zu aktualisierende Eintraege
- uebersprungene Eintraege
- Duplikaten oder Konflikten

### Features konfigurieren

Die Feature-Schalter steuern die Lesesicht fuer andere Nutzerinnen und Nutzer.

#### Auf dieser Startseite anzeigen

Hier legen Sie fest, welche Einstiege auf der ACP-Startseite erscheinen:

- Item-Explorer
- Aufgaben ansehen
- Testhefte und Aufgabenfolgen
- Paketstruktur (ACP-Index)

Diese Schalter aendern keine Funktionsrechte. Die fachlichen Funktionen werden weiterhin in den
Bereichen `Aufgaben-Ansicht`, `Navigation`, `Kommentare` und `Item-Explorer` aktiviert. Auch ein
ausgeblendeter Einstieg ist keine Zugriffssperre; Zugriffe werden ueber das Zugriffsmodell und die
Funktionsrechte geregelt. Bestehende ACPs zeigen alle Eintraege weiterhin an. Eine vorhandene,
deaktivierte Einstellung `Navigation ueber die Unit-Liste` bleibt als Alt-Konfiguration erhalten.

#### Downloads

Sie koennen einzeln erlauben:

- ACP-Index-Download
- Unit-Download als ZIP
- sonstige Datei-Downloads

#### Aufgaben-Ansicht

Hier steuern Sie unter anderem, ob die Unit-Ansicht mit Verona-Player verfuegbar ist.

#### Navigation

Hier steuern Sie unter anderem:

- Verfuegbarkeit von Testheften und Aufgabenfolgen

#### Kommentare

Wenn `Kommentare aktivieren` gesetzt ist, waehlen Sie ausserdem die erlaubten Ziele:

- Aufgaben (Units)
- Items
- Aufgabenfolgen

#### Item-Liste und Explorer-nahe Optionen

Hier steuern Sie unter anderem:

- Item-Liste aktivieren
- Item-Klick zur Aufgabe
- Filtern erlauben
- Sortieren erlauben
- Item-Tagging erlauben
- Kodierungsvariablen mit `audio` oder `video` anzeigen
- bedingte Sichtbarkeit im Item-Explorer-Player anwenden
- Item im Player hervorheben
- zusaetzliche Player-Zuordnungsinfos im Explorer anzeigen
- Nutzer-Einstellungen speichern

Wenn `Item-Tagging erlauben` aktiv ist, pflegen Sie darunter die Liste `Verfuegbare Tags`.

### Empfehlung fuer die Praxis

- Waehlen Sie `Privat`, solange Dateien und Index noch in Arbeit sind.
- Aktivieren Sie erst danach oeffentliche oder credentials-basierte Zugaenge.
- Testen Sie die Lesesicht mit einem passenden Testkonto oder mit ACP-Zugangsdaten, nicht nur als
  Managerkonto.

## Snapshots

Snapshots sind Sicherheitsstaende Ihres ACPs.

### Wann ein Snapshot sinnvoll ist

Erstellen Sie einen Snapshot insbesondere:

- vor Index-Importen
- vor groesseren Dateiaustauschen
- vor Aenderungen an Zugriffsmodellen
- vor dem Veroeffentlichen groesserer Explorer-Aenderungen

### Snapshot erstellen

1. `+ Snapshot erstellen` klicken.
2. Im Feld `Changelog` kurz beschreiben, was gesichert wird.
3. `Erstellen` klicken.

### Snapshot vergleichen

Mit `Diff zum aktuellen Stand` sehen Sie:

- ob der ACP-Index veraendert ist
- neue Dateien im aktuellen Stand
- fehlende Dateien im aktuellen Stand
- inhaltlich geaenderte Dateien

### Snapshot wiederherstellen

Mit `Wiederherstellen` setzen Sie ACP-Index und Dateien auf den Stand dieses Snapshots zurueck.

Wichtig:

- aktuelle, nicht anderweitig gesicherte Aenderungen gehen verloren
- die Aktion sollte nur bewusst und mit aktuellem Kontext durchgefuehrt werden

### Snapshot loeschen

Mit `Loeschen` entfernen Sie einen Snapshot dauerhaft. Diese Aktion kann nicht rueckgaengig gemacht
werden.

## Vorschau und fachliche Kontrolle

Die Schaltflaeche `Vorschau` oeffnet die Lesesicht des ACPs. Dort kontrollieren Sie, wie Inhalte
fuer Nutzerinnen und Nutzer praesentiert werden.

Auf der Startseite des ACPs finden Sie je nach Konfiguration:

- `ACP-Index`
- `Aufgaben`
- `Aufgabenfolgen`
- `Item-Liste`
- `Item-Explorer`
- `Downloads`
- `Kommentare`

Wenn Sie ACP-Manager sind, erscheint zusaetzlich `Zur Verwaltung`.

### Wichtiger Testhinweis

ACP-Manager und App-Admins koennen mehr sehen als normale Betrachter. Wenn Sie die
Nutzerperspektive pruefen moechten, testen Sie zusaetzlich:

- mit einem `READ_ONLY`-Konto oder
- mit ACP-Zugangsdaten bei `Zugangsliste`

## Aufgaben-Ansicht

In der Aufgabenansicht koennen Sie Units fachlich pruefen.

Wichtige Funktionen:

- Unit im Player anzeigen
- zwischen Seiten navigieren
- Metadaten, Kodierschema und RichText einblenden
- Kommentare schreiben, falls aktiviert
- Unit herunterladen, falls erlaubt
- Print-Modus ein- oder ausschalten

Das ist besonders hilfreich fuer die Endkontrolle nach Datei-Upload oder Index-Aenderungen.

## Item-Liste

Die `Item-Liste` bietet eine tabellarische Uebersicht ueber alle Items.

Moegliche Funktionen, je nach Feature-Konfiguration:

- filtern
- sortieren
- Tags anzeigen oder vergeben
- per Klick zur Aufgabe oder zur Item-Ansicht springen

Die Item-Liste eignet sich gut fuer:

- schnelle Vollstaendigkeitskontrolle
- Suche nach einzelnen Items
- einfache fachliche Sichtung nach Aufgabe oder Bezeichnung

## Item-Explorer

Der `Item-Explorer` ist die zentrale Arbeitsflaeche fuer detaillierte Item-Pruefung und
metadatenbezogene Bearbeitung.

### Was Sie dort tun koennen

- Items filtern und sortieren
- Metadaten-Spalten ein- oder ausblenden
- Reihenfolge manuell anpassen
- Tags pflegen
- empirische Itemschwierigkeiten per CSV importieren
- Player-Vorschau mit Item-Fokus pruefen
- Kodierung und Metadaten direkt neben dem Player einsehen
- Aenderungsverlauf einsehen

### Studio-Kommentare anzeigen

Unter `Zugriff & Funktionen` → `Item-Explorer` → `Inhalte und Darstellung` können
ACP-Manager `Studio-Kommentare im Item-Explorer anzeigen` einschalten. Die Einstellung
ist standardmäßig ausgeschaltet und unabhängig von der Freigabe für Review-Kommentare.

Voraussetzung ist ein Studio-Export einschließlich Kommentaren: Die Aufgaben-XML
verweist mit `UnitCommentsRef` auf die mit hochgeladene `.vouc`-Datei. Die dortigen
`itemUuids` müssen zu den UUIDs der Items in der `.vomd`-Datei passen.

Beim Auswählen eines Items erscheinen seine Kommentare und zugehörigen Antworten
oberhalb der Player-Vorschau in einem eigenen Abschnitt `Studio-Kommentare`. Die
Reihenfolge des Studio-Exports bleibt erhalten; im Studio ausgeblendete Kommentare
werden entsprechend gekennzeichnet. Ohne zugehörige Kommentare erscheint kein
Abschnitt. Die Hinweise sind ausschließlich lesbar und werden nicht in
Review-Kommentar-Threads übernommen. Ein neuer Upload aktualisiert die Hinweise.

### Entwurf und Veroeffentlichung

Der Explorer arbeitet mit einem Entwurfsmodell:

- `CLEAN`: kein unveroeffentlichter Unterschied
- `DIRTY`: es gibt Entwurfs-Aenderungen

Wichtige Schaltflaechen:

- `Speichern`: Aenderungen veroeffentlichen
- `Verwerfen`: unveroeffentlichte Aenderungen verwerfen

Vor dem Speichern zeigt die Anwendung eine Aenderungsuebersicht.

### Spalten verwalten

Ueber `Spalten verwalten` bestimmen Sie:

- welche fachlichen Spalten sichtbar sind
- in welcher Reihenfolge sie erscheinen
- welche Breite die einzelnen Spalten haben

Die Verwaltung umfasst feste Spalten wie `Item-ID` und `Aufgabe`, konfigurierte
Metadatenspalten sowie - falls aktiviert - `Tags`, `Kompetenzstufe (persönlich)`, `Markierungen`
und `Notiz`. Die gemeinsame, per CSV-Feld `kstufe` importierte Kompetenzstufe ist davon getrennt
und erscheint als fachliche Spalte `Kompetenzstufe`. Erlaubt sind die Werte `I` bis `V`.
Technische Bedienungsspalten wie die laufende Position oder die Auswahl
fuer eine Auswahlliste bleiben fest.

Diese Einstellungen werden veroeffentlicht und damit Teil der gemeinsamen ACP-Konfiguration.
Vorhandene reine Metadatenspalten-Konfigurationen werden weiterhin uebernommen.

### Tags verwalten

Wenn Tagging aktiviert ist, koennen Sie:

- vorhandene Tags auswaehlen
- neue Tags direkt am Item anlegen
- Tags wieder entfernen

### Empirische Itemschwierigkeiten importieren

Ueber `Item-Schwierigkeiten (CSV) hochladen` importieren Sie Schwierigkeitswerte.

Nutzen Sie diese Funktion, wenn empirische Daten in die fachliche Sichtung einfliessen sollen.
Nach dem Import erhalten Sie einen Bericht ueber erfolgreiche und fehlgeschlagene Zuordnungen.

Die Spalte `booklet` kann auch ohne `position` importiert werden. Neue Zuordnungen haben dann keine
bekannte Position. Ist dasselbe Booklet bereits mit einer Position gespeichert, bleibt diese beim
Import ohne Positionsangabe erhalten. Eine Position ohne Booklet wird nicht importiert; nach einer
Warnung koennen Sie den Import abbrechen oder nur die unabhaengigen Itemparameter uebernehmen.

### Player- und Antwortzustaende testen

Fuer vertiefte Pruefungen koennen Sie im Explorer:

- den aktuellen Zustand eines Items speichern
- einen gespeicherten Zustand zuruecksetzen
- Rohdaten aller gespeicherten Zustaende anzeigen

Das ist vor allem fuer Test- und Analysezwecke hilfreich.

### Hilfreiche Tastaturkuerzel

- `/` fokussiert den globalen Filter
- `Pfeil hoch/runter` bewegt die Auswahl
- `Pos1` / `Ende` springen an Anfang oder Ende
- `Strg/Cmd + S` oeffnet den Speicherdialog

## Review vorbereiten und starten

Die ACP-Uebersicht zeigt fuer Personen mit `Review: verwalten` eine eigene Review-Karte mit dem
aktuellen Aktivierungsstatus.

1. Oeffnen Sie die Review-Karte.
2. Waehlen Sie `Bereitschaft pruefen`.
3. Beheben Sie technische Blocker. Hinweise duerfen nach bewusster Bestaetigung bestehen bleiben.
4. Waehlen Sie die Kommentarsicht und konfigurieren Sie bei Bedarf Review-Gruppen.
5. Aktivieren Sie den Review und speichern Sie die Konfiguration.
6. Vergeben Sie unter den Personen oder ACP-Zugaengen die Berechtigung `Review: teilnehmen`.

Unter **Metadaten in der Prüfansicht** koennen Sie **Namen und Kürzel der
Aufgabenentwickler/innen ausblenden** aktivieren. Speichern Sie anschliessend die
Review-Konfiguration. In der Testheft-Pruefansicht wird das Metadatenfeld
`iqb_author` bzw. „Entwickler/in“ dann fuer alle Review-Teilnehmenden ausgeblendet.
Andere Metadaten bleiben sichtbar. Die Einstellung aendert die Anzeige; die
Metadatendateien und vorhandene Downloadrechte bleiben erhalten.

Bei mehrseitigen Aufgaben zeigt die Seitennavigation die aktuelle Seite und die
Gesamtzahl an. Sie folgt auch Seitenwechseln ueber Schaltflaechen innerhalb der Aufgabe.

Die Bereitschaftspruefung kontrolliert insbesondere Booklets, referenzierte Units,
Aufgabendefinitionen, Player sowie syntaktische und semantische Validierungsergebnisse. Sie ist
keine formale Release-Freigabe.

Teilnehmende sehen auf der ACP-Startseite eine Review-Karte. Dort oeffnen sie ein Testheft direkt im
Review-Arbeitsplatz mit Player und Reviewbereich. Eine zusaetzliche Review-Zwischenseite ist fuer
Teilnehmende nicht erforderlich.

`Review: verwalten` und `Review: teilnehmen` sind getrennte Berechtigungen. Review-Gruppen steuern
nur die Sichtbarkeit von Kommentaren und vergeben keinen Zugang.

## Kommentare und Exporte

Wenn Kommentare aktiviert sind, koennen angemeldete Nutzerinnen und Nutzer Kommentare im
jeweiligen fachlichen Kontext anlegen. Item-Kommentare werden beim ausgewaehlten Item im
Item-Explorer erfasst; Unit-Kommentare in der Ansicht der jeweiligen Unit.

Im Review-Arbeitsplatz kann unter `Kommentarziel` zwischen `Aufgabe`, `Item` und `Testheft`
gewechselt werden, soweit diese Ziele fuer den ACP aktiviert sind. Fuer `Item` waehlen Sie
anschliessend das gewuenschte Item der aktuellen Aufgabe aus. Die Auswahl zeigt die Item-ID
und, soweit vorhanden, die Bezeichnung. Nicht abgesendete Kommentare bleiben beim Wechsel
zwischen Items und Kommentarzielen erhalten. Ein separater Zugang zum Item-Explorer ist fuer
diese Kommentierung nicht erforderlich.

Auf der ACP-Startseite stehen dann typischerweise zur Verfuegung:

- ein Link zu den Item-Kommentaren im Item-Explorer, falls diese aktiviert sind
- `Kommentare exportieren (XLSX)`

Pruefen Sie vor der Freigabe:

- ob die gewuenschten Kommentarziele aktiviert sind
- ob der Export fuer den geplanten Review-Prozess ausreicht

## Empfohlener Standardablauf fuer ACP-Manager

1. ACP in `Verwalten` oeffnen.
2. Namen, Rollen und Ausgangskonfiguration pruefen.
3. Falls noetig Snapshot anlegen.
4. ACP-Index importieren oder kontrollieren.
5. Dateien oder ZIP hochladen.
6. Upload-Berichte und Validierung pruefen.
7. In `Zugriffskonfiguration` das gewuenschte Zugriffsmodell und die Features setzen.
8. In `Vorschau` Units, Item-Liste und Item-Explorer fachlich kontrollieren.
9. Falls genutzt: Explorer-Aenderungen veroeffentlichen.
10. Mit Testkonto oder Zugangsdaten die Zielperspektive pruefen.

## Typische Fehler vermeiden

- Nach Aenderungen in der Zugriffskonfiguration beide Speichern-Schaltflaechen nicht verwechseln.
- Vor grossen Importen immer einen Snapshot anlegen.
- Oeffentliche Freigabe erst nach erfolgreicher Dateipruefung vornehmen.
- Bei Dateikonflikten bewusst entscheiden, ob wirklich ersetzt werden soll.
- Endnutzer-Sicht nicht nur mit Managerkonto testen.

## Weiterfuehrende Dokumentation

- [ACP Workflows](../features/acp-workflows.md)
- [Access Control](../features/access-control.md)
- [Item Explorer](../features/item-explorer.md)
