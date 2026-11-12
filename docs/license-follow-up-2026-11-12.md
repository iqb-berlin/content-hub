# Lizenznachverfolgung vom 12. November 2026

Diese Änderungen setzen die technischen Maßnahmen aus der Bewertung der 141
Prüfpunkte vom 3. November um. Der damalige Bericht und seine Evidenz bleiben
unverändert. Er bezog sich auf
`d4b239c19a5bf6a33bd98d0d557a9e6e12e4ad48`.

Die Änderungen dieses Follow-ups basieren auf dem aktuellen `master`-Stand
`4ecc6383bbc2b14817b0611ead46dc5c4d11d03b`, im Branch
`fix/license-notice-follow-up`. Der alte Compliance-Branch wurde nicht in
`master` integriert. Insbesondere sind die dort vorbereiteten Release-Prüfungen
und Projekt-Lizenzkopien im aktuellen `master` nicht vorhanden. Die alte
Prüfung wird deshalb nicht als Rechtefreigabe für den heutigen Gesamtstand
wiederverwendet.

## Umgesetzt

### Keycloak: zwei Datei-Änderungshinweise und lokale Lizenzbeilage

`keycloak/themes/iqb-theme/login/login.ftl` und `template.ftl` tragen jetzt
ausdrückliche, nicht gerenderte FreeMarker-Kommentare über ihre Anpassungen für
IQB ContentPool / Content Hub. Die Formular- und Layoutlogik wird dabei nicht
geändert. Die Hinweise betreffen Apache-2.0 Ziffer 4(b).

Der vollständige Apache-2.0-Text liegt jetzt direkt im Theme unter
`keycloak/themes/iqb-theme/LICENSE.txt`. `NOTICE.md` daneben dokumentiert die
belegten Vergleichsquellen und trennt diese von der nicht rekonstruierten
ursprünglichen Versionsherkunft. Die bestehende ALTCHA-MIT-Beilage bleibt
daneben bestehen. Es wird keine Fremdurheberschaft des lokalen Projekts
behauptet und keine neue Lizenz für das Gesamtprojekt festgelegt.

Das Runtime-Archiv übernimmt das gesamte `keycloak`-Verzeichnis; die neuen
Dateien werden daher mit dem Theme ausgeliefert. Der aktuelle Keycloak-24.0.1-
Quellbaum enthält keine Root-NOTICE-Datei. Eine entfernte Copyright-Kopfzeile
der verglichenen FTL-Dateien wird nicht behauptet.

Betroffene ursprüngliche IDs:

- `scanoss:5d36fb6fd43a0dc67a7597d6`
- `scanoss:f50ad72716451fe51284962e`

Die beiden konkreten Pflichtmängel sind in diesem Änderungsvorschlag technisch
behoben. Die Feststellung zum unveränderten historischen Commit bleibt bestehen.
Maßstab: [Apache License 2.0, Ziffer 4](https://www.apache.org/licenses/LICENSE-2.0).

### ASPECT: Testdatei im Quellrepository, kein fest eingebauter Player

Content Hub lädt den Player dynamisch über die `PLAYER`-Abhängigkeit der jeweiligen
Aufgabe und deren `downloadUrl`. Das gilt sowohl für die Aufgabenansicht als auch
für die Vorschau im Item Explorer. Es gibt keine fest eingebaute ASPECT-Version
für den Produktivbetrieb.

Die Datei unter `test-fixtures/synthetic-aspect/` dient den Browser-Tests und ist
im Git-Repository versioniert. Das geprüfte Runtime-Archiv enthält sie nicht;
der Archivbau übernimmt dieses Verzeichnis nicht. Der Angular-Build übernimmt
als statische Assets nur `frontend/public`, und die produktiven Docker-Stufen
übernehmen die gebauten Anwendungen. Der hier beschriebene ASPECT-Prüfpunkt
betrifft deshalb die weitergegebene Testdatei im Quellrepository, nicht einen
zwangsläufig mit Content Hub ausgelieferten Runtime-Player.

Das offizielle Release-Asset wurde direkt heruntergeladen. Seine 3.719.915 Bytes
sind identisch zur lokalen Fixture. SHA-256:
`54ee0f792c105c933b1c811ded0ee54eefae8502fa690edb18f6dd0b71c803c2`.
Die GitHub-Asset-Metadaten nennen denselben Hash. Der Release-Tag wurde auf
`b964ba086519cdbc04903f18c36f874f2067f0cd` aufgelöst; Originalmetadaten,
Quellbaum, Buildskript und Packer wurden gesichert.

Damit ist die bislang offene Bytevergleichsfrage erledigt. Der vollständige
Notice-Nachweis ist weiterhin offen: Das Release enthält nur Editor-/Player-
HTML-Assets, der untersuchte Quellbaum keinen vollständigen ASPECT-Lizenztext.
Die MIT-Deklaration in den Verona-Metadaten ist belegt. Das Buildskript packt
JS/CSS und Assets, fügt aber keine gesonderte vollständige Notice-Sammlung in
das HTML ein. Eine vollständige Beilage darf daraus nicht behauptet werden.

Die Journey-Dokumentation wurde berichtigt und
`test-fixtures/synthetic-aspect/rights-review.json` hält den offenen Zustand
explizit fest. Die Playerbytes wurden nicht verändert. Dies betrifft
`scancode:79c1d876d463876db2bf08c4`.

## Download-Helfer: zusätzliche lokale Vorgeschichte gefunden

Der Nutzer hat angegeben, keinen Entwicklungs-Chat oder anderen
Herkunftsnachweis zu besitzen. Unabhängig davon wurde die Git-Vorgeschichte
über die neu angelegte Helferdatei hinaus geprüft.

Bereits im lokalen Commit
`cb38150853f3c9929c5d822ee50d4d1ffa3f4c17` vom **15. Juli 2026** enthält
`item-explorer.facade.ts` an drei Stellen denselben Download-Grundablauf mit
`URL.createObjectURL(blob)`, `const anchor`, `href`, `download`,
`document.body.appendChild(anchor)`, `anchor.click()`, Entfernung des Anchors
und `URL.revokeObjectURL(url)`. Die damaligen Zeilenbereiche sind 3209–3216,
3245–3252 und 4589–4596. Der konkrete gemeldete `okto-pulse`-Dateipfad ist nach
seiner gesicherten Historie erst seit **23. August 2026** vorhanden.

Der Helfer vom 22. September verallgemeinert diesen schon lokal vorhandenen
Ablauf. Gegenüber den alten lokalen Stellen kommen vor allem der Parameter
`filename` und die garantierte Bereinigung in `finally` hinzu; `anchor.remove()`
ersetzt `document.body.removeChild(anchor)`. Diese zusätzliche lokale Evidenz
fehlte in der ersten Betrachtung, die nur die neue Helferdatei verfolgt hatte.

Für `scanoss:9998b729357fad090936b692` lautet die aktualisierte technische
Bewertung deshalb **nach verfügbarer Evidenz kein Verstoß erkennbar**. Sie
beruht auf konkreten früheren lokalen Implementierungen und dem begrenzten
zusätzlichen API-/Cleanup-Gerüst. Eine unabhängige Rechtekette der gesamten
älteren Entwicklung ist damit nicht bewiesen; die menschliche Entscheidung
bleibt offen. Es wird keine bekannte Übernahme aus `okto-pulse` behauptet und
keine vorsorgliche Fremdattribution erfunden. Der Helfer wurde nicht umgeschrieben.

## Ausgangsstand der weiteren Nachverfolgung

Zum Zeitpunkt des ersten Follow-ups wurden die neun nicht verfügbaren Originaldateien über die exakten
Dateiadressen, Versionsabfragen und Repository-Suchen geprüft. Sie sind weiter
nicht erreichbar. Namensgleiche, aber nicht belegbar identische Repositories
wurden nicht als Ersatz verwendet. Damit bleiben **17 IDs** ungeklärt,
einschließlich aller sieben ursprünglichen offenen Baseline-Referenzen:

| Gegenstand | Ungeklärte IDs |
|---|---|
| EdraVault AppModule | `baseline:4` |
| dhanam Review-Access-Test | `baseline:12` |
| ZephixPlatform DataSource | `scanoss:3ab0b24d9b1afdfe316c8e1e`, `baseline:16` |
| ZephixPlatform Audit-Migration | `scanoss:e41878c382c90ef92b1cf835`, `baseline:29` |
| ninjabackup SnapshotsModule | `scanoss:8d9a70e93c58197086bea29c`, `baseline:42` |
| api-workbench Dialoge | `scanoss:ca79893b6d660d8ae0988f98`, `scanoss:063a4ee5576e1be27f2d127c`, `scanoss:8711164173b258323c8297de`, `baseline:51`, `baseline:52` |
| nest-auth Preference-Entität | `scanoss:555df30b8cb103a249ff62e3` |
| teachlink UsersController | `scanoss:65783c496fec1fcbc859de22`, `baseline:44` |
| emergent Token-Entität | `baseline:25` |

Zusammen mit dem ASPECT-Notice-Fall verbleiben **18 ungeklärte IDs**. Bezogen
auf die historische 141-ID-Liste ergibt die neue Evidenz damit 121 Fälle ohne
erkennbaren Verstoß, 18 ungeklärte Fälle und zwei am historischen Commit belegte
Pflichtmängel, deren technische Korrektur hier vorliegt. Diese Zahlen sind keine
neue Vollprüfung des heutigen `master`.

Bei tatsächlich relevanter Fremdübernahme sind belastbare Originalarchive,
Entstehungsnachweise oder eine konkrete Rechteerlaubnis erforderlich. Die
fehlende Abrufbarkeit einer Scanner-Referenz allein beweist eine solche
Übernahme nicht. Die unten dokumentierte Standardmusterprüfung ordnet 13 der
Fundstellen deshalb anhand ihres konkreten lokalen Ausdrucks ein. Der offene
ASPECT-Notice-Prüfpunkt betrifft die Testdatei im Quellrepository. Der
[MIT-Text](https://opensource.org/license/mit) verlangt bei einschlägiger
Weitergabe die Copyright-/Permission-Notice; der verifizierte Assethash ersetzt
diese Frage nicht.

Die lokale Evidenz und ein Entscheidungsbogen mit allen **141 unveränderten
Finding-IDs** liegen unter `reports/license-follow-up-2026-11-12/`. Alle
menschlichen Entscheidungen darin bleiben `pending`. Es wurde kein Reviewer
eingetragen, kein Issue geschlossen und keine Freigabe oder Veröffentlichung
ausgeführt. Konkrete Anfragetexte an Beitragende und ASPECT-Verantwortliche
sind im dortigen `anfragen.md` als ursprüngliche Entwürfe erhalten. Der spätere
Versand ist gesondert in `reports/license-outreach-2026-11-12/` dokumentiert:
zwei E-Mails und ein öffentliches ASPECT-Issue. Seit der nachfolgenden
Nutzeranweisung dürfen **keine weiteren E-Mails oder Ticketaktionen ohne
ausdrückliche Bestätigung** erfolgen. Das ASPECT-Issue wurde auf ausdrücklichen
Wunsch mit einer Klarstellung zur dynamischen Player-Einbindung zurückgezogen
und am 12.11.2026 geschlossen (`not_planned`). Der Abschluss ist in
`reports/aspect-ticket-closure-2026-11-12/` dokumentiert; er ist keine
Lizenzfreigabe der im Quellrepository enthaltenen Testdatei.

## Weitere Klärung ohne Kontaktaufnahme

Der neue Untersuchungsstand liegt unter
`reports/license-resolution-2026-11-12/`. Er verfolgt die 15 bislang nicht
angefragten IDs in neun lokalen Dateien und erhält die alten Prüfberichte
unverändert.

Für `baseline:44` und `scanoss:65783c496fec1fcbc859de22` ist der gemeldete
teachlink-Originalstand über den erhaltenen Fork `OsejiFabian/teachLink_backend`
wieder verfügbar. Der vollständige Commit ist
`d94883b0e83e06198dec2d69188379e3577ee2fa`. Die Datei ist identisch zum früher
gesicherten Original: SHA-256
`eaa2b1d57e67dfbc8ed032a5af87dc0c1e5122c20479560308b2ac3b607ee87c`.
Die Paketdatei an genau diesem Commit deklariert `UNLICENSED`, während die README
`MIT © 2025 TeachLink DAO` nennt. Eine vollständige und widerspruchsfrei diesem
Code zugeordnete MIT-Beilage ist nicht belegt. Der wieder mögliche Vergleich
und diese offenen Lizenzangaben werden getrennt dokumentiert.

Für alle neun lokalen Dateien wurden Einführung, spätere Git-Änderungen und
die gemeldeten Zeilenbereiche gesichert. Git-Autorennamen und Zeitstempel allein
beweisen keine unabhängige Entstehung. Für die übrigen Quellen haben die
durchgeführten GitHub-, Software-Heritage- und Wayback-Abfragen kein verifiziertes
Original geliefert; das beweist weder dessen Nichtexistenz noch eine Erlaubnis.

Die Fallblätter trennen dokumentierte Framework-Aufrufe und projektspezifische
Angaben von einer menschlichen Beurteilung der tatsächlichen Übernahme. Für einen
gegebenenfalls nötigen Ersatz enthalten sie konkrete Funktionsverträge und
Prüfanforderungen. Ein bloßes Umformatieren oder Umbenennen wird nicht als
Herkunftsnachweis oder Rechteklärung gewertet. Es wurden keine menschlichen
Freigaben erfunden und keine Anwendungsfunktionen zur Vermeidung eines
Scanner-Treffers entfernt.

## Ergebnis der technischen Einzelprüfung der übrigen 13 Fälle

Die 13 IDs betreffen acht lokale Dateien. Die Prüfung hat bei acht IDs
Framework-Deklarationen und bei fünf IDs Standardkonfiguration bzw. einfache
SQL-Deklarationen mit projektspezifischen Werten ergeben. In den gemeldeten
Bereichen ist keine individuelle fremde Implementierung belegt.

| Gegenstand | IDs | Technischer Befund |
|---|---:|---|
| Drei Angular-Dialoge | 5 | Imports, Component-Metadaten und lokale View-Model-Bindung |
| SnapshotsModule | 2 | Standard-Modulregistrierung mit leerer Klasse |
| ApplicationToken | 1 | Spaltenabbildung passend zur eigenen Token-Migration |
| CLI-DataSource | 2 | Dokumentierte CLI-Befehle, Optionen und lokale DB-Werte |
| Audit-Migration | 2 | Drei statische Indexanweisungen für das eigene Schema |
| AppModule | 1 | Asynchrone DB-Konfiguration mit lokalen Schaltern |

Die Belege umfassen das offizielle Angular-Schematic der beim Refactoring
gesperrten Version 21.2.19, die API-Verträge der verwendeten Nest-/TypeORM-Pakete
und die zugehörigen lokalen Git-Änderungen. Vier offizielle Paketarchive wurden
gegen die Integritätswerte der Lockdateien geprüft. Die Strukturprüfung der
acht aktuellen und acht historischen TypeScript-Dateien ist bestanden.

Für diese Fundstellen ergibt sich kein begründeter Bedarf an einer Codeänderung
oder zusätzlichen Fremdattribution. Die lokale Korrektur betrifft ihre
Einordnung und den Nachverfolgungsplan. Der Anwendungscode ist unverändert.

Die sechs gemeldeten Fremdoriginale sind weiterhin nicht verifiziert. Ob einzelne
Standardzeilen ursprünglich kopiert wurden, bleibt damit eine getrennte
Herkunftsfrage. Die Musterprüfung beweist weder unabhängige Autorenschaft noch
eine vollständige Rechtefreigabe. Alle menschlichen Entscheidungen und die
ursprünglichen Prüfberichte bleiben erhalten.

Die begründeten Entscheidungen zu allen 13 ursprünglichen IDs und die neuen
Belege liegen unter `reports/license-pattern-review-2026-11-12/`. Es wurden
keine weiteren E-Mails oder Ticketaktionen ausgeführt.

## teachlink: beide IDs am wiedergefundenen Original verglichen

`baseline:44` und `scanoss:65783c496fec1fcbc859de22` bezeichnen denselben
lokalen Bereich 10–32 gegenüber den Originalzeilen 11–33. Der Originalstand
`d94883b0e83e06198dec2d69188379e3577ee2fa` wurde erneut abgerufen und stimmt
mit dem früher gesicherten SHA-256 und Git-Blob überein. Zusätzlich zu den
gemeldeten Bereichen wurden beide vollständigen Controller verglichen.

Die Übereinstimmungen betreffen das Nest-/Swagger-Gerüst, Konstruktor-Injection,
CRUD-Service-Delegation und zwei kurze funktionale Swagger-Beschriftungen. Das
offizielle Nest-CRUD-Template enthält dieselbe Grundform. Im Controller ist keine
individuelle teachlink-Fachimplementierung belegt. Der lokale Controller hat
andere Rollenwerte, UUID-Parameterprüfung, teilweise andere Service-Aufrufe,
eine zusätzliche Admin-Aktion und eine andere DTO-Importstruktur. Diese
Unterschiede allein sind kein Beweis unabhängiger Entstehung.

Ein lokaler Metadatenlauf bestätigt alle sechs Routen mit explizitem
`APP_ADMIN`, beide Klassenguards und UUID-Prüfpipes an den vier ID-Routen.
Der fremde Code wurde ausschließlich geparst und nicht ausgeführt. Aus fehlenden
Rollenannotationen einzelner fremder Handler wird keine Aussage über deren
effektive Zugriffsregeln abgeleitet.

Für beide IDs ergibt sich damit die technische Einordnung als Standardgerüst
mit kurzen CRUD-Beschriftungen. Eine Codeänderung oder zusätzliche
Fremdattribution ist aus dem Vergleich nicht begründet. Die abweichenden
Original-Lizenzangaben (`UNLICENSED` in package.json, MIT in der README) bleiben
als Fakten erhalten; sie werden weder zu einer neuen Erlaubnis noch allein zu
einem lokalen Lizenzverstoß umgedeutet.

Die Kopier- oder Generatorherkunft bleibt ohne Entstehungsunterlagen offen.
Die lokale Korrektur betrifft den Prüfstatus und die Nachverfolgung: Beide
IDs sind jetzt am Original technisch beurteilt und nicht mehr nur wegen der
ursprünglichen Abruflücke zurückgestellt. Der Anwendungscode und alle
menschlichen Entscheidungen bleiben unverändert. Vergleich und Belege liegen
unter `reports/teachlink-review-2026-11-12/`. Weitere E-Mails oder Ticketaktionen
wurden nicht ausgeführt.

## nest-auth und dhanam: die beiden verbleibenden lokalen Muster geprüft

Für `scanoss:555df30b8cb103a249ff62e3` ist die Preference-Entität weiterhin
vorhanden: `acp-item-preference.entity.ts` wurde beim AP-Refactoring in
`ap-item-preference.entity.ts` umbenannt. Das frühere Flag für eine fehlende
Datei berücksichtigte diese Git-Umbenennung nicht. Die aktuelle Fallzuordnung
enthält den richtigen Pfad und Hash; der eingefrorene Ausgangsbericht bleibt
erhalten.

Der gemeldete Bereich 9–27 enthält TypeORM-Metadaten mit den eigenen Tabellen-
und Indexwerten. Die ganze Entität enthält keine Authentifizierungs- oder andere
Fachimplementierung. Beide bedingten Unique-Indizes passen zur lokalen Migration
vom 13. Juli; ein Metadatenlauf bestätigt die Spaltenbindungen und Prädikate.
Die gesperrte TypeORM-API erklärt die Dekoratorform. Der Scanner-Lizenzname
`Unlicense` bleibt eine nicht am Original verifizierte Angabe.

Für `baseline:12` wurde der dhanam-Treffer am verifizierten lokalen Baseline-
Stand gelesen: Die gemeldeten Zeilen 36–47 gehören zum Commit
`d77c33b3d4305a701d6afbc806331f85fb614042`. Sie setzen einen abgelehnten Mock,
erwarten den Fehler des eigenen Review-Guards und schließen den Folgeaufruf der
Review-Policy aus. Die verwendeten Formen sind in der offiziellen
[Jest-29.7-Dokumentation](https://jestjs.io/docs/29.7/mock-function-api#mockfnmockrejectedvaluevalue)
und den [Assertions](https://jestjs.io/docs/29.7/expect#rejects) beschrieben.
Die spätere Umstellung auf eigene Review-Capabilities wurde separat verfolgt.
Der entsprechende heutige Ablehnungstest steht in Zeilen 34–46. Alle 21
vorhandenen Guard-Tests bestehen.

Beide Fundstellen werden technisch als Standardmuster mit lokalen Schema- bzw.
Testwerten eingeordnet. Eine individuelle Fremdimplementierung ist in den
untersuchten lokalen Bereichen nicht belegt; eine Codeänderung oder zusätzliche
Fremdattribution ist daraus nicht begründet. Dass der dhanam-Treffer Testcode
betrifft, ist dabei kein pauschaler Ausschluss von Weitergabepflichten.

Die exakten Fremdoriginale bleiben nach den Datei-, Repository- und Archivabfragen
nicht verifiziert. Das gefundene `madfam-org/dhanam-core` liefert weder den
gemeldeten Tag noch die betreffende Datei und ersetzt den Originalstand nicht.
Ob einzelne Standardzeilen ursprünglich kopiert wurden, bleibt ohne Originale
und Entstehungsunterlagen offen. In den beiden bereits versandten Anfrage-Threads
war nur die jeweilige eigene Nachricht sichtbar, keine Antwort.

Die lokale Korrektur umfasst die Fallzuordnung, Einordnung und eine aktuelle
Sicht auf alle 141 unveränderten IDs unter
`reports/nest-auth-dhanam-review-2026-11-12/current-review-index.json`. Diese
vereinigt die vorherigen Nachprüfungen: 138 IDs ohne nach verfügbarer technischer
Evidenz erkennbaren Verstoß, ein offener ASPECT-Fixture-Notice-Fall und zwei
historisch belegte, lokal bereits technisch korrigierte Mängel. Das ist keine
Vollprüfung des heutigen Gesamtstands oder Rechtefreigabe; alle menschlichen
Entscheidungen bleiben `pending`. Anwendungscode und frühere Berichte wurden
nicht geändert. Einzelbegründungen und Belege liegen unter
`reports/nest-auth-dhanam-review-2026-11-12/`. Es wurden keine weiteren Mails
versandt und keine Ticketaktionen ausgeführt.
