# Feinkonzept: Wegweiser

Stand: 2026-09-08. Die bestehenden Detaildokumente bilden gemeinsam das
Feinkonzept. Dieser Einstieg vermeidet doppelte Beschreibungen von APIs,
Datenmodellen und Berechtigungen. Bei Widerspruechen muessen Dokumentation und
Implementierung abgeglichen werden; ein Plan allein belegt keine Implementierung.

| Gegenstand | Massgebliche Detailbeschreibung |
| --- | --- |
| Systemgrenzen und Laufzeit | [Architektur](../architecture/overview.md) |
| Backend-Module und Persistenz | [Backend](../architecture/backend.md) |
| Frontend und Navigation | [Frontend](../architecture/frontend.md) |
| Entitaeten, Beziehungen und JSONB | [Datenmodell](../architecture/data-model.md) |
| Authentifizierung und Autorisierung | [Zugriffskontrolle](../features/access-control.md) |
| Import, Validierung, Snapshots und Kommentare | [AP-Arbeitsablaeufe](../features/acp-workflows.md) |
| Explorer-Entwurf und Veroeffentlichung | [Item Explorer](../features/item-explorer.md) |
| Externe Schnittstellen und Transfer | [Integrationen und API](../features/integrations-and-api.md) |
| Konfiguration | [Konfiguration](../development/configuration.md) |
| Tests und Qualitaetspruefung | [Tests](../development/testing-and-quality.md) |
| Bereitstellung | [Deployment](../operations/deployment.md) |
| Sicherung und Wartung | [Betrieb](../operations/monitoring-and-maintenance.md) |
| Software-Releases und Rollback | [Release-Verfahren](../operations/releases.md) |
| Bedienablaeufe | [AP-Manager-Handbuch](../manuals/acp-manager-manual.md) |

Software-Releases im Betriebsdokument sind von fachlichen AP-Freigaben zu
unterscheiden. Noch offene Anforderungen des Ausgangskonzepts stehen im
[Konzeptabgleich](KONZEPTABGLEICH.md).
