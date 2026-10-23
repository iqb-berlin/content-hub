# Synthetic ASPECT pool

Six artificial tasks exercise the Booklet review with the unmodified **ASPECT 3.0.1**
player and **4.6.0** unit definitions. There are no assessment, participant or
production data in this directory. The definitions are committed snapshots, so
replaying them does not require the editor, another checkout or a generator.

`pool.json` is the entry point. Each task has a definition, an optional coding
scheme and independent expected solution values and unsupported variable IDs.
The component suite checks these expectations against the actual Review component;
the browser suite verifies what the real player displays.

| Task | Coverage |
| --- | --- |
| u1 | Multiple pages, radio selection, text field, coding aliases |
| u2 | Partial solution and manually coded open response |
| u3 | Manual instructions and 2/1/0 points |
| u4 | Alternative correct answers without guessing |
| u5 | Missing coding scheme |
| u6 | Dropdown and unsupported scalar toggle prefill; unacknowledged input |

The normal browser seed registers a separate private ACP, a real Booklet XML and
all player/definition/coding files in the isolated E2E database. Browser tests do
not substitute the player or the content API. Two explicit error cases intercept
only a coding-file download (invalid JSON and a deliberately held response).

## Player provenance

`iqb-player-aspect-3.0.1.html` is the unchanged upstream release asset:

- [Official release](https://github.com/iqb-berlin/verona-modules-aspect/releases/tag/editor/3.0.1%2Bplayer/3.0.1)
- [Original HTML asset](https://github.com/iqb-berlin/verona-modules-aspect/releases/download/editor/3.0.1%2Bplayer/3.0.1/iqb-player-aspect-3.0.1.html)
- SHA-256: `54ee0f792c105c933b1c811ded0ee54eefae8502fa690edb18f6dd0b71c803c2`
- License declared by the asset's Verona metadata: MIT; upstream repository:
  [iqb-berlin/verona-modules-aspect](https://github.com/iqb-berlin/verona-modules-aspect).
  Embedded third-party notices are retained in the HTML.

The seed refuses a changed checksum. To update the player, replace the complete
release artifact, update version/source/checksum in `pool.json` and verify all
cases and review media. Do not update expected answers merely to make a test pass.
Definitions may need an explicit migration when changing player versions.

See [running, CI and media instructions](../../docs/development/synthetic-aspect-pool.md).
