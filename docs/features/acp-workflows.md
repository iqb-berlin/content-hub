# AP Workflows

## Overview

Most product functionality is organized around the AP lifecycle. This guide explains how
an AP typically moves through the system from creation to viewing, review, and export.

## 1. Create the AP

An app admin creates an AP through the AP management API or admin UI.

Core fields:

- `packageId`
- `name`
- `description`

At this stage the AP exists, but it usually still needs:

- an AP-Index,
- files,
- access configuration review,
- role assignments.

New APs are created with a default access configuration of `PRIVATE`, so they are not
publicly visible until a manager changes that setting.

## 2. Configure Access

Before sharing the AP, managers define how it should be exposed.

Typical choices:

- private setup while managers prepare content,
- public preview for open content,
- role-based access for known internal users,
- AP credential list for tightly scoped review access.

This same step also controls feature flags such as:

- whether files can be downloaded,
- whether the item list is visible,
- whether commenting is allowed,
- which comment targets are valid,
- whether user preferences should persist.

## 3. Assign Roles

Role assignment happens separately from the access model.

Typical patterns:

- app admin assigns `ACP_MANAGER` to project maintainers,
- managers or admins assign `READ_ONLY` to internal reviewers,
- credential viewers are handled through the credential list rather than AP role assignment.

Important rule:

- non-admin managers can assign `READ_ONLY`, but only app admins can assign or remove `ACP_MANAGER`.

## 4. Build or Import the AP-Index

The AP-Index is the main structured content payload. Managers can:

- fetch it,
- update it directly,
- import a full replacement JSON payload,
- reset it,
- export it as JSON.

This index drives:

- start-page information,
- unit and sequence navigation,
- many read-only view structures,
- semantic validation cross-references.

## 5. Upload Files

Managers upload files through the file-management endpoints or UI.

The backend then performs follow-up work automatically:

1. file metadata is persisted,
2. the AP-Index can be synchronized from uploaded files,
3. syntactic validation runs per file,
4. semantic AP-wide validation runs across index and file references.

Conflict strategies currently supported on upload:

- `reject`
- `overwrite`
- `keep-both`

## 6. Validate Content

The file and validation subsystems help managers answer several practical questions:

- are required files present for each unit,
- are JSON payloads syntactically valid,
- do referenced files exist,
- do index references point to real units or dependencies,
- is the current AP internally consistent.

Validation feedback is stored with file metadata so the UI can surface the result later.

## 7. Explore and Refine Item Data

Once content is loaded, the item workflows become relevant:

- browse item lists,
- filter and sort by metadata,
- manage shared tags,
- import empirical difficulties,
- edit explorer draft state,
- persist viewer preferences if enabled.

For collaborative metadata curation, the Item Explorer is the main UI. It is documented in
[Item Explorer](item-explorer.md).

## 8. Create Snapshots

Snapshots are the rollback and comparison mechanism for APs.

Managers should create a snapshot:

- before a major index import,
- before large file replacement work,
- before publishing important item explorer changes,
- before external transfer operations that may be hard to undo.

Snapshots support:

- list,
- detail,
- diff against previous snapshot,
- diff against current state,
- restore,
- delete.

## 9. Prepare and Run Review

Review management and Review participation use separate entry points:

1. A user with `review:manage` opens the Review card on the AP management overview.
2. `Bereitschaft prüfen` validates files, semantic references, the Review manifest, referenced
   Units, Unit definitions, and players.
3. Technical blockers prevent a new Review activation. Non-blocking warnings can be confirmed.
4. The manager configures visibility and optional Review groups, activates Review, and grants
   `review:participate` to the intended user accounts or AP credentials.
5. Participants open the Review card on the AP start page and select a Booklet directly.
6. The Booklet workspace shows the player and the Review panel side by side.

Review readiness has three states:

- `READY`: the technical Review path is complete;
- `WARNING`: Review is possible, but the manager must confirm the reported warnings;
- `BLOCKED`: a Booklet, referenced Unit, Unit definition, player, or another required structure is
  missing or invalid.

The readiness check is not a formal release approval. It verifies that the material can be opened
for Review; content quality is still assessed during Review.

`review:manage` does not imply `review:participate`. Review groups control comment visibility but do
not grant AP or Review access.

## 10. Collect Comments

Comments can target:

- units,
- items,
- task sequences.

Commenting is enabled separately under `Zugriff & Funktionen`; activating Review alone does not
enable comment targets. Managers can export comments as:

- JSON
- XLSX

Non-manager users can export only the subset they are allowed to see.

For item comments, managers also choose a visibility mode. Existing APs default to `PRIVATE`;
`SHARED` must be selected explicitly before authenticated AP users can see and reply to each
other's comments in the Item Explorer. Users can edit or delete only comments they authored.

## 11. Export or Integrate

When an AP is ready for handoff or synchronization, there are several export paths:

- AP-Index JSON export,
- file download and ZIP export,
- full AP transfer through the server API,
- coding-scheme replacement through the server API for managed update workflows.

## Practical Manager Checklist

When setting up a new AP, a good sequence is:

1. create the AP,
2. set access model and feature flags,
3. assign manager roles,
4. import or initialize the AP-Index,
5. upload files,
6. review validation output,
7. adjust metadata columns and tags,
8. create a snapshot,
9. test the read-only view as the intended audience,
10. export or share access.

## Related Documents

- [Access Control](access-control.md)
- [Item Explorer](item-explorer.md)
- [Integrations and API](integrations-and-api.md)
