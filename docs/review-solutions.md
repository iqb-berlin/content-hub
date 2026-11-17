# Musterlösung und Kodierinformation im Booklet-Review

Refs #228, #238, #285 und #290.

Mit **Musterlösung anzeigen** wird eine aus dem Kodierschema ableitbare Lösung
im Aufgabenplayer eingeblendet. Der Reviewbereich öffnet dabei den separaten Bereich
**Kodierung** mit dem Ergebnis und den zugehörigen Anweisungen. Der ausgewählte
Reiter und begonnene Kommentare bleiben erhalten. Beim Ausblenden
werden die zuvor vom Player gemeldeten eigenen Eingaben und die aktuelle Seite
wiederhergestellt. Eingaben im Lösungsmodus verändern diesen vorherigen Stand
nicht. Bei noch nicht gemeldeten Eingaben wartet die Umschaltung auf einen
aktuellen Antwortstand des Players. Dies gilt auch nach abgeschlossenen
Ziehbewegungen, die kein normales Eingabeereignis auslösen. Bleibt die Meldung
aus, bleibt der eigene Player erhalten und die Oberfläche bietet einen erneuten
Versuch an.
Abschließende Entlademeldungen werden nur über die genaue Fenster- und
Sitzungskennung des bisherigen Players übernommen. ISO-Zeitstempel und
numerische Millisekunden-Zeitstempel werden unterstützt.

Ein Aufgabenwechsel beendet den Lösungsmodus und verwirft den lokalen
Antwortpuffer der vorherigen Aufgabe. Es werden keine Antworten gespeichert.
Die Druckansichten von ASPECT berücksichtigen keine Antwortwerte. Daher ist
der Musterlösungs-Schalter dort deaktiviert. Ein Wechsel in die Druckansicht
beendet den Lösungsmodus; Druckzustände überschreiben keine eigenen Antworten.

Die Ableitung verwendet denselben konservativen Resolver wie der Item-Explorer:
Ein ausdrücklich markierter FULL_CREDIT-Code, eine eindeutig darstellbare Antwort
und eine erfolgreiche Rückprüfung mit dem Kodierschema sind erforderlich.
Zusätzlich wird die Kombination der Teilantworten für die ganze Aufgabe geprüft.
Widersprüchliche Antworten werden nicht eingeblendet. Die Originaldefinition und
ihre Sichtbarkeitsbedingungen bleiben aktiv.

Bei unterstützten Drag-and-drop-Aufgaben werden die Paletten und Zielfelder
gemeinsam vorbereitet. Ein verschobenes Objekt wird aus seiner Palette entfernt;
ausdrücklich kopierbare Objekte bleiben dort verfügbar. Auch über mehrere
Kodiervariablen hinweg darf ein nicht kopierbares Objekt nur einmal belegt werden.
Einzel- und Summenvariablen mit derselben Listenantwort werden zusammengeführt.
Widersprüchliche Belegungen verweisen auf die Kodieranweisungen. Beim Ausblenden
der Musterlösung wird der vollständige vorherige eigene Zustand wiederhergestellt.

Nicht alle Antwortformate erlauben eine sichere automatische Vorgabe. Bei einer
teilweise ableitbaren Lösung nennt die Oberfläche die Anzahl der unterstützten
Kodiervariablen und die übrigen Variablen. Im Lösungsmodus werden ausschließlich
die geprüften Antworten vorgegeben. Bei ausschließlich manueller Kodierung,
mehrdeutigen Lösungen oder nicht unterstützten Formaten verweist die Oberfläche
auf die vorhandenen Anweisungen, ohne den Player neu zu starten.
Schaltflächen-Gruppen werden über die Kodierinformation erläutert; eine skalare
Antwortvorgabe wird dafür im Review nicht verwendet, weil sie im geprüften
ASPECT-Player nicht zuverlässig dargestellt wird.

Mit **Kodierung anzeigen** lässt sich der standardmäßig geschlossene Bereich unabhängig
von den Reitern **Kommentare** und **Metadaten** öffnen. Kodierung und Kommentare
sind gleichzeitig sichtbar und auf großen Bildschirmen getrennt scrollbar. Auf
schmalen Bildschirmen stehen sie untereinander; die Kodierung behält eine begrenzte
Scrollfläche. **Kodierung ausblenden** schließt nur die Kodierinformation und erhält
Kommentarentwürfe und den eingegebenen Suchbegriff.
Beim Einblenden bleibt das zuletzt verwendete Kommentarfeld auch mit Kategorie-
und Gruppenauswahl sichtbar. Falls nötig, wird die Scrollposition nach der
Layoutänderung angepasst; der Fokus bleibt auf der betätigten Schaltfläche.

Der Bereich **Kodierung** ermittelt Teilaufgabennummern lesend aus unterstützten
ASPECT-Definitionen. Der Adapter prüft den Definitionstyp und die genaue
VOUD-Version. Unterstützt werden 4.6.0, 4.7.0, 4.8.0, 4.9.0, 4.10.0, 4.11.0
und 4.12.0: die automatische Abschnittsnummerierung seit ASPECT 2.5 bis 2.12.6
sowie 3.0.1. Das sind Definitionsversionen, keine Player-Versionsnummern.
Ältere Formate vor dieser Automatik (z. B. ASPECT 2.4), unbekannte zukünftige
Versionen und deaktivierte Nummerierung liefern keine abgeleitete Nummer.
Der Lückentext-Parser unterscheidet die Modellformen: `Checkbox` wird in allen
unterstützten Formaten gelesen, der Lückentext-Knotentyp `Dropdown` erst in
4.12.0 (ASPECT 3.0.1). Die Knotentypen sind mit den Modellen von
[ASPECT 2.12.6](https://github.com/iqb-berlin/verona-modules-aspect/blob/b281f3353ee12b3d70d48cdca4a441d569f6763b/projects/common/models/elements/compound-elements/cloze/cloze.ts)
und [3.0.1](https://github.com/iqb-berlin/verona-modules-aspect/blob/editor/3.0.1%2Bplayer/3.0.1/projects/common/models/elements/cloze.ts)
abgeglichen.

Die Antwortkennungen werden ebenfalls versionsabhängig gelesen: ASPECT 2.5
(VOUD 4.6.0) verwendet nur interne IDs; ein zusätzlich gespeicherter Alias wird
wie im Player ignoriert. Ab 2.6 (4.7.0) gibt es getrennte Aliasse. Bei vollständigen
2.x-Modellen fällt ein leerer Alias auf die ID zurück; bei unvollständigen
Modellen wird kein generierter Alias geraten. ASPECT 3.0.1 (4.12.0) behält einen
explizit leeren Alias bei. Likert-Zeilen erhalten ihren Modelltyp aus dem
Zeilenkontext, auch wenn die gespeicherte Zeile kein `type` enthält.
Geometrie-Antworten werden aus Elementkennung und überwachtem Variablennamen
gebildet und nehmen an derselben ID-/Alias-Konfliktprüfung teil. Bis 2.10
(4.9.0) sind die überwachten Namen Strings; ab 2.11 (4.10.0) werden zusätzlich
Objekte und erwartete Variablen berücksichtigt, mit Deduplizierung desselben
Geometrie-Variablennamens. Nicht lesbare Geometriekennungen liefern keine
abgeleiteten Nummern. Die Regeln folgen den Element-/Geometriemodellen von
[2.5.0](https://github.com/iqb-berlin/verona-modules-aspect/blob/editor/2.5.0%2Bplayer/2.5.0/projects/common/models/elements/geometry/geometry.ts),
[2.6.4](https://github.com/iqb-berlin/verona-modules-aspect/blob/editor/2.6.4%2Bplayer/2.6.4/projects/common/models/elements/element.ts),
[2.11.6](https://github.com/iqb-berlin/verona-modules-aspect/blob/38d561bfc573c5e9e99b43006ecb99309ebfa0b3/projects/common/models/elements/geometry/geometry.ts)
und [3.0.1](https://github.com/iqb-berlin/verona-modules-aspect/blob/editor/3.0.1%2Bplayer/3.0.1/projects/common/models/elements/element.ts).

Gezählt werden die nicht ausgenommenen Abschnitte über alle normalen Seiten;
dauerhaft sichtbare Stimulus-Seiten zählen nicht mit. Sichtbarkeitsregeln ändern
den Zähler nicht. Eine Basisvariable im nummerierten Abschnitt erhält dessen
Nummer, sofern interne ID und öffentlicher Antwortalias denselben eindeutigen
VOUD-Knoten bestätigen. Widersprüchliche oder doppelte Aliasse sowie doppelte
interne Kodier-IDs liefern keine Nummer. Das gilt auch für Quellvariablen
abgeleiteter Kodierungen. Bei älteren Kodierschemata ohne getrennte interne ID
bleibt eine eindeutige Zuordnung über die öffentliche Kennung möglich.
Für ausgenommene Antwortabschnitte wird nur das am Original DHV004 aus
#290 geprüfte Audio-Muster unterstützt: genau ein nummerierter Abschnitt auf
der Seite, nur Audio/Schaltflächen in diesem Abschnitt, unmittelbar danach der
Antwortabschnitt und genau eine Freigaberegel „dieses Audio > 0“.
Bloße Nachbarschaft, Rich-Text-Überschriften, IDs und Tabellenpositionen reichen
nicht aus. Der Adapter interpretiert keine beliebigen Sichtbarkeitsbeziehungen
als fachliche Zuordnung. Abgeleitete Variablen erhalten eine Nummer nur, wenn
alle internen Quellvariablen eindeutig dieselbe Nummer liefern; fehlende,
seitenübergreifend gemischte oder zyklische Quellen liefern keine Nummer.

Die Zählregeln wurden gegen den Quellcode von ASPECT
[2.5.0](https://github.com/iqb-berlin/verona-modules-aspect/blob/editor/2.5.0%2Bplayer/2.5.0/projects/player/src/app/components/section/section.component.ts),
[2.11.6](https://github.com/iqb-berlin/verona-modules-aspect/blob/38d561bfc573c5e9e99b43006ecb99309ebfa0b3/projects/player/src/app/components/section/section.component.ts)
und [2.12.6](https://github.com/iqb-berlin/verona-modules-aspect/blob/b281f3353ee12b3d70d48cdca4a441d569f6763b/projects/player/src/app/components/section/section.component.ts)
geprüft. Die Regression für #290 enthält eine strukturelle Projektion des
Originalpakets: alle Seiten und Abschnitte, Nummerierungsflags, Freigaberegeln
und Antwortkennungen bleiben erhalten; Medien, Aufgabentexte und Gestaltung
sind entfernt. VOMD-Beschreibungen bleiben `null`, Kodierlabels leer und
Indexnamen wie `05` unverändert. Erwartet wird ausdrücklich `05` → `4.`.

Ohne sicher ableitbare Nummer werden vorhandene Item-/Kodierbezeichnungen oder
„Kodierung ohne Bezeichnung“ angezeigt. Zusätzliche Bezeichnungen stehen als
Untertitel neben einer ermittelten Nummer. Eine eindeutig zugeordnete
Itembeschreibung aus einer vollständigen VOMD-Vorschau hat Vorrang vor dem
Itemnamen im AP-Index. Die Vorschau ist auf 20 Items begrenzt; bei größerem
`itemCount` wird sie nicht als vollständige Quelle für Bezeichnungen verwendet.
Die Zuordnung nutzt `variableReadOnlyId` als interne ID; ohne diese Referenz
werden `sourceVariable` beziehungsweise `variableId` zuerst als Alias und danach
als interne ID aufgelöst. Eine unbekannte angegebene interne ID wird nicht durch
einen Alias ersetzt. Widersprüchliche oder unvollständige Beschreibungen fallen
auf die Kodierbezeichnung zurück. Technische Kennungen werden nicht als
Bezeichnungen verwendet; eine explizite VOMD-Beschreibung darf der Item-ID gleichen.

Gleiche Überschriften erhalten einen eindeutigen Zusatz, mit dem Quellen in
abgeleiteten Kodierungen den Kodierkarten zugeordnet werden können. Bei Formeln
steht die Zuordnung der Platzhalter zu den Karten unter dem Ausdruck. Hinweise
auf Kodiervariablen ohne eindeutige Player-Lösung verwenden den Alias
beziehungsweise die ID der Kodierkarte; Quellenverweise werden zuerst über die
interne ID aufgelöst. Die Suche berücksichtigt die angezeigten Bezeichnungen,
Anweisungen und Kodierregeln. Audio- und Video-Variablen bleiben ausgeblendet.

Die Anzeige wird beim Eintreffen der VOUD oder vollständiger VOMD-Metadaten
aktualisiert und benötigt keine Player-Bereitschaft. Der ASPECT-Adapter arbeitet
ohne Browser-Globals und ohne DOM-Analyse. Die Original-VOUD wird weder
verändert noch neu serialisiert, sondern unverändert an den Player übergeben.
Paging- und Druckmodi beeinflussen die Nummern nicht. Andere Player verwenden
weiterhin die vorhandenen Bezeichnungen; die VOUD-Auswertung ist ASPECT-spezifisch.

Die automatisierte Prüfung verwendet synthetische Antwortdefinitionen und
Kodierschemata. Komponententests prüfen das Puffern inkrementeller Antwortteile,
Zeitstempel, veraltete Sitzungen, ausstehende Antwortmeldungen, abschließende
Entlademeldungen, Druckansichten, Wiederherstellung und Aufgabenwechsel. Die
Browserprüfung deckt den Booklet-Ablauf einschließlich offener Antwortformate,
Teilmusterlösung und mobiler Anzeige in Chromium, Firefox und WebKit ab.
