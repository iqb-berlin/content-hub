import { CompleteCommentLifecycle1789300000000 } from "../migrations/1789300000000-CompleteCommentLifecycle";
import { join } from "path";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";

describe("CompleteCommentLifecycle migration", () => {
  const migration = new CompleteCommentLifecycle1789300000000() as any;
  const base = {
    id: "comment-1",
    acp_id: "ap-1",
    booklet_id: null,
    unit_id: null,
    item_id: null,
  };
  const targets = migration.collectTargets({
    assessmentParts: [
      {
        units: [
          { id: "unit-1", items: [{ id: "item-1" }] },
          { id: "unit_1", items: [{ id: "item-1" }] },
        ],
        instruments: [
          {
            testcenterBooklet: [
              { id: "booklet-1", modules: ["module-1", "shared"] },
              { id: "booklet-2", modules: ["shared"] },
            ],
          },
        ],
      },
    ],
  });

  it("maps stable unit and unique booklet targets", () => {
    expect(
      migration.resolveLegacyComment(
        { ...base, target_type: "UNIT", target_id: "unit-1" },
        targets,
      ),
    ).toMatchObject({ unitId: "unit-1", legacyReadOnly: false });
    expect(
      migration.resolveLegacyComment(
        {
          ...base,
          target_type: "TASK_SEQUENCE",
          target_id: "module-1",
        },
        targets,
      ),
    ).toMatchObject({
      targetType: "BOOKLET",
      bookletId: "booklet-1",
      legacyReadOnly: false,
    });
    expect(
      migration.resolveLegacyComment(
        {
          ...base,
          target_type: "ITEM",
          target_id: "legacy-value",
          unit_id: "unit-1",
          item_id: "item-from-unit-file",
        },
        migration.collectTargets({}, new Map(), [
          { unitId: "unit-1", itemId: "item-from-unit-file" },
        ]),
      ),
    ).toMatchObject({
      unitId: "unit-1",
      itemId: "item-from-unit-file",
      legacyReadOnly: false,
    });
    expect(
      migration.resolveLegacyComment(
        {
          ...base,
          target_type: "ITEM",
          target_id: "unit-1_item-1",
        },
        targets,
      ),
    ).toMatchObject({
      unitId: "unit-1",
      itemId: "item-1",
      legacyReadOnly: false,
    });
  });

  it("uses top-level units when assessment parts contain no units", () => {
    const topLevelTargets = migration.collectTargets({
      units: [{ id: "top-unit", items: [{ id: "top-item" }] }],
      assessmentParts: [
        {
          bookletModules: [],
          instruments: [],
        },
      ],
    });

    expect(
      migration.resolveLegacyComment(
        { ...base, target_type: "UNIT", target_id: "top-unit" },
        topLevelTargets,
      ),
    ).toMatchObject({ unitId: "top-unit", legacyReadOnly: false });
    expect(
      migration.resolveLegacyComment(
        {
          ...base,
          target_type: "ITEM",
          target_id: "top-unit_top-item",
        },
        topLevelTargets,
      ),
    ).toMatchObject({
      unitId: "top-unit",
      itemId: "top-item",
      legacyReadOnly: false,
    });
  });

  it("maps a unique module to the canonical booklet ID from XML", () => {
    const xml = `
      <Booklet>
        <Metadata><Id>xml-booklet</Id><Label>XML Booklet</Label></Metadata>
        <Units><Unit id="unit-1" /></Units>
      </Booklet>
    `;
    const xmlTargets = migration.collectTargets(
      {
        units: [{ id: "unit-1" }],
        assessmentParts: [
          {
            instruments: [
              {
                testcenterBooklet: [
                  {
                    definitionId: "booklet.xml",
                    modules: ["module-from-index"],
                  },
                ],
              },
            ],
          },
        ],
      },
      new Map([["booklet.xml", xml]]),
    );

    expect(
      migration.resolveLegacyComment(
        {
          ...base,
          target_type: "TASK_SEQUENCE",
          target_id: "module-from-index",
        },
        xmlTargets,
      ),
    ).toMatchObject({
      targetType: "BOOKLET",
      bookletId: "xml-booklet",
      legacyReadOnly: false,
    });
  });

  it("loads referenced booklet definitions from the AP file catalog", async () => {
    const queryRunner = {
      query: jest.fn().mockResolvedValue([
        {
          original_name: "review.xml",
          file_path: join(
            __dirname,
            "../../review/fixtures/review-booklet.xml",
          ),
        },
        {
          original_name: "unreferenced.xml",
          file_path: "/does/not/exist.xml",
        },
      ]),
    };

    const definitions = await migration.loadBookletDefinitions(
      queryRunner,
      "ap-1",
      {
        assessmentParts: [
          {
            instruments: [
              {
                testcenterBooklet: [{ definitionId: "review.xml" }],
              },
            ],
          },
        ],
      },
    );

    expect(definitions.get("review.xml")).toContain("<Id>review-1</Id>");
    expect(definitions.has("unreferenced.xml")).toBe(false);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM "acp_files"'),
      ["ap-1"],
    );
  });

  it("allows rollback on an empty comment table", async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue([]) };
    await migration.down(queryRunner);
    expect(queryRunner.query.mock.calls[0][0]).toContain('SELECT "id"');
    expect(
      queryRunner.query.mock.calls.some(([sql]) => sql.includes("DROP COLUMN")),
    ).toBe(true);
    expect(
      queryRunner.query.mock.calls.some(([sql]) =>
        sql.includes('UPDATE "comments"'),
      ),
    ).toBe(false);
  });

  it.each(["ITEM", "CODING", "BOOKLET", "TASK_SEQUENCE"])(
    "blocks rollback before changes when %s comments exist",
    async (targetType) => {
      const queryRunner = {
        query: jest
          .fn()
          .mockResolvedValue([{ id: "existing", target_type: targetType }]),
      };
      await expect(migration.down(queryRunner)).rejects.toThrow(
        "while comments exist",
      );
      expect(queryRunner.query).toHaveBeenCalledTimes(1);
      expect(queryRunner.query.mock.calls[0][0]).toContain('SELECT "id"');
    },
  );

  it("keeps cross-source aliases ambiguous and file-only targets editable", () => {
    const catalog = migration.collectTargets(
      { units: [{ id: "u1", items: [{ id: "i1" }] }] },
      new Map(),
      [
        { unitId: "u2", itemId: "i1" },
        { unitId: "u1", itemId: "u1_i1" },
      ],
    );
    expect(catalog.units.get("u1")).toEqual(new Set(["i1"]));
    expect(
      migration.resolveLegacyComment(
        { ...base, target_type: "ITEM", target_id: "i1" },
        catalog,
      ),
    ).toMatchObject({ unitId: null, itemId: null, legacyReadOnly: true });
    expect(
      migration.resolveLegacyComment(
        { ...base, target_type: "ITEM", target_id: "u2_i1" },
        catalog,
      ),
    ).toMatchObject({ unitId: "u2", itemId: "i1", legacyReadOnly: false });
    expect(
      migration.resolveLegacyComment(
        {
          ...base,
          target_type: "ITEM",
          target_id: "u2_i1",
          unit_id: "u2",
          item_id: "i1",
        },
        catalog,
      ),
    ).toMatchObject({ unitId: "u2", itemId: "i1", legacyReadOnly: false });
  });

  it("loads file-only identities and refuses incomplete metadata sources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "comment-migration-"));
    try {
      const xmlPath = join(directory, "unit.xml");
      const metadataPath = join(directory, "metadata.json");
      await writeFile(
        xmlPath,
        "<Unit><Metadata><Id>u2</Id><Reference>metadata</Reference></Metadata></Unit>",
      );
      await writeFile(
        metadataPath,
        JSON.stringify({ items: [{ id: "i1", profiles: [] }] }),
      );
      const files = [
        { original_name: "unit.xml", file_path: xmlPath },
        { original_name: "metadata.json", file_path: metadataPath },
      ];
      const queryRunner = { query: jest.fn().mockResolvedValue(files) };
      expect(await migration.loadItemTargets(queryRunner, "ap-1")).toEqual([
        { unitId: "u2", itemId: "i1" },
      ]);
      const backfill = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM "acp"'))
            return [
              {
                id: "ap-1",
                acp_index: {
                  units: [{ id: "u1", items: [{ id: "i1" }] }],
                },
              },
            ];
          if (sql.includes('FROM "acp_files"')) return files;
          if (sql.includes('FROM "comments"'))
            return [
              { ...base, target_type: "ITEM", target_id: "i1" },
              {
                ...base,
                id: "file-comment",
                target_type: "ITEM",
                target_id: "u2_i1",
              },
            ];
          return [];
        }),
      };
      await migration.up(backfill);
      expect(backfill.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "comments"'),
        ["comment-1", "ITEM", null, null, null, true],
      );
      expect(backfill.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "comments"'),
        ["file-comment", "ITEM", null, "u2", "i1", false],
      );
      queryRunner.query.mockResolvedValueOnce([files[0]]);
      await expect(
        migration.loadItemTargets(queryRunner, "ap-1"),
      ).rejects.toThrow("Missing item metadata");
      await writeFile(metadataPath, '{"items": "invalid"}');
      await expect(
        migration.loadItemTargets(queryRunner, "ap-1"),
      ).rejects.toThrow("Invalid item metadata");
      await rm(metadataPath);
      await expect(
        migration.loadItemTargets(queryRunner, "ap-1"),
      ).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps ambiguous or missing legacy targets read-only", () => {
    expect(
      migration.resolveLegacyComment(
        {
          ...base,
          target_type: "ITEM",
          target_id: "unit-1_item-1",
          unit_id: "unit-1",
          item_id: "removed-item",
        },
        targets,
      ),
    ).toMatchObject({
      unitId: "unit-1",
      itemId: "removed-item",
      legacyReadOnly: true,
    });
    expect(
      migration.resolveLegacyComment(
        {
          ...base,
          target_type: "TASK_SEQUENCE",
          target_id: "shared",
        },
        targets,
      ),
    ).toMatchObject({
      targetType: "TASK_SEQUENCE",
      bookletId: null,
      legacyReadOnly: true,
    });
    expect(
      migration.resolveLegacyComment(
        { ...base, target_type: "ITEM", target_id: "item-1" },
        targets,
      ),
    ).toMatchObject({ legacyReadOnly: true });
    expect(
      migration.resolveLegacyComment(
        {
          ...base,
          target_type: "ITEM",
          target_id: "unit-1_missing-item",
        },
        targets,
      ),
    ).toMatchObject({
      unitId: null,
      itemId: null,
      legacyReadOnly: true,
    });
  });
});
