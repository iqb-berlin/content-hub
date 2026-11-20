import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Repository } from "typeorm";
import { ApFile } from "../database/entities";
import { PublicTask } from "../database/entities/public-task.entity";
import { PublicTasksService } from "./public-tasks.service";

describe("PublicTasksService", () => {
  let directory: string;
  let files: ApFile[];
  let task: PublicTask | null;
  let sourceExists: boolean;
  let service: PublicTasksService;
  const input = {
    unitId: "u1",
    copyrightNotice: "© Test Stimulus",
    publicComments: "Freigegebener Kommentar",
  };
  const manager = {
    transaction: jest.fn(),
    existsBy: jest.fn(async () => sourceExists),
    find: jest.fn(async () => files),
    create: jest.fn((_entity, data) => ({
      ...data,
      id: "public-id",
      createdAt: new Date(),
    })),
    save: jest.fn(async (data) => {
      task = structuredClone(data);
      return data;
    }),
  };
  const repository = {
    manager,
    find: jest.fn(async () => (task ? [task] : [])),
    findOne: jest.fn(async ({ where }) =>
      task && task.id === where.id && task.published
        ? structuredClone(task)
        : null,
    ),
    update: jest.fn(async (where, patch) => {
      if (!task || task.sourceApId !== where.sourceApId || task.id !== where.id)
        return { affected: 0 };
      Object.assign(task, patch);
      return { affected: 1 };
    }),
    findOneByOrFail: jest.fn(async () => task),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    manager.transaction.mockImplementation(async (_isolation, callback) =>
      callback(manager),
    );
    directory = await mkdtemp(join(tmpdir(), "public-task-test-"));
    task = null;
    sourceExists = true;
    const sources = {
      "booklet.xml": "<Booklet><Id>booklet</Id></Booklet>",
      "u1.xml":
        '<Unit><Id>u1</Id><Label>Aufgabe 1</Label><DefinitionRef player="player@1">u1.voud</DefinitionRef><CodingSchemeRef>u1.vocs</CodingSchemeRef><Reference>u1.vomd</Reference></Unit>',
      "player-1.html": "<html>Player</html>",
      "u1.voud": JSON.stringify({ pages: [{ alwaysVisible: ["Stimulus"] }] }),
      "u1.vocs": JSON.stringify({
        version: "3.0",
        variableCodings: [{ id: "v1", sourceType: "BASE", codes: [] }],
      }),
      "u1.vomd": JSON.stringify({
        profiles: [
          {
            entries: [
              {
                id: "domain",
                label: [{ lang: "de", value: "Fach" }],
                valueAsText: [{ lang: "de", value: "Deutsch" }],
              },
            ],
          },
        ],
        items: [
          {
            id: "i1",
            profiles: [],
            studioComments: [{ body: "INTERNAL SECRET" }],
          },
        ],
      }),
    };
    files = [];
    for (const [name, content] of Object.entries(sources)) {
      const filePath = join(directory, name);
      await writeFile(filePath, content);
      files.push({
        id: name,
        apId: "source",
        originalName: name,
        filePath,
        fileSize: Buffer.byteLength(content),
      } as ApFile);
    }
    service = new PublicTasksService(
      repository as unknown as Repository<PublicTask>,
    );
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it("offers only actual units and does not persist the preview", async () => {
    expect(await service.units("source")).toEqual([
      { id: "u1", name: "Aufgabe 1" },
    ]);
    const draft = await service.preview("source", input);
    expect(draft.snapshot.metadata[0].entries).toEqual([
      { label: "Fach", value: "Deutsch" },
    ]);
    expect(JSON.stringify(draft)).not.toContain("INTERNAL SECRET");
    expect(JSON.stringify(draft)).not.toContain("downloadUrl");
    expect(JSON.stringify(draft)).not.toContain(directory);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("keeps the exact reviewed snapshot after source files and the AP are deleted", async () => {
    const draft = await service.preview("source", input);
    const created = await service.create("source", {
      ...input,
      sourceRevision: draft.sourceRevision,
    });
    await rm(directory, { recursive: true, force: true });
    files = [];
    sourceExists = false;
    expect(created.path).toBe("/public/task/public-id");
    const result = await service.getPublic(created.id);
    expect(result.snapshot).toEqual(draft.snapshot);
    expect(result).not.toHaveProperty("sourceApId");
    expect(await service.list("source")).toEqual([created]);
  });

  it.each(["file", "copyright", "comments"])(
    "rejects changes to %s after the preview",
    async (changed) => {
      const draft = await service.preview("source", input);
      const next = { ...input, sourceRevision: draft.sourceRevision };
      if (changed === "file")
        await writeFile(join(directory, "u1.voud"), '{"pages":[]}');
      if (changed === "copyright") next.copyrightNotice = "Different rights";
      if (changed === "comments") next.publicComments = "Different comment";
      await expect(service.create("source", next)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    },
  );

  it("refuses incomplete tasks instead of publishing a broken player", async () => {
    files = files.filter((file) => !file.originalName.endsWith(".voud"));
    await expect(service.preview("source", input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects a source file with a mismatching checksum", async () => {
    files.find((file) => file.originalName.endsWith(".voud"))!.checksum =
      "wrong";
    await expect(service.preview("source", input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each([
    { variableCodings: [] },
    { variableCodings: [{}] },
    { variableCodings: [{ id: "v1" }, { id: "V1" }] },
  ])(
    "blocks incomplete or ambiguous coding variables: %j",
    async ({ variableCodings }) => {
      await writeFile(
        join(directory, "u1.vocs"),
        JSON.stringify({ variableCodings }),
      );
      await expect(service.preview("source", input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it("scopes withdrawal to the source AP and restores the same link", async () => {
    const draft = await service.preview("source", input);
    const created = await service.create("source", {
      ...input,
      sourceRevision: draft.sourceRevision,
    });
    await expect(
      service.setPublished("other", created.id, false),
    ).rejects.toBeInstanceOf(NotFoundException);
    const withdrawn = await service.setPublished("source", created.id, false);
    expect(withdrawn.path).toBe(created.path);
    await expect(service.getPublic(created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await service.setPublished("source", created.id, true);
    expect((await service.getPublic(created.id)).snapshot).toEqual(
      draft.snapshot,
    );
  });
});
