# Hörtranskripte im Review: technische Prüfung zu #278

Refs #278 – [Anforderung](https://github.com/iqb-berlin/content-hub/issues/278).

Stand 13. November 2026. PR #281 enthält die Umsetzung zu #278. Veröffentlichung,
Bereitstellung und fachliche Abnahme stehen aus.

## Verhalten

- Im Review gibt es bei vorhandenen, nicht leeren Transkripten einen eigenen
  Reiter **Hörtranskripte**, auch bei **Reiter „Metadaten“ ausblenden** und bei
  veröffentlichter Spaltensperre für Reviewer.
- Das schließt das gesamte Feld **Transkript Original / Text Original** ein,
  auch wenn es den Originaltext einer Leseaufgabe enthält.
- Andere Metadaten bleiben von dieser Einstellung abhängig. Die separate
  Einstellung zum Ausblenden der Entwicklernamen bleibt wirksam.
- Transkripte erscheinen im Review ausschließlich im neuen Reiter. In regulären
  Aufgabenansichten bleiben sie Teil der bestehenden Metadatenanzeige.
- Zeilenumbrüche bleiben erhalten. Inhalte werden als Text dargestellt.
- Beim Aufgabenwechsel werden alte Inhalte entfernt. Aufgaben ohne Transkript
  erhalten keinen leeren Transkriptreiter. Schmale Ansichten umbrechen die Reiter.
- Der Transkript-Endpunkt gibt ausschließlich passende Aufgabenfelder aus der
  zugeordneten VOMD-Datei zurück, einschließlich Feldern hinter Position zwölf.
  Für die allgemeine Dateivorschau gelten die bisherigen Grenzen.

## Belegte Erkennung und bestätigte Abgrenzung

Die IDs und Bezeichnungen stammen aus den veröffentlichten IQB-Aufgabenprofilen,
abgerufen am 10. November 2026:

| Feld | Quelle / Bedeutung |
| --- | --- |
| `iqb_transcript` | [p12](https://github.com/iqb-vocabs/p12/blob/master/unit.json), [p16](https://github.com/iqb-vocabs/p16/blob/master/unit.json), [p17](https://github.com/iqb-vocabs/p17/blob/master/unit.json): „Hörsequenz Transkript“ bzw. „Transkript“ |
| `iqb_final_transcript` | [p52](https://github.com/iqb-vocabs/p52/blob/master/unit.json), [p55](https://github.com/iqb-vocabs/p55/blob/master/unit.json): „Transkript zur Aufgabe“ |
| `k6` mit Bezeichnung „Transkript zur Aufgabe“ | [p53](https://github.com/iqb-vocabs/p53/blob/master/unit.json), [p54](https://github.com/iqb-vocabs/p54/blob/master/unit.json). Keine Erkennung allein anhand von `k6`: dasselbe Feld bedeutet in p16/p17 „Nebengeräusche“. |
| `iqb_copyright_original` | [p52](https://github.com/iqb-vocabs/p52/blob/master/unit.json) bis [p55](https://github.com/iqb-vocabs/p55/blob/master/unit.json): „Transkript Original / Text Original“ |

Die [fachliche Klarstellung vom 13. November 2026](https://github.com/iqb-berlin/content-hub/issues/278#issuecomment-6854663174)
schließt das vollständige Originalfeld und die veröffentlichte Spaltensperre ein.
Die drei stabilen Transkript-IDs gelten unabhängig von der Bezeichnung. Beim
mehrdeutigen Legacy-Feld `k6` zählt die Bezeichnung „Transkript zur Aufgabe“ mit
normalisierter Groß-/Kleinschreibung und normalisierten Leerzeichen.

## Zugriff und Prüfumfang

`GET /api/view/ap/:apId/review/booklets/:bookletId/units/:unitId/transcripts`
verwendet die vorhandene AP- und Review-Berechtigung. Die Aufgabe muss im
angegebenen Testheft vorkommen. Die Antwort enthält nur Kennung, Bezeichnung und
Text der belegten, nicht leeren Transkriptfelder auf Aufgabenebene. Rohdateien,
Item-Metadaten und übrige Aufgabenmetadaten bleiben unter der veröffentlichten
Spaltenfreigabe geschützt.

Der HTTP-Test `reviewer-columns.e2e-spec.ts` prüft die Antwort für ein Konto
mit reinem Review-Zugang, die Sperre von VOMD-Vorschau und Download, falsche
Testheft- und Aufgabenkennungen sowie Konten ohne Review-Berechtigung. Die
Browser- und Komponententests prüfen Anzeige, Einstellungen, Neuladen,
Aufgabenwechsel und reguläre Aufgabenansichten.

## Reproduktion

Voraussetzungen: unterstützte Node.js-Version, `npm ci` in `backend/` und
`frontend/`, installierte Playwright-Browser. Der Standardaufruf benötigt Docker
für eine isolierte PostgreSQL-16-Testdatenbank. Er verwendet ausschließlich die
Testkonfiguration und temporäre Dateiablagen.

In `frontend/`:

```bash
npm test -- --run
npm run lint
npm run format:check
npm run build
npm run e2e -- review-navigation-metadata.spec.ts --grep 'keeps transcripts|visibility choice' --headed
```

Erwartet: die sechs Browserfälle laufen in den drei konfigurierten Browsern grün.
Alternativ kann eine eigens angelegte, leere lokale Datenbank `contenthub_e2e`
mit dem Testbenutzer `contenthub` verwendet werden. Für den dokumentierten Lauf
ist im Beispiel `127.0.0.1:55481` vorgesehen:

```bash
BROWSER_E2E_USE_EXISTING_DATABASE=true \
BROWSER_E2E_DATABASE_PORT=55481 \
BROWSER_E2E_SKIP_BROWSER_INSTALL=true \
npm run e2e -- review-navigation-metadata.spec.ts --grep 'keeps transcripts|visibility choice' --headed
```

In `backend/`:

```bash
npm test -- --runInBand files.service.spec.ts review.controller.spec.ts
npm run lint
npm run format:check
npm run build
```

Für den HTTP-Test mit einer eigens dafür angelegten lokalen Testdatenbank:

```bash
NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=55481 DB_USERNAME=contenthub \
DB_PASSWORD=contenthub_dev DB_DATABASE=contenthub_e2e DB_SYNCHRONIZE=true \
JWT_SECRET=review-e2e-only-at-least-32-characters \
npm run test:e2e -- --runInBand reviewer-columns.e2e-spec.ts
```

Erwartet: Das Review-Konto erhält für das freigegebene Testheft ausschließlich
die Transkriptfelder (HTTP 200). Die rohe VOMD-Vorschau und der Download liefern
HTTP 403. Frontend und Backend gemeinsam ausliefern.
