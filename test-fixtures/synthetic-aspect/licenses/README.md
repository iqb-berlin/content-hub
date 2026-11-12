# ASPECT 3.0.1 fixture notices

These files accompany the unchanged `../iqb-player-aspect-3.0.1.html` browser
fixture. The application selects a player dynamically for each unit; this
directory is not a fixed production player or part of the runtime archive.

The locked source at commit `b964ba086519cdbc04903f18c36f874f2067f0cd` was rebuilt
with `npm ci --ignore-scripts` and `npm run build-player`. Its output is byte-for-byte
identical to the fixture and official release: SHA-256
`54ee0f792c105c933b1c811ded0ee54eefae8502fa690edb18f6dd0b71c803c2`.
All 1,377 source files were checked against their Git blob identities.

- `ASPECT-MIT.txt` combines the published IQB copyright notice with the
  international MIT terms declared by the player. It is assembled from those
  declarations, not presented as a recovered ASPECT repository LICENSE file.
- `IQB-LICENSE-DE.txt` retains the publisher's complete German policy text.
  Its source revision predates this player release. Human review must confirm
  the applicability of that general IQB policy to this distribution.
- `THIRD_PARTY_LICENSES.txt` is the unmodified license list produced by the
  byte-identical build. It contains a missing-file reference for
  `@ngx-translate/core`; it is therefore supplemented below.
- `NPM_NOTICES.txt` includes the available license/notice files for all 14
  packages found in the upstream build's module statistics. The missing
  ngx-translate notice is recovered from the exact upstream v15.0.0 tag.
- `FONT_NOTICES.txt` retains copyright, license and reserved-name records
  extracted from all 25 embedded fonts. Every font is byte-matched to its
  file in the exact ASPECT source tree. The complete DejaVu/Bitstream/Arev
  text is retained in those extracted records.
- `OFL-1.1.txt`, `MATERIAL-ICONS-APACHE-2.0.txt` and
  `FONT_FAMILY_LICENSES.txt` provide the complete applicable font terms and
  supplementary upstream family notices. Current family-license references
  are not represented as byte matches of current vendor fonts to historical
  ASPECT fonts; the exact embedded records are recorded separately.

`manifest.json` binds the player, rebuild, notice files, locked npm versions
and font identities with hashes and primary-source references. The publisher
policy is at [this immutable source revision](https://github.com/iqb-berlin/iqb-berlin.github.io/blob/7f8de97a55ee271e6e2efc0f06cb9cf81af09dac/license.qmd).
Material Icons licensing is described by [Google](https://developers.google.com/fonts/docs/material_icons#licensing).

The notices supply evidence for human review. They do not manufacture a human
approval or establish the independent rights chain of every upstream contribution.
Keep this directory with the fixture when copying the source fixture.
