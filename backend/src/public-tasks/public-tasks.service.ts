import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash } from "crypto";
import * as fs from "fs/promises";
import { EntityManager, Repository } from "typeorm";
import { Ap, ApFile } from "../database/entities";
import {
  PublicTask,
  PublicTaskSnapshot,
} from "../database/entities/public-task.entity";
import {
  extractLabelText,
  extractValueText,
  findPlayerFile,
  getXmlRootElement,
  isRecord,
  parseUnitXml,
  parseVomd,
} from "../files/unit-file-parsing";
import { UnitXmlData } from "../files/unit-parser.types";
import { CreatePublicTaskDto, PreviewPublicTaskDto } from "./public-tasks.dto";

const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

@Injectable()
export class PublicTasksService {
  private readonly logger = new Logger(PublicTasksService.name);

  constructor(
    @InjectRepository(PublicTask)
    private readonly tasks: Repository<PublicTask>,
  ) {}

  async list(apId: string) {
    return (
      await this.tasks.find({
        where: { sourceApId: apId },
        order: { createdAt: "DESC" },
      })
    ).map((task) => this.summary(task));
  }

  async units(apId: string) {
    const files = await this.tasks.manager.find(ApFile, {
      where: { apId },
      order: { originalName: "ASC" },
    });
    return (await this.parseUnits(files)).map((unit) => ({
      id: unit.unitId,
      name: unit.unitLabel,
    }));
  }

  async preview(apId: string, dto: PreviewPublicTaskDto) {
    return this.tasks.manager.transaction("REPEATABLE READ", (manager) =>
      this.prepare(manager, apId, dto),
    );
  }

  async create(apId: string, dto: CreatePublicTaskDto) {
    return this.tasks.manager.transaction(
      "REPEATABLE READ",
      async (manager) => {
        const draft = await this.prepare(manager, apId, dto);
        if (draft.sourceRevision !== dto.sourceRevision) {
          throw new ConflictException(
            "Die Aufgabe oder die Freigabetexte wurden geändert. Bitte die Vorschau erneut prüfen.",
          );
        }
        const task = manager.create(PublicTask, {
          sourceApId: apId,
          title: draft.snapshot.title,
          unitId: draft.snapshot.unitId,
          snapshot: draft.snapshot,
          published: true,
        });
        return this.summary(await manager.save(task));
      },
    );
  }

  async setPublished(apId: string, id: string, published: boolean) {
    const result = await this.tasks.update(
      { id, sourceApId: apId },
      { published },
    );
    if (!result.affected)
      throw new NotFoundException("Veröffentlichung nicht gefunden");
    return this.summary(
      await this.tasks.findOneByOrFail({ id, sourceApId: apId }),
    );
  }

  async getPublic(id: string) {
    const task = await this.tasks.findOne({
      where: { id, published: true },
      select: { id: true, createdAt: true, snapshot: true },
    });
    if (!task)
      throw new NotFoundException(
        "Diese Aufgabe ist nicht öffentlich verfügbar.",
      );
    return { id: task.id, createdAt: task.createdAt, snapshot: task.snapshot };
  }

  private summary(task: PublicTask) {
    return {
      id: task.id,
      unitId: task.unitId,
      title: task.title,
      published: task.published,
      createdAt: task.createdAt,
      path: `/public/task/${task.id}`,
    };
  }

  private async read(file: ApFile): Promise<string> {
    if (Number(file.fileSize) > MAX_SNAPSHOT_BYTES)
      throw new BadRequestException(
        "Datei ist für die öffentliche Darstellung zu groß.",
      );
    let content: Buffer;
    try {
      content = await fs.readFile(file.filePath);
    } catch {
      throw new ConflictException(
        "Quelldatei ist nicht verfügbar. Bitte das Paket prüfen und die Vorschau neu laden.",
      );
    }
    if (
      file.checksum &&
      createHash("sha256").update(content).digest("hex") !== file.checksum
    ) {
      throw new ConflictException(
        "Quelldatei wurde geändert. Bitte die Vorschau neu laden.",
      );
    }
    return content.toString("utf8");
  }

  private async parseUnits(files: ApFile[]): Promise<UnitXmlData[]> {
    const units: UnitXmlData[] = [];
    for (const file of files.filter((file) =>
      /\.xml$/i.test(file.originalName),
    )) {
      const xml = await this.read(file);
      if (getXmlRootElement(xml) !== "Unit") continue;
      const unit = parseUnitXml(xml, file.originalName, this.logger);
      if (unit?.unitId) units.push(unit);
    }
    return units;
  }

  private async prepare(
    manager: EntityManager,
    apId: string,
    dto: PreviewPublicTaskDto,
  ) {
    if (!(await manager.existsBy(Ap, { id: apId })))
      throw new NotFoundException("Paket nicht gefunden");
    const files = await manager.find(ApFile, {
      where: { apId },
      order: { originalName: "ASC" },
    });
    const matches = (await this.parseUnits(files)).filter(
      (unit) => unit.unitId === dto.unitId,
    );
    if (matches.length !== 1)
      throw new BadRequestException(
        "Die Aufgabe fehlt oder ihre ID ist nicht eindeutig.",
      );
    const unit = matches[0];
    const readRequired = async (name: string | undefined, label: string) => {
      const file = files.find((file) => file.originalName === name);
      if (!file)
        throw new BadRequestException(
          `${label} fehlt. Eine vollständige Aufgabe ist für die Veröffentlichung erforderlich.`,
        );
      return this.read(file);
    };
    const [playerHtml, definition, codingText, metadataText] =
      await Promise.all([
        readRequired(
          findPlayerFile(
            unit.playerRef,
            files.map((file) => file.originalName),
          ),
          "Verona-Player",
        ),
        readRequired(unit.definitionRef, "Aufgabendefinition"),
        readRequired(unit.codingSchemeRef, "Kodierschema"),
        readRequired(
          files.some((file) => file.originalName === unit.metadataRef)
            ? unit.metadataRef
            : `${unit.metadataRef}.json`,
          "Metadaten",
        ),
      ]);
    let codingScheme: unknown;
    try {
      if (!isRecord(JSON.parse(definition)))
        throw new Error("Invalid definition");
      codingScheme = JSON.parse(codingText);
    } catch {
      throw new BadRequestException(
        "Aufgabendefinition und Kodierschema müssen gültiges JSON enthalten.",
      );
    }
    if (Array.isArray(codingScheme))
      codingScheme = { variableCodings: codingScheme };
    if (
      !isRecord(codingScheme) ||
      !Array.isArray(codingScheme.variableCodings) ||
      !codingScheme.variableCodings.length ||
      !codingScheme.variableCodings.every(
        (variable) =>
          isRecord(variable) &&
          typeof variable.id === "string" &&
          variable.id.trim() &&
          (variable.codes === undefined ||
            (Array.isArray(variable.codes) && variable.codes.every(isRecord))),
      ) ||
      new Set(
        codingScheme.variableCodings.map((variable) =>
          variable.id.toLowerCase(),
        ),
      ).size !== codingScheme.variableCodings.length
    )
      throw new BadRequestException("Ungültiges oder leeres Kodierschema");
    const metadata = parseVomd(metadataText, true, this.logger);
    if (!metadata) throw new BadRequestException("Ungültige Metadaten");
    const profileEntries = (
      profiles: unknown,
    ): { label: string; value: string }[] => {
      if (!Array.isArray(profiles)) return [];
      return profiles.flatMap((profile) =>
        Array.isArray(profile.entries)
          ? profile.entries.map((entry: Record<string, unknown>) => ({
              label: extractLabelText(entry.label) || String(entry.id || ""),
              value:
                extractValueText(entry.valueAsText) ||
                String(entry.value ?? ""),
            }))
          : [],
      );
    };
    const snapshot: PublicTaskSnapshot = {
      version: 1,
      unitId: unit.unitId,
      title: unit.unitLabel || unit.unitId,
      description: unit.description || "",
      copyrightNotice: dto.copyrightNotice.trim(),
      publicComments: dto.publicComments.trim(),
      playerHtml,
      definition,
      codingScheme,
      metadata: [
        { label: "Aufgabe", entries: profileEntries(metadata.unitProfiles) },
        ...metadata.items.map((item) => ({
          label: extractLabelText(item.label) || item.description || item.id,
          entries: profileEntries(item.profiles),
        })),
      ],
    };
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized) > MAX_SNAPSHOT_BYTES)
      throw new BadRequestException(
        "Die öffentliche Aufgabe darf höchstens 64 MiB umfassen.",
      );
    return {
      sourceRevision: createHash("sha256").update(serialized).digest("hex"),
      snapshot,
    };
  }
}
