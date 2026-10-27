import { normalizeFeatureConfig } from "./feature-config.utils";

describe("normalizeFeatureConfig", () => {
  it.each([undefined, false, "true", 1, true])(
    "only explicitly enables Studio comments for boolean true (%s)",
    (value) => {
      expect(
        normalizeFeatureConfig({ showStudioItemComments: value })
          .showStudioItemComments,
      ).toBe(value === true);
    },
  );
  it("normalizes personal item working-data configuration", () => {
    expect(
      normalizeFeatureConfig({
        enablePersonalItemData: true,
        enableItemCollections: true,
        personalItemCategoryLabel: " Stufe ",
        personalItemCategoryValues: ["I", " I ", "II", ""],
        personalItemTagLabel: " Sichtung ",
        personalItemTags: [
          { label: "Prüfen", color: "#ABCDEF" },
          { label: "Prüfen", color: "#000000" },
          { label: "Offen", color: "invalid" },
        ],
      }),
    ).toMatchObject({
      enablePersonalItemData: true,
      enableItemCollections: true,
      personalItemCategoryLabel: "Stufe",
      personalItemCategoryValues: ["I", "II"],
      personalItemTagLabel: "Sichtung",
      personalItemTags: [
        { label: "Prüfen", color: "#abcdef" },
        { label: "Offen", color: "#3498db" },
      ],
    });
  });

  it("limits every personal item category value", () => {
    const longValue = "x".repeat(250);

    const normalized = normalizeFeatureConfig({
      personalItemCategoryValues: [longValue, `${"x".repeat(200)}duplicate`],
    });

    expect(normalized.personalItemCategoryValues).toEqual(["x".repeat(200)]);
  });

  it("defaults player focus highlight to disabled when the flag is missing", () => {
    const normalized = normalizeFeatureConfig({
      enableItemList: true,
    });

    expect(normalized).toMatchObject({
      enableItemList: true,
      enablePlayerFocusHighlight: false,
    });
  });

  it("normalizes partial-credit labels", () => {
    const normalized = normalizeFeatureConfig({
      itemSubIdLabel: "  Kategorie  ",
      itemSubIdLabels: {
        " 1 ": "  teilweise richtig ",
        "2": "vollständig richtig",
        empty: "   ",
      },
    });

    expect(normalized).toMatchObject({
      itemSubIdLabel: "Kategorie",
      itemSubIdLabels: {
        "1": "teilweise richtig",
        "2": "vollständig richtig",
      },
    });
  });

  it("migrates legacy itemListMetadataColumns to metadataColumns", () => {
    const normalized = normalizeFeatureConfig({
      enableItemList: true,
      itemListMetadataColumns: ["colA", "colB"],
    });

    expect(normalized).toMatchObject({
      enableItemList: true,
      metadataColumns: {
        visible: ["colA", "colB"],
        order: ["colA", "colB"],
      },
    });
    expect(normalized).not.toHaveProperty("itemListMetadataColumns");
  });

  it("keeps canonical metadataColumns and strips legacy key", () => {
    const normalized = normalizeFeatureConfig({
      metadataColumns: {
        visible: ["visible-1"],
        order: ["order-1", "order-2"],
      },
      itemListMetadataColumns: ["legacy-1"],
    });

    expect(normalized).toMatchObject({
      metadataColumns: {
        visible: ["visible-1"],
        order: ["order-1", "order-2"],
      },
    });
    expect(normalized).not.toHaveProperty("itemListMetadataColumns");
  });

  it("fills missing metadataColumns order from visible list", () => {
    const normalized = normalizeFeatureConfig({
      metadataColumns: {
        visible: ["meta-1", "meta-2"],
      },
    });

    expect(normalized).toMatchObject({
      metadataColumns: {
        visible: ["meta-1", "meta-2"],
        order: ["meta-1", "meta-2"],
      },
    });
  });

  it("keeps reference-number visibility opt-in for existing ACPs", () => {
    expect(
      normalizeFeatureConfig({
        metadataColumns: {
          visible: [],
          order: [],
          referenceNumberVisible: true,
        },
      }),
    ).toMatchObject({
      metadataColumns: {
        visible: [],
        order: [],
        referenceNumberVisible: true,
      },
    });

    expect(normalizeFeatureConfig({ enableItemList: true })).not.toHaveProperty(
      "metadataColumns.referenceNumberVisible",
    );
  });

  it("applies the ACP coding display defaults", () => {
    expect(normalizeFeatureConfig({})).toMatchObject({
      showGeneralCodingInstructions: false,
      preferManualCodingInstructions: true,
    });
    expect(
      normalizeFeatureConfig({
        showGeneralCodingInstructions: true,
        preferManualCodingInstructions: false,
      }),
    ).toMatchObject({
      showGeneralCodingInstructions: true,
      preferManualCodingInstructions: false,
    });
  });

  it("keeps explicit empty column selections, definitions and bounded widths", () => {
    expect(
      normalizeFeatureConfig({
        metadataColumns: {
          visible: [],
          order: [],
          configured: true,
          definitions: [
            { id: " custom ", label: " Eigene Spalte " },
            { id: "custom", label: "Duplikat" },
            { id: "", label: "Ungültig" },
          ],
          widths: { custom: 720, narrow: 20, invalid: "x" },
        },
      }),
    ).toMatchObject({
      metadataColumns: {
        visible: [],
        order: [],
        configured: true,
        definitions: [{ id: "custom", label: "Eigene Spalte" }],
        widths: { custom: 600, narrow: 80 },
      },
    });
  });

  it("normalizes the unified table layout without changing legacy metadata settings", () => {
    expect(
      normalizeFeatureConfig({
        metadataColumns: {
          visible: ["custom"],
          order: ["custom"],
          widths: { custom: 210 },
          layout: {
            visible: ["system:unitLabel", "metadata:custom"],
            order: ["metadata:custom", "system:unitLabel"],
            configured: true,
            widths: {
              "system:unitLabel": 320,
              "personal:category": 700,
            },
          },
        },
      }),
    ).toMatchObject({
      metadataColumns: {
        visible: ["custom"],
        order: ["custom"],
        widths: { custom: 210 },
        layout: {
          visible: ["system:unitLabel", "metadata:custom"],
          order: ["metadata:custom", "system:unitLabel"],
          configured: true,
          widths: {
            "system:unitLabel": 320,
            "personal:category": 600,
          },
        },
      },
    });

    expect(
      normalizeFeatureConfig({
        metadataColumns: {
          layout: {
            visible: [],
            order: ["system:referenceNumber"],
            configured: true,
          },
        },
      }),
    ).toMatchObject({
      metadataColumns: {
        layout: {
          visible: [],
          order: ["system:referenceNumber"],
          configured: true,
        },
      },
    });
  });

  it("preserves widths for every supported unified table column and long metadata keys", () => {
    const widths = Object.fromEntries(
      Array.from({ length: 110 }, (_, index) => [
        `metadata:column-${index}`,
        200 + index,
      ]),
    );
    const longMetadataKey = `metadata:${"x".repeat(200)}`;
    widths[longMetadataKey] = 333;

    const normalized = normalizeFeatureConfig({
      metadataColumns: {
        layout: {
          visible: ["system:itemId"],
          order: ["system:itemId"],
          configured: true,
          widths,
        },
      },
    });
    const normalizedWidths = (
      normalized.metadataColumns as {
        layout: { widths: Record<string, number> };
      }
    ).layout.widths;

    expect(Object.keys(normalizedWidths)).toHaveLength(111);
    expect(normalizedWidths[longMetadataKey]).toBe(333);
  });

  it("keeps existing ACP comments private unless sharing is explicitly enabled", () => {
    expect(normalizeFeatureConfig({ enableCommenting: true })).toMatchObject({
      enableCommenting: true,
      commentVisibilityMode: "PRIVATE",
    });
    expect(
      normalizeFeatureConfig({
        enableCommenting: true,
        commentVisibilityMode: "SHARED",
      }),
    ).toMatchObject({
      enableCommenting: true,
      commentVisibilityMode: "SHARED",
    });
  });
});

describe("reduced Explorer feature configuration", () => {
  it("keeps existing ACPs opt-in and normalizes malformed settings", () => {
    expect(normalizeFeatureConfig({})).not.toHaveProperty(
      "itemExplorerReducedView",
    );
    for (const value of [
      null,
      [],
      true,
      "false",
      { enabled: "true", headerActions: [] },
    ]) {
      expect(
        normalizeFeatureConfig({ itemExplorerReducedView: value })
          .itemExplorerReducedView,
      ).toMatchObject({
        enabled: false,
        showHeader: true,
        showTableToolbarArea: true,
        showItemInfo: true,
        showPlayerPreview: true,
        showExplorerItemPanel: true,
        headerActions: { columnManager: true, readonlyPreview: true },
      });
    }
  });

  it("preserves explicit visibility choices and strips unsupported nested keys", () => {
    const normalized = normalizeFeatureConfig({
      itemExplorerReducedView: {
        enabled: true,
        showHeader: false,
        showTableToolbarArea: false,
        showItemInfo: false,
        showPlayerPreview: false,
        showExplorerItemPanel: false,
        extension: "not supported",
        headerActions: {
          columnManager: false,
          readonlyPreview: false,
          unknown: false,
        },
      },
    });
    expect(normalized.itemExplorerReducedView).toMatchObject({
      enabled: true,
      showHeader: false,
      showTableToolbarArea: false,
      showItemInfo: false,
      showPlayerPreview: false,
      showExplorerItemPanel: false,
      headerActions: {
        columnManager: false,
        readonlyPreview: false,
        history: true,
      },
    });
    expect(normalized.itemExplorerReducedView).not.toHaveProperty("extension");
    expect(
      (normalized.itemExplorerReducedView as any).headerActions,
    ).not.toHaveProperty("unknown");
    expect(normalizeFeatureConfig(normalized)).toEqual(normalized);
  });
});
