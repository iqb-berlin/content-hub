## Code Review

**Verdict**: APPROVE
**Confidence**: MEDIUM

### Summary

Die AP-Umstellung auf Basis von `52c45037` wurde besonders auf bestehende
Integrationen geprüft. Die erste Fassung `e2eb149f` hatte bestätigte
Kompatibilitätsfehler; die hier beschriebenen Korrekturen und Regressionstests
beheben diese. Es verbleibt kein bestätigter P0-/P1-Befund aus dieser Prüfung.
Das Urteil ist keine Produktions- oder fachliche Abnahme.

### Findings

| Priorität | Bestätigter Fehler der ersten Fassung | Ort der Korrektur | Status |
| --- | --- | --- | --- |
| P1 | Die allgemeine Übersetzung veränderte freie Item-Felder und Tag-Schlüssel wie `apId`/`acpId`; kollidierende Schlüssel konnten in Antworten verloren gehen. | `backend/src/common/ap-contract.ts:58`, `backend/src/items/items.controller.ts:98` | Behoben |
| P1 | Verschachtelte Fallback-Antworten und echte SSE-Jobereignisse lieferten alten Clients `apId` statt `acpId`. Ebenso fehlte die Übersetzung verschachtelter Explorer-Aktoren. | `backend/src/common/ap-contract.interceptor.ts:18`, explizite Handler-Metadaten | Behoben |
| P1 | Legacy-Dateien wie `acp-index.json` mit `[]` oder ohne identifizierende Indexfelder wurden als gültiges allgemeines JSON statt als ungültiger Index behandelt. | `backend/src/validation/validation.service.ts:688` | Behoben |
| P2 | Gemischte Groß-/Kleinschreibung in bislang gültigen API-Pfaden verursachte 404/400 oder eine falsche Behandlung roher Indexdaten. Auch Exportnamen bei `EXPORT/` waren betroffen. | `backend/src/common/ap-compatibility.middleware.ts`, `isRawApIndexPath` | Behoben |
| P2 | Legacy-Unit-Antworten enthielten neue Downloadpfade; Scope-Fehler vor dem Interceptor verwendeten das neue Vokabular. | `backend/src/views/views.controller.ts:375`, `backend/src/api/server-api-auth.guard.ts:39` | Behoben |

### Details

#### [P1] Grenzen zwischen Vertragsfeldern und freien Daten

**File:** `backend/src/common/ap-contract.ts:58`

Die erste Implementierung durchlief jedes `items`-Feld und behandelte jedes
Antwortobjekt als Vertragsobjekt. Ein Item mit zwei frei definierten Feldern
`apId` und `acpId` verlor dadurch ein Feld. Auch GET/PUT der Tag-Dictionaries
veränderten gültige Zeilenschlüssel.

**Suggested fix:** Nur explizit deklarierte Antwort-Container traversieren;
Dictionary-Antworten unverändert durchreichen. Das ist mit
`ApResponseEnvelopes` und `RawApResponse` umgesetzt. Die allgemeinen
Berechtigungs- und Reviewer-Spaltenprüfungen werden weiterhin ausgeführt.
HTTP-Tests prüfen beide Namensfamilien und den vollständigen Erhalt der Daten.

#### [P1] Verschachtelte Legacy-Verträge

**File:** `backend/src/common/ap-contract.interceptor.ts:18`

Die äußeren Antworten wurden übersetzt, `state` und SSE-`data` jedoch nicht.
Alte Clients erhielten dadurch ein anderes Schema als vor der Umstellung.

**Suggested fix:** Die bekannten Container an ihren Handlern deklarieren.
Fallback-Zustände, Explorer-Antworten, Token-Seiten und SSE-Ereignisse werden
gezielt übersetzt. `responseData`, Item-Inhalte und andere Nutzdaten bleiben
unverändert. Ein echter abgeschlossener SSE-Stream und eine gespeicherte
Fallback-Antwort werden über beide API-Familien geprüft.

#### [P1] Schema-Prüfung bestehender Indexdateien

**File:** `backend/src/validation/validation.service.ts:688`

Die reine Umbenennung des Dateinamen-Prädikats entfernte die Erkennung von
`acp-index`. Gültige Indizes mit erkennbaren Paketfeldern wurden weiterhin
erkannt; fehlerhafte Inhalte ohne solche Felder umgingen aber die bisherige
Schema-Prüfung. Drei zusätzliche Negativfälle bestätigten die Regression.

**Suggested fix:** Sowohl `ap-index` als auch `acp-index` unabhängig von der
Groß-/Kleinschreibung erkennen. Beide Dateinamenfamilien werden nun gegen
fehlerhafte Array-/Objektinhalte getestet.

### Validation

- 1.160 Backend-Tests bestanden, einschließlich der bestehenden Coverage-Grenzen.
- 1.182 Frontend-Tests bestanden, einschließlich der bestehenden Coverage-Grenzen.
- 109 PostgreSQL-/HTTP-Tests bestanden. Darin enthalten sind 19 fokussierte
  Vertragsfälle für alte/neue Pfade, Payloads, Rollen, Scopes, Query-Aliase,
  gespeicherte JWTs und Tokens, Paketbeschränkungen, SSE, Fallbacks, freie Daten,
  Dateidownloads und bestehende Tabellen-/Enum-Zuordnungen.
- Die fünf zunächst ergänzten HTTP-Regressionsfälle schlugen auf der ersten
  Fassung fehl. Zusätzliche Negativläufe bestätigten die Legacy-Scope-Meldung,
  den Unit-Downloadpfad und die drei alten Indexdateinamen.
- Neun gezielte Chromium-Browserprüfungen bestanden: altes Lesezeichen,
  unmittelbare Namensanzeige, Verwaltung, Rollen und Navigation.
- Frontend-/Backend-Builds, Lint und Formatierung bestanden.

Reproduzierbare Befehle und die Auswahl des Antwortformats stehen in
[AP API compatibility](../features/ap-api-compatibility.md). Die HTTP-Tests
benötigen eine isolierte Datenbank mit `e2e` im Namen und `NODE_ENV=test`.
Es wurde keine Produktionsdatenbank verändert.

### Recommendation

Die korrigierte Fassung kann in den PR-Review. CI, Release, Deployment und
fachliche Abnahme bleiben getrennte Schritte; es wird nicht automatisch gemergt
oder ein Ticket geschlossen. Die umfassendere Browserprüfung aus dem ersten
Durchlauf war nicht vollständig grün: Der Firefox-Vorschauablauf war instabil;
auf unverändertem `origin/master` scheiterte derselbe Test an einem anderen
Schritt. Dieser Kontrolllauf beweist nicht, dass der identische Menüfehler auf
der Basis vorhanden ist. Die aktuelle Nachprüfung wiederholt die neun gezielten
Chromium-Fälle und behauptet keinen vollständigen Firefox-/WebKit-Nachweis.
