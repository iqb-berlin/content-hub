import { NotFoundException } from "@nestjs/common";
import * as crypto from "crypto";
import { Ap, ApItemRowNumber } from "../database/entities";
import {
  ItemRowNumberingService,
  NumberableItemRow,
} from "./item-row-numbering.service";

describe("ItemRowNumberingService", () => {
  let service: ItemRowNumberingService;
  let persisted: ApItemRowNumber[];
  let apExists: boolean;
  let repository: any;
  let transactionManager: any;
  let rootTransaction: jest.Mock;

  const row = (
    rowKey: string,
    unitId: string,
    itemId: string,
    subId?: string,
  ): NumberableItemRow => ({ rowKey, unitId, itemId, subId });
  const hash = (rowKey: string) =>
    crypto.createHash("sha256").update(rowKey, "utf8").digest("hex");

  beforeEach(() => {
    persisted = [];
    apExists = true;
    repository = {
      find: jest.fn(async ({ where }: any) => {
        const requestedHashes = where.rowKeyHash?.value;
        const hashSet = Array.isArray(requestedHashes)
          ? new Set(requestedHashes)
          : null;
        return persisted.filter(
          (entry) =>
            entry.apId === where.apId &&
            (!hashSet || hashSet.has(entry.rowKeyHash)),
        );
      }),
      maximum: jest.fn(async (_column: string, { apId }: any) =>
        persisted
          .filter((entry) => entry.apId === apId)
          .reduce<
            number | null
          >((maximum, entry) => (maximum === null ? entry.rowNumber : Math.max(maximum, entry.rowNumber)), null),
      ),
      create: jest.fn((entry: Partial<ApItemRowNumber>) => ({
        id: `id-${entry.rowKey}`,
        ...entry,
      })),
      save: jest.fn(async (entries: ApItemRowNumber[]) => {
        persisted.push(...entries);
        return entries;
      }),
      delete: jest.fn(async ({ apId }: { apId: string }) => {
        persisted = persisted.filter((entry) => entry.apId !== apId);
        return { affected: 1 };
      }),
    };
    const apQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => (apExists ? { id: "ap-1" } : null)),
    };
    transactionManager = {
      getRepository: jest.fn((entity) =>
        entity === Ap
          ? { createQueryBuilder: jest.fn(() => apQueryBuilder) }
          : repository,
      ),
    };
    repository.manager = transactionManager;
    rootTransaction = jest.fn(async (work) => work(transactionManager));
    const rootRepository = {
      find: repository.find,
      maximum: repository.maximum,
      manager: {
        transaction: rootTransaction,
      },
    };
    service = new ItemRowNumberingService(rootRepository as any);
  });

  it("initially numbers rows by natural alphanumeric Item-ID and Sub-ID", async () => {
    const numbers = await service.assignNumbers("ap-1", [
      row("uuid-10", "UNIT_1", "ITEM_10"),
      row("uuid-2::2", "UNIT_1", "ITEM_2", "2"),
      row("uuid-2::1", "UNIT_1", "ITEM_2", "1"),
      row("uuid-1", "UNIT_1", "ITEM_1"),
    ]);

    expect(Array.from(numbers.entries())).toEqual([
      ["uuid-1", 1],
      ["uuid-2::1", 2],
      ["uuid-2::2", 3],
      ["uuid-10", 4],
    ]);
  });

  it("returns the persisted revision from the numbering transaction", async () => {
    const assignment = await service.assignNumbersWithRevision("ap-1", [
      row("uuid-1", "UNIT_1", "ITEM_1"),
      row("uuid-2", "UNIT_1", "ITEM_2"),
    ]);

    expect(Array.from(assignment.numbers.entries())).toEqual([
      ["uuid-1", 1],
      ["uuid-2", 2],
    ]);
    expect(assignment.revision).toBe(await service.getRevision("ap-1"));
    expect(rootTransaction).toHaveBeenCalledTimes(1);
  });

  it("reads the compact revision after persisting within the transaction", async () => {
    repository.query = jest
      .fn()
      .mockResolvedValue([{ count: "1", hash: "transaction-hash" }]);

    const assignment = await service.assignNumbersWithRevision("ap-1", [
      row("uuid-1", "UNIT_1", "ITEM_1"),
    ]);

    expect(assignment.revision).toBe("1:transaction-hash");
    expect(repository.save.mock.invocationCallOrder[0]).toBeLessThan(
      repository.query.mock.invocationCallOrder[0],
    );
  });

  it("does not calculate a revision when only row numbers are requested", async () => {
    repository.query = jest
      .fn()
      .mockResolvedValue([{ count: "1", hash: "unused" }]);

    await service.assignNumbers("ap-1", [row("uuid-1", "UNIT_1", "ITEM_1")]);

    expect(repository.query).not.toHaveBeenCalled();
  });

  it("derives a deterministic revision from persisted row assignments", async () => {
    persisted = [
      {
        id: "1",
        apId: "ap-1",
        rowKey: "first",
        rowKeyHash: hash("first"),
        rowNumber: 2,
      } as ApItemRowNumber,
      {
        id: "2",
        apId: "ap-1",
        rowKey: "second",
        rowKeyHash: hash("second"),
        rowNumber: 1,
      } as ApItemRowNumber,
    ];

    const first = await service.getRevision("ap-1");
    persisted.reverse();
    const second = await service.getRevision("ap-1");
    persisted[0].rowNumber = 3;
    const changed = await service.getRevision("ap-1");

    expect(first).toBe(second);
    expect(changed).not.toBe(first);
  });

  it("uses the compact database revision query when available", async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ count: "2", hash: "database-hash" }]);
    (service as any).rowNumberRepository.query = query;

    await expect(service.getRevision("ap-1")).resolves.toBe("2:database-hash");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM acp_item_row_numbers"),
      ["ap-1"],
    );
  });

  it("sorts globally by Item-ID before using Unit-ID as a tie-breaker", async () => {
    const numbers = await service.assignNumbers("ap-1", [
      row("unit-1-item-10", "UNIT_1", "ITEM_10"),
      row("unit-2-item-2", "UNIT_2", "ITEM_2"),
      row("unit-1-item-2", "UNIT_1", "ITEM_2"),
    ]);

    expect(Array.from(numbers.entries())).toEqual([
      ["unit-1-item-2", 1],
      ["unit-2-item-2", 2],
      ["unit-1-item-10", 3],
    ]);
  });

  it("returns existing assignments without taking the AP write lock", async () => {
    persisted = [
      {
        id: "1",
        apId: "ap-1",
        rowKey: "current",
        rowKeyHash: hash("current"),
        rowNumber: 4,
      } as ApItemRowNumber,
    ];

    const numbers = await service.assignNumbers("ap-1", [
      row("current", "UNIT_1", "UNIT_1_ITEM_1"),
    ]);

    expect(numbers.get("current")).toBe(4);
    expect(rootTransaction).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("stores long row keys with a fixed-size hash identity", async () => {
    const longRowKey = `123e4567-e89b-12d3-a456-426614174000::${encodeURIComponent(
      "😀".repeat(39),
    )}`;

    expect(longRowKey.length).toBeGreaterThan(500);

    await service.assignNumbers("ap-1", [
      row(longRowKey, "UNIT_1", "ITEM_1", "😀".repeat(39)),
    ]);

    expect(persisted[0]).toEqual(
      expect.objectContaining({
        rowKey: longRowKey,
        rowKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("keeps deleted row numbers free and appends new rows above the previous maximum", async () => {
    persisted = [
      {
        id: "1",
        apId: "ap-1",
        rowKey: "current",
        rowKeyHash: hash("current"),
        rowNumber: 1,
      } as ApItemRowNumber,
      {
        id: "2",
        apId: "ap-1",
        rowKey: "deleted",
        rowKeyHash: hash("deleted"),
        rowNumber: 2,
      } as ApItemRowNumber,
      {
        id: "3",
        apId: "ap-1",
        rowKey: "current-2",
        rowKeyHash: hash("current-2"),
        rowNumber: 4,
      } as ApItemRowNumber,
    ];

    const numbers = await service.assignNumbers("ap-1", [
      row("current", "UNIT_1", "ITEM_1"),
      row("new", "UNIT_1", "ITEM_2"),
      row("current-2", "UNIT_1", "ITEM_3"),
    ]);

    expect(numbers.get("current")).toBe(1);
    expect(numbers.has("deleted")).toBe(false);
    expect(numbers.get("new")).toBe(5);
    expect(repository.maximum).toHaveBeenCalledWith("rowNumber", {
      apId: "ap-1",
    });
  });

  it("assigns draft-only rows provisionally without persisting them", async () => {
    persisted = [
      {
        id: "1",
        apId: "ap-1",
        rowKey: "current",
        rowKeyHash: hash("current"),
        rowNumber: 1,
      } as ApItemRowNumber,
      {
        id: "2",
        apId: "ap-1",
        rowKey: "deleted",
        rowKeyHash: hash("deleted"),
        rowNumber: 4,
      } as ApItemRowNumber,
    ];

    const numbers = await service.assignProvisionalNumbers("ap-1", [
      row("current", "UNIT_1", "ITEM_1"),
      row("draft", "UNIT_1", "ITEM_2"),
    ]);

    expect(numbers.get("current")).toBe(1);
    expect(numbers.get("draft")).toBe(5);
    expect(repository.save).not.toHaveBeenCalled();
    expect(persisted.map((entry) => entry.rowKey)).toEqual([
      "current",
      "deleted",
    ]);
  });

  it("recalculates only current rows and closes previous gaps", async () => {
    persisted = [
      {
        id: "1",
        apId: "ap-1",
        rowKey: "deleted",
        rowNumber: 2,
      } as ApItemRowNumber,
      {
        id: "2",
        apId: "ap-1",
        rowKey: "item-10",
        rowNumber: 8,
      } as ApItemRowNumber,
    ];

    const numbers = await service.recalculateNumbers("ap-1", [
      row("item-10", "UNIT_1", "ITEM_10"),
      row("item-2", "UNIT_1", "ITEM_2"),
    ]);

    expect(Array.from(numbers.entries())).toEqual([
      ["item-2", 1],
      ["item-10", 2],
    ]);
    expect(persisted.map((entry) => entry.rowKey)).toEqual([
      "item-2",
      "item-10",
    ]);
  });

  it("reuses a caller transaction for atomic recalculation", async () => {
    await service.recalculateNumbers(
      "ap-1",
      [row("item-1", "UNIT_1", "ITEM_1")],
      transactionManager,
    );

    expect(rootTransaction).not.toHaveBeenCalled();
    expect(repository.delete).toHaveBeenCalledWith({ apId: "ap-1" });
    expect(persisted[0]).toEqual(
      expect.objectContaining({ rowKey: "item-1", rowNumber: 1 }),
    );
  });

  it("validates the source snapshot after locking and before replacing rows", async () => {
    const validateBeforeReplace = jest.fn(async (manager) => {
      expect(manager).toBe(transactionManager);
    });

    await service.recalculateNumbers(
      "ap-1",
      [row("item-1", "UNIT_1", "ITEM_1")],
      transactionManager,
      validateBeforeReplace,
    );

    expect(validateBeforeReplace).toHaveBeenCalledTimes(1);
    expect(validateBeforeReplace.mock.invocationCallOrder[0]).toBeLessThan(
      repository.delete.mock.invocationCallOrder[0],
    );
  });

  it("fails without mutating numbering when the AP does not exist", async () => {
    apExists = false;

    await expect(
      service.assignNumbers("missing", [row("item", "UNIT_1", "ITEM_1")]),
    ).rejects.toThrow(NotFoundException);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
