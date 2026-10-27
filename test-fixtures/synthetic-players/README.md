# Synthetischer Formate- und Player-Testpool

Dieser Pool ergänzt die sechs Review-Szenarien unter `../synthetic-aspect` um
44 künstliche Aufgaben; zusammen sind es 50 Aufgaben. Er enthält keine Erhebungs-, Produktions- oder Personendaten.
`pool.json` benennt jede Aufgabe, ihren Originalplayer, ihre Formate und den
Browser-Prüffall. `catalogue.json` hält den abgeglichenen Formatkatalog mit Quellen
fest; ein Komponententest prüft die Vollständigkeit gegen die tatsächlichen
Definitionen, einschließlich verschachtelter ASPECT-Elemente.

## Playerfamilien und Versionen

| Familie | Neue Aufgaben | Player | Definitionen und Prüfumfang |
| --- | --- | --- | --- |
| ASPECT | 29 | 3.0.1, Originaldatei aus dem bisherigen Pool | Alle 30 registrierten Elementtypen der Definition 4.12.0, einschließlich Tabellenzellen, Likert-Zeilen und Lückentextfeldern; zusätzlich Sortierliste. Die sechs bisherigen Aufgaben bleiben bei 4.6.0. |
| ABI | 2 | 5.0.0 | iqb-scripted 1.2: Text, mehrzeiliger Text, Zahl, Checkbox, Checkboxgruppe, Radioauswahl, Dropdown, Likert, Bedingungen und wiederholte Unterformulare; Navigation und statische Textdirektiven. |
| Speedtest Multi | 9 | 3.3.0 | Sämtliche Stimulusarten (`text`, `image`, `audio`, `word-select`, `inline-answers`) und Antwortarten (`text`, `image`, `number`, `audio`), Mehrfachauswahl sowie Zeilen- und Spaltenlayout. |
| Speedtest Mono | 2 | 1.2.0 | Plain-Text-Aufgaben mit zwei und drei Antwortknöpfen und Antwortzeitvariable. |
| Simple HTML | 1 | Release 6.0.4, Moduldatei `verona-player-simple-6.0.html` | Native HTML-Eingaben: Text, Textarea, Zahl, Checkbox, Radio, Select, Mehrfach-Select, Range, Datum, Uhrzeit, Farbe und Contenteditable; zwei Fieldset-Seiten. |
| ItemBuilder (experimentell) | 1 | Wrapper 0.2.0 aus Commit `285e155db7637edfca75191c00c722afe736f510` | Eigene synthetische ItemBuilder-Konfiguration mit Texteingabe, Checkbox und Navigationsknopf; echte DIPF-Runtime 9.9.0. Dies prüft die Integration des experimentellen Wrappers, nicht das gesamte DIPF-Widgetinventar. |

Der Umfang bezieht sich auf diese festgelegten Versionen. Bei Simple HTML ist
beliebiger HTML-/JavaScript-Inhalt möglich; der Pool deckt die nativen
Eingabemechanismen ab, keine beliebigen benutzerdefinierten Programme. Bei Speedtest
werden alle Formatarten geprüft, nicht jedes kartesische Produkt von Stimulus,
Antwortart und Layout. Editoren und Schemer sind keine Playerfamilien.

## ASPECT-Formate

Alle Einträge der [ElementFactory des Release-Tags](https://github.com/iqb-berlin/verona-modules-aspect/blob/editor/3.0.1%2Bplayer/3.0.1/projects/common/utils/element-factory.ts)
sind mit echten Instanzen vertreten:

- Auswahl: `radio`, `checkbox`, `dropdown`, `toggle-button`, `radio-group-images`,
  `likert`, `likert-row`, `slider`, `hotspot-image`.
- Texteingaben: `text-field`, `text-field-simple`, `text-area`, `spell-correct`, `cloze`.
- Zuordnung und Reihenfolge: `drop-list`, einschließlich Sortierliste.
- Mathematik: `math-field`, `text-area-math`, `math-table`, `geometry` (GeoGebra).
- Inhalte und Layout: `text` mit Textmarkierung, `marking-panel`, `image`, `audio`,
  `video`, `frame`, `table` mit Eingabezelle.
- Aktionen und Werkzeuge: `button`, `trigger`, `widget-periodic-table`,
  `widget-molecule-editor`.

`media/` enthält ausschließlich selbst erzeugte geometrische Formen, einen kurzen
Sinuston, ein kurzes VP8-Video dieser Formen und eine selbst geschriebene
GeoGebra-Konstruktion mit einem verschiebbaren Punkt. Die Definitionen enthalten
Medien als Data-URLs; keine fremden Bilder, Sprachaufnahmen oder Aufgaben sind nötig.

## Originalplayer und externe Runtimes

Playerdateien bleiben unverändert. Git darf auch die CRLF-Zeilenenden des ABI-Players
nicht normalisieren; die Vendor-Regeln in `.gitattributes` erhalten die Originalbytes. `pool.json` hält Herkunft und SHA-256 fest;
Seed und Browser prüfen die tatsächlich ausgelieferten Bytes. Lizenzdateien liegen
neben den Modulen, eingebettete Fremdcodehinweise bleiben erhalten. Herkunft:

- [IQB-Releaseliste](https://iqb-berlin.github.io/releases.html)
- [ASPECT 3.0.1](https://github.com/iqb-berlin/verona-modules-aspect/releases/tag/editor/3.0.1%2Bplayer/3.0.1)
- [ABI 5.0.0](https://github.com/iqb-berlin/verona-player-abi/releases/tag/5.0.0)
- [Speedtest Multi 3.3.0](https://github.com/iqb-berlin/verona-modules-speedtest/releases/tag/3.3.0)
- [Speedtest Mono 1.2.0](https://github.com/iqb-berlin/verona-player-speedtest/releases/tag/1.2.0)
- [Simple 6.0.4](https://github.com/iqb-berlin/verona-player-simple/releases/tag/6.0.4)
- [ItemBuilder-Wrapper](https://github.com/iqb-berlin/verona-modules-ib/tree/285e155db7637edfca75191c00c722afe736f510)

Der E2E-Seed lädt das GeoGebra Math Apps Bundle **5.4.933.1** und die beiden
DIPF-Runtimedateien **9.9.0** einmalig in `backend/node_modules/.cache/synthetic-player-resources`.
`resources.json` fixiert URLs, Commit und SHA-256; jede Verwendung prüft die Bytes,
auch bei Cachetreffern. Ein fehlender Download oder eine abweichende Prüfsumme lässt
den Seed fehlschlagen. Nach dem Seed kommen Player-, Aufgaben- und Runtime-Ressourcen vom lokalen
Backend. Die bestehende Anwendungsoberfläche und einzelne Originalplayer laden Schriften weiterhin von Google Fonts. Es gibt keine Player-Stubs, CDN-Umleitungen oder simulierte GeoGebra-API.
GeoGebra unterliegt den [GeoGebra-Lizenzbedingungen](https://www.geogebra.org/license).

Der vorhandene gemeinsame Ressourcen-Mount `/api/shared-assets/GeoGebra/` liefert
auch das synthetische ItemBuilder-Paket aus einem Unterverzeichnis der isolierten
E2E-Dateiablage. Die Unit benennt diesen Paketpfad explizit. Das ist eine
Testkonfiguration; ACP-eigene ItemBuilder-Paketverwaltung wird damit nicht ergänzt.

## Ausführen und Prüfergebnisse

Siehe [E2E-, CI- und Medienanleitung](../../docs/development/synthetic-aspect-pool.md).
Jede Formatprüfung bedient den echten Player und kontrolliert einen sichtbaren
Wert oder Effekt. Bei `widget-periodic-table` und `widget-molecule-editor` wird
die echte `vopWidgetCall`-Anfrage geprüft (`coverage: widget-request-only`).
Content Pool stellt diese beiden Host-Werkzeuge noch nicht bereit; die Tests
öffnen und simulieren keine Ersatzoberfläche. Jede Familie erhält außerdem einen Review-Rundgang mit lesbarer
Kodierung und einem Aufgabenwechsel. Für Formate ohne nachgewiesene automatische
Vorbelegung bleiben die Kodieranweisungen sichtbar; die Tests behaupten keine
automatische Musterlösung. Die ursprünglichen sechs Szenarien prüfen weiterhin
vollständige und teilweise Musterlösungen sowie deren Wiederherstellung.
