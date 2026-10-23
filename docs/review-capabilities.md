# ACP-Berechtigungen und Zugangsliste (#60)

Die vier Grants sind ACP-bezogen und werden als explizite JSON-Arrays an
`acp_user_roles` bzw. `acp_credentials` gespeichert. Leere Arrays sind gültig.
`review:manage` impliziert keine Teilnahme; `item-explorer:edit` umfasst Lesen.
Grants ändern die allgemeine ACP-Rolle nicht. ACP-Manager verwalten weiterhin
Dateien, Rollen und Zugangsdaten. App-Admins besitzen einen administrativen
Management-Override, zum Kommentieren benötigen auch sie einen Teilnahme-Grant.

## Migration

`1789200000000-AcpCapabilityGrants` migriert bestehende ACP-Manager auf alle vier
Grants. READ_ONLY und Credentials erhalten Teilnahme bei bisher aktivierter
Kommentierung sowie Explorer-Lesen bei aktivem Item Explorer. Ein nicht gesetztes
`enableItemList` entspricht dem bisherigen Standard `true`. Neue Zuordnungen und
Credentials erhalten standardmäßig **keine** Grants. Der neue Review-Einstieg wird
für alle bestehenden ACPs deaktiviert und muss bewusst aktiviert werden.

Vor dem Release Datenbanksicherung und Migrationsprobe vorsehen. Die Migration
wurde lokal gegen eine separate PostgreSQL-Datenbank getestet. Ein Rollback der
Migration entfernt die Grant-Spalten; die vorherige Software verwendet wieder ihr
breiteres Rollenmodell. Ein Rollback ist daher kein Ersatz für einen Rechteentzug.

## Zugriff

- Explorer-Endpunkte für Daten, Zustand, Präferenzen und persönliche Listen prüfen
  Lesen. Änderungen am gemeinsamen Explorer (einschließlich Tags, Antwortzuständen,
  Importparametern und Entwürfen) prüfen Bearbeiten.
- `enableItemList=false` sperrt Explorer-Zugriffe für Teilnehmer auch bei vorhandenen
  Lese-/Bearbeitungs-Grants. Die Grants bleiben gespeichert und werden nach erneuter
  Aktivierung wieder wirksam. ACP-Manager und App-Admins behalten ihren bisherigen
  Verwaltungszugriff.
- Persönliche Präferenzen und Listen bleiben mit Lesezugriff bearbeitbar.
- Review-Lesen erfordert Teilnahme oder Management; eigene Mutationen erfordern
  Teilnahme. Ownership-Prüfungen bleiben bestehen.
- `/view/acp/:acpId/review` liefert alle Booklets des ACP über das Manifest aus #59.
  `/view/:acpId/review` bietet den Einstieg und die Aktivierung für Verantwortliche.
- Bestehende Kommentar-APIs einschließlich `/comments` bleiben verfügbar, prüfen
  aber explizite Review-Grants. Bestehende Kommentierungs-Features bleiben getrennt
  von der Aktivierung des neuen Review-Einstiegs: Item-/Aufgabenkommentare bleiben
  mit `enableCommenting=true` und Teilnahme-Grant auch bei `enableReview=false`
  nutzbar, insbesondere für ACPs ohne Testheft. Der Booklet-Einstieg und Abstimmungen
  benötigen weiterhin die Review-Aktivierung.
- Öffentliche Explorer-Lesezugriffe bleiben bestehen. Auf einem öffentlichen ACP
  kann ein Nutzer daher auch ohne persönlichen Explorer-Grant öffentlich lesen.
- Gemeinsame ACP-Inhalte (Index, Booklets, Player-Dateien) bleiben über die
  allgemeinen ACP-Lesepfade verfügbar; der Review benötigt diese Inhalte ebenfalls.
- Grants werden serverseitig aus der Datenbank gelesen. Entzug und gelöschte
  Credentials wirken bei der nächsten Anfrage auch mit bereits ausgestellten Tokens.

## Import

`POST /api/acp/:id/access/credentials/file` erhält multipart `file`, `profile`
und optional ein JSON-Array als Textfeld `capabilities`. Queryparameter:
`mode=replace|append|upsert`, optional `preview=true`. Maximale Dateigröße: 1 MiB.

UTF-8 mit optionaler BOM, LF/CRLF/CR, Komma/Semikolon/Tab, CSV-Quoting einschließlich
escaped quotes und mehrzeiliger Felder werden unterstützt. Optionale Header:
`username`, `user`, `benutzername`, `nutzername` und `password`, `passwort`, `kennwort`,
auch in umgekehrter Reihenfolge. Nutzernamen werden getrimmt und bleiben wie bisher
case-sensitive; Passwörter werden nicht getrimmt. Die bestehende Passwortstärke
(mindestens zwölf Zeichen, Groß-/Kleinbuchstaben, Zahl, Sonderzeichen) bleibt Pflicht.

Profile:

| Profil | Grants |
| --- | --- |
| REVIEW_ONLY | review:participate |
| ITEM_EXPLORER_ONLY | item-explorer:view |
| BOTH | review:participate, item-explorer:view |
| CUSTOM | ausdrücklich gewählte Grants, auch keine |

Fehler und doppelte Nutzernamen verwerfen die gesamte Datei vor Änderungen.
Die Vorschau enthält nur Nutzernamen, Aktionen, alte/neue Grants und Löschkandidaten.
Sie reserviert keinen Datenbankstand; beim Import wird erneut geprüft.

`append` überspringt bestehende Nutzer vollständig. `upsert` aktualisiert Passwort
und ersetzt deren Grants durch das gewählte Profil. `replace` verfährt ebenso und
löscht zusätzlich nicht enthaltene Zugänge. Wiederverwendete Nutzernamen behalten
in allen Modi ihre Credential-ID. Passwort-Hashes und Grants werden in derselben
Transaktion gespeichert; Imports desselben ACP werden serialisiert.

Der bisherige JSON-Import bleibt kompatibel: Fehlt dort eine Profil-/Grant-Angabe,
bleiben bestehende Grants erhalten, neue Zugänge erhalten keine. Neue Clients
sollten immer ein Profil oder explizite Grants mitsenden.

## Validierung

Unit-Tests decken alle 16 Grant-Kombinationen für OIDC-Nutzer und Credentials,
Parserfehler, öffentliche Zugriffe, Admin-Semantik und Rechteentzug ab. Die
API-Integrationstests in `backend/test/capabilities.e2e-spec.ts` prüfen dieselbe
Matrix mit echten Guards, Controllern und PostgreSQL sowie Import und Migration.
Nur gegen eine isolierte Testdatenbank ausführen; die Tests erzeugen Testdaten.

## Upgrade mit Schemasynchronisierung

Beim Entwicklungsstart mit `DB_SYNCHRONIZE=true` werden bestehende Rollen- und
Credential-Grants beim erstmaligen Anlegen der jeweiligen Capability-Spalte
übernommen. Die Kommentarziele werden vor der Schemasynchronisierung nach den
Migrationsregeln zugeordnet. Scheitert diese Vorbereitung, wird sie vollständig
zurückgerollt. Nachfolgende Starts überschreiben keine bewusst geleerten Grants
und keine vorhandene `enableReview`-Einstellung. Review-Revisions- und
Vote-Cleanup-Trigger werden auch für neu synchronisierte Datenbanken installiert.

Bereits durch einen früheren Synchronisierungsstart erzeugte leere Grants lassen
sich nicht von bewusst entzogenen Rechten unterscheiden. Sie werden daher nicht
nachträglich automatisch aufgefüllt; betroffene Zugänge müssen anhand der vorherigen
Berechtigungen geprüft und explizit freigegeben werden.

`backend/test/synchronize-upgrade.e2e-spec.ts` prüft das Upgrade vom Schema 0.5.0,
den Fehler-/Rollback-Pfad und einen erneuten Start nach Rechteentzug. Der Test
benötigt eine isolierte PostgreSQL-Testinstanz und ein Testkonto mit `CREATEDB`;
er erzeugt und entfernt eine eigene Datenbank.
