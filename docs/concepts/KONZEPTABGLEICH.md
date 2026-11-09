# Abgleich mit dem Ausgangskonzept

Stand: 2026-09-08. Grundlage sind das [historische Konzept](legacy/README.md),
die aktuelle Dokumentation und eine gezielte Sichtung von Backend-Modulen und
AP-Codepfaden. Dies ist keine vollstaendige Code- oder Laufzeitpruefung.

## Statusdefinitionen

- **Umgesetzt:** Die Faehigkeit ist in der aktuellen Dokumentation beschrieben;
  dies ist keine Aussage ueber vollstaendige Testabdeckung.
- **Anders umgesetzt:** Der aktuelle Ansatz weicht fachlich oder technisch ab.
- **Offen:** Die urspruengliche Anforderung ist nicht ausreichend als umgesetzt
  belegt oder ihre weitere Gueltigkeit muss entschieden werden.
- **Bewusst verworfen:** Eine ausdrueckliche, begruendete Entscheidung liegt vor.
  Aktuell wird keine Anforderung allein wegen fehlender Implementierung so eingestuft.

## Vergleich

| Ausgangskonzept | Status | Aktueller Stand / Nachweis |
| --- | --- | --- |
| AP erfassen und bearbeiten | Umgesetzt | Index- und Dateiverwaltung; [Workflows](../features/acp-workflows.md) |
| Syntaktische und semantische Validierung | Umgesetzt | Validierung von Inhalten und Referenzen; keine Zusage aller alten Scale-Regeln; [Workflows](../features/acp-workflows.md) |
| Versionierte Registry mit packageId + version | Anders umgesetzt | Zentrales AP-Aggregat und Snapshots; [Datenmodell](../architecture/data-model.md) |
| Versionsvergleich | Anders umgesetzt | Snapshot-Vergleiche statt vorausgesetzter Gleichheit mit dem alten AP-Diff; [Workflows](../features/acp-workflows.md) |
| Viewer/Reviewer/Maintainer/Publisher/Admin | Anders umgesetzt | APP_ADMIN, AP_MANAGER, READ_ONLY und AP-Zugangsdaten; [Zugriff](../features/access-control.md) |
| OIDC als spaeterer Ausbau | Umgesetzt | Keycloak/OIDC ist Teil der Architektur; [Zugriff](../features/access-control.md) |
| Review-Tasks OPEN / IN_PROGRESS / DONE | Offen | Kommentare und Betrachtungsablaeufe belegen keine formale Aufgabenverwaltung |
| Erzwungene AP-Transitionen und Release-Pruefung | Offen | Statuswerte im AP-Index belegen keine Transition-Matrix mit Publisher-Pruefung |
| Kryptografisch signierte AP-Release-Ereignisse | Offen | Kein gleichwertiger Signatur-/Release-Nachweis im bisherigen Abgleich identifiziert |
| Vollstaendiger Audit-Trail aller Mutationen | Offen | Explorer-ChangeLog und ServerApiAuditLog vorhanden; globale Abdeckung nicht belegt; [Datenmodell](../architecture/data-model.md) |
| Import/Export und Merge-Strategien | Anders umgesetzt | Index-/Datei-/Server-Transfer; Upload reject/overwrite/keep-both ist kein Nachweis der alten Bundle-Merge-Semantik; [Workflows](../features/acp-workflows.md) |
| Scale-Simulation und alter Fehlercode-Katalog | Offen | Gleichwertigkeit zum alten Analytics-/Quality-Scope nicht belegt |
| Fachliche API-Gruppen catalog/quality/workflow/release | Anders umgesetzt | NestJS-Module und AP-/View-/Server-API; [Backend](../architecture/backend.md), [API](../features/integrations-and-api.md) |
| Hexagonaler Monolith mit Queue/Worker als Ziel | Offen | Modularer NestJS-Backend vorhanden; Worker-Ausbaustufe und strikte Ports/Adapter-Grenzen nicht als verbindliches Ziel belegt |
| Containerbetrieb und PostgreSQL | Umgesetzt | [Deployment](../operations/deployment.md) |
| Verbindliche Backup- und Restore-Intervalle | Offen | Betriebsdokumentation vorhanden; Einhaltung der alten Zeitvorgaben nicht durch diesen Abgleich nachgewiesen |
| Tests fuer alle alten kritischen Fachprozesse | Offen | Aktuelle [Testdokumentation](../development/testing-and-quality.md) ersetzt keinen Nachweis fuer alte Release-/Scale-Prozesse |

## Erweiterungen gegenueber dem Ausgangskonzept

Der heutige Zuschnitt umfasst insbesondere Verona-Player-Ansichten,
AP-bezogene Feature-Konfiguration, zeitlich eingeschraenkten Credential-Zugang,
Kommentare sowie den Item Explorer mit Entwurf und veroeffentlichtem Stand.
Sie sind im [Grobkonzept](GROBKONZEPT.md) und den verlinkten Detaildokumenten eingeordnet.

## Noch zu treffende Entscheidungen

1. Sind formale Review-Aufgaben und eine getrennte Publisher-Rolle weiterhin erforderlich?
2. Werden kryptografisch signierte AP-Freigaben benoetigt, und was wird dabei signiert?
3. Welche Mutationen muessen mit welcher Aufbewahrung und Manipulationssicherheit protokolliert werden?
4. Muessen alte Scale-, Diff- und Bundle-Merge-Funktionen fachlich erhalten bleiben?
5. Rechtfertigen konkrete Last- oder Laufzeitanforderungen eine Queue und Worker?

Diese Punkte sind Entscheidungsbedarf, keine bereits beschlossene Roadmap.
Bei jeder Klaerung werden Status, Begruendung und ein Link auf Entscheidung oder
Implementierungsnachweis ergaenzt. Die historische Kopie bleibt unveraendert.
