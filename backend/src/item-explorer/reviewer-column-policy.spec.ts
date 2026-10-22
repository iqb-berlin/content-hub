import { buildReviewManifest } from "../review/review-manifest";
import { ReviewerColumnsInterceptor } from "./reviewer-columns.interceptor";
import { lastValueFrom, of } from "rxjs";
import { ReviewerColumnPolicy } from "./reviewer-column-policy";

const policy = (...visible: string[]) =>
  new ReviewerColumnPolicy({
    restrictReviewerColumnsToManagerSelection: true,
    layout: { configured: true, visible, order: visible, widths: {} },
  });

describe("Reviewer column information boundary", () => {
  it("preserves feature-gated Studio comments independently of table column restrictions", () => {
    const studioComments = [
      { id: 1, body: "Imported Studio hint", hidden: false },
    ];
    expect(
      policy().projectItem({
        itemId: "i1",
        studioComments,
        unitLabel: "Hidden label",
      }),
    ).toEqual({ itemId: "i1", studioComments });
  });
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "handles custom metadata named %s without inherited dictionary entries",
    (id) => {
      const metadata = Object.fromEntries([[id, "custom value"]]);
      const visible = policy(`metadata:${id}`);
      expect(
        visible.projectItem({
          itemId: "I",
          metadata,
          [id]: "hidden top-level value",
        }),
      ).toEqual({ itemId: "I", metadata });
      expect(policy().projectMetadata(metadata)).toEqual({});
      expect(visible.allowsField(id)).toBe(false);
      expect(visible.allowsExportField(id)).toBe(false);
      const settings = {
        visible: [id],
        order: [id],
        widths: { [id]: 140 },
        definitions: [{ id, label: id }],
      };
      expect(visible.projectColumnSettings(settings)).toMatchObject(settings);
      expect(policy().projectColumnSettings(settings)).toMatchObject({
        visible: [],
        order: [],
        widths: {},
        definitions: [],
      });
      expect(visible.projectResponse({ columns: [{ id }], metadata })).toEqual({
        columns: [{ id }],
        metadata,
      });
      // Malformed legacy layout keys must not resolve through Object.prototype.
      expect(() =>
        policy(id).projectColumnSettings({
          layout: { visible: [id], order: [id] },
        }),
      ).not.toThrow();
      expect(() => visible.projectResponse({ [id]: "value" })).not.toThrow();
    },
  );

  it("projects start-page and standalone sequence summaries without leaking labels", () => {
    const sequences = [
      {
        id: "B",
        kind: "booklet",
        name: "Hidden name",
        instrumentName: "Hidden instrument",
        bookletDefinitionId: "Hidden.xml",
      },
      { id: "M", name: "Hidden module" },
    ];
    const expected = [{ id: "B", kind: "booklet" }, { id: "M" }];
    expect(policy().projectResponse({ sequences })).toEqual({
      sequences: expected,
    });
    expect(policy().projectResponse(sequences, "sequences")).toEqual(expected);
    expect(policy("metadata:booklet").projectResponse({ sequences })).toEqual({
      sequences,
    });
    expect(sequences[0].name).toBe("Hidden name");
    const legacy = {
      id: "M",
      name: "Hidden module",
      units: [{ id: "U", name: "Unit name" }],
    };
    expect(policy().projectResponse(legacy, "sequences")).toEqual({
      id: "M",
      units: [{ id: "U" }],
    });
    expect(
      policy("system:unitLabel").projectResponse(legacy, "sequences"),
    ).toEqual({ id: "M", units: [{ id: "U", name: "Unit name" }] });
  });

  it("preserves existing payloads when disabled", () => {
    const payload = { items: [{ itemId: "I", empiricalDifficulty: 12 }] };
    expect(new ReviewerColumnPolicy().projectResponse(payload)).toBe(payload);
  });

  it("projects both native values and metadata without mutating shared cached data", () => {
    const item = {
      itemId: "I",
      rowKey: "U_I",
      unitLabel: "Secret",
      empiricalDifficulty: 123,
      bista: 456,
      metadata: {
        empiricalDifficulty: "123",
        bista: "456",
        skill: "read",
        future: "secret",
      },
      futureField: "secret",
      tags: ["internal"],
    };
    const result = policy("metadata:skill", "metadata:bista").projectItem(item);
    expect(result).toEqual({
      itemId: "I",
      rowKey: "U_I",
      bista: 456,
      metadata: { skill: "read", bista: "456" },
    });
    expect(item.empiricalDifficulty).toBe(123);
    expect(
      policy("system:empiricalDifficulty").projectItem(item),
    ).toHaveProperty("empiricalDifficulty", 123);
  });

  it.each([
    ["metadata:iqb_time_item", "itemTimeSeconds", "iqb_time_item"],
    ["metadata:iqb_item_time", "itemTimeSeconds", "iqb_item_time"],
    ["metadata:iqb_time_stimulus", "stimulusTimeSeconds", "iqb_time_stimulus"],
  ])(
    "projects canonical time values released through %s",
    (legacyColumn, canonicalField, metadataId) => {
      const restricted = policy(legacyColumn);
      const item = {
        itemId: "I",
        [canonicalField]: 45,
        metadata: { [metadataId]: "00:45" },
      };

      expect(restricted.allowedColumns).toContain(`metadata:${canonicalField}`);
      expect(restricted.allowsField(canonicalField)).toBe(true);
      expect(restricted.projectItem(item)).toEqual({
        itemId: "I",
        [canonicalField]: 45,
        metadata: {},
      });
      expect(
        restricted.projectColumnSettings({
          visible: [metadataId],
          order: [metadataId],
          widths: { [metadataId]: 180 },
          definitions: [{ id: metadataId, label: "Zeit" }],
          layout: {
            configured: true,
            visible: ["system:itemId", legacyColumn],
            order: ["system:itemId", legacyColumn],
            widths: { [legacyColumn]: 180 },
          },
        }),
      ).toMatchObject({
        visible: [metadataId],
        order: [metadataId],
        widths: { [metadataId]: 180 },
        definitions: [{ id: metadataId, label: "Zeit" }],
        layout: {
          visible: ["system:position", "system:itemId", legacyColumn],
          order: ["system:position", "system:itemId", legacyColumn],
          widths: { [legacyColumn]: 180 },
        },
      });
    },
  );

  it("does not release raw time metadata through a canonical column", () => {
    expect(
      policy("metadata:itemTimeSeconds").projectItem({
        itemId: "I",
        itemTimeSeconds: 45,
        metadata: {
          iqb_time_item: "UNRELEASED_TEXT",
          iqb_item_time: "ALSO_UNRELEASED",
        },
      }),
    ).toEqual({ itemId: "I", itemTimeSeconds: 45, metadata: {} });
  });

  it("removes unpublished state, hidden filters and hidden metadata definitions", () => {
    const state = {
      ui: { filter: "secret" },
      tags: { I: ["secret"] },
      itemProperties: { I: { bista: 123 } },
      metadataColumns: {
        layout: {
          configured: true,
          visible: ["metadata:bista"],
          order: ["metadata:bista"],
        },
      },
    };
    const result = policy().projectResponse({
      publishedState: state,
      draftState: { secret: "draft" },
      activeState: {},
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.draftState).toEqual(result.publishedState);
    expect(result.activeState.metadataColumns.layout.visible).toEqual([
      "system:position",
      "system:itemId",
    ]);
  });

  it("keeps position visible for legacy restricted layouts and honors schema 3 hiding", () => {
    const legacy = new ReviewerColumnPolicy({
      restrictReviewerColumnsToManagerSelection: true,
      layout: {
        configured: true,
        visible: ["system:itemId"],
        order: ["system:itemId"],
        widths: {},
        schemaVersion: 2,
      },
    });
    const current = new ReviewerColumnPolicy({
      restrictReviewerColumnsToManagerSelection: true,
      layout: {
        configured: true,
        visible: ["system:itemId"],
        order: ["system:itemId"],
        widths: {},
        schemaVersion: 3,
      },
    });

    expect(legacy.allows("system:position")).toBe(true);
    expect(legacy.projectColumnSettings({ layout: {} }).layout).toMatchObject({
      visible: ["system:position", "system:itemId"],
      order: ["system:position", "system:itemId"],
    });
    expect(current.allows("system:position")).toBe(false);
    expect(current.projectColumnSettings({ layout: {} }).layout).toMatchObject({
      visible: ["system:itemId"],
      order: ["system:itemId"],
    });
  });

  it("also projects index-shaped unit items and fails closed for new fields", () => {
    expect(
      policy().projectResponse({
        units: [
          {
            id: "U",
            name: "Secret",
            description: "Secret",
            futureField: "Secret",
            items: [
              {
                id: "I",
                name: "Secret",
                futureParameter: 123,
                metadata: { hidden: "Secret" },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      units: [{ id: "U", items: [{ id: "I", metadata: {} }] }],
    });
  });

  it("allows personal data and the identity while refusing future shared columns", () => {
    const restricted = policy();
    expect(restricted.allows("personal:note")).toBe(true);
    expect(restricted.allows("system:itemId")).toBe(true);
    expect(restricted.allows("metadata:future")).toBe(false);
    expect(
      restricted.projectResponse({
        rowData: { I: { tags: ["my tag"], note: "my note" } },
      }),
    ).toEqual({ rowData: { I: { tags: ["my tag"], note: "my note" } } });
    expect(restricted.allowsExportField("note")).toBe(true);
    expect(restricted.allowsExportField("rowKey")).toBe(false);
    expect(restricted.allowsExportField("subId")).toBe(false);
    expect(policy("system:subId").allowsExportField("subId")).toBe(true);
    expect(restricted.allowsExportField("empiricalDifficulty")).toBe(false);
    expect(restricted.allowsExportField("competenceLevel")).toBe(false);
    expect(restricted.allowsExportField("personalCompetenceLevel")).toBe(true);
    expect(
      policy("metadata:competenceLevel").allowsExportField("competenceLevel"),
    ).toBe(true);
  });

  it("separates booklet names from positions and removes raw metadata dependencies", () => {
    const restricted = policy("metadata:bookletPosition");
    expect(
      restricted.projectItem({
        itemId: "I",
        bookletOccurrences: [{ booklet: "Secret booklet", position: 2 }],
      }),
    ).toEqual({ itemId: "I", bookletOccurrences: [{ position: 2 }] });
    expect(
      restricted.projectResponse({
        dependencies: [
          { type: "METADATA", downloadUrl: "secret" },
          { type: "PLAYER", fileId: "P" },
        ],
      }),
    ).toEqual({ dependencies: [{ type: "PLAYER", fileId: "P" }] });
  });
});

describe("Restricted review navigation", () => {
  const manifest = () =>
    buildReviewManifest(
      {
        assessmentParts: [
          {
            units: [
              {
                id: "U",
                name: "SECRET_UNIT",
                items: [{ id: "I", name: "SECRET_ITEM" }],
              },
            ],
            bookletModules: [
              {
                id: "M",
                name: "SECRET_BLOCK",
                units: [{ id: "U" }, { id: "U", alias: "repeat" }],
              },
            ],
            instruments: [
              {
                testcenterBooklet: [
                  { id: "B", name: "SECRET_BOOKLET", modules: ["M"] },
                ],
              },
            ],
          },
        ],
      },
      new Map(),
    );

  it.each([
    [[]],
    [["metadata:booklet"]],
    [["system:unitLabel"]],
    [["metadata:booklet", "system:unitLabel"]],
  ])(
    "preserves navigation and applies independent label releases (%j)",
    (visible: string[]) => {
      const original = manifest();
      const before = JSON.stringify(original);
      const projected = policy(...visible).projectReviewManifest(original);
      const booklet = projected.booklets[0];
      expect(booklet.id).toBe("B");
      expect(booklet.units.map((unit) => unit.id)).toEqual(["U", "U"]);
      expect(new Set(booklet.units.map((unit) => unit.occurrenceId)).size).toBe(
        2,
      );
      expect(() =>
        booklet.units.forEach((unit) => unit.blockPath.length),
      ).not.toThrow();
      expect(booklet.name).toBe(
        visible.includes("metadata:booklet") ? "SECRET_BOOKLET" : "",
      );
      expect(booklet.children[0].label).toBe(
        visible.includes("metadata:booklet") ? "SECRET_BLOCK" : "",
      );
      expect(booklet.units[0].blockPath).toEqual(
        visible.includes("metadata:booklet") ? ["SECRET_BLOCK"] : [],
      );
      expect(booklet.children[0].children![0].label).toBe(
        visible.includes("system:unitLabel") ? "SECRET_UNIT" : "",
      );
      expect(booklet.units[0].name).toBe(
        visible.includes("system:unitLabel") ? "SECRET_UNIT" : "",
      );
      expect(JSON.stringify(projected)).not.toContain("SECRET_ITEM");
      expect(JSON.stringify(original)).toBe(before);
    },
  );

  it("uses the manifest projection on the review handler path", async () => {
    const restricted = policy();
    const states = {
      getPublishedColumnPolicy: jest.fn().mockResolvedValue(restricted),
      assertColumnPolicyCurrent: jest.fn(),
    };
    const interceptor = new ReviewerColumnsInterceptor(
      states as any,
      {} as any,
      {} as any,
    );
    class ReviewController {}
    function getReview() {}
    const req = {
      params: { acpId: "ACP" },
      acpCapabilities: ["review:participate", "item-explorer:view"],
    };
    const context = {
      getClass: () => ReviewController,
      getHandler: () => getReview,
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    };
    const result = await lastValueFrom(
      await interceptor.intercept(context as any, {
        handle: () => of(manifest()),
      }),
    );
    expect(result.booklets[0].units[0].blockPath).toEqual([]);
    expect(result.booklets[0].units[0].occurrenceId).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("SECRET_");
    expect(states.assertColumnPolicyCurrent).toHaveBeenCalled();
  });

  it.each([
    [[]],
    [["metadata:booklet"]],
    [["system:unitLabel"]],
    [["metadata:booklet", "system:unitLabel"]],
  ])(
    "projects the booklet-opening handler with releases %j",
    async (visible: string[]) => {
      const restricted = policy(...visible);
      const states = {
        getPublishedColumnPolicy: jest.fn().mockResolvedValue(restricted),
        assertColumnPolicyCurrent: jest.fn(),
      };
      const interceptor = new ReviewerColumnsInterceptor(
        states as any,
        {} as any,
        {} as any,
      );
      class ViewsController {}
      function getSequence() {}
      const req = {
        params: { acpId: "ACP", sequenceId: "B" },
        query: { kind: "booklet" },
        acpCapabilities: ["item-explorer:view"],
      };
      const context = {
        getClass: () => ViewsController,
        getHandler: () => getSequence,
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({ setHeader: jest.fn() }),
        }),
      };
      const original = manifest().booklets[0];
      const before = JSON.stringify(original);
      const project = async (response: any) =>
        lastValueFrom(
          await interceptor.intercept(context as any, {
            handle: () => of(response),
          }),
        );
      const result = await project(original);
      expect(result.name).toBe(
        visible.includes("metadata:booklet") ? "SECRET_BOOKLET" : "",
      );
      expect(result.children[0].children[0].label).toBe(
        visible.includes("system:unitLabel") ? "SECRET_UNIT" : "",
      );
      expect(result.units[0].occurrenceId).toBe(original.units[0].occurrenceId);
      expect(Array.isArray(result.units[0].blockPath)).toBe(true);
      expect(JSON.stringify(original)).toBe(before);
      expect(await project(null)).toBeNull();
      expect(states.assertColumnPolicyCurrent).toHaveBeenCalled();
    },
  );

  it("preserves unrestricted manifests", () => {
    const original = manifest();
    expect(new ReviewerColumnPolicy().projectReviewManifest(original)).toBe(
      original,
    );
  });
});
