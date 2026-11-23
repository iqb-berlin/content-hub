import { ReviewItemCatalogService } from "../files/review-item-catalog.service";
import { FileCatalogCache } from "../files/file-catalog.cache";
import { buildReviewManifest } from "../review/review-manifest";
import { ReviewManifestService } from "../review/review-manifest.service";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ViewsService } from "./views.service";
import { ItemExplorerStateService } from "../item-explorer/item-explorer-state.service";
import { UnitParserService } from "../files/unit-parser.service";
import { readFile } from "fs/promises";
import {
  Ap,
  ApAccessConfig,
  ApFile,
  AppSettings,
  ApItemPreference,
} from "../database/entities";

jest.mock("fs/promises", () => ({ readFile: jest.fn() }));

describe("ViewsService", () => {
  let service: ViewsService;
  let reviewItemCatalog: ReviewItemCatalogService;
  let manifestService: ReviewManifestService;
  let apRepository: { findOne: jest.Mock };
  let accessConfigRepository: { findOne: jest.Mock; find: jest.Mock };
  let fileRepository: { find: jest.Mock; findOne: jest.Mock };
  let fileCatalogCache: { get: jest.Mock };
  let settingsRepository: { findOne: jest.Mock };
  let itemPreferenceRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    query: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let transactionManager: { getRepository: jest.Mock; query: jest.Mock };
  let itemExplorerStateService: { getStateForViewer: jest.Mock };
  let unitParserService: {
    getItemRowKeysFromFiles: jest.Mock;
    getItemListFromFiles: jest.Mock;
  };

  beforeEach(async () => {
    jest.mocked(readFile).mockReset();
    apRepository = { findOne: jest.fn() };
    accessConfigRepository = { findOne: jest.fn(), find: jest.fn() };
    fileRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };
    fileCatalogCache = {
      get: jest.fn().mockResolvedValue({ signature: "test", files: [] }),
    };
    settingsRepository = { findOne: jest.fn() };
    transactionManager = {
      getRepository: jest.fn(),
      query: jest.fn(),
    };
    itemPreferenceRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
      query: jest.fn(),
      manager: {
        transaction: jest
          .fn()
          .mockImplementation(
            async (
              callback: (
                manager: typeof transactionManager,
              ) => Promise<unknown>,
            ) => callback(transactionManager),
          ),
      },
    };
    transactionManager.getRepository.mockReturnValue(itemPreferenceRepository);
    itemExplorerStateService = {
      getStateForViewer: jest.fn().mockResolvedValue({
        activeState: { itemProperties: {} },
        publishedState: { itemProperties: {} },
      }),
    };
    unitParserService = {
      getItemRowKeysFromFiles: jest
        .fn()
        .mockResolvedValue(new Set(["uuid-1::1", "uuid-2::1"])),
      getItemListFromFiles: jest.fn().mockResolvedValue({ items: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViewsService,
        ReviewItemCatalogService,
        { provide: FileCatalogCache, useValue: fileCatalogCache },
        {
          provide: ReviewManifestService,
          useValue: {
            getManifest: jest
              .fn()
              .mockResolvedValue({ booklets: [], units: [], issues: [] }),
          },
        },
        { provide: getRepositoryToken(Ap), useValue: apRepository },
        {
          provide: getRepositoryToken(ApAccessConfig),
          useValue: accessConfigRepository,
        },
        { provide: getRepositoryToken(ApFile), useValue: fileRepository },
        {
          provide: getRepositoryToken(AppSettings),
          useValue: settingsRepository,
        },
        {
          provide: getRepositoryToken(ApItemPreference),
          useValue: itemPreferenceRepository,
        },
        {
          provide: ItemExplorerStateService,
          useValue: itemExplorerStateService,
        },
        { provide: UnitParserService, useValue: unitParserService },
      ],
    }).compile();

    service = module.get<ViewsService>(ViewsService);
    reviewItemCatalog = module.get(ReviewItemCatalogService);
    manifestService = module.get(ReviewManifestService);
  });

  it("lists canonical booklets and returns their complete navigation", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      name: "AP",
      apIndex: {},
    });
    accessConfigRepository.findOne.mockResolvedValue(null);
    const booklet = {
      id: "b1",
      name: "Booklet",
      definitionId: "b.xml",
      children: [],
      units: [
        {
          id: "u1",
          name: "Unit",
          occurrenceId: "b1:path",
          linkId: "Y5gRx3-5hT2cV0WQ",
          blockPath: ["Block"],
        },
      ],
    };
    jest
      .mocked(manifestService.getManifest)
      .mockResolvedValue({ booklets: [booklet], units: [], issues: [] });
    expect((await service.getApStartPage("ap-1")).sequences).toEqual([
      {
        id: "b1",
        name: "Booklet",
        bookletDefinitionId: "b.xml",
        kind: "booklet",
      },
    ]);
    expect(await service.getTaskSequence("ap-1", "b1", "booklet")).toEqual(
      booklet,
    );
  });

  it.each([
    ["Manual name", "Manual name"],
    [undefined, "XML name"],
    ["", "XML name"],
  ])(
    "uses the configured booklet name %j with XML fallback",
    async (name, expected) => {
      const index = {
        assessmentParts: [
          {
            instruments: [
              {
                testcenterBooklet: [{ id: "b1", name, definitionId: "b.xml" }],
              },
            ],
          },
        ],
      };
      const manifest = buildReviewManifest(
        index,
        new Map([
          [
            "b.xml",
            "<Booklet><Metadata><Id>b1</Id><Label>XML name</Label></Metadata><Units/></Booklet>",
          ],
        ]),
      );
      apRepository.findOne.mockResolvedValue({ id: "ap-1", apIndex: index });
      accessConfigRepository.findOne.mockResolvedValue(null);
      jest.mocked(manifestService.getManifest).mockResolvedValue(manifest);
      expect((await service.getApStartPage("ap-1")).sequences[0].name).toBe(
        expected,
      );
      expect(
        (await service.getTaskSequence("ap-1", "b1", "booklet")).name,
      ).toBe(expected);
    },
  );

  it("keeps same-ID legacy module links distinct from explicit booklet links", async () => {
    const index = {
      assessmentParts: [
        {
          units: [{ id: "old" }, { id: "new" }],
          bookletModules: [
            { id: "same", name: "Module", units: [{ id: "old" }] },
          ],
          instruments: [{ testcenterBooklet: [{ definitionId: "b.xml" }] }],
        },
      ],
    };
    const xml =
      '<Booklet><Metadata><Id>same</Id></Metadata><Units><Unit id="new"/></Units></Booklet>';
    const manifest = buildReviewManifest(index, new Map([["b.xml", xml]]));
    expect(manifest.issues).toEqual([]);
    apRepository.findOne.mockResolvedValue({ id: "ap-1", apIndex: index });
    accessConfigRepository.findOne.mockResolvedValue(null);
    jest.mocked(manifestService.getManifest).mockResolvedValue(manifest);
    expect(
      (await service.getTaskSequence("ap-1", "same")).units.map(
        (unit: any) => unit.id,
      ),
    ).toEqual(["old"]);
    expect(
      (await service.getTaskSequence("ap-1", "same", "booklet")).units.map(
        (unit: any) => unit.id,
      ),
    ).toEqual(["new"]);
    const sequences = (await service.getApStartPage("ap-1")).sequences;
    expect(sequences).toHaveLength(2);
    expect(sequences[0]).toMatchObject({ id: "same", kind: "booklet" });
    expect(sequences[1]).toMatchObject({ id: "same" });
    expect(sequences[1].kind).toBeUndefined();
    expect(
      await service.getTaskSequence("ap-1", "unknown", "booklet"),
    ).toBeNull();
  });

  it("uses bookletModule IDs as sequence IDs on AP start page", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      name: "AP",
      description: "Demo",
      apIndex: {
        assessmentParts: [
          {
            units: [{ id: "unit-1", name: "Unit 1" }],
            bookletModules: [
              {
                id: "mod-1",
                name: [{ lang: "de", value: "Modul 1" }],
                units: [{ id: "unit-1", order: 1 }],
              },
            ],
            instruments: [
              {
                id: "inst-1",
                name: "Instrument 1",
                testcenterBooklet: [
                  {
                    definitionId: "booklet-1.xml",
                    modules: [{ moduleId: "mod-1" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    accessConfigRepository.findOne.mockResolvedValue({ featureConfig: {} });

    const start = await service.getApStartPage("ap-1");
    expect(start.sequences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mod-1",
          bookletDefinitionId: "booklet-1.xml",
          instrumentName: "Instrument 1",
        }),
      ]),
    );
  });

  it("supports different module reference formats and deduplicates sequence IDs", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      name: "AP",
      description: "Demo",
      apIndex: {
        assessmentParts: [
          {
            units: [{ id: "unit-1", name: "Unit 1" }],
            bookletModules: [
              {
                id: "mod-1",
                name: "Module 1",
                units: [{ id: "unit-1", order: 1 }],
              },
              {
                id: "mod-2",
                name: "Module 2",
                units: [{ id: "unit-1", order: 1 }],
              },
            ],
            instruments: [
              {
                id: "inst-1",
                name: "Instrument 1",
                testcenterBooklet: [
                  {
                    definitionId: "booklet-1.xml",
                    modules: [{ moduleId: "mod-1" }, { id: "mod-2" }, "mod-1"],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    accessConfigRepository.findOne.mockResolvedValue({ featureConfig: {} });

    const start = await service.getApStartPage("ap-1");
    const sequenceIds = (start.sequences || []).map(
      (s: { id: string }) => s.id,
    );

    expect(sequenceIds.filter((id: string) => id === "mod-1")).toHaveLength(1);
    expect(sequenceIds).toEqual(expect.arrayContaining(["mod-1", "mod-2"]));
  });

  it("exposes canonical metadataColumns when legacy key is stored", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      name: "AP",
      description: "Demo",
      apIndex: {
        assessmentParts: [],
      },
    });
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        itemListMetadataColumns: ["metaA", "metaB"],
      },
    });

    const start = await service.getApStartPage("ap-1");
    expect(start.featureConfig).toMatchObject({
      metadataColumns: {
        visible: ["metaA", "metaB"],
        order: ["metaA", "metaB"],
      },
    });
    expect(start.featureConfig.itemListMetadataColumns).toBeUndefined();
  });

  it("returns empty item preferences when no authenticated identity is available", async () => {
    const prefs = await service.getItemPreferences("ap-1", null, "item-list");
    expect(prefs).toEqual({ ui: {}, tags: {}, rowData: {} });
    expect(itemPreferenceRepository.findOne).not.toHaveBeenCalled();
  });

  it("loads normalized item preferences for authenticated users", async () => {
    itemPreferenceRepository.findOne.mockResolvedValue({
      preferences: {
        ui: {
          filterText: "abc",
          sortDir: "asc",
        },
        tags: {
          item1: ["alpha", "alpha", " beta "],
          item2: [],
        },
      },
    });

    const prefs = await service.getItemPreferences(
      "ap-1",
      { kind: "user", userId: "user-1" },
      "item-list",
    );
    expect(prefs).toEqual({
      ui: {
        filterText: "abc",
        sortDir: "asc",
      },
      tags: {
        item1: ["alpha", "beta"],
      },
      rowData: {},
    });
  });

  it("requires a stable identity for personal item preferences", async () => {
    await expect(
      service.getItemPreferences("ap-1", null, "item-explorer"),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.patchPersonalItemPreferenceRow("ap-1", null, "uuid::1", {
        note: "not saved",
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(itemPreferenceRepository.query).not.toHaveBeenCalled();
  });

  it("exports personal data in requested order with an unambiguous configured category label", async () => {
    itemPreferenceRepository.findOne.mockResolvedValue({
      preferences: {
        rowData: {
          "uuid-1::1": {
            category: "II",
            tags: ["Prüfen"],
            note: "Eigene Notiz",
          },
        },
      },
    });
    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: {
        personalItemCategoryLabel: "Kompetenzstufe",
        personalItemTags: [{ label: "Prüfen", color: "#ff0000" }],
      },
    });
    itemExplorerStateService.getStateForViewer.mockResolvedValue({
      status: "DIRTY",
      canEdit: true,
      activeState: { itemProperties: { "uuid-1::1": { draft: true } } },
      publishedState: {
        itemProperties: { "uuid-1::1": { published: true } },
      },
    });
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [
        {
          itemId: "item-1",
          uuid: "uuid-1",
          rowKey: "uuid-1::1",
          subId: "1",
          unitId: "unit-1",
          unitLabel: "Aufgabe 1",
          description: "",
          variableId: "var-1",
          metadata: {},
          empiricalDifficulty: 0.25,
          bista: 503.25,
          textComplexity: "anspruchsvoll",
          meanTaskDifficulty: 0.6,
        },
        {
          itemId: "item-2",
          uuid: "uuid-2",
          rowKey: "uuid-2::1",
          subId: "1",
          unitId: "unit-1",
          unitLabel: "Aufgabe 1",
          description: "",
          variableId: "var-2",
          metadata: {},
          empiricalDifficulty: 0.75,
          meanTaskDifficulty: 0.6,
        },
      ],
    });

    const buffer = await service.exportPersonalItemDataXlsx(
      "ap-1",
      { kind: "user", userId: "user-1" },
      ["uuid-2::1", "removed-row", "uuid-1::1"],
      true,
    );

    expect(itemPreferenceRepository.findOne).toHaveBeenCalledWith({
      where: {
        apId: "ap-1",
        viewId: "item-explorer",
        userId: "user-1",
      },
    });
    expect(itemExplorerStateService.getStateForViewer).toHaveBeenCalledWith(
      "ap-1",
      true,
    );
    expect(unitParserService.getItemListFromFiles).toHaveBeenCalledWith(
      "ap-1",
      {
        itemPropertiesOverride: { "uuid-1::1": { draft: true } },
        publishedItemPropertiesOverride: {
          "uuid-1::1": { published: true },
        },
      },
    );

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet("Persönliche Itemdaten");
    expect(sheet).toBeDefined();
    expect(sheet!.autoFilter).toBe("A1:V1");
    expect(sheet!.getRow(1).values).toEqual([
      undefined,
      "Laufende Nummer",
      "Unit-ID",
      "Unit-Label",
      "Item-ID",
      "Item-UUID",
      "Sub-ID",
      "Zeilenschlüssel",
      "Markierung/Farbe",
      "Notiz",
      "Kompetenzstufe (persönlich)",
      "Empirische Itemschwierigkeit",
      "BiSta-Wert",
      "Infit",
      "Trennschärfe",
      "Lösungshäufigkeit",
      "Textkomplexität",
      "Kompetenzstufe",
      "Itemzeit (s)",
      "Stimuluszeit (s)",
      "Booklet",
      "Position im Booklet",
      "Mittlere Aufgabenschwierigkeit",
    ]);
    expect(sheet!.getCell("A2").value).toBe(1);
    expect(sheet!.getCell("E2").value).toBe("uuid-2");
    expect(sheet!.getCell("F2").value).toBe("1");
    expect(sheet!.getCell("G2").value).toBe("uuid-2::1");
    expect(sheet!.getCell("H2").value).toBeNull();
    expect(sheet!.getCell("P3").value).toBe("anspruchsvoll");
    expect(sheet!.getCell("L3").value).toBe(503.25);
    expect(sheet!.getCell("V2").value).toBe(0.6);
    expect(sheet!.getCell("A3").value).toBe(2);
    expect(sheet!.getCell("E3").value).toBe("uuid-1");
    expect(sheet!.getCell("F3").value).toBe("1");
    expect(sheet!.getCell("G3").value).toBe("uuid-1::1");
    expect(sheet!.getCell("H3").value).toBe("Prüfen (#ff0000)");
    expect(sheet!.getCell("I3").value).toBe("Eigene Notiz");
    expect(sheet!.getCell("J3").value).toBe("II");

    accessConfigRepository.findOne.mockResolvedValue({
      featureConfig: { personalItemCategoryLabel: "Priorität" },
    });
    const customLabelBuffer = await service.exportPersonalItemDataXlsx(
      "ap-1",
      { kind: "user", userId: "user-1" },
      ["uuid-1::1"],
      true,
    );
    const customLabelWorkbook = new ExcelJS.Workbook();
    await customLabelWorkbook.xlsx.load(customLabelBuffer as any);
    expect(
      customLabelWorkbook.getWorksheet("Persönliche Itemdaten")!.getCell("J1")
        .value,
    ).toBe("Priorität");
  });

  it("requires an explicit filtered and sorted row order for exports", async () => {
    await expect(
      service.exportPersonalItemDataXlsx(
        "ap-1",
        { kind: "user", userId: "user-1" },
        undefined as unknown as string[],
      ),
    ).rejects.toThrow(BadRequestException);
    expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
  });

  it("filters every participant by exact collection row keys without duplicating sub-items", async () => {
    itemPreferenceRepository.find.mockResolvedValue(
      ["one", "two"].map((username) => ({
        user: { username },
        preferences: {
          rowData: {
            "uuid::A": { note: `${username}-included` },
            "uuid::B": { note: `${username}-excluded` },
          },
        },
      })),
    );
    unitParserService.getItemListFromFiles.mockResolvedValue({ items: [] });
    const csv = (
      await service.exportAllPersonalItemDataCsv("ap-1", false, [
        "uuid::A",
        "uuid::A",
      ])
    ).toString("utf8");
    expect(csv).toContain("one-included");
    expect(csv).toContain("two-included");
    expect(csv).not.toContain("excluded");
    expect(csv.trim().split("\r\n")).toHaveLength(3);
    const empty = (
      await service.exportAllPersonalItemDataCsv("ap-1", false, [])
    ).toString("utf8");
    expect(empty.trim().split("\r\n")).toHaveLength(1);
    expect(empty).toContain("Teilnehmerkennung");
    const noData = (
      await service.exportAllPersonalItemDataCsv("ap-1", false, [
        "without-data",
      ])
    ).toString("utf8");
    expect(noData).toBe(empty);
  });

  it("exports all stored participant rows as CSV with literal note line breaks", async () => {
    itemPreferenceRepository.find.mockResolvedValue([
      {
        credential: { username: "teilnehmer-a" },
        preferences: {
          rowData: {
            "uuid-1::A": {
              category: "=II",
              tags: ["Prüfen", "Sicher"],
              note: "Erste Zeile\nZweite Zeile",
            },
          },
        },
      },
      {
        credential: { username: "ohne-eintrag" },
        preferences: { rowData: {} },
      },
      {
        user: { username: "teilnehmer-b" },
        preferences: {
          rowData: {
            "uuid-2": { category: "III", tags: [], note: "Fertig" },
          },
        },
      },
    ]);
    unitParserService.getItemListFromFiles.mockResolvedValue({
      items: [
        {
          itemId: "item-1",
          uuid: "uuid-1",
          rowKey: "uuid-1::A",
          subId: "A",
          unitId: "unit-1",
          unitLabel: "Aufgabe 1",
          description: "",
          variableId: "var-1",
          metadata: {},
          empiricalDifficulty: -0.25,
          meanTaskDifficulty: -0.125,
        },
        {
          itemId: "item-2",
          uuid: "uuid-2",
          rowKey: "uuid-2",
          unitId: "unit-1",
          unitLabel: "Aufgabe 1",
          description: "",
          variableId: "var-2",
          metadata: {},
          empiricalDifficulty: 0.75,
          meanTaskDifficulty: -0.125,
        },
      ],
    });

    const csv = (
      await service.exportAllPersonalItemDataCsv("ap-1", true)
    ).toString("utf8");

    expect(itemPreferenceRepository.find).toHaveBeenCalledWith({
      where: { apId: "ap-1", viewId: "item-explorer" },
      relations: { user: true, credential: true },
    });
    expect(itemExplorerStateService.getStateForViewer).toHaveBeenCalledWith(
      "ap-1",
      true,
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      '"Teilnehmerkennung";"Unit-ID";"Unit-Label";"Item-ID";"Sub-ID";"Zeilenschlüssel"',
    );
    expect(csv).toContain(
      '"teilnehmer-a";"unit-1";"Aufgabe 1";"item-1";"A";"uuid-1::A";"\'=II";"Prüfen, Sicher";"Erste Zeile\\nZweite Zeile";"-0.25";"";"";"";"";"";"";"";"";"";"";"-0.125"',
    );
    expect(csv).toContain(
      '"teilnehmer-b";"unit-1";"Aufgabe 1";"item-2";"";"uuid-2";"III";"";"Fertig";"0.75";"";"";"";"";"";"";"";"";"";"";"-0.125"',
    );
    expect(csv).not.toContain("ohne-eintrag");
  });

  it("limits personal data exports to 10,000 requested rows", async () => {
    const rowKeys = Array.from(
      { length: 10_001 },
      (_, index) => `uuid-${index}`,
    );

    await expect(
      service.exportPersonalItemDataXlsx(
        "ap-1",
        { kind: "user", userId: "user-1" },
        rowKeys,
      ),
    ).rejects.toThrow("At most 10000 item rows can be exported");
    expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
  });

  it("does not fall back to an orphaned username for stable credentials", async () => {
    itemPreferenceRepository.findOne.mockImplementation(async ({ where }) =>
      where.credentialId
        ? null
        : {
            credentialUsername: "reader-a",
            preferences: { rowData: { "uuid::1": { note: "old secret" } } },
          },
    );

    await expect(
      service.getItemPreferences(
        "ap-1",
        {
          kind: "credential",
          credentialId: "credential-new",
          credentialUsername: "reader-a",
        },
        "item-explorer",
      ),
    ).resolves.toEqual({ ui: {}, tags: {}, rowData: {} });
    expect(itemPreferenceRepository.findOne).toHaveBeenCalledTimes(1);
    expect(itemPreferenceRepository.findOne).toHaveBeenCalledWith({
      where: {
        apId: "ap-1",
        viewId: "item-explorer",
        credentialId: "credential-new",
      },
    });
  });

  it("saves preferences scoped by stable credential id", async () => {
    const saved = await service.saveItemPreferences(
      "ap-1",
      {
        kind: "credential",
        credentialId: "credential-1",
        credentialUsername: "reader-a",
      },
      {
        ui: {
          filterText: "xyz",
        },
        tags: {
          item1: ["tag1", "tag1", "tag2"],
        },
      },
      "item-explorer",
    );

    expect(saved).toEqual({
      ui: {
        filterText: "xyz",
      },
      tags: {
        item1: ["tag1", "tag2"],
      },
      rowData: {},
    });
    expect(itemPreferenceRepository.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ON CONFLICT ("acp_id", "view_id", "credential_id")',
      ),
      [
        "ap-1",
        "item-explorer",
        null,
        "credential-1",
        "reader-a",
        JSON.stringify(saved),
      ],
    );
    expect(itemPreferenceRepository.findOne).not.toHaveBeenCalled();
    expect(itemPreferenceRepository.save).not.toHaveBeenCalled();
  });

  it("returns default public settings when app settings are missing", async () => {
    settingsRepository.findOne.mockResolvedValue(null);

    await expect(service.getPublicSettings()).resolves.toEqual({
      theme: {},
      language: "de",
      logoUrl: null,
      landingPageHtml: null,
      imprintHtml: null,
      privacyHtml: null,
      accessibilityHtml: null,
    });
  });

  it("returns configured public settings", async () => {
    settingsRepository.findOne.mockResolvedValue({
      theme: { primary: "#fff" },
      language: "en",
      logoUrl: "/logo.svg",
      landingPageHtml: "<p>Landing</p>",
      imprintHtml: "<p>Imprint</p>",
      privacyHtml: "<p>Privacy</p>",
      accessibilityHtml: "<p>A11y</p>",
    });

    await expect(service.getPublicSettings()).resolves.toEqual({
      theme: { primary: "#fff" },
      language: "en",
      logoUrl: "/logo.svg",
      landingPageHtml: "<p>Landing</p>",
      imprintHtml: "<p>Imprint</p>",
      privacyHtml: "<p>Privacy</p>",
      accessibilityHtml: "<p>A11y</p>",
    });
  });

  it("aggregates public APs and active credential APs without duplicates", async () => {
    accessConfigRepository.find
      .mockResolvedValueOnce([
        {
          apId: "ap-public",
          accessModel: "PUBLIC",
          ap: { id: "ap-public", name: "Public", description: "Public Desc" },
        },
      ])
      .mockResolvedValueOnce([
        {
          apId: "ap-public",
          accessModel: "CREDENTIALS_LIST",
          validFrom: null,
          validUntil: null,
          ap: { id: "ap-public", name: "Public", description: "Public Desc" },
        },
        {
          apId: "ap-credential",
          accessModel: "CREDENTIALS_LIST",
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
          validUntil: new Date("2026-12-31T23:59:59.000Z"),
          ap: {
            id: "ap-credential",
            name: "Credential",
            description: "Credential Desc",
          },
        },
        {
          apId: "ap-inactive",
          accessModel: "CREDENTIALS_LIST",
          validFrom: new Date("2027-01-01T00:00:00.000Z"),
          validUntil: new Date("2027-12-31T23:59:59.000Z"),
          ap: {
            id: "ap-inactive",
            name: "Inactive",
            description: "Inactive Desc",
          },
        },
      ]);

    const result = await service.getPublicAps();

    expect(result).toEqual([
      {
        id: "ap-public",
        name: "Public",
        description: "Public Desc",
        accessModel: "PUBLIC",
      },
      {
        id: "ap-credential",
        name: "Credential",
        description: "Credential Desc",
        accessModel: "CREDENTIALS_LIST",
        requiresLogin: true,
      },
    ]);
  });

  it("returns null for unknown APs in start page/index/unit/sequence lookups", async () => {
    apRepository.findOne.mockResolvedValue(null);

    await expect(service.getApStartPage("missing")).resolves.toBeNull();
    await expect(service.getApIndex("missing")).resolves.toBeNull();
    await expect(
      service.getUnitViewData("missing", "unit-1"),
    ).resolves.toBeNull();
    await expect(
      service.getTaskSequence("missing", "seq-1"),
    ).resolves.toBeNull();
  });

  it("loads unit view data with resolved dependencies", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: {
        assessmentParts: [
          {
            units: [
              {
                id: "unit-1",
                name: "Unit 1",
                description: "Desc",
                lang: "de",
                items: [{ id: "item-1" }],
                dependencies: [
                  { id: "player.html", type: "PLAYER" },
                  { id: "missing.html", type: "PLAYER" },
                ],
                codingScheme: {},
                richText: "<p>x</p>",
              },
            ],
          },
        ],
      },
    });
    fileRepository.findOne
      .mockResolvedValueOnce({
        id: "file-1",
        originalName: "player.html",
      })
      .mockResolvedValueOnce(null);

    await expect(service.getUnitViewData("ap-1", "unit-1")).resolves.toEqual({
      id: "unit-1",
      name: "Unit 1",
      description: "Desc",
      lang: "de",
      items: [{ id: "item-1" }],
      navigationItems: [{ id: "item-1" }],
      dependencies: [
        {
          type: "PLAYER",
          originalName: "player.html",
          downloadUrl: "/api/ap/ap-1/files/file-1/download",
          fileId: "file-1",
        },
      ],
      codingScheme: {},
      richText: "<p>x</p>",
    });
  });

  function unitWithMetadata() {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: {
        units: [
          {
            id: "unit-1",
            items: [{ id: "I1", variableId: "index-fallback" }],
            dependencies: [{ id: "unit.vomd", type: "METADATA" }],
          },
        ],
      },
    });
    const metadata = {
      id: "metadata-1",
      originalName: "unit.vomd",
      filePath: "/uploads/unit.vomd",
    };
    fileRepository.findOne.mockImplementation(async ({ where }) =>
      (where.relativePath ?? where.originalName) === metadata.originalName
        ? metadata
        : null,
    );
    fileCatalogCache.get.mockResolvedValue({
      signature: "test",
      files: [metadata],
    });
  }

  it("includes complete file-backed navigation identities without exporting VOMD metadata", async () => {
    unitWithMetadata();
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: `I${index + 1} `,
      ...(index === 1 ? { useUnitAliasAsPrefix: false } : {}),
      variableId: ` ALIAS_${index + 1} `,
      variableReadOnlyId: ` internal-${index + 1} `,
      sourceVariable: index ? "" : " legacy-first ",
      description: "Unreleased item description",
      profiles: [{ entries: [{ id: "secret", valueAsText: "Hidden" }] }],
    }));
    jest
      .mocked(readFile)
      .mockResolvedValue(
        JSON.stringify({ items: [...items, null, { id: " " }] }),
      );

    const result = await service.getUnitViewData("ap-1", "unit-1");
    expect(result.navigationItems).toEqual(
      items.map((_, index) => ({
        id: `I${index + 1}`,
        variableId: `ALIAS_${index + 1}`,
        variableReadOnlyId: `internal-${index + 1}`,
        ...(index ? {} : { sourceVariable: "legacy-first" }),
      })),
    );
    expect(result.items).toEqual([{ id: "I1", variableId: "index-fallback" }]);
    expect(readFile).toHaveBeenCalledWith("/uploads/unit.vomd", "utf8");
    expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    "maps raw VOMD items to a prefixed index ID only if enabled (%s)",
    async (useUnitAliasAsPrefix) => {
      apRepository.findOne.mockResolvedValue({
        id: "ap-1",
        apIndex: {
          units: [
            {
              id: "U",
              items: [{ id: "U_I", variableId: "OLD" }],
              dependencies: [{ id: "U.vomd", type: "METADATA" }],
            },
            {
              id: "OTHER",
              items: [{ id: "unrelated" }],
              dependencies: [{ id: "OTHER.vomd", type: "METADATA" }],
            },
          ],
        },
      });
      fileRepository.findOne.mockImplementation(async ({ where }) =>
        (where.relativePath ?? where.originalName) === "U.vomd"
          ? {
              id: "metadata",
              originalName: "U.vomd",
              filePath: "/uploads/U.vomd",
            }
          : null,
      );
      jest.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          items: [{ id: "I", variableId: "NEW", useUnitAliasAsPrefix }],
        }),
      );
      const result = await service.getUnitViewData("ap-1", "U");
      expect(result.navigationItems).toEqual(
        useUnitAliasAsPrefix
          ? [{ id: "U_I", variableId: "NEW", fallbackIds: ["I"] }]
          : [
              { id: "U_I", variableId: "OLD" },
              { id: "I", variableId: "NEW" },
            ],
      );
      expect(fileRepository.findOne).toHaveBeenCalledTimes(2);
      expect(readFile).toHaveBeenCalledTimes(1);
      expect(readFile).toHaveBeenCalledWith("/uploads/U.vomd", "utf8");
      expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
    },
  );

  it("retains canonical comment IDs and uses current file references across prefix collisions", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: {
        units: [
          {
            id: "U",
            items: [
              { id: "I", variableId: "stale" },
              { id: "U_I", variableId: "stale-prefixed" },
              { id: "legacy", variableId: "stale-legacy" },
            ],
            dependencies: [{ id: "U.vomd", type: "METADATA" }],
          },
        ],
      },
    });
    fileRepository.findOne.mockImplementation(async ({ where }) =>
      (where.relativePath ?? where.originalName) === "U.vomd"
        ? {
            id: "metadata",
            originalName: "U.vomd",
            filePath: "/uploads/U.vomd",
          }
        : null,
    );
    jest.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        items: [
          { id: "I", variableId: "FIRST" },
          { id: "U_I", variableId: "SECOND" },
          { id: "U_legacy", variableId: "THIRD" },
        ],
      }),
    );
    const result = await service.getUnitViewData("ap-1", "U");
    expect(result.navigationItems).toEqual([
      { id: "I", variableId: "FIRST" },
      { id: "U_I", variableId: "SECOND" },
      { id: "legacy", variableId: "THIRD", fallbackIds: ["U_legacy"] },
    ]);
  });

  it("keeps two file items distinct when the second raw ID looks like a prefix alias", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: {
        units: [
          {
            id: "U",
            items: [{ id: "I" }],
            dependencies: [{ id: "U.vomd", type: "METADATA" }],
          },
        ],
      },
    });
    fileRepository.findOne.mockImplementation(async ({ where }) =>
      (where.relativePath ?? where.originalName) === "U.vomd"
        ? {
            id: "metadata",
            originalName: "U.vomd",
            filePath: "/uploads/U.vomd",
          }
        : null,
    );
    jest.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        items: [
          { id: "U_I", variableId: "SECOND" },
          { id: "I", variableId: "FIRST" },
        ],
      }),
    );
    const result = await service.getUnitViewData("ap-1", "U");
    expect(result.navigationItems).toEqual([
      { id: "I", variableId: "FIRST" },
      { id: "U_I", variableId: "SECOND" },
    ]);
  });

  it("reads only the requested Unit XML and VOMD for older index entries with no metadata dependency", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: { units: [{ id: "U" }, { id: "OTHER" }] },
    });
    fileRepository.findOne.mockResolvedValueOnce({
      originalName: "U.xml",
      filePath: "/uploads/U.xml",
    });
    fileRepository.find.mockResolvedValue([
      {
        id: "metadata",
        originalName: "U.vomd.json",
        filePath: "/uploads/U.vomd.json",
      },
    ]);
    jest
      .mocked(readFile)
      .mockResolvedValueOnce(
        "<Unit><Id>U</Id><Reference>U.vomd</Reference></Unit>",
      )
      .mockResolvedValueOnce(
        JSON.stringify({ items: [{ id: "I", variableId: "ALIAS" }] }),
      );
    const result = await service.getUnitViewData("ap-1", "U");
    expect(result.navigationItems).toEqual([{ id: "I", variableId: "ALIAS" }]);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenNthCalledWith(1, "/uploads/U.xml", "utf8");
    expect(readFile).toHaveBeenNthCalledWith(2, "/uploads/U.vomd.json", "utf8");
    expect(fileCatalogCache.get).not.toHaveBeenCalled();
    expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
  });

  it("resolves an older Unit XML with a different filename without opening unrelated VOMD", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: { units: [{ id: "U" }, { id: "OTHER" }] },
    });
    fileRepository.findOne.mockResolvedValue(null);
    fileCatalogCache.get.mockResolvedValue({
      signature: "legacy",
      files: [
        { originalName: "other.xml", filePath: "/uploads/other.xml" },
        { originalName: "other.vomd", filePath: "/uploads/other.vomd" },
        { originalName: "legacy.xml", filePath: "/uploads/legacy.xml" },
        { originalName: "U.vomd", filePath: "/uploads/U.vomd" },
      ],
    });
    fileRepository.find.mockResolvedValue([
      { id: "metadata", originalName: "U.vomd", filePath: "/uploads/U.vomd" },
    ]);
    jest.mocked(readFile).mockImplementation(async (path) => {
      if (path === "/uploads/legacy.xml")
        return "<Unit><Id>U</Id><Reference>U.vomd</Reference></Unit>";
      return JSON.stringify({ items: [{ id: "I", variableId: "ALIAS" }] });
    });
    const result = await service.getUnitViewData("ap-1", "U");
    expect(result.navigationItems).toEqual([{ id: "I", variableId: "ALIAS" }]);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readFile).not.toHaveBeenCalledWith("/uploads/other.vomd", "utf8");
    expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
  });

  it.each(["stale-index", "missing-first", "invalid-first"] as const)(
    "selects the same VOMD for review navigation and comment targets (%s)",
    async (scenario) => {
      const old = {
        id: "old",
        originalName: "old.vomd",
        filePath: "/uploads/old.vomd",
      };
      const current = {
        id: "new",
        originalName: "current.vomd",
        filePath: "/uploads/current.vomd",
      };
      const unitXml = {
        id: "xml",
        originalName: "U.xml",
        filePath: "/uploads/U.xml",
      };
      const files = scenario === "missing-first" ? [current] : [old, current];
      apRepository.findOne.mockResolvedValue({
        id: "ap-1",
        apIndex: {
          units: [
            {
              id: "U",
              items: [],
              dependencies: [
                { id: "old.vomd", type: "METADATA" },
                { id: "current.vomd", type: "METADATA" },
              ],
            },
          ],
        },
      });
      fileRepository.findOne.mockImplementation(async ({ where }) =>
        (where.relativePath ?? where.originalName) === unitXml.originalName &&
        scenario === "stale-index"
          ? unitXml
          : (files.find(
              ({ originalName }) =>
                originalName === (where.relativePath ?? where.originalName),
            ) ?? null),
      );
      fileCatalogCache.get.mockResolvedValue({ signature: "shared", files });
      jest.mocked(readFile).mockImplementation(async (path) => {
        if (path === unitXml.filePath)
          return "<Unit><Id>U</Id><Reference>current.vomd</Reference></Unit>";
        if (path === old.filePath && scenario === "invalid-first")
          return "invalid JSON";
        return JSON.stringify({
          items: [
            path === old.filePath
              ? { id: "STALE", variableId: "STALE" }
              : { id: "I", variableId: "CURRENT" },
          ],
        });
      });
      unitParserService.getItemListFromFiles.mockResolvedValue({
        items:
          scenario === "stale-index"
            ? [{ unitId: "U", itemId: "I", variableId: "CURRENT" }]
            : [],
      });

      const unit = await service.getUnitViewData("ap-1", "U");
      expect(unit.navigationItems).toEqual([
        { id: "I", variableId: "CURRENT" },
      ]);
      expect(unit.dependencies).toEqual([
        expect.objectContaining({ fileId: current.id }),
      ]);
      expect(unitParserService.getItemListFromFiles).not.toHaveBeenCalled();
      const catalog = await reviewItemCatalog.getCatalog("ap-1");
      expect(catalog).toEqual([
        expect.objectContaining({
          itemId: "I",
          variableReferences: { variableId: "CURRENT" },
        }),
      ]);
      if (scenario === "stale-index") {
        expect(fileCatalogCache.get).toHaveBeenCalledTimes(1);
        expect(readFile).not.toHaveBeenCalledWith(old.filePath, "utf8");
      }
    },
  );

  it.each(["missing", "unreadable", "invalid"])(
    "keeps index fallback data when the metadata file is %s",
    async (failure) => {
      unitWithMetadata();
      if (failure === "missing") {
        fileRepository.findOne.mockResolvedValue(null);
        fileCatalogCache.get.mockResolvedValue({
          signature: "missing",
          files: [],
        });
      } else if (failure === "unreadable")
        jest.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
      else jest.mocked(readFile).mockResolvedValue("invalid JSON");
      const result = await service.getUnitViewData("ap-1", "unit-1");
      expect(result.items).toEqual([
        { id: "I1", variableId: "index-fallback" },
      ]);
      expect(result.navigationItems).toEqual([
        { id: "I1", variableId: "index-fallback" },
      ]);
      if (failure === "missing") expect(readFile).not.toHaveBeenCalled();
    },
  );

  it("returns null for unknown units and computes item list prefixes", async () => {
    apRepository.findOne
      .mockResolvedValueOnce({
        id: "ap-1",
        apIndex: {
          assessmentParts: [{ units: [{ id: "unit-1", items: [] }] }],
        },
      })
      .mockResolvedValueOnce({
        id: "ap-1",
        apIndex: {
          assessmentParts: [
            {
              units: [
                {
                  id: "unit-1",
                  name: "Unit 1",
                  items: [
                    { id: "item-1", name: "Item 1" },
                    { id: "item-2", useUnitAliasAsPrefix: false },
                  ],
                },
              ],
            },
          ],
        },
      });

    await expect(
      service.getUnitViewData("ap-1", "missing-unit"),
    ).resolves.toBeNull();
    await expect(service.getItemList("ap-1")).resolves.toEqual([
      {
        itemId: "unit-1_item-1",
        unitId: "unit-1",
        unitName: "Unit 1",
        name: "Item 1",
        sourceVariable: undefined,
      },
      {
        itemId: "item-2",
        unitId: "unit-1",
        unitName: "Unit 1",
        name: undefined,
        sourceVariable: undefined,
      },
    ]);
  });

  it("returns empty item list when AP does not exist", async () => {
    apRepository.findOne.mockResolvedValue(null);
    await expect(service.getItemList("missing")).resolves.toEqual([]);
  });

  it("projects mean task difficulty from the published Explorer item list", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: {
        assessmentParts: [
          {
            units: [
              {
                id: "unit-1",
                name: "Aufgabe 1",
                items: [
                  { id: "item-1", name: "Item 1" },
                  { id: "item-2", name: "Item 2" },
                ],
              },
            ],
          },
        ],
      },
    });
    unitParserService.getItemListFromFiles.mockResolvedValueOnce({
      items: [
        {
          itemId: "unit-1_item-1",
          uuid: "uuid-1",
          rowKey: "uuid-1",
          unitId: "unit-1",
          unitLabel: "Aufgabe 1",
          description: "Item 1",
          sourceVariable: "V1",
          empiricalDifficulty: -1,
          meanTaskDifficulty: -0.25,
        },
        {
          itemId: "item-2",
          uuid: "uuid-2",
          rowKey: "uuid-2",
          unitId: "unit-1",
          unitLabel: "Aufgabe 1",
          description: "Item 2",
          sourceVariable: "V2",
          meanTaskDifficulty: -0.25,
        },
      ],
    });

    await expect(service.getItemList("ap-1")).resolves.toEqual([
      expect.objectContaining({
        itemId: "unit-1_item-1",
        meanTaskDifficulty: -0.25,
      }),
      expect.objectContaining({
        itemId: "unit-1_item-2",
        meanTaskDifficulty: -0.25,
      }),
    ]);
    expect(itemExplorerStateService.getStateForViewer).toHaveBeenCalledWith(
      "ap-1",
      false,
    );
  });

  it("keeps one simple-list entry per index item for partial-credit rows", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: {
        assessmentParts: [
          {
            units: [
              {
                id: "unit-1",
                name: "Aufgabe 1",
                items: [{ id: "item-1", name: "Item 1" }],
              },
            ],
          },
        ],
      },
    });
    unitParserService.getItemListFromFiles.mockResolvedValueOnce({
      items: [
        {
          itemId: "item-1",
          rowKey: "uuid-1::A",
          subId: "A",
          unitId: "unit-1",
          sourceVariable: "V1",
          meanTaskDifficulty: 0.25,
        },
        {
          itemId: "item-1",
          rowKey: "uuid-1::B",
          subId: "B",
          unitId: "unit-1",
          sourceVariable: "V1",
          meanTaskDifficulty: 0.25,
        },
      ],
    });

    await expect(service.getItemList("ap-1")).resolves.toEqual([
      {
        itemId: "unit-1_item-1",
        unitId: "unit-1",
        unitName: "Aufgabe 1",
        name: "Item 1",
        sourceVariable: undefined,
        meanTaskDifficulty: 0.25,
      },
    ]);
  });

  it("returns sorted sequence units and falls back to raw ids when units are missing", async () => {
    apRepository.findOne.mockResolvedValue({
      id: "ap-1",
      apIndex: {
        assessmentParts: [
          {
            units: [{ id: "unit-1", name: "Unit 1" }],
            bookletModules: [
              {
                id: "seq-1",
                name: "Sequence",
                units: [
                  { id: "missing-unit", order: 2 },
                  { id: "unit-1", order: 1 },
                ],
              },
            ],
          },
        ],
      },
    });

    await expect(service.getTaskSequence("ap-1", "seq-1")).resolves.toEqual({
      id: "seq-1",
      name: "Sequence",
      units: [
        { id: "unit-1", name: "Unit 1" },
        { id: "missing-unit", name: "missing-unit" },
      ],
    });
    await expect(
      service.getTaskSequence("ap-1", "unknown"),
    ).resolves.toBeNull();
  });

  it("returns normalized preferences immediately when identity is missing on save", async () => {
    await expect(
      service.saveItemPreferences("ap-1", null, {
        ui: { filterText: "abc" },
        tags: { item1: ["x", " x ", ""] },
      }),
    ).resolves.toEqual({
      ui: { filterText: "abc" },
      tags: { item1: ["x"] },
      rowData: {},
    });
    expect(itemPreferenceRepository.save).not.toHaveBeenCalled();
  });

  it("upserts preference records atomically for authenticated users", async () => {
    const saved = await service.saveItemPreferences(
      "ap-1",
      { kind: "user", userId: "user-1" },
      {
        ui: { sortBy: "name" },
        tags: { itemA: ["A", "A", " B "] },
      },
      "item-list",
    );

    expect(itemPreferenceRepository.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /ON CONFLICT \("acp_id", "view_id", "user_id"\)[\s\S]*jsonb_typeof\("acp_item_preferences"\."preferences"\) = 'object'[\s\S]*ELSE '\{\}'::jsonb[\s\S]*\) \|\| EXCLUDED\."preferences"/,
      ),
      ["ap-1", "item-list", "user-1", null, null, JSON.stringify(saved)],
    );
    expect(itemPreferenceRepository.findOne).not.toHaveBeenCalled();
    expect(itemPreferenceRepository.create).not.toHaveBeenCalled();
    expect(itemPreferenceRepository.save).not.toHaveBeenCalled();
  });

  it("persists personal working data by stable row key", async () => {
    const saved = await service.saveItemPreferences(
      "ap-1",
      { kind: "user", userId: "user-1" },
      {
        rowData: {
          "uuid-1::1": {
            category: " A ",
            tags: ["Prüfen", " Prüfen ", ""],
            note: "Notiz\r\nzweite Zeile",
            formatted: "<strong>ignored</strong>",
          },
          "  ": { category: "ignored" },
        },
      },
      "item-explorer",
    );

    expect(saved.rowData).toEqual({
      "uuid-1::1": {
        category: "A",
        tags: ["Prüfen"],
        note: "Notiz\nzweite Zeile",
      },
    });
  });

  it("patches one personal row atomically without replacing other rows", async () => {
    itemPreferenceRepository.query.mockResolvedValue([{ updated: 1 }]);

    const result = await service.patchPersonalItemPreferenceRow(
      "ap-1",
      { kind: "user", userId: "user-1" },
      "uuid-2::1",
      { category: " II ", formatted: "ignored" },
    );

    expect(result.rowData).toEqual({
      "uuid-2::1": { category: "II" },
    });
    expect(itemExplorerStateService.getStateForViewer).toHaveBeenCalledWith(
      "ap-1",
      false,
    );
    expect(unitParserService.getItemRowKeysFromFiles).toHaveBeenCalledWith(
      "ap-1",
      {
        itemPropertiesOverride: {},
        publishedItemPropertiesOverride: {},
      },
    );
    expect(itemPreferenceRepository.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /\("acp_item_preferences"\."preferences"->'rowData'\) - \$8::text[\s\S]*jsonb_build_object\(\$8::text, \$7::jsonb\)[\s\S]*\? \$8::text[\s\S]*RETURNING 1 AS "updated"/,
      ),
      expect.arrayContaining([
        "ap-1",
        "item-explorer",
        "user-1",
        null,
        null,
        expect.any(String),
        JSON.stringify({ category: "II" }),
        "uuid-2::1",
        10_000,
      ]),
    );
  });

  it("rejects personal data for a row that does not exist in the AP", async () => {
    unitParserService.getItemRowKeysFromFiles.mockResolvedValue(
      new Set(["uuid-1::1"]),
    );

    await expect(
      service.patchPersonalItemPreferenceRow(
        "ap-1",
        { kind: "user", userId: "user-1" },
        "invented-row",
        { note: "unbounded" },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(itemPreferenceRepository.query).not.toHaveBeenCalled();
  });

  it("allows deleting a stale row without resolving the current item list", async () => {
    itemPreferenceRepository.query.mockResolvedValue([{ updated: 1 }]);

    await expect(
      service.patchPersonalItemPreferenceRow(
        "ap-1",
        { kind: "user", userId: "user-1" },
        "removed-row",
        null,
      ),
    ).resolves.toEqual({ rowData: {} });
    expect(itemExplorerStateService.getStateForViewer).not.toHaveBeenCalled();
    expect(unitParserService.getItemRowKeysFromFiles).not.toHaveBeenCalled();
  });

  it("rejects adding a new row after the personal row limit is reached", async () => {
    itemPreferenceRepository.query.mockResolvedValue([]);

    await expect(
      service.patchPersonalItemPreferenceRow(
        "ap-1",
        { kind: "user", userId: "user-1" },
        "uuid-1::1",
        { note: "one too many" },
      ),
    ).rejects.toThrow("Personal item data is limited to 10000 rows");
  });
});
