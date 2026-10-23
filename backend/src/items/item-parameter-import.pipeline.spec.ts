import { BadRequestException } from "@nestjs/common";
import {
  ItemParameterImportPipeline,
  ItemParameterImportRequest,
} from "./item-parameter-import.pipeline";

describe("ItemParameterImportPipeline", () => {
  const pipeline = new ItemParameterImportPipeline();
  const items = [
    {
      uuid: "uuid-1",
      itemId: "I-1",
      unitId: "U-1",
      unitLabel: "Aufgabe 1",
    },
    {
      uuid: "uuid-2",
      itemId: "I-2",
      unitId: "U-1",
      unitLabel: "Aufgabe 1",
    },
  ] as ItemParameterImportRequest["items"];

  it("plans explicit row, item and unit mutations before applying them", () => {
    const request: ItemParameterImportRequest = {
      fileBuffer: Buffer.from(
        "item;sub_id;est;item_time_s;stimulus_time_s\nI1;A;0,25;20;12",
      ),
      items,
      itemProperties: {
        "uuid-1": { tags: ["keep"], stimulusTimeSeconds: 5 },
        "uuid-1::A": {
          itemUuid: "uuid-1",
          subId: "A",
          itemTimeSeconds: 3,
          stimulusTimeSeconds: 5,
        },
        "uuid-2": { stimulusTimeSeconds: 5 },
      },
    };

    const plan = pipeline.buildPlan(request);
    expect(plan.mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "set",
          scope: "row",
          property: "empiricalDifficulty",
          targetKeys: ["uuid-1::A"],
        }),
        expect.objectContaining({
          action: "set",
          scope: "item",
          property: "itemTimeSeconds",
          targetKeys: ["uuid-1"],
        }),
        expect.objectContaining({
          action: "set",
          scope: "unit",
          property: "stimulusTimeSeconds",
          targetKeys: ["uuid-2"],
        }),
        expect.objectContaining({
          action: "keep",
          scope: "row",
          property: "infit",
        }),
      ]),
    );
    expect(
      plan.mutations
        .filter((mutation) => mutation.action === "keep")
        .every((mutation) => !("targetKeys" in mutation)),
    ).toBe(true);
    expect(plan.mutations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "row",
          property: "itemTimeSeconds",
        }),
      ]),
    );
    expect(plan.mutations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "row",
          property: "stimulusTimeSeconds",
        }),
      ]),
    );

    expect(pipeline.applyPlan(request.itemProperties, plan)).toEqual({
      "uuid-1": {
        tags: ["keep"],
        itemTimeSeconds: 20,
        stimulusTimeSeconds: 12,
      },
      "uuid-1::A": {
        itemUuid: "uuid-1",
        subId: "A",
        empiricalDifficulty: 0.25,
      },
      "uuid-2": { stimulusTimeSeconds: 12 },
    });
  });

  it("ignores empty CSV records while preserving source row numbers for errors", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from(
        [
          "item;est;infit",
          "I1;0.5;1.0",
          ";;",
          '"";" ";""',
          "   ",
          ";0.7;",
          "I2;0.8;1.1",
          ";;",
        ].join("\r\n"),
      ),
      items,
      itemProperties: {},
    });

    expect(result.updated).toBe(2);
    expect(result.failed).toEqual([
      { csvRow: "Zeile 6", reason: "Item fehlt" },
    ]);
    expect(result.nextItemProperties).toEqual({
      "uuid-1": { empiricalDifficulty: 0.5, infit: 1.0 },
      "uuid-2": { empiricalDifficulty: 0.8, infit: 1.1 },
    });
  });

  it("distinguishes an absent column from an explicitly empty value", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;est\nI1;"),
      items,
      itemProperties: {
        "uuid-1": {
          empiricalDifficulty: 0.4,
          infit: 1.05,
          textComplexity: "hoch",
        },
      },
    });

    expect(result.nextItemProperties).toEqual({
      "uuid-1": { infit: 1.05, textComplexity: "hoch" },
    });
  });

  it("imports bista independently per row with at most two decimal places", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;sub_id;bista\nI1;A;503,25\nI1;B;504.5"),
      items,
      itemProperties: {},
    });

    expect(result.failed).toEqual([]);
    expect(result.successes).toEqual([
      expect.objectContaining({ subId: "A", fields: ["bista"] }),
      expect.objectContaining({ subId: "B", fields: ["bista"] }),
    ]);
    expect(result.nextItemProperties).toEqual({
      "uuid-1::A": {
        itemUuid: "uuid-1",
        subId: "A",
        bista: 503.25,
      },
      "uuid-1::B": {
        itemUuid: "uuid-1",
        subId: "B",
        bista: 504.5,
      },
    });
  });

  it("rejects bista values with more than two decimal places", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;bista\nI1;503,251"),
      items,
      itemProperties: { "uuid-1": { bista: 500 } },
    });

    expect(result.updated).toBe(0);
    expect(result.failed).toEqual([
      {
        csvRow: "I1",
        reason: "bista darf höchstens 2 Nachkommastellen haben",
      },
    ]);
    expect(result.nextItemProperties).toEqual({ "uuid-1": { bista: 500 } });
  });

  it("imports text_complexity as text, including numeric-looking content", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;text_complexity\nI1;3.5"),
      items,
      itemProperties: {},
    });

    expect(result.nextItemProperties).toEqual({
      "uuid-1": { textComplexity: "3.5" },
    });
    expect(typeof result.nextItemProperties["uuid-1"].textComplexity).toBe(
      "string",
    );
    expect(result.successes).toEqual([
      expect.objectContaining({ fields: ["text_complexity"] }),
    ]);
  });

  it("clears text_complexity only when the imported column is explicitly empty", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;text_complexity\nI1;"),
      items,
      itemProperties: {
        "uuid-1": { textComplexity: "hoch", infit: 1.05 },
      },
    });

    expect(result.nextItemProperties).toEqual({
      "uuid-1": { infit: 1.05 },
    });
  });

  it("imports kstufe once per item and normalizes valid values", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;sub_id;kstufe\nI1;A; ii \nI1;B;II"),
      items,
      itemProperties: {
        "uuid-1::A": {
          itemUuid: "uuid-1",
          subId: "A",
          competenceLevel: "I",
        },
      },
    });

    expect(result.failed).toEqual([]);
    expect(result.successes).toEqual([
      expect.objectContaining({ subId: "A", fields: ["kstufe"] }),
      expect.objectContaining({ subId: "B", fields: ["kstufe"] }),
    ]);
    expect(result.nextItemProperties).toEqual({
      "uuid-1": { competenceLevel: "II" },
      "uuid-1::A": { itemUuid: "uuid-1", subId: "A" },
      "uuid-1::B": { itemUuid: "uuid-1", subId: "B" },
    });
  });

  it("clears kstufe only when the column is present and explicitly empty", () => {
    const cleared = pipeline.execute({
      fileBuffer: Buffer.from("item;kstufe\nI1;"),
      items,
      itemProperties: {
        "uuid-1": { competenceLevel: "III", infit: 1.05 },
      },
    });
    const preserved = pipeline.execute({
      fileBuffer: Buffer.from("item;infit\nI1;1.1"),
      items,
      itemProperties: {
        "uuid-1": { competenceLevel: "III" },
      },
    });

    expect(cleared.nextItemProperties).toEqual({
      "uuid-1": { infit: 1.05 },
    });
    expect(preserved.nextItemProperties).toEqual({
      "uuid-1": { competenceLevel: "III", infit: 1.1 },
    });
  });

  it("rejects invalid and conflicting kstufe values without overwriting data", () => {
    const invalid = pipeline.execute({
      fileBuffer: Buffer.from("item;kstufe\nI1;VI"),
      items,
      itemProperties: { "uuid-1": { competenceLevel: "IV" } },
    });

    expect(invalid.updated).toBe(0);
    expect(invalid.failed).toEqual([
      { csvRow: "I1", reason: "kstufe muss I, II, III, IV oder V sein" },
    ]);
    expect(invalid.nextItemProperties).toEqual({
      "uuid-1": { competenceLevel: "IV" },
    });

    expect(() =>
      pipeline.execute({
        fileBuffer: Buffer.from("item;sub_id;kstufe\nI1;A;I\nI1;B;II"),
        items,
        itemProperties: {},
      }),
    ).toThrow(BadRequestException);
  });

  it("parses BOM, quoted Sub-IDs, decimal commas and grouped booklet rows", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from(
        '\uFEFFitem;sub_id;infit;booklet;position\nI1;"A;1";1,05;B2;8\nI1;"A;1";1.05;B1;3',
      ),
      items,
      itemProperties: {},
    });

    expect(result.nextItemProperties).toEqual({
      "uuid-1::A%3B1": {
        itemUuid: "uuid-1",
        subId: "A;1",
        infit: 1.05,
        bookletOccurrences: [
          { booklet: "B1", position: 3 },
          { booklet: "B2", position: 8 },
        ],
      },
    });
  });

  it("imports booklets without positions and preserves a known position for the same booklet", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;est;booklet\nI1;0.5;B1\nI1;0.5;B2"),
      items,
      itemProperties: {
        "uuid-1": {
          empiricalDifficulty: 0.2,
          bookletOccurrences: [
            { booklet: "B1", position: 4 },
            { booklet: "OLD", position: 9 },
          ],
        },
      },
    });

    expect(result.requiresConfirmation).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    expect(result.nextItemProperties).toEqual({
      "uuid-1": {
        empiricalDifficulty: 0.5,
        bookletOccurrences: [
          { booklet: "B1", position: 4 },
          { booklet: "B2", position: null },
        ],
      },
    });
    expect(result.successes).toEqual([
      expect.objectContaining({
        fields: ["est", "booklet"],
        bookletOccurrences: [
          { booklet: "B1", position: 4 },
          { booklet: "B2", position: null },
        ],
      }),
    ]);
  });

  it("preserves booklet occurrences when text_complexity has no complete occurrence pair", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from(
        "item;text_complexity;booklet;position\nI1;hoch;;",
      ),
      items,
      itemProperties: {
        "uuid-1": {
          textComplexity: "niedrig",
          bookletOccurrences: [{ booklet: "OLD", position: 4 }],
        },
      },
      confirmWarnings: true,
    });

    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "BOOKLET_OCCURRENCES_SKIPPED" }),
    ]);
    expect(result.nextItemProperties).toEqual({
      "uuid-1": {
        textComplexity: "hoch",
        bookletOccurrences: [{ booklet: "OLD", position: 4 }],
      },
    });
  });

  it("does not infer a position-only column as a legacy Sub-ID", () => {
    const csv = "item;position;est\nI1;4;0.5";
    const result = pipeline.execute({
      fileBuffer: Buffer.from(csv),
      items,
      itemProperties: {
        "uuid-1": {
          empiricalDifficulty: 0.2,
          bookletOccurrences: [{ booklet: "OLD", position: 4 }],
        },
      },
      requireEmpiricalDifficulty: true,
      confirmWarnings: true,
    });

    expect(result.requiresConfirmation).toBe(false);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "BOOKLET_OCCURRENCES_SKIPPED" }),
    ]);
    expect(result.nextItemProperties).toEqual({
      "uuid-1": {
        empiricalDifficulty: 0.5,
        bookletOccurrences: [{ booklet: "OLD", position: 4 }],
      },
    });
    expect(result.successes).toEqual([
      expect.objectContaining({
        rowKey: "uuid-1",
        affectedRowKeys: ["uuid-1"],
        subId: undefined,
        value: 0.5,
      }),
    ]);
  });

  it("skips a position without a booklet and preserves stored occurrences", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;est;booklet;position\nI1;0.5;;4"),
      items,
      itemProperties: {
        "uuid-1": {
          empiricalDifficulty: 0.2,
          bookletOccurrences: [{ booklet: "OLD", position: 7 }],
        },
      },
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "BOOKLET_OCCURRENCES_SKIPPED",
        message: expect.stringContaining('"position" ohne "booklet"'),
      }),
    ]);
    expect(result.nextItemProperties).toEqual({
      "uuid-1": {
        empiricalDifficulty: 0.5,
        bookletOccurrences: [{ booklet: "OLD", position: 7 }],
      },
    });
  });

  it("imports booklet occurrences with and without positions together", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from(
        "item;est;booklet;position\nI1;0.5;B1;1\nI1;0.5;B2;",
      ),
      items,
      itemProperties: {
        "uuid-1": {
          bookletOccurrences: [{ booklet: "OLD", position: 4 }],
        },
      },
    });

    expect(result.failed).toEqual([]);
    expect(result.requiresConfirmation).toBeUndefined();
    expect(result.nextItemProperties).toEqual({
      "uuid-1": {
        empiricalDifficulty: 0.5,
        bookletOccurrences: [
          { booklet: "B1", position: 1 },
          { booklet: "B2", position: null },
        ],
      },
    });
    expect(result.successes).toEqual([
      expect.objectContaining({
        fields: ["est", "booklet", "position"],
        bookletOccurrences: [
          { booklet: "B1", position: 1 },
          { booklet: "B2", position: null },
        ],
      }),
    ]);
  });

  it("rejects structural conflicts without mutating the source properties", () => {
    const itemProperties = { "uuid-1": { infit: 0.9 } };

    expect(() =>
      pipeline.execute({
        fileBuffer: Buffer.from(
          "item;infit;booklet;position\nI1;1.0;B1;1\nI1;1.1;B2;2",
        ),
        items,
        itemProperties,
      }),
    ).toThrow(BadRequestException);
    expect(itemProperties).toEqual({ "uuid-1": { infit: 0.9 } });
  });

  it("rejects conflicting text_complexity values for grouped rows", () => {
    expect(() =>
      pipeline.execute({
        fileBuffer: Buffer.from(
          "item;text_complexity;booklet;position\nI1;hoch;B1;1\nI1;niedrig;B2;2",
        ),
        items,
        itemProperties: {},
      }),
    ).toThrow(BadRequestException);
  });

  it("fans a standard row out to existing partial-credit rows without deleting them", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;est\nI1;0.5"),
      items,
      itemProperties: {
        "uuid-1": { empiricalDifficulty: 0.1, tags: ["base"] },
        "uuid-1::A": {
          itemUuid: "uuid-1",
          subId: "A",
          empiricalDifficulty: 0.2,
          tags: ["partial"],
        },
        "uuid-1::B": {
          itemUuid: "uuid-1",
          subId: "B",
          empiricalDifficulty: 0.8,
        },
      },
      requireEmpiricalDifficulty: true,
    });

    expect(result.nextItemProperties).toEqual({
      "uuid-1": { tags: ["base"] },
      "uuid-1::A": {
        itemUuid: "uuid-1",
        subId: "A",
        empiricalDifficulty: 0.5,
        tags: ["partial"],
      },
      "uuid-1::B": {
        itemUuid: "uuid-1",
        subId: "B",
        empiricalDifficulty: 0.5,
      },
    });
  });

  it("retains target-specific booklet positions when fanning out to partial-credit rows", () => {
    const result = pipeline.execute({
      fileBuffer: Buffer.from("item;booklet\nI1;B1"),
      items,
      itemProperties: {
        "uuid-1": {
          tags: ["base"],
          bookletOccurrences: [{ booklet: "BASE", position: 9 }],
        },
        "uuid-1::A": {
          itemUuid: "uuid-1",
          subId: "A",
          bookletOccurrences: [{ booklet: "B1", position: 2 }],
        },
        "uuid-1::B": {
          itemUuid: "uuid-1",
          subId: "B",
          bookletOccurrences: [{ booklet: "B1", position: 5 }],
        },
      },
    });

    expect(result.requiresConfirmation).toBeUndefined();
    expect(result.nextItemProperties).toEqual({
      "uuid-1": { tags: ["base"] },
      "uuid-1::A": {
        itemUuid: "uuid-1",
        subId: "A",
        bookletOccurrences: [{ booklet: "B1", position: 2 }],
      },
      "uuid-1::B": {
        itemUuid: "uuid-1",
        subId: "B",
        bookletOccurrences: [{ booklet: "B1", position: 5 }],
      },
    });
    expect(result.successes).toEqual([
      expect.objectContaining({
        affectedRowKeys: ["uuid-1::A", "uuid-1::B"],
        fields: ["booklet"],
      }),
    ]);
  });

  it("keeps the mutation plan linear for many items in one unit", () => {
    const manyItems = Array.from({ length: 500 }, (_, index) => ({
      uuid: `uuid-${index}`,
      itemId: `I-${index}`,
      unitId: "U-large",
      unitLabel: "Große Aufgabe",
    })) as ItemParameterImportRequest["items"];
    const csvRows = manyItems.map((item) => `${item.itemId};0.5`);

    const plan = pipeline.buildPlan({
      fileBuffer: Buffer.from(["item;est", ...csvRows].join("\n")),
      items: manyItems,
      itemProperties: {},
    });
    const keepMutations = plan.mutations.filter(
      (mutation) => mutation.action === "keep",
    );

    expect(keepMutations).toHaveLength(9);
    expect(keepMutations.every((mutation) => !("targetKeys" in mutation))).toBe(
      true,
    );
    expect(plan.mutations).toHaveLength(manyItems.length + 9);
  });
});
