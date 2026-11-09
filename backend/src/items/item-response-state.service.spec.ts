import { ForbiddenException } from "@nestjs/common";
import { ItemResponseStateService } from "./item-response-state.service";

describe("ItemResponseStateService", () => {
  let service: ItemResponseStateService;
  let stateRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    find: jest.Mock;
  };

  beforeEach(() => {
    stateRepository = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((value) => value),
      save: jest
        .fn()
        .mockImplementation(async (value) => ({ id: "state-1", ...value })),
      delete: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    service = new ItemResponseStateService(stateRepository as any);
  });

  it("rejects saving state for non-managers", async () => {
    await expect(
      service.saveResponseState("ap-1", "item-1", "unit-1", { a: 1 }, false),
    ).rejects.toThrow(ForbiddenException);
  });

  it("updates existing state records", async () => {
    stateRepository.findOne.mockResolvedValue({
      id: "state-1",
      apId: "ap-1",
      itemId: "item-1",
      unitId: "unit-1",
      responseData: { old: true },
    });

    const result = await service.saveResponseState(
      "ap-1",
      "item-1",
      "unit-1",
      { answer: 1 },
      true,
    );

    expect(stateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "state-1",
        unitId: "unit-1",
        responseData: { answer: 1 },
      }),
    );
    expect(result).toEqual(expect.objectContaining({ id: "state-1" }));
    expect(stateRepository.findOne).toHaveBeenCalledWith({
      where: {
        apId: "ap-1",
        itemId: "item-1",
        unitId: "unit-1",
        rowKey: "unit-1::item-1",
      },
    });
  });

  it("creates new state records when none exist", async () => {
    stateRepository.findOne.mockResolvedValue(null);

    await service.saveResponseState(
      "ap-1",
      "item-2",
      "unit-2",
      { answer: 2 },
      true,
    );

    expect(stateRepository.create).toHaveBeenCalledWith({
      apId: "ap-1",
      itemId: "item-2",
      unitId: "unit-2",
      rowKey: "unit-2::item-2",
      responseData: { answer: 2 },
    });
    expect(stateRepository.save).toHaveBeenCalled();
  });

  it("finds UUID-backed standard states for callers without a row key", async () => {
    const canonicalState = {
      id: "state-canonical",
      apId: "ap-1",
      itemId: "item-1",
      unitId: "unit-1",
      rowKey: "uuid-1",
      responseData: { answer: 1 },
      updatedAt: new Date("2026-07-13T10:00:00.000Z"),
    };
    stateRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(canonicalState);

    await expect(
      service.getResponseState("ap-1", "item-1", "unit-1"),
    ).resolves.toEqual(canonicalState);

    expect(stateRepository.findOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          apId: "ap-1",
          itemId: "item-1",
          unitId: "unit-1",
          rowKey: expect.anything(),
        }),
        order: { updatedAt: "DESC" },
      }),
    );
    const rowKeyOperator = stateRepository.findOne.mock.calls[1][0].where
      .rowKey as any;
    expect(rowKeyOperator.type).toBe("not");
    expect(rowKeyOperator.child.type).toBe("like");
    expect(rowKeyOperator.child.value).toBe("%::%");
  });

  it("does not rename a canonical standard state back to its legacy key", async () => {
    const canonicalState = {
      id: "state-canonical",
      apId: "ap-1",
      itemId: "item-1",
      unitId: "unit-1",
      rowKey: "uuid-1",
      responseData: { answer: 1 },
    };
    stateRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(canonicalState);

    await service.saveResponseState(
      "ap-1",
      "item-1",
      "unit-1",
      { answer: 2 },
      true,
    );

    expect(stateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "state-canonical",
        rowKey: "uuid-1",
        responseData: { answer: 2 },
      }),
    );
  });

  it("keeps legacy fallback reads side-effect free", async () => {
    const legacyState = {
      id: "state-legacy",
      apId: "ap-1",
      itemId: "item-1",
      unitId: "unit-1",
      rowKey: "unit-1::item-1",
      responseData: { answer: 1 },
    };
    stateRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacyState);

    await expect(
      service.getResponseState("ap-1", "item-1", "unit-1", "uuid-1"),
    ).resolves.toEqual(legacyState);

    expect(stateRepository.save).not.toHaveBeenCalled();
  });

  it("migrates a legacy row key only during a manager save", async () => {
    const legacyState = {
      id: "state-legacy",
      apId: "ap-1",
      itemId: "item-1",
      unitId: "unit-1",
      rowKey: "unit-1::item-1",
      responseData: { answer: 1 },
    };
    stateRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacyState);

    await service.saveResponseState(
      "ap-1",
      "item-1",
      "unit-1",
      { answer: 2 },
      true,
      "uuid-1",
    );

    expect(stateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "state-legacy",
        rowKey: "uuid-1",
        responseData: { answer: 2 },
      }),
    );
  });

  it("returns direct response state when available", async () => {
    stateRepository.find.mockResolvedValueOnce([
      {
        id: "state-direct",
        apId: "ap-1",
        itemId: "item-2",
        unitId: "unit-1",
        rowKey: "unit-1::item-2",
      },
    ]);

    const result = await service.getResponseStateWithFallback(
      "ap-1",
      "item-2",
      "unit-1",
      [
        { itemId: "item-1", unitId: "unit-1" },
        { itemId: "item-2", unitId: "unit-1" },
      ],
    );

    expect(result).toEqual({
      state: expect.objectContaining({ id: "state-direct" }),
      isFallback: false,
    });
    expect(stateRepository.find).toHaveBeenCalledTimes(1);
    expect(stateRepository.findOne).not.toHaveBeenCalled();
  });

  it("returns fallback state from previous item in same unit", async () => {
    stateRepository.find.mockResolvedValueOnce([
      {
        id: "state-prev",
        apId: "ap-1",
        itemId: "item-1",
        unitId: "unit-1",
        rowKey: "unit-1::item-1",
      },
    ]);

    const result = await service.getResponseStateWithFallback(
      "ap-1",
      "item-2",
      "unit-1",
      [
        { itemId: "item-1", unitId: "unit-1" },
        { itemId: "item-2", unitId: "unit-1" },
      ],
    );

    expect(result).toEqual({
      state: expect.objectContaining({
        id: "state-prev",
        itemId: "item-1",
      }),
      isFallback: true,
      fallbackItemId: "item-1",
    });
    expect(stateRepository.find).toHaveBeenCalledTimes(1);
  });

  it("returns no fallback when item is first in sequence or no previous state exists", async () => {
    stateRepository.find.mockResolvedValue([]);

    await expect(
      service.getResponseStateWithFallback("ap-1", "item-1", "unit-1", [
        { itemId: "item-1", unitId: "unit-1" },
        { itemId: "item-2", unitId: "unit-1" },
      ]),
    ).resolves.toEqual({ state: null, isFallback: false });

    await expect(
      service.getResponseStateWithFallback("ap-1", "item-2", "unit-1", [
        { itemId: "item-1", unitId: "unit-2" },
        { itemId: "item-2", unitId: "unit-1" },
      ]),
    ).resolves.toEqual({ state: null, isFallback: false });
  });

  it("gets, deletes and lists states with manager checks", async () => {
    stateRepository.findOne.mockResolvedValue({ id: "state-1" });
    await expect(
      service.getResponseState("ap-1", "item-1", "unit-1"),
    ).resolves.toEqual({ id: "state-1" });

    await expect(
      service.deleteResponseState("ap-1", "item-1", "unit-1", false),
    ).rejects.toThrow(ForbiddenException);

    stateRepository.delete.mockResolvedValue({ affected: 1 });
    await expect(
      service.deleteResponseState("ap-1", "item-1", "unit-1", true),
    ).resolves.toEqual({ success: true });

    stateRepository.delete.mockResolvedValue({ affected: 0 });
    await expect(
      service.deleteResponseState("ap-1", "item-2", "unit-2", true),
    ).resolves.toEqual({ success: false });

    await expect(service.getAllStatesForAp("ap-1", false)).rejects.toThrow(
      ForbiddenException,
    );

    stateRepository.find.mockResolvedValue([{ id: "state-1" }]);
    await expect(service.getAllStatesForAp("ap-1", true)).resolves.toEqual([
      { id: "state-1" },
    ]);
    expect(stateRepository.find).toHaveBeenCalledWith({
      where: { apId: "ap-1" },
      order: { unitId: "ASC", itemId: "ASC", rowKey: "ASC" },
    });
  });

  it("stores response states independently for partial-credit row keys", async () => {
    stateRepository.findOne.mockResolvedValue(null);

    await service.saveResponseState(
      "ap-1",
      "item-1",
      "unit-1",
      { answer: 1 },
      true,
      "uuid-1::1",
    );
    await service.saveResponseState(
      "ap-1",
      "item-1",
      "unit-1",
      { answer: 2 },
      true,
      "uuid-1::2",
    );

    expect(stateRepository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        rowKey: "uuid-1::1",
        responseData: { answer: 1 },
      }),
    );
    expect(stateRepository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        rowKey: "uuid-1::2",
        responseData: { answer: 2 },
      }),
    );
  });

  it("does not resolve a row key through a different item route", async () => {
    stateRepository.findOne.mockResolvedValue(null);

    await service.getResponseState("ap-1", "item-b", "unit-b", "uuid-a::1");

    expect(stateRepository.findOne).toHaveBeenCalledWith({
      where: {
        apId: "ap-1",
        itemId: "item-b",
        unitId: "unit-b",
        rowKey: "uuid-a::1",
      },
    });
  });

  it("returns false for manager check placeholder", async () => {
    await expect(service.checkIsManager("ap-1", "user-1")).resolves.toBe(false);
  });
});
