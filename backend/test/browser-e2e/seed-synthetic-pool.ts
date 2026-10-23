import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DataSource } from "typeorm";
import {
  AccessModel,
  Acp,
  AcpAccessConfig,
  AcpFile,
  AcpRole,
  AcpUserRole,
} from "../../src/database/entities";

/** Only called by the guarded, destructive E2E seed; never by the application. */
export async function seedSyntheticPool(
  dataSource: DataSource,
  fixtureDirectory: string,
  managerId: string,
): Promise<void> {
  const source = resolve(__dirname, "../../../test-fixtures/synthetic-aspect");
  const pool = JSON.parse(await readFile(join(source, "pool.json"), "utf8"));
  const player = await readFile(join(source, pool.player.file));
  if (
    createHash("sha256").update(player).digest("hex") !== pool.player.sha256
  ) {
    throw new Error("Synthetic ASPECT player checksum mismatch.");
  }
  const directory = join(fixtureDirectory, "synthetic-aspect");
  await mkdir(directory, { recursive: true });
  const units = await Promise.all(
    pool.units.map(async (entry: { file: string }) =>
      JSON.parse(await readFile(join(source, entry.file), "utf8")),
    ),
  );
  const files: { name: string; type: string; content: string | Buffer }[] = [
    { name: pool.player.file, type: "PLAYER", content: player },
    {
      name: "synthetic-booklet.xml",
      type: "BOOKLET",
      content: `<Booklet><Metadata><Id>${pool.bookletId}</Id><Label>Synthetische ASPECT-Aufgaben</Label></Metadata><Units>${units.map((unit) => `<Unit id="${unit.id}"/>`).join("")}</Units></Booklet>`,
    },
  ];
  const indexUnits = units.map((unit) => {
    files.push({
      name: `${unit.id}.voud`,
      type: "UNIT_DEFINITION",
      content: JSON.stringify(unit.definition),
    });
    if (unit.codingScheme)
      files.push({
        name: `${unit.id}.vocs`,
        type: "CODING_SCHEME",
        content: JSON.stringify(unit.codingScheme),
      });
    return {
      id: unit.id,
      name: unit.name,
      items: [],
      richText:
        "<p>Synthetischer Zusatztext in der normalen Aufgabenansicht.</p>",
      dependencies: [
        { id: pool.player.file, type: "PLAYER" },
        { id: `${unit.id}.voud`, type: "UNIT_DEFINITION" },
        ...(unit.codingScheme
          ? [{ id: `${unit.id}.vocs`, type: "CODING_SCHEME" }]
          : []),
      ],
    };
  });
  await dataSource.getRepository(Acp).save(
    dataSource.getRepository(Acp).create({
      id: pool.acpId,
      packageId: "synthetic-aspect-e2e",
      name: "Synthetischer ASPECT-Testpool",
      description:
        "Ausschließlich künstliche Testaufgaben, keine Erhebungsdaten.",
      settings: {},
      acpIndex: {
        version: "0.5.0",
        packageId: "synthetic-aspect-e2e",
        assessmentParts: [
          {
            id: "synthetic-part",
            name: "Synthetische Aufgaben",
            units: indexUnits,
            bookletModules: [
              {
                id: "synthetic-module",
                units: units.map((unit, order) => ({ id: unit.id, order })),
              },
            ],
            instruments: [
              {
                id: "synthetic-instrument",
                testcenterBooklet: [
                  {
                    definitionId: "synthetic-booklet.xml",
                    modules: ["synthetic-module"],
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );
  await dataSource.getRepository(AcpUserRole).save(
    dataSource.getRepository(AcpUserRole).create({
      userId: managerId,
      acpId: pool.acpId,
      role: AcpRole.ACP_MANAGER,
      capabilities: ["review:participate", "review:manage"],
    }),
  );
  await dataSource.getRepository(AcpAccessConfig).save(
    dataSource.getRepository(AcpAccessConfig).create({
      acpId: pool.acpId,
      accessModel: AccessModel.PRIVATE,
      allowRegistered: false,
      featureConfig: {
        enableUnitView: true,
        enableReview: true,
        enableCommenting: false,
        showMetadata: true,
        showCodingScheme: true,
        showRichText: true,
      },
    }),
  );
  for (const file of files) {
    const filePath = join(directory, file.name);
    await writeFile(filePath, file.content);
    await dataSource.getRepository(AcpFile).save(
      dataSource.getRepository(AcpFile).create({
        acpId: pool.acpId,
        filePath,
        originalName: file.name,
        fileType: file.type,
        fileSize: Buffer.byteLength(file.content),
      }),
    );
  }
}
