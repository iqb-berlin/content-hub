import { NestFactory } from "@nestjs/core";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { DataSource } from "typeorm";
import * as bcrypt from "bcryptjs";
import { responseStatePlayerHtml } from "./response-state-player";
import {
  journeyFiles,
  journeyUnitId,
  journeyUnitName,
  journeyBookletId,
} from "../../../test-fixtures/browser-journey-package";
import { AppModule } from "../../src/app.module";
import { seedSyntheticPool } from "./seed-synthetic-pool";
import {
  AccessModel,
  Ap,
  ApAccessConfig,
  ApCredential,
  ApFile,
  ApItemExplorerState,
  ApRole,
  ApUserRole,
  ItemResponseState,
  User,
} from "../../src/database/entities";

const AP_ID = "10000000-0000-4000-8000-000000000001";
const REGRESSION_AP_ID = "10000000-0000-4000-8000-000000000101";
const BISTATEST_AP_ID = "10000000-0000-4000-8000-000000000201";
const MANAGER_ID = "10000000-0000-4000-8000-000000000002";
const MANAGER_USERNAME = "e2e-manager";
const VIEWER_ID = "10000000-0000-4000-8000-000000000003";
const VIEWER_USERNAME = "e2e-viewer";
const REVIEW_MANAGER_ID = "10000000-0000-4000-8000-000000000004";
const REVIEW_MANAGER_USERNAME = "e2e-review-manager";
const CREDENTIAL_USERNAME = "e2e-reviewer";
const CREDENTIAL_PASSWORD = "Reviewer-E2E-123!";

async function seed(): Promise<void> {
  const database = process.env.DB_DATABASE || "";
  if (
    process.env.NODE_ENV !== "test" ||
    !database.toLowerCase().includes("e2e")
  ) {
    throw new Error(
      "Browser E2E fixtures require NODE_ENV=test and a DB_DATABASE containing 'e2e'.",
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const dataSource = app.get(DataSource);
    await dataSource.synchronize(true);

    const itemProperties = {
      "item-uuid-1": { empiricalDifficulty: -0.5 },
      "item-uuid-2": { empiricalDifficulty: 0.5 },
    };
    const ap = await dataSource.getRepository(Ap).save(
      dataSource.getRepository(Ap).create({
        id: AP_ID,
        packageId: "browser-e2e-package",
        name: "Browser E2E AP",
        description: "Isolated Playwright fixture",
        apIndex: {
          version: "0.5.0",
          packageId: "browser-e2e-package",
          assessmentParts: [
            {
              id: "part-1",
              name: "Teil 1",
              units: [
                {
                  id: "u1",
                  name: "Aufgabe 1",
                  items: [
                    { id: "i1", name: "Item 1", sourceVariable: "V1" },
                    { id: "i2", name: "Item 2", sourceVariable: "V2" },
                  ],
                },
              ],
            },
          ],
        },
        itemProperties,
        settings: {},
      }),
    );

    const manager = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: MANAGER_ID,
        username: MANAGER_USERNAME,
        displayName: "E2E Manager",
        isAppAdmin: false,
      }),
    );
    await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: VIEWER_ID,
        username: VIEWER_USERNAME,
        displayName: "E2E Viewer",
        isAppAdmin: false,
      }),
    );
    await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: REVIEW_MANAGER_ID,
        username: REVIEW_MANAGER_USERNAME,
        displayName: "E2E Review Manager",
        isAppAdmin: false,
      }),
    );
    await dataSource.getRepository(ApUserRole).save(
      dataSource.getRepository(ApUserRole).create({
        userId: manager.id,
        apId: ap.id,
        role: ApRole.AP_MANAGER,
        capabilities: [
          "review:participate",
          "review:manage",
          "item-explorer:view",
          "item-explorer:edit",
        ],
      }),
    );

    const accessConfig = await dataSource.getRepository(ApAccessConfig).save(
      dataSource.getRepository(ApAccessConfig).create({
        apId: ap.id,
        accessModel: AccessModel.CREDENTIALS_LIST,
        allowRegistered: false,
        featureConfig: {
          enableItemList: true,
          enableItemListFilter: true,
          enableItemListSort: true,
          enableItemClick: true,
          persistUserPreferences: true,
          enableItemCollections: true,
        },
      }),
    );
    await dataSource.getRepository(ApCredential).save(
      dataSource.getRepository(ApCredential).create({
        accessConfigId: accessConfig.id,
        username: CREDENTIAL_USERNAME,
        passwordHash: await bcrypt.hash(CREDENTIAL_PASSWORD, 4),
        capabilities: ["review:participate", "item-explorer:view"],
      }),
    );

    const sharedState = {
      ui: {},
      tags: {},
      metadataColumns: { visible: [], order: [] },
      itemOrder: [],
      itemProperties,
    };
    await dataSource.getRepository(ApItemExplorerState).save(
      dataSource.getRepository(ApItemExplorerState).create({
        apId: ap.id,
        publishedState: sharedState,
        draftState: sharedState,
        status: "CLEAN",
        version: 1,
        publishedVersion: 1,
      }),
    );

    const fixtureDirectory =
      process.env.BROWSER_E2E_FIXTURE_DIR || "/tmp/content-hub-browser-e2e";
    await mkdir(fixtureDirectory, { recursive: true });
    const unitXml = `<?xml version="1.0" encoding="UTF-8"?>
<Unit>
  <Id>u1</Id>
  <Label>Aufgabe 1</Label>
  <Description>Browser E2E Unit</Description>
  <DefinitionRef player="iqb-player-aspect@2.11">u1.voud</DefinitionRef>
  <Reference>u1.vomd</Reference>
</Unit>`;
    const itemMetadata = JSON.stringify({
      profiles: [],
      items: [
        {
          id: "i1",
          uuid: "item-uuid-1",
          description: "Item 1",
          variableId: "V1",
          useUnitAliasAsPrefix: true,
          profiles: [],
        },
        {
          id: "i2",
          uuid: "item-uuid-2",
          description: "Item 2",
          variableId: "V2",
          useUnitAliasAsPrefix: true,
          profiles: [],
        },
      ],
    });
    const unitDefinition = JSON.stringify({
      pages: [{ elements: [{ id: "V1" }] }, { elements: [{ id: "V2" }] }],
    });
    const playerHtml =
      "<!doctype html><html><body>Browser E2E Player</body></html>";
    const files = [
      { name: "u1.xml", content: unitXml, type: "UNIT_XML" },
      { name: "u1.vomd", content: itemMetadata, type: "ITEM_METADATA" },
      { name: "u1.voud", content: unitDefinition, type: "UNIT_DEFINITION" },
      {
        name: "iqb-player-aspect-2.11.6.html",
        content: playerHtml,
        type: "PLAYER",
      },
    ];
    for (const file of files) {
      const filePath = join(fixtureDirectory, file.name);
      await writeFile(filePath, file.content, "utf8");
      await dataSource.getRepository(ApFile).save(
        dataSource.getRepository(ApFile).create({
          apId: ap.id,
          filePath,
          originalName: file.name,
          fileType: file.type,
          fileSize: Buffer.byteLength(file.content),
        }),
      );
    }

    const regressionItemProperties = {
      "regression-item-uuid-1": { empiricalDifficulty: -0.8 },
      "regression-item-uuid-2": { empiricalDifficulty: -0.2 },
      "regression-item-uuid-3::A": {
        itemUuid: "regression-item-uuid-3",
        subId: "A",
        empiricalDifficulty: 0.1,
      },
      "regression-item-uuid-3::B": {
        itemUuid: "regression-item-uuid-3",
        subId: "B",
        empiricalDifficulty: 0.4,
      },
      "regression-item-uuid-4": { empiricalDifficulty: 0.7 },
      "regression-item-uuid-5": { empiricalDifficulty: 0.9 },
    };
    const regressionAp = await dataSource.getRepository(Ap).save(
      dataSource.getRepository(Ap).create({
        id: REGRESSION_AP_ID,
        packageId: "browser-e2e-regression-package",
        name: "Browser E2E Regression AP",
        description: "Extended Item Explorer Playwright fixture",
        apIndex: {
          version: "0.5.0",
          packageId: "browser-e2e-regression-package",
          assessmentParts: [
            {
              id: "part-regression",
              name: "Regression",
              units: [
                {
                  id: "u1",
                  name: "Regression Aufgabe 1",
                  dependencies: [
                    { id: "u1.voud", type: "UNIT_DEFINITION" },
                    { id: "u1.vomd", type: "METADATA" },
                    { id: "iqb-player-aspect-2.11.6.html", type: "PLAYER" },
                  ],
                  items: [
                    {
                      id: "i1",
                      name: "Direkter Zustand",
                      sourceVariable: "V1",
                    },
                    {
                      id: "i2",
                      name: "Fallback-Zustand",
                      sourceVariable: "V2",
                    },
                    { id: "i3", name: "Partial Credit", sourceVariable: "V3" },
                    { id: "i4", name: "Legacy-Zustand", sourceVariable: "V4" },
                  ],
                },
                {
                  id: "u2",
                  name: "Regression Aufgabe 2",
                  dependencies: [
                    { id: "u2.voud", type: "UNIT_DEFINITION" },
                    { id: "u2.vomd", type: "METADATA" },
                    { id: "iqb-player-aspect-2.11.6.html", type: "PLAYER" },
                  ],
                  items: [
                    { id: "i5", name: "Unit-Wechsel", sourceVariable: "V5" },
                  ],
                },
              ],
            },
          ],
        },
        itemProperties: regressionItemProperties,
        settings: {},
      }),
    );
    await dataSource.getRepository(ApUserRole).save(
      dataSource.getRepository(ApUserRole).create({
        userId: manager.id,
        apId: regressionAp.id,
        role: ApRole.AP_MANAGER,
        capabilities: [
          "review:participate",
          "review:manage",
          "item-explorer:view",
          "item-explorer:edit",
        ],
      }),
    );
    await dataSource.getRepository(ApAccessConfig).save(
      dataSource.getRepository(ApAccessConfig).create({
        apId: regressionAp.id,
        accessModel: AccessModel.REGISTERED,
        allowRegistered: true,
        featureConfig: {
          enableItemList: true,
          enableItemListFilter: true,
          enableItemListSort: true,
          enableItemClick: true,
          enableUnitView: true,
          enableTags: true,
          itemSubIdLabel: "Niveaustufe",
          itemSubIdLabels: {
            A: "Basis",
            B: "Erweitert",
          },
        },
      }),
    );
    const regressionSharedState = {
      ui: {},
      tags: {},
      metadataColumns: { visible: [], order: [] },
      itemOrder: [],
      itemProperties: regressionItemProperties,
    };
    await dataSource.getRepository(ApItemExplorerState).save(
      dataSource.getRepository(ApItemExplorerState).create({
        apId: regressionAp.id,
        publishedState: regressionSharedState,
        draftState: regressionSharedState,
        status: "CLEAN",
        version: 1,
        publishedVersion: 1,
      }),
    );

    await dataSource.getRepository(ItemResponseState).save([
      dataSource.getRepository(ItemResponseState).create({
        apId: regressionAp.id,
        itemId: "i1",
        unitId: "u1",
        rowKey: "regression-item-uuid-1",
        responseData: { marker: "direct-i1" },
      }),
      dataSource.getRepository(ItemResponseState).create({
        apId: regressionAp.id,
        itemId: "i3",
        unitId: "u1",
        rowKey: "regression-item-uuid-3::A",
        responseData: { marker: "partial-i3-A" },
      }),
      dataSource.getRepository(ItemResponseState).create({
        apId: regressionAp.id,
        itemId: "i4",
        unitId: "u1",
        rowKey: "u1::i4",
        responseData: { marker: "legacy-i4" },
      }),
    ]);

    const regressionDirectory = join(fixtureDirectory, "regression");
    await mkdir(regressionDirectory, { recursive: true });
    const regressionFiles = [
      {
        name: "u1.xml",
        type: "UNIT_XML",
        content: `<?xml version="1.0" encoding="UTF-8"?>
<Unit>
  <Id>u1</Id>
  <Label>Regression Aufgabe 1</Label>
  <Description>Response state and coding regression unit</Description>
  <DefinitionRef player="iqb-player-aspect@2.11">u1.voud</DefinitionRef>
  <CodingSchemeRef>u1.vocs</CodingSchemeRef>
  <Reference>u1.vomd</Reference>
</Unit>`,
      },
      {
        name: "u1.vomd",
        type: "ITEM_METADATA",
        content: JSON.stringify({
          profiles: [],
          items: [
            {
              id: "i1",
              uuid: "regression-item-uuid-1",
              description: "Direkter Zustand",
              variableId: "V1",
              useUnitAliasAsPrefix: true,
              profiles: [],
            },
            {
              id: "i2",
              uuid: "regression-item-uuid-2",
              description: "Fallback-Zustand",
              variableId: "V2",
              useUnitAliasAsPrefix: true,
              profiles: [],
            },
            {
              id: "i3",
              uuid: "regression-item-uuid-3",
              description: "Partial Credit",
              variableId: "V3",
              useUnitAliasAsPrefix: true,
              profiles: [],
            },
            {
              id: "i4",
              uuid: "regression-item-uuid-4",
              description: "Legacy-Zustand",
              variableId: "V4",
              useUnitAliasAsPrefix: true,
              profiles: [],
            },
          ],
        }),
      },
      {
        name: "u1.voud",
        type: "UNIT_DEFINITION",
        content: JSON.stringify({
          pages: [
            {
              elements: [
                { id: "V1" },
                { id: "V2" },
                { id: "V3" },
                { id: "V4" },
              ],
            },
          ],
        }),
      },
      {
        name: "u1.vocs",
        type: "CODING_SCHEME",
        content: JSON.stringify({
          variableCodings: [
            {
              id: "V1",
              label: "Direkte Antwort",
              sourceType: "BASE",
              deriveSources: [],
              codes: [
                {
                  id: "1",
                  score: 1,
                  label: "Richtig",
                  ruleSets: [],
                },
              ],
            },
            {
              id: "V2",
              label: "Fallback-Antwort",
              sourceType: "BASE",
              deriveSources: [],
              codes: [],
            },
            {
              id: "V3",
              label: "Partial-Credit-Antwort",
              sourceType: "BASE",
              deriveSources: [],
              codes: [],
            },
            {
              id: "V4",
              label: "Legacy-Antwort",
              sourceType: "BASE",
              deriveSources: [],
              codes: [],
            },
          ],
        }),
      },
      {
        name: "u2.xml",
        type: "UNIT_XML",
        content: `<?xml version="1.0" encoding="UTF-8"?>
<Unit>
  <Id>u2</Id>
  <Label>Regression Aufgabe 2</Label>
  <Description>Rapid unit switch regression unit</Description>
  <DefinitionRef player="iqb-player-aspect@2.11">u2.voud</DefinitionRef>
  <Reference>u2.vomd</Reference>
</Unit>`,
      },
      {
        name: "u2.vomd",
        type: "ITEM_METADATA",
        content: JSON.stringify({
          profiles: [],
          items: [
            {
              id: "i5",
              uuid: "regression-item-uuid-5",
              description: "Unit-Wechsel",
              variableId: "V5",
              useUnitAliasAsPrefix: true,
              profiles: [],
            },
          ],
        }),
      },
      {
        name: "u2.voud",
        type: "UNIT_DEFINITION",
        content: JSON.stringify({
          pages: [{ elements: [{ id: "V5" }] }],
        }),
      },
      {
        name: "iqb-player-aspect-2.11.6.html",
        type: "PLAYER",
        content: responseStatePlayerHtml,
      },
    ];
    for (const file of regressionFiles) {
      const filePath = join(regressionDirectory, file.name);
      await writeFile(filePath, file.content, "utf8");
      await dataSource.getRepository(ApFile).save(
        dataSource.getRepository(ApFile).create({
          apId: regressionAp.id,
          filePath,
          originalName: file.name,
          fileType: file.type,
          fileSize: Buffer.byteLength(file.content),
        }),
      );
    }

    const bistaItemProperties = {
      "bista-item-uuid-01": {
        empiricalDifficulty: -0.4,
        tags: ["Alt"],
        infit: 0.98,
        discrimination: 0.62,
        solutionRate: 0.73,
        itemTimeSeconds: 30,
        stimulusTimeSeconds: 20,
      },
      "bista-item-uuid-general": {
        empiricalDifficulty: 0.2,
        infit: 1.04,
        discrimination: 0.51,
        solutionRate: 0.58,
        itemTimeSeconds: 45,
        stimulusTimeSeconds: 20,
      },
    };
    const bistaAp = await dataSource.getRepository(Ap).save(
      dataSource.getRepository(Ap).create({
        id: BISTATEST_AP_ID,
        packageId: "browser-e2e-bistatest-package",
        name: "BiStaTest Item Explorer AP",
        description: "BiStaTest ticket acceptance fixture",
        apIndex: {
          version: "0.5.0",
          packageId: "browser-e2e-bistatest-package",
          assessmentParts: [
            {
              id: "bista-part",
              name: "BiStaTest",
              units: [
                {
                  id: "MDB007",
                  name: "Lieblingsbücher_2",
                  items: [
                    { id: "01", name: "GeoGebra", sourceVariable: "01" },
                    {
                      id: "G",
                      name: "Allgemeine Hinweise",
                      sourceVariable: "",
                    },
                  ],
                },
              ],
            },
          ],
        },
        itemProperties: bistaItemProperties,
        settings: {},
      }),
    );
    await dataSource.getRepository(ApUserRole).save(
      dataSource.getRepository(ApUserRole).create({
        userId: manager.id,
        apId: bistaAp.id,
        role: ApRole.AP_MANAGER,
        capabilities: [
          "review:participate",
          "review:manage",
          "item-explorer:view",
          "item-explorer:edit",
        ],
      }),
    );
    await dataSource.getRepository(ApUserRole).save(
      dataSource.getRepository(ApUserRole).create({
        userId: VIEWER_ID,
        apId: bistaAp.id,
        role: ApRole.READ_ONLY,
        capabilities: ["review:participate", "item-explorer:view"],
      }),
    );
    await dataSource.getRepository(ApUserRole).save(
      dataSource.getRepository(ApUserRole).create({
        userId: REVIEW_MANAGER_ID,
        apId: bistaAp.id,
        role: ApRole.READ_ONLY,
        capabilities: ["review:manage"],
      }),
    );
    await dataSource.getRepository(ApAccessConfig).save(
      dataSource.getRepository(ApAccessConfig).create({
        apId: bistaAp.id,
        accessModel: AccessModel.REGISTERED,
        allowRegistered: true,
        featureConfig: {
          enableItemList: true,
          enableItemListFilter: true,
          enableItemListSort: true,
          enableItemClick: true,
          enableUnitView: true,
          enableItemListTags: true,
          availableTags: ["Alt", "Neu"],
          persistUserPreferences: true,
          enableItemCollections: true,
          enableReview: true,
          enableCommenting: true,
          commentTargets: ["ITEM"],
          commentVisibilityMode: "SHARED",
          showGeneralCodingInstructions: false,
          preferManualCodingInstructions: true,
          metadataColumns: {
            definitions: [
              { id: "customQuality", label: "Eigene Qualitätsspalte" },
            ],
          },
        },
      }),
    );
    const bistaSharedState = {
      ui: {},
      tags: { "bista-item-uuid-01": ["Alt"] },
      metadataColumns: { visible: [], order: [] },
      itemOrder: [],
      itemProperties: bistaItemProperties,
    };
    await dataSource.getRepository(ApItemExplorerState).save(
      dataSource.getRepository(ApItemExplorerState).create({
        apId: bistaAp.id,
        publishedState: bistaSharedState,
        draftState: bistaSharedState,
        status: "CLEAN",
        version: 1,
        publishedVersion: 1,
      }),
    );

    const bistaDirectory = join(fixtureDirectory, "bistatest");
    await mkdir(bistaDirectory, { recursive: true });
    const bistaFiles = [
      {
        name: "MDB007.xml",
        type: "UNIT_XML",
        content: `<?xml version="1.0" encoding="UTF-8"?>
<Unit>
  <Id>MDB007</Id>
  <Label>Lieblingsbücher_2</Label>
  <Description>GeoGebra regression fixture based on MDB007</Description>
  <DefinitionRef player="iqb-player-aspect@2.11">MDB007.voud</DefinitionRef>
  <CodingSchemeRef>MDB007.vocs</CodingSchemeRef>
  <Reference>MDB007.vomd</Reference>
</Unit>`,
      },
      {
        name: "MDB007.vomd",
        type: "ITEM_METADATA",
        content: JSON.stringify({
          profiles: [],
          items: [
            {
              id: "01",
              uuid: "bista-item-uuid-01",
              description: "BiStaTest GeoGebra Item",
              variableId: "01",
              variableReadOnlyId: "01_1",
              useUnitAliasAsPrefix: false,
              profiles: [],
            },
            {
              id: "G",
              uuid: "bista-item-uuid-general",
              description: "Item ohne ausgewählte Kodiervariable",
              variableId: "",
              useUnitAliasAsPrefix: false,
              profiles: [],
            },
          ],
        }),
      },
      {
        name: "MDB007.voud",
        type: "UNIT_DEFINITION",
        content: JSON.stringify({
          pages: [
            {
              elements: [
                { id: "_intro01" },
                {
                  id: "01",
                  alias: "_01",
                  type: "checkbox",
                  label: "Bilderbücher ausgewählt",
                },
                {
                  id: "01_ggb_bilderbuecherAngeklickt",
                  alias: "_01_ggb_bilderbuecherAngeklickt",
                  type: "checkbox",
                  label: "Bilderbuchsegment markiert",
                },
                { id: "_button01" },
                { id: "_outro01" },
                { id: "_source01" },
              ],
            },
          ],
        }),
      },
      {
        name: "MDB007.vocs",
        type: "CODING_SCHEME",
        content: JSON.stringify({
          version: "3.0",
          variableCodings: [
            {
              id: "01",
              alias: "_01",
              label: "Variable 01",
              sourceType: "BASE",
              deriveSources: [],
              manualInstruction: "<p>Nur Segment Bilderbücher markieren.</p>",
              codeModel: "MANUAL_AND_RULES",
              codes: [
                {
                  id: 1,
                  type: "FULL_CREDIT",
                  score: 1,
                  label: "richtig",
                  ruleSets: [
                    {
                      ruleOperatorAnd: true,
                      rules: [{ method: "MATCH", parameters: ["true"] }],
                    },
                  ],
                  manualInstruction: "",
                },
                {
                  id: 0,
                  type: "RESIDUAL",
                  score: 0,
                  label: "falsch",
                  ruleSets: [],
                },
              ],
            },
            {
              id: "01_ggb_bilderbuecherAngeklickt",
              alias: "_01_ggb_bilderbuecherAngeklickt",
              label: "Bilderbuchsegment markiert",
              sourceType: "BASE",
              deriveSources: [],
              manualInstruction: "",
              codeModel: "RULES_ONLY",
              codes: [
                {
                  id: 1,
                  type: "FULL_CREDIT",
                  score: 1,
                  label: "richtig",
                  ruleSets: [{ rules: [{ method: "IS_FALSE" }] }],
                },
                {
                  id: 0,
                  type: "RESIDUAL",
                  score: 0,
                  label: "falsch",
                  ruleSets: [],
                },
              ],
            },
            {
              id: "01_1",
              alias: "01",
              label: "Abgeleitete Variable",
              sourceType: "SUM_SCORE",
              deriveSources: ["01", "01_ggb_bilderbuecherAngeklickt"],
              manualInstruction: "",
              codeModel: "RULES_ONLY",
              codes: [
                {
                  id: 1,
                  type: "FULL_CREDIT",
                  score: 1,
                  label: "vollständig richtig",
                  ruleSets: [
                    { rules: [{ method: "NUMERIC_MATCH", parameters: ["2"] }] },
                  ],
                },
                {
                  id: 0,
                  type: "RESIDUAL",
                  score: 0,
                  label: "nicht vollständig richtig",
                  ruleSets: [],
                },
              ],
            },
            {
              id: "GEN",
              label: "Allgemeiner Hinweis",
              sourceType: "BASE",
              deriveSources: [],
              manualInstruction:
                "<p>Allgemeiner Testhinweis zur Kodierung.</p>",
              codeModel: "MANUAL_AND_RULES",
              codes: [],
            },
            ...["_button01", "_intro01", "_outro01", "_source01"].map((id) => ({
              id,
              alias: id,
              label: "",
              sourceType: "BASE_NO_VALUE",
              deriveSources: [],
              manualInstruction: "",
              codes: [],
            })),
          ],
        }),
      },
      {
        name: "iqb-player-aspect-2.11.6.html",
        type: "PLAYER",
        content:
          "<!doctype html><html><body>BiStaTest E2E Player</body></html>",
      },
    ];
    for (const file of bistaFiles) {
      const filePath = join(bistaDirectory, file.name);
      await writeFile(filePath, file.content, "utf8");
      await dataSource.getRepository(ApFile).save(
        dataSource.getRepository(ApFile).create({
          apId: bistaAp.id,
          filePath,
          originalName: file.name,
          fileType: file.type,
          fileSize: Buffer.byteLength(file.content),
        }),
      );
    }

    // Stateful journeys use separate APs. The three publishing fixtures are
    // also split by browser so a failed run cannot leak draft state into the
    // next Playwright project.
    const isolatedProjects = [
      { id: "10000000-0000-4000-8000-000000000301", name: "files" },
      { id: "10000000-0000-4000-8000-000000000302", name: "snapshots" },
      { id: "10000000-0000-4000-8000-000000000303", name: "review" },
      { id: "10000000-0000-4000-8000-000000000304", name: "explorer-chromium" },
      { id: "10000000-0000-4000-8000-000000000305", name: "explorer-firefox" },
      { id: "10000000-0000-4000-8000-000000000306", name: "explorer-webkit" },
      { id: "10000000-0000-4000-8000-000000000307", name: "review-links" },
    ];
    for (const project of isolatedProjects) {
      const realTask =
        project.name.startsWith("review") ||
        project.name.startsWith("explorer-");
      const apIndex = structuredClone(regressionAp.apIndex);
      apIndex.packageId = `browser-e2e-${project.name}`;
      if (project.name === "files" || realTask) {
        apIndex.assessmentParts = [];
      }
      if (realTask) {
        apIndex.assessmentParts = [
          {
            id: "journey-part",
            name: "Browseraufgabe",
            ...(project.name === "review-links"
              ? {
                  instruments: [
                    {
                      id: "link-test",
                      testcenterBooklet: [
                        {
                          id: journeyBookletId,
                          definitionId: "journey-review.xml",
                        },
                        {
                          id: "review-other",
                          definitionId: "review-other.xml",
                        },
                      ],
                    },
                  ],
                }
              : {}),
            units: [
              {
                id: journeyUnitId,
                name: journeyUnitName,
                items: [],
                dependencies: [
                  { id: "iqb-player-aspect-3.0.1.html", type: "PLAYER" },
                  { id: `${journeyUnitId}.voud`, type: "UNIT_DEFINITION" },
                  { id: `${journeyUnitId}.vomd`, type: "METADATA" },
                ],
              },
            ],
          },
        ];
      }
      const projectState =
        project.name === "files" || realTask
          ? { ...regressionSharedState, itemProperties: {} }
          : regressionSharedState;
      const isolatedAp = await dataSource.getRepository(Ap).save(
        dataSource.getRepository(Ap).create({
          id: project.id,
          packageId: `browser-e2e-${project.name}`,
          name: `Browser E2E ${project.name}`,
          apIndex,
          itemProperties: structuredClone(projectState.itemProperties),
          settings: {},
        }),
      );
      await dataSource.getRepository(ApUserRole).save(
        dataSource.getRepository(ApUserRole).create({
          userId: manager.id,
          apId: isolatedAp.id,
          role: ApRole.AP_MANAGER,
          capabilities: [
            "review:participate",
            "review:manage",
            "item-explorer:view",
            "item-explorer:edit",
          ],
        }),
      );
      if (project.name === "files" || project.name.startsWith("explorer-")) {
        await dataSource.getRepository(ApUserRole).save(
          dataSource.getRepository(ApUserRole).create({
            userId: VIEWER_ID,
            apId: isolatedAp.id,
            role: ApRole.READ_ONLY,
            capabilities: ["review:participate", "item-explorer:view"],
          }),
        );
      }
      await dataSource.getRepository(ApAccessConfig).save(
        dataSource.getRepository(ApAccessConfig).create({
          apId: isolatedAp.id,
          accessModel: AccessModel.REGISTERED,
          allowRegistered: true,
          featureConfig: {
            enableItemList: true,
            enableItemClick: true,
            enableUnitView: true,
            enableCommenting: true,
            commentTargets: ["BOOKLET"],
          },
        }),
      );
      await dataSource.getRepository(ApItemExplorerState).save(
        dataSource.getRepository(ApItemExplorerState).create({
          apId: isolatedAp.id,
          publishedState: structuredClone(projectState),
          draftState: structuredClone(projectState),
          status: "CLEAN",
          version: 1,
          publishedVersion: 1,
        }),
      );
      const projectDirectory = join(fixtureDirectory, project.name);
      await mkdir(projectDirectory, { recursive: true });
      const sourceFiles = await dataSource.getRepository(ApFile).find({
        where: { apId: regressionAp.id },
      });
      const regressionFilesToCopy =
        project.name === "files" || realTask ? [] : sourceFiles;
      for (const sourceFile of regressionFilesToCopy) {
        const content = await readFile(sourceFile.filePath);
        const filePath = join(projectDirectory, sourceFile.originalName);
        await writeFile(filePath, content);
        await dataSource.getRepository(ApFile).save(
          dataSource.getRepository(ApFile).create({
            apId: isolatedAp.id,
            filePath,
            originalName: sourceFile.originalName,
            fileType: sourceFile.fileType,
            fileSize: content.length,
          }),
        );
      }
      if (realTask) {
        const projectFiles = [...journeyFiles];
        if (project.name === "review-links") {
          const booklet = (id: string, units: string) =>
            Buffer.from(
              `<Booklet><Metadata><Id>${id}</Id><Label>${id}</Label></Metadata><Units>${units}</Units></Booklet>`,
            );
          const bookletIndex = projectFiles.findIndex(
            (file) => file.type === "BOOKLET_XML",
          );
          projectFiles[bookletIndex] = {
            ...projectFiles[bookletIndex],
            buffer: booklet(
              journeyBookletId,
              `<Unit id="${journeyUnitId}" alias="first"/><Testlet id="repeat"><Unit id="${journeyUnitId}" alias="second"/><Unit id="${journeyUnitId}" alias="third"/></Testlet>`,
            ),
          };
          projectFiles.push({
            name: "review-other.xml",
            type: "BOOKLET_XML",
            buffer: booklet("review-other", `<Unit id="${journeyUnitId}"/>`),
          });
        }
        for (const file of projectFiles) {
          const filePath = join(projectDirectory, file.name);
          await writeFile(filePath, file.buffer);
          await dataSource.getRepository(ApFile).save(
            dataSource.getRepository(ApFile).create({
              apId: isolatedAp.id,
              filePath,
              originalName: file.name,
              fileType: file.type,
              fileSize: file.buffer.length,
            }),
          );
        }
      }
    }

    await seedSyntheticPool(dataSource, fixtureDirectory, manager.id);

    process.stdout.write(
      JSON.stringify({
        apId: AP_ID,
        regressionApId: REGRESSION_AP_ID,
        bistaTestApId: BISTATEST_AP_ID,
        managerUsername: MANAGER_USERNAME,
        viewerUsername: VIEWER_USERNAME,
        credentialUsername: CREDENTIAL_USERNAME,
      }) + "\n",
    );
  } finally {
    await app.close();
  }
}

void seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
