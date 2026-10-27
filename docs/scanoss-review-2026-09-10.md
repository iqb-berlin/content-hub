# SCANOSS-Trefferprüfung vom 10. September 2026

## Ergebnis

57 Treffer erfasst: **50 technisch plausible Standardmuster** (davon eines vertieft geprüft) und **7 nicht abrufbare Quellen**. Keine bestätigte Lizenzverletzung festgestellt. Die technische Einordnung ist keine rechtliche Freigabe und kein Beweis unabhängiger Entstehung. Kein Code wird allein zur Senkung eines Matchwerts umgeschrieben; keine unbelegte Fremdurheberschaft wird durch vorsorgliche Attribution behauptet.

## Umfang und Nachvollziehbarkeit

- Ausgangspunkt: lokaler SCANOSS-1.54.2-/OSSKB-Bericht zu `d77c33b3d4305a701d6afbc806331f85fb614042`: 362 Dateien, 57 Treffer (54 Snippet-, 3 Dateitreffer).
- Alle 57 lokalen Trefferbereiche gesichtet; für 50 Treffer Fremddateien am gemeldeten Commit/Tag bzw. Paketstand abgerufen und gegenübergestellt. Zwei Pfade über den Git-Baum desselben Tags korrigiert. Sieben Quellen waren auch über den Git-Baum der gemeldeten Version nicht erreichbar.
- Die 57 betroffenen lokalen Dateien sind in PR-Stand `51cfa9c2f40d11c0d6cb063a357affb1c00be06d` bytegleich zum gescannten Stand. Neue/ungefundene Dateien sind durch diese Prüfung nicht freigegeben.
- Vergleich der gemeldeten Bereiche und bei Auffälligkeiten zusätzlicher Kontext. Manche Fremd-Zeilenbereiche reichen über das Dateiende hinaus oder treffen Kommentare; dies begrenzt die Genauigkeit des Fingerprint-Hinweises.
- Ergebnisse von OpenAI Codex erstellt; keine menschliche oder anwaltliche Freigabe behauptet. Entscheidung und Umfang werden pro Treffer unten dokumentiert.
- [Maschinenlesbare Prüfliste](scanoss-review-2026-09-10.json) enthält Abrufadressen, Dateihashes, Status und Begründungen. Fremder Quelltext und umfangreiche Rohdaten werden nicht mitveröffentlicht.

## Verbleibende Schritte

1. **Treffer 4, 12, 16, 29, 42, 51, 52:** Originalversion aus verlässlicher Quelle beschaffen oder Herkunft anderweitig klären. 404 bedeutet weder rechtsfrei noch rechtswidrig. Besonders Treffer 12 trägt AGPL-Metadaten.
2. Menschliche Maintainer sollen die technische Standardmuster-Einordnung bestätigen, insbesondere die drei vollständigen Dateitreffer. Kein automatisches Unterdrücken künftiger Treffer durch diese Liste.

## Vertiefung zu Treffer 49 – Farbkontrastfunktionen

Der fremde Dateipfad wurde am 16.06.2026 veröffentlicht; die lokalen Funktionen kamen am 15.07.2026 mit [Commit `79d4778`](https://github.com/iqb-berlin/content-pool-next/commit/79d47783ad666a65f693a73e5cced83ddb5e036b) hinzu. Die zeitliche Reihenfolge macht eine Übernahme grundsätzlich möglich, belegt sie aber nicht.

Die gemeinsamen Rechenschritte sind durch WCAG vorgegeben: sRGB-Kanäle werden durch 255 geteilt, linearisiert und mit 0,2126/0,7152/0,0722 gewichtet; der Kontrast ist `(heller + 0,05) / (dunkler + 0,05)`. Die lokale Fassung verwendet den von W3C korrigierten Schwellwert 0,04045, die gemeldete Fremddatei den älteren Wert 0,03928. Funktionsnamen, Typisierung, Regex-Verhalten, Potenzschreibweise und die anschließende Farbauswahl unterscheiden sich. Vergleichbare TypeScript-Implementierungen der Luminanz- und Kontrastfunktionen existierten außerdem bereits vor beiden Dateien, beispielsweise seit dem 28.02.2026 in [Color Thief](https://github.com/lokesh/color-thief/commit/47584118d12cf2c6cc2ebd1cd5dc70fc6ddcbfd5).

Der SCANOSS-Hinweis von 21 % ist deshalb technisch als Standardimplementierung der WCAG-Formel einzuordnen. Zusätzlich reicht der gemeldete Fremdbereich 49–78 über das Ende der 55-zeiligen Fremddatei hinaus, sodass die Bereichsangabe nicht als exakter Kopiernachweis taugt. Es gibt derzeit keinen hinreichenden Beleg für eine substanzielle Übernahme und damit keinen Anlass, Copyright oder MIT-Lizenztext dieses konkreten Fremdprojekts beizufügen. Falls ein Beitragender tatsächliches Kopieren aus dieser Quelle bestätigt, muss die Lizenzfrage neu bewertet und die MIT-Attribution ergänzt werden.

## Maßstab

Keine Prozentgrenze entscheidet über Urheberrecht. Relevant sind individuelle Ausdrucksform, tatsächliche Übernahme und anwendbare Lizenzbedingungen. Scanner-Lizenzlisten können Repository-/Paketmetadaten oder mehrere fremde Komponenten vermischen; sie sind nicht automatisch die Lizenz des betroffenen Fragments. Technisch plausible Standardmuster bleiben eine begründete Einschätzung, keine pauschale Aussage zur Schutzfähigkeit.

Quellen: [§ 69a UrhG](https://www.gesetze-im-internet.de/urhg/__69a.html), [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0), [Angular-Provider](https://angular.dev/guide/http/setup), [WCAG-Kontrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C-Hinweis zum korrigierten Luminanz-Schwellwert](https://www.w3.org/WAI/GL/wiki/Relative_luminance), [MIT-Lizenz des Farbprojekts](https://github.com/eeelester/bilibili-fullscreen-sc/blob/0.9.6/LICENSE).

## Einzelbewertungen

### 1. `backend/src/admin/admin.module.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 68%; lokale Zeilen 3-23; Fremdzeilen 3-23.

NestJS-Modulregistrierung; unterschiedliche Entitäten und Services. Gemeinsam sind Imports und forFeature-Gerüst.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/masa1984a/ai-ocr-system/c62793e/backend/src/documents/documents.module.ts); Version `c62793e`. Scanner-Lizenzangaben: MIT.

### 2. `backend/src/api/server-api-audit.interceptor.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 22%; lokale Zeilen 7-24; Fremdzeilen 2-19.

NestJS-/RxJS-Imports und Interceptor-Signatur. Fremdcode dient Mock-Routen, eigener Code Audit-Protokollierung; gemeldeter Fremdbereich enthält überwiegend Dokumentation.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/svintsoff78/megamock/v1.0.2/src/interceptors/mockRoute.interceptor.ts); Version `v1.0.2`. Scanner-Lizenzangaben: keine.

### 3. `backend/src/api/server-api-auth.guard.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 26%; lokale Zeilen 7-24; Fremdzeilen 1-18.

Guard-/Reflector-/Request-Gerüst. Abweichende Authentifizierungsdienste und Metadaten; keine charakteristische gemeinsame Implementierung im gemeldeten Bereich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/beydemirfurkan/tweetly/4ed5132/backend/src/auth/api-key.guard.ts); Version `4ed5132`. Scanner-Lizenzangaben: MIT.

### 4. `backend/src/app.module.ts`

**Offen: Quelle nicht abrufbar** — SCANOSS: 29%; lokale Zeilen 26-45; Fremdzeilen 43-62.

Lokaler Bereich konfiguriert PostgreSQL und Umgebungsvariablen. Exakte Fremdversion nicht abrufbar; keine abschließende Gegenprüfung.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/ekadwrama/EdraVault/v0.1.0-beta/apps/backend/src/app.module.ts); Version `v0.1.0-beta`. Scanner-Lizenzangaben: keine.

### 5. `backend/src/auth/auth.module.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 75%; lokale Zeilen 3-47; Fremdzeilen 3-47.

JWT-/Passport-Modulkonfiguration mit ConfigService. Deutliche Gerüstähnlichkeit; Laufzeiten, registrierte Entitäten und zusätzliche Authentifizierungsdienste unterscheiden sich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/rub-a-dab-dub/whspr_stellar/cd0d66d/src/auth/auth.module.ts); Version `cd0d66d`. Scanner-Lizenzangaben: MIT.

### 6. `backend/src/auth/guards/jwt-auth.guard.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 100%; lokale Zeilen all; Fremdzeilen all.

Fünf Zeilen NestJS-Standardadapter: zwei Imports, Injectable und leere AuthGuard(jwt)-Unterklasse. Inhaltlich identisch; allein daraus keine individuelle Fremdleistung oder Übernahmerichtung ableitbar.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/publicmapping/districtbuilder/0.1.0/src/server/src/auth/guards/jwt-auth.guard.ts); Version `0.1.0`. Scanner-Lizenzangaben: Apache-2.0.

### 7. `backend/src/auth/guards/oidc-auth.guard.spec.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 48%; lokale Zeilen 22-46; Fremdzeilen 82-106.

Jest-Spies auf canActivate und mockRestore; andere OIDC-/Cookie-Szenarien, Kontextdaten und Erwartungen.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/legendyz/G-Credit/v1.2.0/gcredit-project/backend/src/common/guards/jwt-auth.guard.spec.ts); Version `v1.2.0`. Scanner-Lizenzangaben: MIT.

### 8. `backend/src/auth/guards/roles.guard.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 28%; lokale Zeilen 8-31; Fremdzeilen 3-26.

Übliches NestJS-RBAC-Gerüst mit Reflector/getAllAndOverride und HTTP-Kontext; Rollenprüfung und weitere Logik unterscheiden sich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/Radega1993/gestion-terranova/v1.0.0/backend/src/modules/users/guards/roles.guard.ts); Version `v1.0.0`. Scanner-Lizenzangaben: Apache-2.0.

### 9. `backend/src/auth/strategies/jwt.strategy.spec.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 27%; lokale Zeilen 48-78; Fremdzeilen 261-291.

GPL-Metadaten: findOne-Mock, Nullprüfung und Jest-Aufrufe gemeinsam; eigene JWT-Validierung unterscheidet sich von Reset-Token-/E-Mail-Tests. Kein charakteristischer übernommener Test nachgewiesen.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/blazer82/analytodon/v2.0.0/apps/backend/src/users/users.service.spec.ts); Version `v2.0.0`. Scanner-Lizenzangaben: GPL-3.0-only.

### 10. `backend/src/auth/strategies/jwt.strategy.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 22%; lokale Zeilen 3-18; Fremdzeilen 3-18.

PassportStrategy-/Repository-Injektion als Framework-Muster; JWT-Extraktion und eigene Payload-/Validierungslogik unterscheiden sich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/blessingfoodsdnbhd-spec/gaymeet-app/v1.0-beta/backend/src/modules/auth/strategies/jwt.strategy.ts); Version `v1.0-beta`. Scanner-Lizenzangaben: Apache-2.0.

### 11. `backend/src/comments/comments.module.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 72%; lokale Zeilen 3-19; Fremdzeilen 3-19.

Quelldatei im selben Tag unter server/src/comments/comments.module.ts gefunden. Einfaches NestJS-Modul; eigene Review-Policy, Guards und zusätzliche Entitäten fehlen im Vergleichsprojekt.

[Gemeldete/aufgelöste Quelldatei](https://github.com/tk1/doatask/blob/v0.1/server/src/comments/comments.module.ts); Version `v0.1`. Scanner-Lizenzangaben: MIT.

### 12. `backend/src/comments/review-access.guard.spec.ts`

**Offen: Quelle nicht abrufbar** — SCANOSS: 23%; lokale Zeilen 36-47; Fremdzeilen 1041-1052.

AGPL-Metadaten: lokaler kurzer Jest-Ablehnungstest. Exakte Referenz nicht abrufbar, daher Gegenprüfung offen.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/madfam-org/dhanam/%40dhanam%2Fbilling-sdk%400.3.0/apps/api/src/modules/transactions/transactions.service.spec.ts); Version `@dhanam/billing-sdk@0.3.0`. Scanner-Lizenzangaben: AGPL-3.0.

### 13. `backend/src/comments/review-access.guard.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 25%; lokale Zeilen 11-16; Fremdzeilen 8-13.

Nur Konstruktorinjektion und CanActivate-Signatur gemeinsam; injizierte Objekte und Aufgaben unterscheiden sich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/onix-systems/nest-js-boilerplate/2.30.0/generators/auth/templates/mongodb/passportLocal/src/guards/roles.guard.ts); Version `2.30.0`. Scanner-Lizenzangaben: MIT.

### 14. `backend/src/common/uuid-param.spec.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 37%; lokale Zeilen 9-31; Fremdzeilen 5-27.

NestJS-TestingModule-/Anwendungsaufbau; lokaler UUID-Routentest statt Redis-Microservice-Test.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/nestjs/nest/v6.6.0/integration/microservices/e2e/broadcast-redis.spec.ts); Version `v6.6.0`. Scanner-Lizenzangaben: MIT.

### 15. `backend/src/config/database.config.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 62%; lokale Zeilen 6-16; Fremdzeilen 6-16.

Konfiguration aus DB-Umgebungsvariablen und parseInt-Port. Andere Standardwerte und Migrationsregeln; Routinekonfiguration.

[Gemeldete/aufgelöste Quelldatei](https://registry.npmjs.org/@anand_kanzariya_/nestjs-boilerplate/-/nestjs-boilerplate-0.0.1.tgz); Version `0.0.1`. Scanner-Lizenzangaben: Unlicense.

### 16. `backend/src/database/data-source.ts`

**Offen: Quelle nicht abrufbar** — SCANOSS: 50%; lokale Zeilen 7-18; Fremdzeilen 7-18.

Lokale TypeORM-CLI-Dokumentation und DataSource-Konfiguration; exakte Fremdversion nicht abrufbar.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/adeel99sa/ZephixPlatform/pre-architecture-migration-20250829-1640/zephix-backend/src/data-source.ts); Version `pre-architecture-migration-20250829-1640`. Scanner-Lizenzangaben: MIT.

### 17. `backend/src/database/entities/acp-access-config.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 39%; lokale Zeilen 9-27; Fremdzeilen 10-28.

TypeORM-Entität mit UUID und Dekoratoren; anderes Fachmodell (Zugriffskonfiguration gegenüber Benachrichtigung).

[Gemeldete/aufgelöste Quelldatei](https://proxy.golang.org/github.com/myfursona-project/backend/@v/v0.0.0-20240502210631-e3a467f79d73.zip); Version `v0.0.0-20240502210631-e3a467f79d73`. Scanner-Lizenzangaben: Apache-2.0.

### 18. `backend/src/database/entities/acp-file.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 22%; lokale Zeilen 22-31; Fremdzeilen 95-104.

Column-Dekoratoren mit nullable/type; verschiedene Felder, Datentypen und Fachmodelle.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/jileZ014/league_gametriq/v1.0-baseline/apps/api/src/modules/audit/audit.entity.ts); Version `v1.0-baseline`. Scanner-Lizenzangaben: keine.

### 19. `backend/src/database/entities/acp-item-explorer-change-log.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 12%; lokale Zeilen 47-54; Fremdzeilen 66-73.

CreateDateColumn-Routine; gemeldeter Fremdbereich reicht über Dateiende hinaus. Kein Vergleich des ganzen gemeldeten Bereichs möglich; sichtbarer gemeinsamer Teil ist ein Zeitstempelfeld.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/hackclub/beest/6c82f7d/backend/src/entities/project-review.entity.ts); Version `6c82f7d`. Scanner-Lizenzangaben: keine.

### 20. `backend/src/database/entities/acp-item-explorer-state.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 29%; lokale Zeilen 9-20,47-53; Fremdzeilen 9-20,30-36.

UUID-/Zeitstempel-/Relationen-Muster; andere Entitäten und Relationseigenschaften.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/bayesimpact/agent-studio/v26.06.12/apps/api/src/domains/agents/conversation-agent-sessions/conversation-agent-session-category.entity.ts); Version `v26.06.12`. Scanner-Lizenzangaben: MIT.

### 21. `backend/src/database/entities/acp-item-preference.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 27%; lokale Zeilen 9-27; Fremdzeilen 13-31.

Entity-/Index-/UUID-Muster; eigener bedingter Benutzer-/Credential-Index statt Lagerbestandsmodell.

[Gemeldete/aufgelöste Quelldatei](https://registry.npmjs.org/@things-factory/warehouse-base/-/warehouse-base-2.4.0-beta.0.tgz); Version `2.4.0-beta.0`. Scanner-Lizenzangaben: MIT.

### 22. `backend/src/database/entities/acp-snapshot.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 43%; lokale Zeilen 21-37; Fremdzeilen 23-39.

Column-Dekoratoren für JSON-/Textwerte; Feldnamen, Werte und Beziehungen unterscheiden sich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/agesempire/stellarswipe-backends/395a999/src/performance-profiling/performance-snapshot.entity.ts); Version `395a999`. Scanner-Lizenzangaben: MIT.

### 23. `backend/src/database/entities/acp-user-role.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 76%; lokale Zeilen 8-34; Fremdzeilen 11-37.

TypeORM-Entity-Gerüst; Rollenmodell statt Finanzdeposit. Gemeinsame UUID-/Relationssyntax begründet den hohen Wert nicht als Textkopie.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/code-flexing/harvest-finance/4b34bab/harvest-finance/backend/src/database/entities/deposit.entity.ts); Version `4b34bab`. Scanner-Lizenzangaben: MIT, BSD-3-Clause.

### 24. `backend/src/database/entities/acp.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 37%; lokale Zeilen 23-44; Fremdzeilen 18-39.

JSON-/Zeitstempel-/Relationsfelder; eigenes ACP-Modell statt Job-Warteschlange.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/stellaiverse/stellaiverse-backend/c1eb7db/src/workers/entities/job.entity.ts); Version `c1eb7db`. Scanner-Lizenzangaben: MIT.

### 25. `backend/src/database/entities/application-token.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 28%; lokale Zeilen 33-47; Fremdzeilen 35-49.

Timestamptz- und nullable-Spalten gemeinsam. Fremde Mehrfach-Lizenzliste ist keine für diese Datei verifizierte Lizenzexpression; kein individueller Übernahmeblock erkannt.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/Emergent-Comapny/emergent/cli-v0.2.0/apps/server/src/entities/invite.entity.ts); Version `cli-v0.2.0`. Scanner-Lizenzangaben: BSD-2-Clause, EUPL-1.2, Jam, OML, MIT.

### 26. `backend/src/database/entities/comment.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 16%; lokale Zeilen 9-26; Fremdzeilen 9-26.

Comment-Klassenname und ORM-Dekoratoren; eigene Zieltyp-Enumeration und ACP-Beziehungen unterscheiden sich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/Ywoosang/ywoosang-blog-server/v0.1.0/src/comment/entities/comment.entity.ts); Version `v0.1.0`. Scanner-Lizenzangaben: keine.

### 27. `backend/src/database/entities/item-response-state.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 73%; lokale Zeilen 10-38; Fremdzeilen 3-31.

73 Prozent ohne Lizenzangabe: überwiegend TypeORM-Dekoratoren und UUID-/Textfelder. Inhaltlich Antwortzustand statt Accessibility-Label; kein charakteristisches gemeinsames Datenmodell.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/starkmindshq/strellerminds-backend/4cd542f/src/accessibility/entities/content-label.entity.ts); Version `4cd542f`. Scanner-Lizenzangaben: keine.

### 28. `backend/src/database/entities/user.entity.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 68%; lokale Zeilen 9-35; Fremdzeilen 9-35.

User-Entität mit UUID/Column; unterschiedliche Benutzerfelder, Kommentare und Beziehungen.

[Gemeldete/aufgelöste Quelldatei](https://registry.npmjs.org/entity_shared/-/entity_shared-1.0.0.tgz); Version `1.0.0`. Scanner-Lizenzangaben: MIT.

### 29. `backend/src/database/migrations/1760641000000-CreateServerApiAuditLogs.ts`

**Offen: Quelle nicht abrufbar** — SCANOSS: 35%; lokale Zeilen 24-45; Fremdzeilen 17-38.

Lokales SQL-/Index-Migrationsgerüst. Exakte Fremdversion nicht abrufbar.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/adeel99sa/ZephixPlatform/pre-architecture-migration-20250829-1640/zephix-backend/src/database/migrations/1756271690591-CreateResourceTables.ts); Version `pre-architecture-migration-20250829-1640`. Scanner-Lizenzangaben: MIT.

### 30. `backend/src/database/migrations/1761000000000-ChangeItemResponseStateUniqueIndex.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 47%; lokale Zeilen 8-18; Fremdzeilen 12-22.

Wiederholte queryRunner.query-Aufrufe und Indexabbau; andere Tabellen/Indizes und SQL-Dialekte. Fremder gemeldeter Bereich reicht über Dateiende hinaus.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/xud6/eveqbot/v2.7.29/src/db/migration/1584082375410-dbupdate.ts); Version `v2.7.29`. Scanner-Lizenzangaben: keine.

### 31. `backend/src/database/migrations/1762000000000-CreateAcpFileProcessingJobs.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 94%; lokale Zeilen 3-51; Fremdzeilen 3-51.

94 Prozent: stark verschiedene SQL-Inhalte (Verarbeitungsjobs gegenüber Finanztransaktionen). Gemeinsam sind MigrationInterface, up/down und SQL-Aufrufgerüst.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/rub-a-dab-dub/whspr_stellar/dba1d5f/src/migrations/1711234567897-TransactionsSchema.ts); Version `dba1d5f`. Scanner-Lizenzangaben: MIT.

### 32. `backend/src/database/migrations/1763100000000-AddArchiveFieldsToFileProcessingJobs.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 87%; lokale Zeilen 3-31; Fremdzeilen 3-31.

87 Prozent, AGPL-Metadaten: eigene Archivspalten gegenüber Ticket-/Crew-Refactoring. Individuelle SQL-Anweisungen, Namen und Operationen unterscheiden sich erheblich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/EternalDeiwos/logi-bot/v0.17.0/src/database/migrations/1740305404942-crew-refactor.ts); Version `v0.17.0`. Scanner-Lizenzangaben: AGPL-3.0-only, AGPL-3.0-or-later.

### 33. `backend/src/database/migrations/1783904000000-CreateAcpItemRowNumbers.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 75%; lokale Zeilen 8-32; Fremdzeilen 8-32.

Tabellen-/Index-Erstellung über TypeORM; eigenes Zeilennummernmodell statt Metadaten-/Formulardesign mit SQLite.

[Gemeldete/aufgelöste Quelldatei](https://registry.npmjs.org/@sphereon/ssi-sdk.data-store/-/ssi-sdk.data-store-0.37.2-feature.oid4vc.1.0.22.tgz); Version `0.37.2-feature.oid4vc.1.0.22`. Scanner-Lizenzangaben: Apache-2.0.

### 34. `backend/src/database/migrations/1784200000000-CascadeItemResponseStatesWithAcp.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 75%; lokale Zeilen 3-27; Fremdzeilen 3-27.

MigrationInterface/up/down-Gerüst; eigene Datenbereinigung und ACP-Fremdschlüssel statt client_product-Constraints.

[Gemeldete/aufgelöste Quelldatei](https://registry.npmjs.org/ecommerce-operations-api/-/ecommerce-operations-api-0.0.1.tgz); Version `0.0.1`. Scanner-Lizenzangaben: Unlicense.

### 35. `backend/src/database/migrations/1784300000000-MaintainPreviousBackendRowKeyWrites.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 65%; lokale Zeilen 8-31; Fremdzeilen 63-86.

PostgreSQL-Triggergerüst gemeinsam; eigene Zeilenschlüsselberechnung statt Zählerpflege für Extrinsics. Triggerinhalt und Wirkung unterscheiden sich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/uniquenetwork/unique-scan-backend/v1.0.0/migrations/1659414459225-total-stats-triggers.ts); Version `v1.0.0`. Scanner-Lizenzangaben: keine.

### 36. `backend/src/database/migrations/1784700000000-PreserveUserPasswordHashForRollback.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 47%; lokale Zeilen 7-16; Fremdzeilen 21-30.

getTable/findColumnByName-Prüfung als Migrationsmuster; Default-Wert einer vorhandenen Spalte statt neuer Batch-Spalte/Index.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/openlinker-project/openlinker/v0.1.0/apps/api/src/migrations/1807000000000-add-bulk-batch-id-to-listing-creation-records.ts); Version `v0.1.0`. Scanner-Lizenzangaben: Apache-2.0.

### 37. `backend/src/files/async-lru-cache.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 11%; lokale Zeilen 82-93; Fremdzeilen 33-44.

Identische kurze Map-Eviction-Schleife (ältesten Eintrag löschen), aber anderer Cache-Vertrag und Umfang. Technisch übliches Map/LRU-Idiom; keine Übernahmerichtung nachgewiesen.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/Mearman/FleetArchitect/v1.16.0/src/domain/cache/memory-cache.ts); Version `v1.16.0`. Scanner-Lizenzangaben: keine.

### 38. `backend/src/health/health.controller.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 41%; lokale Zeilen 16-35; Fremdzeilen 11-30.

Health-Controller mit DataSource und SELECT 1; unterschiedliche Endpunkte, Antwortdaten und Fehlerbehandlung.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/Alejob60/realculture-backend/stable-version-1.0/src/interfaces/controllers/health.controller.ts); Version `stable-version-1.0`. Scanner-Lizenzangaben: MIT.

### 39. `backend/src/health/version.controller.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 61%; lokale Zeilen 4-15; Fremdzeilen 3-14.

Controller-/Swagger-Dekoratoren gemeinsam; eigener Versionsendpunkt statt Weiterleitung auf eine Website. Niedrige Aussagekraft der 61-Prozent-Angabe.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/pilosa-group/pilosa-api/v1.13.2/apps/pilosa/src/controllers/index.controller.ts); Version `v1.13.2`. Scanner-Lizenzangaben: keine.

### 40. `backend/src/items/items.module.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 80%; lokale Zeilen 3-23; Fremdzeilen 8-28.

Einfaches NestJS-Modul; Fremdcode nutzt Mongoose und andere Provider statt eigener TypeORM-Entitäten.

[Gemeldete/aufgelöste Quelldatei](https://registry.npmjs.org/bounty-system-types/-/bounty-system-types-0.0.1.tgz); Version `0.0.1`. Scanner-Lizenzangaben: MIT.

### 41. `backend/src/main.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 59%; lokale Zeilen 3-17,43-79; Fremdzeilen 3-17,40-76.

NestJS-Bootstrap/ValidationPipe/Swagger-Gerüst; eigene CORS-/Produktionsregeln gegenüber anderem Routing, Filtern und API-Tags. Kein charakteristischer Fachalgorithmus im Vergleich.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/CutaGames/Agentrix-Claw/build-24629116233/frontend/src/main.ts); Version `build-24629116233`. Scanner-Lizenzangaben: Apache-2.0.

### 42. `backend/src/snapshots/snapshots.module.ts`

**Offen: Quelle nicht abrufbar** — SCANOSS: 77%; lokale Zeilen 5-22; Fremdzeilen 3-20.

Lokales NestJS-Modul; exakte Fremdversion nicht abrufbar.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/bhaataha/ninjabackup/v1.0.0/apps/api/src/modules/snapshots/snapshots.module.ts); Version `v1.0.0`. Scanner-Lizenzangaben: MIT.

### 43. `backend/src/users/dto/user.dto.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 56%; lokale Zeilen 2-16; Fremdzeilen 2-16.

Swagger-/class-validator-Dekoratoren für DTO-Felder; eigener Benutzer-DTO statt Nachrichten-DTO.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/attef7474-byte/ATsoftERP/atsoft-erp-browser-console-chunkload-proof/apps/api/src/modules/messaging/dto/send-message.dto.ts); Version `atsoft-erp-browser-console-chunkload-proof`. Scanner-Lizenzangaben: keine.

### 44. `backend/src/users/users.controller.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 32%; lokale Zeilen 10-32; Fremdzeilen 11-33.

NestJS-/Swagger-/RBAC-Controllergerüst; eigene Listenaktion gegenüber fremder Erstellungsaktion, unterschiedliche DTOs und Rollenwerte.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/rinafcode/teachlink_backend/d94883b/src/users/users.controller.ts); Version `d94883b`. Scanner-Lizenzangaben: MIT.

### 45. `backend/src/users/users.module.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 78%; lokale Zeilen 3-14; Fremdzeilen 3-14.

Quelldatei im selben Tag unter services/api-v2/src/users/users.module.ts gefunden. Einfaches NestJS-Modul; registrierte Entitäten und AuthModule unterscheiden sich.

[Gemeldete/aufgelöste Quelldatei](https://github.com/dngconsulting/opendossard/blob/v2.3.44/services/api-v2/src/users/users.module.ts); Version `v2.3.44`. Scanner-Lizenzangaben: MIT.

### 46. `backend/src/users/users.service.spec.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 19%; lokale Zeilen 3-10,39-55; Fremdzeilen 4-11,27-43.

NestJS-/Jest-Testaufbau und Repository-Mocks; andere Repository-Anzahl, Aktionen und Erwartungen. Gemischte Scanner-Lizenzliste nicht als Dateilizenz übernommen.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/dogstark/petchain-frontend/22c1f0d/backend/src/modules/users/users.service.spec.ts); Version `22c1f0d`. Scanner-Lizenzangaben: Python-2.0, Unlicense, ISC, MIT, BSD-2-Clause, BSD-3-Clause, CC-BY-4.0, Apache-2.0, 0BSD.

### 47. `backend/src/views/views.module.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 17%; lokale Zeilen 3-9; Fremdzeilen 3-9.

Imports von ViewsService/ViewsController; andere Entitäten. Übliches Modulgerüst.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/bluecollardev/mediashare/v0.1.6/apps/media-api/src/app/modules/views/views.module.ts); Version `v0.1.6`. Scanner-Lizenzangaben: keine.

### 48. `frontend/src/app/app.config.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 100%; lokale Zeilen all; Fremdzeilen all.

13 Zeilen exakt identische Angular-Providerkonfiguration. Framework-Aufrufe, Routing und Standard-Interceptor-Verkabelung; AGPL-Repositorium allein belegt keine AGPL-Pflicht. Menschliche Bestätigung dieser Boilerplate-Einordnung vor Freigabe sinnvoll.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/kandanapp/kandan/8b59b8a/client/src/app/app.config.ts); Version `8b59b8a`. Scanner-Lizenzangaben: AGPL-3.0-only.

### 49. `frontend/src/app/core/utils/app-settings.util.ts`

**Technisch plausibles Standardmuster (vertieft geprüft)** — SCANOSS: 21%; lokale Zeilen 24-53; Fremdzeilen 49-78.

Vertiefte Prüfung von Quellhistorie und vollständigen Dateien: Der Fremdcode ist etwa einen Monat älter, was allein keine Übernahme belegt. Die Ähnlichkeit konzentriert sich auf die von WCAG vorgegebenen Luminanz- und Kontrastformeln sowie übliche TypeScript-Schritte. Lokaler Schwellwert, Namen, Typisierung, Regex, Potenzschreibweise und Farbauswahl unterscheiden sich; vergleichbare Implementierungen existierten schon früher in anderen Projekten. Der gemeldete Fremdbereich reicht zudem über das Dateiende hinaus. Kein hinreichender Beleg für eine substanzielle Übernahme und aktuell kein Anlass für eine MIT-Attribution; bei bestätigtem tatsächlichem Kopieren neu bewerten.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/eeelester/bilibili-fullscreen-sc/0.9.6/utils/color.ts); Version `0.9.6`. Scanner-Lizenzangaben: MIT.

### 50. `frontend/src/app/shared/components/loading.component.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 45%; lokale Zeilen 22-40; Fremdzeilen 128-146.

Üblicher CSS-Kreis-Spinner mit border-radius und rotate; Maße, Farben und Container unterschiedlich. Gemischte Scanner-Lizenzen nicht als konkrete Dateilizenz verifiziert.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/BenjaminDobler/adorable/v1.0.5/apps/client/src/app/versions/versions-panel.component.ts); Version `v1.0.5`. Scanner-Lizenzangaben: MIT, JSON, ISC, Ferguson-Twofish, BSD-3-Clause, BSD-2-Clause, BlueOak-1.0.0, CC0-1.0, CNRI-Python, Apache-2.0, W3C-20150513, W3C-19980720, W3C, Unlicense, Unicode-3.0, RSA-MD, Symlinks, PSF-2.0, Python-2.0, Python-2.0.1, libutil-David-Nugent, w3m, 0BSD.

### 51. `frontend/src/app/views/item-explorer/components/column-manager-dialog/item-explorer-column-manager-dialog.component.ts`

**Offen: Quelle nicht abrufbar** — SCANOSS: 44%; lokale Zeilen 3-11; Fremdzeilen 13-21.

Lokales Angular-Komponenten-/FormsModule-Gerüst; exakte Fremdversion nicht abrufbar.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/matthiaskopeinigg/api-workbench/v1.0.0/src/app/features/workspace/shared/runner-dialog/runner-dialog.component.ts); Version `v1.0.0`. Scanner-Lizenzangaben: MIT.

### 52. `frontend/src/app/views/item-explorer/components/history-dialog/item-explorer-history-dialog.component.ts`

**Offen: Quelle nicht abrufbar** — SCANOSS: 44%; lokale Zeilen 3-11; Fremdzeilen 13-21.

Lokales Angular-Komponenten-/FormsModule-Gerüst; exakte Fremdversion nicht abrufbar.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/matthiaskopeinigg/api-workbench/v1.0.0/src/app/features/workspace/shared/runner-dialog/runner-dialog.component.ts); Version `v1.0.0`. Scanner-Lizenzangaben: MIT.

### 53. `frontend/src/app/views/item-explorer/item-explorer.component.spec.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 31%; lokale Zeilen 58-90; Fremdzeilen 54-86.

Fullscreen-DOM-Mocks und Vitest-Routinen gemeinsam; eigener Angular-Komponententest mit Wiederherstellung gegenüber React-Hook-Test mit Events/Fehlerfällen.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/jrtilak/lazykit/83fcbd6/registry/react-hooks/useFullscreen.test.ts); Version `83fcbd6`. Scanner-Lizenzangaben: MIT.

### 54. `frontend/src/main.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 100%; lokale Zeilen all; Fremdzeilen all.

Fünf Zeilen Angular-Bootstrap inklusive Imports und catch(console.error), inhaltlich identisch. Übliches CLI-/Framework-Gerüst.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/cemayhan20/PigNote/v0.1.0/src/main.ts); Version `v0.1.0`. Scanner-Lizenzangaben: Apache-2.0.

### 55. `frontend/src/test-setup.ts`

**Technisch plausibles Standardmuster** — SCANOSS: 15%; lokale Zeilen 3-9; Fremdzeilen 4-10.

Angular-Testumgebung initialisieren: Standard-Imports und initTestEnvironment; kein individueller Testalgorithmus im gemeinsamen Teil.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/rodrigo54/rodrigoalves.dev/v4.0.0/src/test-setup.ts); Version `v4.0.0`. Scanner-Lizenzangaben: MIT.

### 56. `scripts/check-license-metadata.py`

**Technisch plausibles Standardmuster** — SCANOSS: 16%; lokale Zeilen 14-22; Fremdzeilen 31-39.

Gemeldeter Fremd-Zeilenbereich enthält andere Pfadkonstanten/Kommentare; eigener Lizenzhash und Fehlerfunktion sind kein entsprechender Kopierblock. Zeilenangabe nicht als exakter Textvergleich interpretierbar.

[Gemeldete/aufgelöste Quelldatei](https://raw.githubusercontent.com/wilsonzlin/aero/98dafdd/scripts/ci/check-virtio-snd-vcxproj-sources.py); Version `98dafdd`. Scanner-Lizenzangaben: Apache-2.0.

### 57. `scripts/init-keycloak.sh`

**Technisch plausibles Standardmuster** — SCANOSS: 8%; lokale Zeilen 26-31; Fremdzeilen 524-529.

curl-Aufruf an standardisierten Keycloak-Tokenendpunkt; verschiedene Grant-Typen und Formularparameter. Protokoll-/Shell-Routine.

[Gemeldete/aufgelöste Quelldatei](https://proxy.golang.org/github.com/vyrodovalexey/avapigw/@v/v0.7.0.zip); Version `v0.7.0`. Scanner-Lizenzangaben: Apache-2.0.
