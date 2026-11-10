# Hörtranskripte im Review: technische Prüfung zu #278

Refs #278 – [Anforderung](https://github.com/iqb-berlin/content-hub/issues/278).

Stand: 10. November 2026. Implementiert auf Basis von `master`
`52c45037b769dc631d41490324fd6d168ce8ffb5` und lokal technisch geprüft.
Merge, Release, Deployment und fachliche Abnahme sind noch ausstehend.
Dieses Dokument enthält technische Nachweise und keine fachliche Abnahme.

## Verhalten

- Im Review gibt es bei vorhandenen, nicht leeren Transkripten einen eigenen
  Reiter **Hörtranskripte**, unabhängig von **Reiter „Metadaten“ ausblenden**.
- Das schließt das gesamte Feld **Transkript Original / Text Original** ein,
  auch wenn es den Originaltext einer Leseaufgabe enthält.
- Andere Metadaten bleiben von dieser Einstellung abhängig. Die separate
  Einstellung zum Ausblenden der Entwicklernamen bleibt wirksam.
- Transkripte erscheinen im Review ausschließlich im neuen Reiter. In regulären
  Aufgabenansichten bleiben sie Teil der bestehenden Metadatenanzeige.
- Zeilenumbrüche bleiben erhalten. Inhalte werden als Text dargestellt.
- Beim Aufgabenwechsel werden alte Inhalte entfernt. Aufgaben ohne Transkript
  erhalten keinen leeren Transkriptreiter. Schmale Ansichten umbrechen die Reiter.
- Die VOMD-Vorschau liefert sämtliche Aufgabenfelder. Die bisherige Begrenzung
  auf zwölf Felder unterschlug Transkripte in mehreren Standardprofilen.
  Die übrigen Vorschaugrenzen für Itemtabellen bleiben bestehen.

## Belegte Erkennung und bestätigte Abgrenzung

Die IDs und Bezeichnungen stammen aus den veröffentlichten IQB-Aufgabenprofilen,
abgerufen am 10. November 2026:

| Feld | Quelle / Bedeutung |
| --- | --- |
| `iqb_transcript` | [p12](https://github.com/iqb-vocabs/p12/blob/master/unit.json), [p16](https://github.com/iqb-vocabs/p16/blob/master/unit.json), [p17](https://github.com/iqb-vocabs/p17/blob/master/unit.json): „Hörsequenz Transkript“ bzw. „Transkript“ |
| `iqb_final_transcript` | [p52](https://github.com/iqb-vocabs/p52/blob/master/unit.json), [p55](https://github.com/iqb-vocabs/p55/blob/master/unit.json): „Transkript zur Aufgabe“ |
| `k6` mit Bezeichnung „Transkript zur Aufgabe“ | [p53](https://github.com/iqb-vocabs/p53/blob/master/unit.json), [p54](https://github.com/iqb-vocabs/p54/blob/master/unit.json). Keine Erkennung allein anhand von `k6`: dasselbe Feld bedeutet in p16/p17 „Nebengeräusche“. |
| `iqb_copyright_original` | [p52](https://github.com/iqb-vocabs/p52/blob/master/unit.json) bis [p55](https://github.com/iqb-vocabs/p55/blob/master/unit.json): „Transkript Original / Text Original“ |

Fachliche Entscheidung vom 10. November 2026: Das gesamte gemeinsame Feld
**Transkript Original / Text Original** (`iqb_copyright_original`) soll ebenfalls
unabhängig von **Reiter „Metadaten“ ausblenden** sichtbar bleiben. Das gilt sowohl
für Audio-Originaltranskripte als auch für Originaltexte von Leseaufgaben. Die
bestehende Implementierung und die Komponententests schließen dieses Feld bereits
ein; eine Codeänderung ist für diese Bestätigung nicht erforderlich.
Die Entscheidung klärt den Funktionsumfang und ist keine fachliche Abnahme der
Implementierung auf einer bereitgestellten Instanz.

Erkennung erfolgt über die belegten stabilen IDs oder exakte bekannte
Feldbezeichnungen, mit normalisierter Groß-/Kleinschreibung und Leerzeichen.
Hinweisfelder wie „Hinweise zum Transkript“, Quellenangaben und Nebengeräusche
werden nicht durch eine unscharfe Teiltextsuche eingeblendet.

## Ausgeführte technische Prüfungen

Umgebung: Node.js 25.9.0, getrennte Installation aus den Lockdateien.
Browserfälle: echte Angular-/NestJS-Anwendung mit isolierter lokaler
PostgreSQL-14.24-Datenbank. Inhalte und Player der beiden Reviewaufgaben sind
deterministische Browserfixtures; Review-Konfiguration und Speicherung laufen
über die echte API. Produktionsdaten wurden nicht verwendet oder verändert.

| Prüfung | Ergebnis |
| --- | --- |
| Gesamte Frontend-Suite, `npm test -- --run` | 79 Dateien, 1.186 Tests bestanden |
| Backend `files.service.spec.ts` | 65 Tests bestanden; einschließlich Transkript nach dem zwölften Aufgabenfeld und unveränderter Zeilenumbrüche |
| Frontend und Backend `npm run lint` | bestanden |
| Frontend und Backend `npm run format:check` | bestanden |
| Frontend und Backend `npm run build` | bestanden |
| Gezielte Playwright-Prüfung in Chromium, Firefox und WebKit | 6 Fälle bestanden |
| GitHub-CI für Implementierungscommit `915d1c3f1d671e5c91e451df58f89987f75a16b5` | [CI einschließlich Release-Gate](https://github.com/iqb-berlin/content-hub/actions/runs/42777481316), [NPM Audits](https://github.com/iqb-berlin/content-hub/actions/runs/42777481308) und [CodeQL](https://github.com/iqb-berlin/content-hub/actions/runs/42777477937) erfolgreich; Trivy planmäßig übersprungen |

Die Komponententests prüfen beide Metadateneinstellungen, die belegten
Transkriptvarianten, Abgrenzung anderer Metadaten, Entwicklernamen, Umschalten,
Aufgabenwechsel mit und ohne Transkript, leere Werte und reguläre Ansichten.
Die Browserfälle prüfen zusätzlich Speichern, Neuladen, Rücknavigation und die
Reiterdarstellung bei 390 Pixeln Breite. Desktop- und Mobilaufnahmen wurden visuell
geprüft.

Ein früher Backend-Build und Browserlauf konnten wegen vollem Datenträger nicht
abgeschlossen werden. Nach Bereinigung wiederherstellbarer Installationscaches
wurden die betroffenen Prüfungen erfolgreich wiederholt. Der endgültige Browserlauf
nutzte eine eigene native Testdatenbank, weil der lokale Docker-Dienst nicht mehr
antwortete.

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
war diese ausschließlich auf `127.0.0.1:55478` erreichbar:

```bash
BROWSER_E2E_USE_EXISTING_DATABASE=true \
BROWSER_E2E_DATABASE_PORT=55478 \
BROWSER_E2E_SKIP_BROWSER_INSTALL=true \
npm run e2e -- review-navigation-metadata.spec.ts --grep 'keeps transcripts|visibility choice' --headed
```

In `backend/`:

```bash
npm test -- --runInBand files.service.spec.ts
npm run lint
npm run format:check
npm run build
```

Erwartet: 65 Servicetests und alle statischen Prüfungen grün. Lokale
Browsernachweise liegen unter `frontend/playwright-report/` und
`frontend/test-results/`; beide Verzeichnisse bleiben unversioniert.

Keine Migration und keine neue Konfiguration erforderlich. Für vollständiges
Verhalten müssen Frontend und Backend zusammen ausgeliefert werden: allein der
Frontendwechsel behebt die bisherige serverseitige Kürzung nicht.
