import { Injectable } from "@nestjs/common";
import type { ItemListResult } from "./unit-parser.types";
import type { AsyncCacheStatus } from "./async-lru-cache";

export interface NumberedItemListCacheValue {
  itemList: ItemListResult;
  rowRevision: string;
  rowNumberingMs: number;
}

interface NumberedItemListCacheEntry {
  promise: Promise<NumberedItemListCacheValue>;
  settled: boolean;
}

@Injectable()
export class NumberedItemListCache {
  private readonly entries = new Map<string, NumberedItemListCacheEntry>();
  private readonly maxEntries = 100;

  get size(): number {
    return this.entries.size;
  }

  async getOrLoad(
    apId: string,
    baseKey: string,
    initialRevision: string,
    load: () => Promise<NumberedItemListCacheValue>,
  ): Promise<{
    value: NumberedItemListCacheValue;
    status: AsyncCacheStatus;
  }> {
    const initialKey = `${apId}:${baseKey}:${initialRevision}`;
    const cached = this.entries.get(initialKey);
    if (cached) {
      this.touch(initialKey, cached);
      const status = cached.settled ? "hit" : "coalesced";
      return {
        value: await cached.promise,
        status,
      };
    }

    const entry: NumberedItemListCacheEntry = {
      settled: false,
      promise: Promise.resolve({
        itemList: {
          columns: [],
          items: [],
          subIdLabel: "Sub-ID",
          subIdLabels: {},
          unitMetadata: {},
          codingSchemes: {},
          variableIdentityConsistency: {
            checkedItemCount: 0,
            collisionCount: 0,
            collisions: [],
          },
        },
        rowRevision: initialRevision,
        rowNumberingMs: 0,
      }),
    };
    entry.promise = Promise.resolve()
      .then(load)
      .then((value) => {
        entry.settled = true;
        const finalKey = `${apId}:${baseKey}:${value.rowRevision}`;
        if (finalKey !== initialKey && this.entries.get(initialKey) === entry) {
          this.entries.delete(initialKey);
          if (!this.entries.has(finalKey)) {
            this.setBounded(finalKey, entry);
          }
        }
        return value;
      })
      .catch((error) => {
        this.deleteIfCurrent(initialKey, entry);
        throw error;
      });
    this.setBounded(initialKey, entry);
    return { value: await entry.promise, status: "miss" };
  }

  invalidate(apId: string): void {
    const prefix = `${apId}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  private touch(key: string, entry: NumberedItemListCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private setBounded(key: string, entry: NumberedItemListCacheEntry): void {
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  private deleteIfCurrent(
    key: string,
    entry: NumberedItemListCacheEntry,
  ): void {
    if (this.entries.get(key) === entry) {
      this.entries.delete(key);
    }
  }
}
