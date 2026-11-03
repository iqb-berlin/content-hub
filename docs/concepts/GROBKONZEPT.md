# Grobkonzept: Content Hub

Stand: 2026-09-08. Dieses Dokument konsolidiert die bestehende Architektur- und
Funktionsdokumentation. Es beschreibt den aktuellen fachlichen Zuschnitt; offene
Anforderungen sind im [Konzeptabgleich](KONZEPTABGLEICH.md) getrennt ausgewiesen.
Es ist keine vollstaendige Abnahme oder Sicherheitspruefung der Implementierung.

## Ziel und Umfang

Content Hub verwaltet Assessment Content Packages (ACPs), ihre Indexdaten und
Dateien. Verantwortliche bereiten Inhalte auf, pruefen sie, konfigurieren den
Zugang und stellen sie zur Ansicht oder Weiterverarbeitung bereit. Betrachtende
koennen freigeschaltete Aufgaben, Einheiten und Items untersuchen und kommentieren.

Zum aktuellen Umfang gehoeren ACP-Verwaltung, Dateiimport und -export,
syntaktische und semantische Validierung, Snapshots mit Vergleich und
Wiederherstellung, ACP-bezogene Zugriffsregeln, Verona-Player-Ansichten,
Kommentare, Item Explorer sowie eine authentifizierte Server-API.

Ein formaler Review-Aufgabenprozess, kryptografisch signierte ACP-Freigaben und
eine Queue-/Worker-Zielarchitektur sind durch diese Beschreibung nicht zugesagt.
Eine oeffentliche Ansicht oder ein veroeffentlichter Explorer-Stand ist kein
Nachweis eines formal geprueften und signierten ACP-Releases.

## Nutzer und Berechtigungen

| Nutzergruppe | Verantwortung und Zugang |
| --- | --- |
| App-Administration | Benutzer, globale Einstellungen und ACP-Verwaltung |
| ACP_MANAGER | Inhalte und Konfiguration zugewiesener ACPs bearbeiten |
| READ_ONLY | Zugewiesene ACPs im erlaubten Funktionsumfang betrachten |
| ACP-Zugangsdaten-Nutzer | Auf das zugeordnete ACP begrenzter Betrachtungszugang |
| Anonyme Besucher | Oeffentliche ACPs im freigeschalteten Umfang betrachten |
| Externe Systeme | Server-API mit Token und berechtigten Scopes verwenden |

Registrierte Benutzer authentifizieren sich ueber OIDC/Keycloak. Das Backend
entscheidet anhand der Identitaet, ACP-Rollen, des Zugangsmodells und der
Feature-Konfiguration ueber den Zugriff. Details: [Access Control](../features/access-control.md).

## Fachlicher Ablauf

1. ACP anlegen und Verantwortliche zuweisen; neue ACPs beginnen privat.
2. Index importieren oder bearbeiten und zugehoerige Dateien hochladen.
3. Validierungsergebnisse pruefen und Inkonsistenzen korrigieren.
4. Metadaten und Item-Daten aufbereiten; Explorer-Entwuerfe bearbeiten.
5. Vor wichtigen Aenderungen Snapshots fuer Vergleich und Rueckkehr erzeugen.
6. Zugang und Funktionen fuer die vorgesehene Zielgruppe konfigurieren.
7. Inhalte betrachten, im Player pruefen und Kommentare sammeln.
8. Index, Dateien oder ACP-Inhalte exportieren bzw. ueber die Server-API uebertragen.

Die Schritte beschreiben einen Arbeitsablauf, keine technisch erzwungene
Freigabe-Statusmaschine. Details: [ACP Workflows](../features/acp-workflows.md).

## Architektur und Datenhaltung

Angular stellt das Frontend bereit. Ein modularer NestJS-Backend mit TypeORM
enthaelt API, Autorisierung, Fachlogik und Persistenzzugriff. PostgreSQL speichert
relationale Zuordnungen und variable ACP-Daten als JSONB. Binaere Dateien liegen
im Dateisystem und besitzen Datenbankeintraege. Keycloak liefert Identitaeten;
Docker Compose und Reverse-Proxy-Konfigurationen unterstuetzen den Betrieb.

Das ACP ist das zentrale Aggregat mit Index, Dateien, Rollen, Zugangsregeln,
Kommentaren und Snapshots. Explorer-Entwurf und veroeffentlichter Explorer-Stand
sind eigenstaendige Zustaende. Sie ersetzen keine globale ACP-Release-Historie.

## Qualitaetsziele

- Backend-seitige Zugriffskontrolle fuer Inhalte und Verwaltungsaktionen.
- Verstaendliche Validierungsrueckmeldungen fuer Index und Dateireferenzen.
- Vergleich und Wiederherstellung historischer Inhalte ueber Snapshots.
- Nachvollziehbare Aenderungen in den vorhandenen Explorer- und Server-API-Protokollen.
- Reproduzierbarer Betrieb mit Migrationen, Healthchecks und Backup-/Restore-Verfahren.

Diese Ziele sind keine Garantie vollstaendiger Audit-Abdeckung oder bereits
erreichter Betriebs-SLAs. Konkrete Verfahren stehen in der Detaildokumentation.

## Dokumentationspflege

Bei fachlichen Aenderungen werden dieses Grobkonzept und die betroffenen
Detaildokumente gemeinsam angepasst. Offene Entscheidungen werden erst nach
einer begruendeten Entscheidung als bewusst verworfen markiert. Historische
Implementierungsplaene dienen als Hintergrund, nicht als Nachweis fertiger Funktionen.

Weiter: [Feinkonzept](FEINKONZEPT.md), [Konzeptabgleich](KONZEPTABGLEICH.md),
[historische Herkunft](legacy/README.md).
