import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Repository } from "typeorm";
import * as crypto from "crypto";
import { Acp, AcpItemRowNumber } from "../database/entities";

export interface NumberableItemRow {
  rowKey: string;
  itemId: string;
  unitId: string;
  subId?: string;
}

export interface ItemRowNumberAssignmentResult {
  numbers: Map<string, number>;
  revision?: string;
}

@Injectable()
export class ItemRowNumberingService {
  private readonly collator = new Intl.Collator("de", {
    numeric: true,
    sensitivity: "base",
  });

  constructor(
    @InjectRepository(AcpItemRowNumber)
    private readonly rowNumberRepository: Repository<AcpItemRowNumber>,
  ) {}

  async getRevision(acpId: string): Promise<string> {
    return this.getRevisionFromRepository(this.rowNumberRepository, acpId);
  }

  private async getRevisionFromRepository(
    repository: Repository<AcpItemRowNumber>,
    acpId: string,
  ): Promise<string> {
    if (typeof repository.query === "function") {
      const rows = (await repository.query(
        `
          SELECT
            COUNT(*)::text AS count,
            COALESCE(
              md5(
                string_agg(
                  row_key_hash || ':' || row_number::text,
                  ',' ORDER BY row_key_hash
                )
              ),
              md5('')
            ) AS hash
          FROM acp_item_row_numbers
          WHERE acp_id = $1
        `,
        [acpId],
      )) as Array<{ count?: string; hash?: string }>;
      return `${rows[0]?.count || "0"}:${rows[0]?.hash || ""}`;
    }

    const persisted = await repository.find({
      where: { acpId },
    });
    const revisionSource = persisted
      .map((entry) => `${entry.rowKeyHash}:${entry.rowNumber}`)
      .sort()
      .join(",");
    return `${persisted.length}:${crypto
      .createHash("md5")
      .update(revisionSource, "utf8")
      .digest("hex")}`;
  }

  async assignNumbers(
    acpId: string,
    rows: NumberableItemRow[],
  ): Promise<Map<string, number>> {
    return (await this.assignNumbersInternal(acpId, rows, false)).numbers;
  }

  async assignNumbersWithRevision(
    acpId: string,
    rows: NumberableItemRow[],
  ): Promise<ItemRowNumberAssignmentResult> {
    return this.assignNumbersInternal(acpId, rows, true);
  }

  private async assignNumbersInternal(
    acpId: string,
    rows: NumberableItemRow[],
    includeRevision: boolean,
  ): Promise<ItemRowNumberAssignmentResult> {
    const normalizedRows = this.normalizeRows(rows);
    if (!normalizedRows.length) {
      return { numbers: new Map() };
    }

    const numbersWithoutLock = await this.findAssignedNumbers(
      this.rowNumberRepository,
      acpId,
      normalizedRows,
    );
    if (normalizedRows.every((row) => numbersWithoutLock.has(row.rowKey))) {
      return { numbers: numbersWithoutLock };
    }

    return this.withAcpLock(acpId, async (repository) => {
      const numbers = await this.findAssignedNumbers(
        repository,
        acpId,
        normalizedRows,
      );
      const missingRows = normalizedRows
        .filter((row) => !numbers.has(row.rowKey))
        .sort((left, right) => this.compareRows(left, right));

      if (missingRows.length) {
        let nextNumber =
          (await repository.maximum("rowNumber", { acpId })) || 0;
        const created = missingRows.map((row) => {
          nextNumber += 1;
          numbers.set(row.rowKey, nextNumber);
          return repository.create({
            acpId,
            rowKey: row.rowKey,
            rowKeyHash: this.hashRowKey(row.rowKey),
            rowNumber: nextNumber,
          });
        });
        await repository.save(created);
      }

      const result: ItemRowNumberAssignmentResult = { numbers };
      if (includeRevision) {
        result.revision = await this.getRevisionFromRepository(
          repository,
          acpId,
        );
      }
      return result;
    });
  }

  async assignProvisionalNumbers(
    acpId: string,
    rows: NumberableItemRow[],
  ): Promise<Map<string, number>> {
    const normalizedRows = this.normalizeRows(rows);
    if (!normalizedRows.length) {
      return new Map();
    }

    const numbers = await this.findAssignedNumbers(
      this.rowNumberRepository,
      acpId,
      normalizedRows,
    );
    const missingRows = normalizedRows
      .filter((row) => !numbers.has(row.rowKey))
      .sort((left, right) => this.compareRows(left, right));
    if (!missingRows.length) {
      return numbers;
    }

    let nextNumber =
      (await this.rowNumberRepository.maximum("rowNumber", { acpId })) || 0;
    for (const row of missingRows) {
      nextNumber += 1;
      numbers.set(row.rowKey, nextNumber);
    }
    return numbers;
  }

  async recalculateNumbers(
    acpId: string,
    rows: NumberableItemRow[],
    transactionManager?: EntityManager,
    validateBeforeReplace?: (manager: EntityManager) => Promise<void>,
  ): Promise<Map<string, number>> {
    const normalizedRows = this.normalizeRows(rows).sort((left, right) =>
      this.compareRows(left, right),
    );

    return this.withAcpLock(
      acpId,
      async (repository) => {
        await validateBeforeReplace?.(repository.manager);
        await repository.delete({ acpId });
        const numbers = new Map<string, number>();
        const created = normalizedRows.map((row, index) => {
          const rowNumber = index + 1;
          numbers.set(row.rowKey, rowNumber);
          return repository.create({
            acpId,
            rowKey: row.rowKey,
            rowKeyHash: this.hashRowKey(row.rowKey),
            rowNumber,
          });
        });
        if (created.length) {
          await repository.save(created);
        }
        return numbers;
      },
      transactionManager,
    );
  }

  private async withAcpLock<T>(
    acpId: string,
    work: (repository: Repository<AcpItemRowNumber>) => Promise<T>,
    transactionManager?: EntityManager,
  ): Promise<T> {
    const runWithManager = async (manager: EntityManager) => {
      const acp = await manager
        .getRepository(Acp)
        .createQueryBuilder("acp")
        .setLock("pessimistic_write")
        .where("acp.id = :acpId", { acpId })
        .getOne();
      if (!acp) {
        throw new NotFoundException("AP not found");
      }
      return work(manager.getRepository(AcpItemRowNumber));
    };

    return transactionManager
      ? runWithManager(transactionManager)
      : this.rowNumberRepository.manager.transaction(runWithManager);
  }

  private normalizeRows(rows: NumberableItemRow[]): NumberableItemRow[] {
    const uniqueRows = new Map<string, NumberableItemRow>();
    for (const row of rows) {
      const rowKey = String(row.rowKey || "").trim();
      if (!rowKey || uniqueRows.has(rowKey)) {
        continue;
      }
      uniqueRows.set(rowKey, { ...row, rowKey });
    }
    return Array.from(uniqueRows.values());
  }

  private hashRowKey(rowKey: string): string {
    return crypto.createHash("sha256").update(rowKey, "utf8").digest("hex");
  }

  private async findAssignedNumbers(
    repository: Repository<AcpItemRowNumber>,
    acpId: string,
    rows: NumberableItemRow[],
  ): Promise<Map<string, number>> {
    const hashes = rows.map((row) => this.hashRowKey(row.rowKey));
    const persisted = await repository.find({
      where: { acpId, rowKeyHash: In(hashes) },
    });
    const persistedByHash = new Map(
      persisted.map((entry) => [entry.rowKeyHash, entry] as const),
    );
    const numbers = new Map<string, number>();

    for (const row of rows) {
      const hash = this.hashRowKey(row.rowKey);
      const entry = persistedByHash.get(hash);
      if (!entry) {
        continue;
      }
      if (entry.rowKey !== row.rowKey) {
        throw new ConflictException("Item row identity hash collision");
      }
      numbers.set(row.rowKey, entry.rowNumber);
    }
    return numbers;
  }

  private compareRows(
    left: NumberableItemRow,
    right: NumberableItemRow,
  ): number {
    const itemComparison = this.collator.compare(
      left.itemId || "",
      right.itemId || "",
    );
    if (itemComparison) {
      return itemComparison;
    }
    const subIdComparison = this.collator.compare(
      left.subId || "",
      right.subId || "",
    );
    if (subIdComparison) {
      return subIdComparison;
    }
    const unitComparison = this.collator.compare(
      left.unitId || "",
      right.unitId || "",
    );
    return unitComparison || this.collator.compare(left.rowKey, right.rowKey);
  }
}
