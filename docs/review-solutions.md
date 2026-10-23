# Musterlösung und Kodierinformation im Booklet-Review

Refs #228 und #238.

Mit **Musterlösung anzeigen** wird eine aus dem Kodierschema ableitbare Lösung
im Aufgabenplayer eingeblendet. Der Reviewbereich öffnet dabei den Reiter
**Kodierung** mit dem Ergebnis und den zugehörigen Anweisungen. Beim Ausblenden
werden die zuvor vom Player gemeldeten eigenen Eingaben und die aktuelle Seite
wiederhergestellt. Eingaben im Lösungsmodus verändern diesen vorherigen Stand
nicht. Ein Aufgabenwechsel beendet den Lösungsmodus und verwirft den lokalen
Antwortpuffer der vorherigen Aufgabe. Es werden keine Antworten gespeichert.

Die Ableitung verwendet denselben konservativen Resolver wie der Item-Explorer:
Ein ausdrücklich markierter FULL_CREDIT-Code, eine eindeutig darstellbare Antwort
und eine erfolgreiche Rückprüfung mit dem Kodierschema sind erforderlich.
Zusätzlich wird die Kombination der Teilantworten für die ganze Aufgabe geprüft.
Widersprüchliche Antworten werden nicht eingeblendet. Die Originaldefinition und
ihre Sichtbarkeitsbedingungen bleiben aktiv.

Nicht alle Antwortformate erlauben eine sichere automatische Vorgabe. Bei einer
teilweise ableitbaren Lösung nennt die Oberfläche die Anzahl der unterstützten
Kodiervariablen und die übrigen Variablen. Im Lösungsmodus werden ausschließlich
die geprüften Antworten vorgegeben. Bei ausschließlich manueller Kodierung,
mehrdeutigen Lösungen oder nicht unterstützten Formaten verweist die Oberfläche
auf die vorhandenen Anweisungen, ohne den Player neu zu starten.

Der Reiter **Kodierung** zeigt Variablen-ID und Bezeichnung, Herkunft und
Vorverarbeitung, allgemeine Variablenanweisungen, Code-Bezeichnungen, Punkte,
manuelle Kodieranweisungen und ausgeschriebene Regeln einschließlich ihrer
Verknüpfung. Manuelle Texte bleiben auch bei Kodiervariablen mit Alias erhalten.
Die Suche berücksichtigt auch diese Texte und Regeln. Die bestehende natürliche
Sortierung und das Ausblenden von Audio-/Video-Variablen bleiben bestehen.

Die automatisierte Prüfung verwendet synthetische Antwortdefinitionen und
Kodierschemata. Komponententests prüfen das Puffern inkrementeller Antwortteile,
Zeitstempel, veraltete Sitzungen, Wiederherstellung und Aufgabenwechsel. Die
Browserprüfung deckt den Booklet-Ablauf einschließlich offener Antwortformate,
Teilmusterlösung und mobiler Anzeige in Chromium, Firefox und WebKit ab.
