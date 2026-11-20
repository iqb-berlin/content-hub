# Browser journey fixture

The critical browser journeys use the synthetic `u1.json` task and the unchanged
ASPECT 3.0.1 release player. The same files belong to the synthetic ASPECT test pool
in PR #253; there are no assessment or participant data in them.

`../browser-journey-package.ts` assembles one task with two pages, metadata, coding,
a Booklet XML and the player. The Chromium import journey uploads these six files
through the application into an empty ACP. Cross-browser navigation and publishing
use separate seeded ACPs with the same content. Publishing changes the preview
target from the destination on page 1 to the transport field on page 2; an
independent reader sees the changed page only after publication and reload.

Player source: [official ASPECT release asset](https://github.com/iqb-berlin/verona-modules-aspect/releases/download/editor/3.0.1%2Bplayer/3.0.1/iqb-player-aspect-3.0.1.html).
SHA-256: `54ee0f792c105c933b1c811ded0ee54eefae8502fa690edb18f6dd0b71c803c2`.
The asset declares MIT in its Verona metadata; embedded third-party notices are
retained. The package helper checks the checksum before use.

Expected visible results are asserted independently in the browser tests: the
headings “Ein Ausflug zum See” and “Die Fahrt zum See”, selectable destinations,
and a writable transport answer. No player or content API responses are mocked.
