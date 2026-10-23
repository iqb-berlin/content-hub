# Kommentarkategorien (#239)

Unter **Review → Vorbereitung** konfigurieren ACP-Manager bis zu 100 Kategorien
je ACP. Namen sind nach Entfernen äußerer Leerzeichen erforderlich, maximal
120 Zeichen lang und unabhängig von Groß-/Kleinschreibung eindeutig.

Jeder Kommentar und jede Antwort kann unabhängig eine optionale Kategorie
erhalten. Die Auswahl ist beim Anlegen und beim Bearbeiten eigener Kommentare
verfügbar. Bestehende Kommentare bleiben zunächst ohne Kategorie. Kategorien
ändern keine Zugangs-, Sichtbarkeits- oder Bearbeitungsrechte.

Kategorien besitzen stabile IDs. Umbenennen aktualisiert die Bezeichnung in
Kommentaransichten und zukünftigen Exporten. Archivieren erhält vorhandene
Zuordnungen; neue Zuordnungen zu archivierten Kategorien sind ausgeschlossen.
Beim Bearbeiten eines bereits zugeordneten Kommentars darf die archivierte
Kategorie erhalten bleiben oder entfernt werden. Reaktivieren macht sie wieder
wählbar. Löschen ist nur möglich, wenn auch keine logisch gelöschten Kommentare
mehr darauf verweisen.

Die Auswertung filtert nach Kategorie oder „Ohne Kategorie“. CSV- und XLSX-Exporte
enthalten **Kategorie (ID)** und **Kategorie**; ohne Zuordnung bleiben beide
Felder leer. Der Kategoriefilter gilt wie die übrigen Anzeigefilter für Exporte,
solange „Anzeigefilter beim Export ignorieren“ ausgeschaltet ist. Archivierte
Kategorien werden mit ihrer aktuellen Bezeichnung exportiert.

Exporte lesen Kommentare und Kategorien gemeinsam unter der ACP-Sperre. Dadurch
bleiben Zuordnungen und Bezeichnungen auch bei gleichzeitigem Entfernen oder
Löschen einer Kategorie konsistent. Die Sperre endet vor der Dateierzeugung.

Die Review-Konfiguration liefert und akzeptiert `categories` mit `id`, `name`
und `archived`; bei neuen Kategorien fehlt die ID. Entfernte IDs werden zusätzlich
in `deletedCategoryIds` gesendet. Konfigurationsänderungen verwenden die
vorhandene Versionsprüfung und dieselbe ACP-Sperre wie Kommentaränderungen.
Ältere Clients, die `categories` auslassen, erhalten die gespeicherte Liste.

Die Kommentar-API akzeptiert `categoryId` beim Anlegen und Bearbeiten. Beim
Bearbeiten bedeutet ein ausgelassenes Feld „Zuordnung beibehalten“, `null`
entfernt die Zuordnung. Thread-Snapshots liefern die Kategorienliste und
berücksichtigen deren Änderungen in ihrer Revision. Entwürfe bewahren die
Auswahl je Kommentarziel; wird eine gewählte Kategorie archiviert, bleibt der
Text erhalten und eine neue Auswahl ist vor dem Absenden erforderlich.

Migration `1789700000000-CommentCategories` ergänzt `comment_categories` an der
ACP-Konfiguration und die nullable `category_id` am Kommentar. Ein Rollback
verweigert das Entfernen der Spalten, solange Kategorien oder Zuordnungen
vorhanden sind.
