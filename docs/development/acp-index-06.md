# ACP index 0.6

The validation and management workflows target the official **development schema
`acp-index@0.6`**, checked on 2026-10-23. The latest GitHub release is still
[0.5](https://github.com/iqb-specifications/acp-index/releases/tag/0.5).
The change to 0.6 is intentional and does not imply that upstream has published
an 0.6 release. The human-readable upstream documentation can still display 0.5.

## Schema sources

The vendored JSON files are the official schemas, with formatting normalized:

| Local schema | Upstream source |
| --- | --- |
| `acp-index-0.6.schema.json` | [ACP index, commit 721b07c](https://github.com/iqb-specifications/acp-index/blob/721b07cfe729f329a1a542eca21f4adb18913c8f/acp-index.schema.json) |
| `acp-scale-base-0.4.schema.json` | [Base scales, commit 9302569](https://github.com/iqb-specifications/acp-scale-base/blob/930256936bdd2fbc95e8a0af6f7060e75cf697d3/acp-scale-base.schema.json) |
| `acp-scale-derived-0.4.schema.json` | [Derived scales, commit 954b58d](https://github.com/iqb-specifications/acp-scale-derived/blob/954b58dd2e3fa803569b8dbd539ccbd4ff460c5a/acp-scale-derived.schema.json) |

The unchanged dependencies remain `acp-unit@0.5` and
`metadata-values@iqb-standard@3.0`. The old `acp-scale@0.2` schema is retained only
to recognize well-formed legacy scales during migration.

`version` inside an ACP index is the **content package's SemVer version**,
independent of the schema version. Migration preserves it. Validation reports and
`acpIndexSchemaId` identify the schema as `acp-index@0.6`.

## Scale structure and validation

Each assessment part has optional `baseScales` and `derivedScales` arrays instead
of `scales`. Base scales contain `method`, `items` and optional method parameters
directly. Derived scales contain string `sources`, an optional method
(`MAP`, `SUM`, `MEAN`), mappings with object-valued `newValue`, and an optional
`mappingsElse` object.

Validation checks base-scale item references (including unit aliases), unique
scale IDs within each part, references within that same part, and cycles between
derived scales. When external checks are requested, public-vocabulary suffixes
in both mappings and the fallback must exist in `publicVocabularyUrl`. The same
bounded cache and safe resource loading as metadata validation apply. Schema
errors prevent saving; semantic and external-resource errors prevent publication.

## Migration of existing indexes

Use **Migration preview** before applying. Applying takes a snapshot and requires
the current revision. The preview does not change stored data.

- Legacy base scales move their type parameters directly into `baseScales`.
- Legacy derived scales become `MAP` scales with a single source. Numeric outputs,
  labels and descriptions move into `newValue` objects. The old implicit fallback
  of zero becomes an explicit `mappingsElse.value`.
- Unweighted aggregate scales become derived `SUM` or `MEAN` scales. A missing
  legacy method keeps its old `SUM` default.
- Non-unit aggregation weights, legacy vocabulary relationships and malformed
  scales require a domain decision. They remain intact in the preview with
  `SCALE_MIGRATION_REVIEW_REQUIRED`; applying is blocked until corrected. No
  weights or vocabulary relationships are silently discarded.
- Existing 0.6 scales remain intact. An already migrated index is unchanged by a
  second migration preview.

Released packages must be reopened before modification. Database schema changes
still use the original `AcpIndex05Compliance1785000000000` migration identity so
that installations which tested the earlier branch do not apply it twice. On
startup, all existing indexes are revalidated against 0.6 without modifying their
content.
