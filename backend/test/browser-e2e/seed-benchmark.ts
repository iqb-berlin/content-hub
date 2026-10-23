import { NestFactory } from "@nestjs/core";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { DataSource } from "typeorm";
import { AppModule } from "../../src/app.module";
import {
  AccessModel,
  Acp,
  AcpAccessConfig,
  AcpFile,
  AcpItemExplorerState,
  AcpRole,
  AcpUserRole,
  ItemResponseState,
  User,
} from "../../src/database/entities";

const ACP_ID = "20000000-0000-4000-8000-000000000001";
const MANAGER_ID = "20000000-0000-4000-8000-000000000002";
const MANAGER_USERNAME = "benchmark-manager";
const UNIT_COUNT = 50;
const ITEMS_PER_UNIT = 40;
const EXPECTED_FILE_COUNT = 151;

interface BenchmarkItem {
  id: string;
  name: string;
  sourceVariable: string;
  uuid: string;
}

interface BenchmarkUnit {
  id: string;
  name: string;
  items: BenchmarkItem[];
}

function padded(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function createUnits(): BenchmarkUnit[] {
  let itemNumber = 0;
  return Array.from({ length: UNIT_COUNT }, (_, unitIndex) => {
    const unitNumber = unitIndex + 1;
    const unitId = `unit-${padded(unitNumber, 3)}`;
    const items = Array.from({ length: ITEMS_PER_UNIT }, (_, itemIndex) => {
      itemNumber += 1;
      const itemSuffix = padded(itemNumber, 4);
      return {
        id: `item-${itemSuffix}`,
        name: `Benchmark Item ${itemSuffix}`,
        sourceVariable: `V${itemIndex + 1}`,
        uuid: `benchmark-item-${itemSuffix}`,
      };
    });
    return {
      id: unitId,
      name: `Benchmark Unit ${padded(unitNumber, 3)}`,
      items,
    };
  });
}

function createUnitFiles(unit: BenchmarkUnit) {
  const variableElements = unit.items.map((item) => ({
    id: item.sourceVariable,
  }));
  return [
    {
      name: `${unit.id}.xml`,
      type: "UNIT_XML",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Unit>
  <Id>${unit.id}</Id>
  <Label>${unit.name}</Label>
  <Description>Reproducible browser benchmark unit</Description>
  <DefinitionRef player="iqb-player-aspect@2.11">${unit.id}.voud</DefinitionRef>
  <Reference>${unit.id}.vomd</Reference>
</Unit>`,
    },
    {
      name: `${unit.id}.vomd`,
      type: "ITEM_METADATA",
      content: JSON.stringify({
        profiles: [],
        items: unit.items.map((item) => ({
          id: item.id,
          uuid: item.uuid,
          description: item.name,
          variableId: item.sourceVariable,
          useUnitAliasAsPrefix: true,
          profiles: [],
        })),
      }),
    },
    {
      name: `${unit.id}.voud`,
      type: "UNIT_DEFINITION",
      content: JSON.stringify({
        pages: [{ elements: variableElements }],
      }),
    },
  ];
}

async function addBaselineCompatibilityColumns(
  dataSource: DataSource,
): Promise<void> {
  // The benchmark runs the current test harness against an older application
  // checkout whose User entity still selects this column. It is intentionally
  // kept only in the disposable benchmark schema and is unused by the candidate.
  await dataSource.query(`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "password_hash" character varying NOT NULL DEFAULT ''
  `);
}

async function seed(): Promise<void> {
  const database = process.env.DB_DATABASE || "";
  if (
    process.env.NODE_ENV !== "test" ||
    !database.toLowerCase().includes("e2e")
  ) {
    throw new Error(
      "Browser benchmark fixtures require NODE_ENV=test and a DB_DATABASE containing 'e2e'.",
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const dataSource = app.get(DataSource);
    await dataSource.synchronize(true);
    await addBaselineCompatibilityColumns(dataSource);

    const units = createUnits();
    const acp = await dataSource.getRepository(Acp).save(
      dataSource.getRepository(Acp).create({
        id: ACP_ID,
        packageId: "item-explorer-browser-benchmark",
        name: "Item Explorer Browser Benchmark",
        description: "Synthetic 50-unit and 2,000-item benchmark fixture",
        acpIndex: {
          version: "0.5.0",
          packageId: "item-explorer-browser-benchmark",
          assessmentParts: [
            {
              id: "benchmark-part",
              name: "Benchmark",
              units: units.map((unit) => ({
                id: unit.id,
                name: unit.name,
                items: unit.items.map((item) => ({
                  id: item.id,
                  name: item.name,
                  sourceVariable: item.sourceVariable,
                })),
              })),
            },
          ],
        },
        itemProperties: {},
        settings: {},
      }),
    );

    const manager = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: MANAGER_ID,
        username: MANAGER_USERNAME,
        displayName: "Benchmark Manager",
        isAppAdmin: false,
      }),
    );
    await dataSource.getRepository(AcpUserRole).save(
      dataSource.getRepository(AcpUserRole).create({
        userId: manager.id,
        acpId: acp.id,
        role: AcpRole.ACP_MANAGER,
      }),
    );
    await dataSource.getRepository(AcpAccessConfig).save(
      dataSource.getRepository(AcpAccessConfig).create({
        acpId: acp.id,
        accessModel: AccessModel.REGISTERED,
        allowRegistered: true,
        featureConfig: {
          enableItemList: true,
          enableItemListFilter: true,
          enableItemListSort: true,
          enableItemClick: true,
          enableUnitView: true,
        },
      }),
    );

    const sharedState = {
      ui: {},
      tags: {},
      metadataColumns: { visible: [], order: [] },
      itemOrder: [],
      itemProperties: {},
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

    const firstUnit = units[0];
    await dataSource.getRepository(ItemResponseState).save(
      dataSource.getRepository(ItemResponseState).create({
        acpId: acp.id,
        itemId: firstUnit.items[0].id,
        unitId: firstUnit.id,
        rowKey: firstUnit.items[0].uuid,
        responseData: { marker: "benchmark-direct-state" },
      }),
    );

    const fixtureDirectory =
      process.env.BROWSER_E2E_FIXTURE_DIR ||
      "/tmp/content-pool-browser-benchmark";
    await mkdir(fixtureDirectory, { recursive: true });
    const files = [
      ...units.flatMap((unit) => createUnitFiles(unit)),
      {
        name: "iqb-player-aspect-2.11.6.html",
        type: "PLAYER",
        content:
          "<!doctype html><html><body>Item Explorer browser benchmark player</body></html>",
      },
    ];
    if (files.length !== EXPECTED_FILE_COUNT) {
      throw new Error(
        `Expected ${EXPECTED_FILE_COUNT} benchmark files, got ${files.length}.`,
      );
    }

    const fileEntities = [];
    for (const file of files) {
      const filePath = join(fixtureDirectory, file.name);
      await writeFile(filePath, file.content, "utf8");
      fileEntities.push(
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
    await dataSource.getRepository(AcpFile).save(fileEntities);

    process.stdout.write(
      `${JSON.stringify({
        acpId: ACP_ID,
        managerUsername: MANAGER_USERNAME,
        unitCount: units.length,
        itemCount: units.reduce((total, unit) => total + unit.items.length, 0),
        fileCount: files.length,
      })}\n`,
    );
  } finally {
    await app.close();
  }
}

void seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
