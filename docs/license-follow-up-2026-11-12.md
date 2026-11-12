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

Die verantwortlichen Beitragenden müssen belastbare Originalarchive,
Entstehungsnachweise oder eine andere konkrete Rechteerlaubnis für die 17 Fälle
beibringen. Für ASPECT müssen die Verantwortlichen den vollständigen
versionsbezogenen Copyright-/MIT-/Drittanbieter-Notice-Nachweis liefern. Der
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
Nutzeranweisung dürfen **keine weiteren E-Mails ohne ausdrückliche Bestätigung**
versandt werden. Die weitere Untersuchung erfolgt ohne neue externe Nachrichten.

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
