# Review-Verwaltung

## Filter und Export

Die Auswertung kombiniert Textsuche im Kommentar (Groß-/Kleinschreibung wird
ignoriert), exakte Autorenbezeichnung, Zieltyp und Review-Gruppe. `ungrouped`
bezeichnet Kommentare ohne Gruppe. Gleichnamige Autoren werden gemeinsam gefiltert.

Die Export-Endpunkte `export/mine.csv`, `export/mine.xlsx` und
`export/visible.xlsx` akzeptieren `q`, `author`, `targetType` und `groupId` als
optionale Query-Parameter. Die Filter werden erst nach Ermittlung der erlaubten
Kommentare angewendet. Persönliche Exporte bleiben persönlich. Standardmäßig
sendet die Oberfläche ihre Anzeigefilter; die ausdrückliche Option zum Ignorieren
der Filter lässt sie weg. Der Export liest aktuelle Daten, daher können inzwischen
neu eingegangene Kommentare hinzukommen.

## Letzte Bereitschaftsprüfung

Migration `1789600000000-ReviewReadinessSnapshots` ergänzt die Tabelle
`review_readiness_snapshots` (ein Ergebnis pro AP, Löschung zusammen mit dem AP).
`POST /api/view/ap/:apId/review/readiness` prüft und speichert;
`GET` liefert das letzte Ergebnis mit aktuell berechnetem `stale`-Kennzeichen.
Beide Endpunkte benötigen `review:manage`.

Der Fingerabdruck umfasst die kanonisch sortierte Paketstruktur, Dateikatalog
(einschließlich Prüfsummen), Dateipfade, Dateigröße und Änderungszeiten auf dem
Dateisystem sowie `rulesVersion` im Readiness-Service. Validierungsergebnisse
selbst gehören nicht zum Fingerabdruck, damit die Prüfung sich nicht selbst
ungültig macht. Änderungen während der Prüfung machen das Ergebnis ebenfalls
veraltet. Bei Änderungen der Prüfregeln oder ihrer Abhängigkeiten **rulesVersion
erhöhen**. Der Fingerabdruck ersetzt keine laufende Integritätsprüfung der Dateien.

Die Oberfläche lädt den letzten Stand beim Öffnen und überprüft seine Aktualität
alle 30 Sekunden. Dabei findet keine vollständige Validierung statt. Ein alter
Status wird als erneuter Prüfbedarf angezeigt, ein Ladefehler als unbekannte
Aktualität. Aktivieren prüft weiterhin frisch; ein währenddessen veraltetes
Ergebnis erlaubt keine Aktivierung.

Rollback der Migration entfernt nur die gespeicherten Prüfergebnisse. Die vorige
Anwendungsversion benötigt diese Tabelle nicht. Migration vor dem Start der neuen
Backend-Version ausführen, sofern automatische Migrationen deaktiviert sind.

## Gruppen löschen

Neue Gruppen können vor dem Speichern verworfen werden. Zum Löschen gespeicherter
Gruppen entfernt der Client sie nach Bestätigung aus `groups` und übermittelt ihre
IDs zusätzlich in `deletedGroupIds`. Erst Speichern führt die Löschung aus.

Der Server sperrt die AP-Konfiguration wie beim Schreiben von Review-Kommentaren,
prüft die Konfigurationsversion und zählt alle Kommentare der entfernten Gruppe,
auch solche mit `deleted_at`. Nur Gruppen ohne Kommentare dürfen verschwinden.
Gruppen mit Verlauf werden archiviert; es findet keine Umgruppierung oder Löschung
von Kommentaren statt. Bei einem Speicherfehler stellt die Oberfläche vorgemerkte
Gruppen wieder her, damit sie z. B. stattdessen archiviert werden können.
