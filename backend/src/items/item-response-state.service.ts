import { Injectable, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Like, Not, Repository } from "typeorm";
import { ItemResponseState } from "../database/entities";

@Injectable()
export class ItemResponseStateService {
  constructor(
    @InjectRepository(ItemResponseState)
    private readonly stateRepository: Repository<ItemResponseState>,
  ) {}

  /**
   * Save or update response state for an item.
   * Only AP managers can save states.
   */
  async saveResponseState(
    apId: string,
    itemId: string,
    unitId: string,
    responseData: Record<string, any>,
    userIsManager: boolean,
    rowKey?: string,
  ): Promise<ItemResponseState> {
    if (!userIsManager) {
      throw new ForbiddenException("Only AP managers can save response states");
    }

    // Check if state already exists
    const explicitRowKey = this.normalizeRowKey(rowKey);
    const resolvedRowKey = this.resolveRowKey(explicitRowKey, unitId, itemId);
    let state = await this.findState(apId, itemId, unitId, explicitRowKey);

    if (state) {
      // Update existing
      if (explicitRowKey) {
        state.rowKey = resolvedRowKey;
      }
      state.responseData = responseData;
    } else {
      // Create new
      state = this.stateRepository.create({
        apId,
        itemId,
        unitId,
        rowKey: resolvedRowKey,
        responseData,
      });
    }

    return this.stateRepository.save(state);
  }

  /**
   * Get response state for a specific item.
   */
  async getResponseState(
    apId: string,
    itemId: string,
    unitId: string,
    rowKey?: string,
  ): Promise<ItemResponseState | null> {
    return this.findState(apId, itemId, unitId, this.normalizeRowKey(rowKey));
  }

  /**
   * Get response state for a specific item, or find fallback from previous items in same unit.
   * Returns the state with metadata about whether it's a fallback.
   */
  async getResponseStateWithFallback(
    apId: string,
    itemId: string,
    unitId: string,
    itemList: { itemId: string; unitId: string; rowKey?: string }[],
    rowKey?: string,
  ): Promise<{
    state: ItemResponseState | null;
    isFallback: boolean;
    fallbackItemId?: string;
  }> {
    const currentIndex = itemList.findIndex(
      (i) =>
        i.itemId === itemId &&
        i.unitId === unitId &&
        (!rowKey || i.rowKey === rowKey),
    );
    const candidateItemIds = Array.from(
      new Set([
        itemId,
        ...(currentIndex > 0
          ? itemList
              .slice(0, currentIndex)
              .filter((candidate) => candidate.unitId === unitId)
              .map((candidate) => candidate.itemId)
          : []),
      ]),
    );
    const unitStates = await this.stateRepository.find({
      where: { apId, unitId, itemId: In(candidateItemIds) },
    });
    const directState = this.findStateInLoadedSet(
      unitStates,
      itemId,
      unitId,
      this.normalizeRowKey(rowKey),
    );
    if (directState) {
      return { state: directState, isFallback: false };
    }

    if (currentIndex <= 0) {
      return { state: null, isFallback: false };
    }

    // Iterate backwards to find previous item in same unit with state
    for (let i = currentIndex - 1; i >= 0; i--) {
      const prevItem = itemList[i];
      if (prevItem.unitId === unitId) {
        const prevState = this.findStateInLoadedSet(
          unitStates,
          prevItem.itemId,
          prevItem.unitId,
          this.normalizeRowKey(prevItem.rowKey),
        );
        if (prevState) {
          return {
            state: prevState,
            isFallback: true,
            fallbackItemId: prevItem.itemId,
          };
        }
      }
    }

    return { state: null, isFallback: false };
  }

  /**
   * Delete response state for an item.
   * Only AP managers can delete states.
   */
  async deleteResponseState(
    apId: string,
    itemId: string,
    unitId: string,
    userIsManager: boolean,
    rowKey?: string,
  ): Promise<{ success: boolean }> {
    if (!userIsManager) {
      throw new ForbiddenException(
        "Only AP managers can delete response states",
      );
    }

    const state = await this.findState(
      apId,
      itemId,
      unitId,
      this.normalizeRowKey(rowKey),
    );
    const result = state
      ? await this.stateRepository.delete({ id: state.id })
      : { affected: 0 };
    return {
      success:
        result.affected !== undefined &&
        result.affected !== null &&
        result.affected > 0,
    };
  }

  /**
   * Get all response states for an AP.
   * Only AP managers can view all states.
   */
  async getAllStatesForAp(
    apId: string,
    userIsManager: boolean,
  ): Promise<ItemResponseState[]> {
    if (!userIsManager) {
      throw new ForbiddenException(
        "Only AP managers can view all response states",
      );
    }

    return this.stateRepository.find({
      where: { apId },
      order: { unitId: "ASC", itemId: "ASC", rowKey: "ASC" },
    });
  }

  /**
   * Check if user is AP manager (placeholder - actual check happens in controller).
   */
  async checkIsManager(_apId: string, _userId: string): Promise<boolean> {
    // This is a placeholder - actual role checking should be done via ApUserRole entity
    // The controller will handle the actual authorization check
    return false;
  }

  private resolveRowKey(
    rowKey: string | undefined,
    unitId: string,
    itemId: string,
  ): string {
    return String(rowKey || "").trim() || `${unitId}::${itemId}`;
  }

  private normalizeRowKey(rowKey?: string): string | undefined {
    const normalized = String(rowKey || "").trim();
    return normalized || undefined;
  }

  private async findState(
    apId: string,
    itemId: string,
    unitId: string,
    explicitRowKey?: string,
  ): Promise<ItemResponseState | null> {
    const legacyRowKey = `${unitId}::${itemId}`;
    const requestedRowKey = explicitRowKey || legacyRowKey;
    const direct = await this.stateRepository.findOne({
      where: { apId, itemId, unitId, rowKey: requestedRowKey },
    });
    if (direct) {
      return direct;
    }

    if (!explicitRowKey) {
      return this.stateRepository.findOne({
        where: {
          apId,
          itemId,
          unitId,
          rowKey: Not(Like("%::%")),
        },
        order: { updatedAt: "DESC" },
      });
    }

    if (explicitRowKey.includes("::")) {
      return null;
    }

    const legacy = await this.stateRepository.findOne({
      where: { apId, itemId, unitId, rowKey: legacyRowKey },
    });
    return legacy;
  }

  private findStateInLoadedSet(
    states: ItemResponseState[],
    itemId: string,
    unitId: string,
    explicitRowKey?: string,
  ): ItemResponseState | null {
    const matchingStates = states.filter(
      (state) => state.itemId === itemId && state.unitId === unitId,
    );
    const legacyRowKey = `${unitId}::${itemId}`;
    const requestedRowKey = explicitRowKey || legacyRowKey;
    const direct =
      matchingStates.find((state) => state.rowKey === requestedRowKey) || null;
    if (direct) return direct;

    if (!explicitRowKey) {
      return (
        matchingStates
          .filter((state) => !String(state.rowKey || "").includes("::"))
          .sort(
            (left, right) =>
              new Date(right.updatedAt).getTime() -
              new Date(left.updatedAt).getTime(),
          )[0] || null
      );
    }

    if (explicitRowKey.includes("::")) {
      return null;
    }

    return (
      matchingStates.find((state) => state.rowKey === legacyRowKey) || null
    );
  }
}
