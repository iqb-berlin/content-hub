# Grobkonzept: Content Hub

Stand: 2026-09-08. Dieses Dokument konsolidiert die bestehende Architektur- und
Funktionsdokumentation. Es beschreibt den aktuellen fachlichen Zuschnitt; offene
Anforderungen sind im [Konzeptabgleich](KONZEPTABGLEICH.md) getrennt ausgewiesen.
Es ist keine vollstaendige Abnahme oder Sicherheitspruefung der Implementierung.

## Ziel und Umfang

Content Hub verwaltet Assessment Packages (APs), ihre Indexdaten und
Dateien. Verantwortliche bereiten Inhalte auf, pruefen sie, konfigurieren den
Zugang und stellen sie zur Ansicht oder Weiterverarbeitung bereit. Betrachtende
koennen freigeschaltete Aufgaben, Einheiten und Items untersuchen und kommentieren.

Zum aktuellen Umfang gehoeren AP-Verwaltung, Dateiimport und -export,
syntaktische und semantische Validierung, Snapshots mit Vergleich und
Wiederherstellung, AP-bezogene Zugriffsregeln, Verona-Player-Ansichten,
Kommentare, Item Explorer sowie eine authentifizierte Server-API.

Ein formaler Review-Aufgabenprozess, kryptografisch signierte AP-Freigaben und
eine Queue-/Worker-Zielarchitektur sind durch diese Beschreibung nicht zugesagt.
Eine oeffentliche Ansicht oder ein veroeffentlichter Explorer-Stand ist kein
Nachweis eines formal geprueften und signierten AP-Releases.

## Nutzer und Berechtigungen

| Nutzergruppe | Verantwortung und Zugang |
| --- | --- |
| App-Administration | Benutzer, globale Einstellungen und AP-Verwaltung |
| AP_MANAGER | Inhalte und Konfiguration zugewiesener APs bearbeiten |
| READ_ONLY | Zugewiesene APs im erlaubten Funktionsumfang betrachten |
| AP-Zugangsdaten-Nutzer | Auf das zugeordnete AP begrenzter Betrachtungszugang |
| Anonyme Besucher | Oeffentliche APs im freigeschalteten Umfang betrachten |
| Externe Systeme | Server-API mit Token und berechtigten Scopes verwenden |

Registrierte Benutzer authentifizieren sich ueber OIDC/Keycloak. Das Backend
entscheidet anhand der Identitaet, AP-Rollen, des Zugangsmodells und der
Feature-Konfiguration ueber den Zugriff. Details: [Access Control](../features/access-control.md).

## Fachlicher Ablauf

1. AP anlegen und Verantwortliche zuweisen; neue APs beginnen privat.
2. Index importieren oder bearbeiten und zugehoerige Dateien hochladen.
3. Validierungsergebnisse pruefen und Inkonsistenzen korrigieren.
4. Metadaten und Item-Daten aufbereiten; Explorer-Entwuerfe bearbeiten.
5. Vor wichtigen Aenderungen Snapshots fuer Vergleich und Rueckkehr erzeugen.
6. Zugang und Funktionen fuer die vorgesehene Zielgruppe konfigurieren.
7. Inhalte betrachten, im Player pruefen und Kommentare sammeln.
8. Index, Dateien oder AP-Inhalte exportieren bzw. ueber die Server-API uebertragen.

Die Schritte beschreiben einen Arbeitsablauf, keine technisch erzwungene
Freigabe-Statusmaschine. Details: [AP Workflows](../features/acp-workflows.md).

## Architektur und Datenhaltung

Angular stellt das Frontend bereit. Ein modularer NestJS-Backend mit TypeORM
enthaelt API, Autorisierung, Fachlogik und Persistenzzugriff. PostgreSQL speichert
relationale Zuordnungen und variable AP-Daten als JSONB. Binaere Dateien liegen
im Dateisystem und besitzen Datenbankeintraege. Keycloak liefert Identitaeten;
Docker Compose und Reverse-Proxy-Konfigurationen unterstuetzen den Betrieb.

Das AP ist das zentrale Aggregat mit Index, Dateien, Rollen, Zugangsregeln,
Kommentaren und Snapshots. Explorer-Entwurf und veroeffentlichter Explorer-Stand
sind eigenstaendige Zustaende. Sie ersetzen keine globale AP-Release-Historie.

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
