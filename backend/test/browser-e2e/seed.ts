import { NestFactory } from "@nestjs/core";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { DataSource } from "typeorm";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../../src/app.module";
import {
  AccessModel,
  Acp,
  AcpAccessConfig,
  AcpCredential,
  AcpFile,
  AcpItemExplorerState,
  AcpRole,
  AcpUserRole,
  ItemResponseState,
  User,
} from "../../src/database/entities";

const ACP_ID = "10000000-0000-4000-8000-000000000001";
const REGRESSION_ACP_ID = "10000000-0000-4000-8000-000000000101";
const BISTATEST_ACP_ID = "10000000-0000-4000-8000-000000000201";
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
    const acp = await dataSource.getRepository(Acp).save(
      dataSource.getRepository(Acp).create({
        id: ACP_ID,
        packageId: "browser-e2e-package",
        name: "Browser E2E ACP",
        description: "Isolated Playwright fixture",
        acpIndex: {
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
    await dataSource.getRepository(AcpUserRole).save(
      dataSource.getRepository(AcpUserRole).create({
        userId: manager.id,
        acpId: acp.id,
        role: AcpRole.ACP_MANAGER,
        capabilities: [
          "review:participate",
          "review:manage",
          "item-explorer:view",
          "item-explorer:edit",
        ],
      }),
    );

    const accessConfig = await dataSource.getRepository(AcpAccessConfig).save(
      dataSource.getRepository(AcpAccessConfig).create({
        acpId: acp.id,
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
    await dataSource.getRepository(AcpCredential).save(
      dataSource.getRepository(AcpCredential).create({
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
    await dataSource.getRepository(AcpItemExplorerState).save(
      dataSource.getRepository(AcpItemExplorerState).create({
        acpId: acp.id,
        publishedState: sharedState,
        draftState: sharedState,
        status: "CLEAN",
        version: 1,
        publishedVersion: 1,
      }),
    );

    const fixtureDirectory =
      process.env.BROWSER_E2E_FIXTURE_DIR || "/tmp/content-pool-browser-e2e";
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
      await dataSource.getRepository(AcpFile).save(
        dataSource.getRepository(AcpFile).create({
          acpId: acp.id,
          filePath,
          originalName: file.name,
          relativePath: file.name,
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
    const regressionAcp = await dataSource.getRepository(Acp).save(
      dataSource.getRepository(Acp).create({
        id: REGRESSION_ACP_ID,
        packageId: "browser-e2e-regression-package",
        name: "Browser E2E Regression ACP",
        description: "Extended Item Explorer Playwright fixture",
        acpIndex: {
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
    await dataSource.getRepository(AcpUserRole).save(
      dataSource.getRepository(AcpUserRole).create({
        userId: manager.id,
        acpId: regressionAcp.id,
        role: AcpRole.ACP_MANAGER,
        capabilities: [
          "review:participate",
          "review:manage",
          "item-explorer:view",
          "item-explorer:edit",
        ],
      }),
    );
    await dataSource.getRepository(AcpAccessConfig).save(
      dataSource.getRepository(AcpAccessConfig).create({
        acpId: regressionAcp.id,
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
    await dataSource.getRepository(AcpItemExplorerState).save(
      dataSource.getRepository(AcpItemExplorerState).create({
        acpId: regressionAcp.id,
        publishedState: regressionSharedState,
        draftState: regressionSharedState,
        status: "CLEAN",
        version: 1,
        publishedVersion: 1,
      }),
    );

    await dataSource.getRepository(ItemResponseState).save([
      dataSource.getRepository(ItemResponseState).create({
        acpId: regressionAcp.id,
        itemId: "i1",
        unitId: "u1",
        rowKey: "regression-item-uuid-1",
        responseData: { marker: "direct-i1" },
      }),
      dataSource.getRepository(ItemResponseState).create({
        acpId: regressionAcp.id,
        itemId: "i3",
        unitId: "u1",
        rowKey: "regression-item-uuid-3::A",
        responseData: { marker: "partial-i3-A" },
      }),
      dataSource.getRepository(ItemResponseState).create({
        acpId: regressionAcp.id,
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
        content:
          "<!doctype html><html><body>Regression E2E Player</body></html>",
      },
    ];
    for (const file of regressionFiles) {
      const filePath = join(regressionDirectory, file.name);
      await writeFile(filePath, file.content, "utf8");
      await dataSource.getRepository(AcpFile).save(
        dataSource.getRepository(AcpFile).create({
          acpId: regressionAcp.id,
          filePath,
          originalName: file.name,
          relativePath: file.name,
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
    const bistaAcp = await dataSource.getRepository(Acp).save(
      dataSource.getRepository(Acp).create({
        id: BISTATEST_ACP_ID,
        packageId: "browser-e2e-bistatest-package",
        name: "BiStaTest Item Explorer ACP",
        description: "BiStaTest ticket acceptance fixture",
        acpIndex: {
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
    await dataSource.getRepository(AcpUserRole).save(
      dataSource.getRepository(AcpUserRole).create({
        userId: manager.id,
        acpId: bistaAcp.id,
        role: AcpRole.ACP_MANAGER,
        capabilities: [
          "review:participate",
          "review:manage",
          "item-explorer:view",
          "item-explorer:edit",
        ],
      }),
    );
    await dataSource.getRepository(AcpUserRole).save(
      dataSource.getRepository(AcpUserRole).create({
        userId: VIEWER_ID,
        acpId: bistaAcp.id,
        role: AcpRole.READ_ONLY,
        capabilities: ["review:participate", "item-explorer:view"],
      }),
    );
    await dataSource.getRepository(AcpUserRole).save(
      dataSource.getRepository(AcpUserRole).create({
        userId: REVIEW_MANAGER_ID,
        acpId: bistaAcp.id,
        role: AcpRole.READ_ONLY,
        capabilities: ["review:manage"],
      }),
    );
    await dataSource.getRepository(AcpAccessConfig).save(
      dataSource.getRepository(AcpAccessConfig).create({
        acpId: bistaAcp.id,
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
    await dataSource.getRepository(AcpItemExplorerState).save(
      dataSource.getRepository(AcpItemExplorerState).create({
        acpId: bistaAcp.id,
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
                { id: "01", alias: "_01" },
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
              ],
            },
            {
              id: "01_1",
              alias: "01",
              label: "Abgeleitete Variable",
              sourceType: "SUM_SCORE",
              deriveSources: ["01", "01_ggb_bilderbuecherAngeklickt"],
              manualInstruction: "",
              codes: [],
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
      await dataSource.getRepository(AcpFile).save(
        dataSource.getRepository(AcpFile).create({
          acpId: bistaAcp.id,
          filePath,
          originalName: file.name,
          relativePath: file.name,
          fileType: file.type,
          fileSize: Buffer.byteLength(file.content),
        }),
      );
    }

    process.stdout.write(
      JSON.stringify({
        acpId: ACP_ID,
        regressionAcpId: REGRESSION_ACP_ID,
        bistaTestAcpId: BISTATEST_ACP_ID,
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
