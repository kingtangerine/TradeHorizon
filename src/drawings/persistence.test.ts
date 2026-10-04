import { describe, expect, it } from "vitest";

import type { Drawing } from "./model";
import {
  createLocalStorageDrawingRepository,
  type KeyValueStorage,
} from "./persistence";

const drawing: Drawing = {
  schemaVersion: 1,
  id: "trend-1",
  marketId: "binance:spot:BTC-USDT",
  type: "trendLine",
  anchors: [
    { timeMs: 1_700_000_000_000, price: "42000" },
    { timeMs: 1_700_000_060_000, price: "42100" },
  ],
  style: {},
  revision: 0,
};

class MemoryStorage implements KeyValueStorage {
  public readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("local storage drawing repository", () => {
  it("round-trips a versioned document", () => {
    const storage = new MemoryStorage();
    const repository = createLocalStorageDrawingRepository({ storage, key: "test" });

    repository.save([drawing]);

    expect(JSON.parse(storage.values.get("test") ?? "")).toMatchObject({ version: 1 });
    expect(repository.load()).toEqual([drawing]);
  });

  it.each(["{broken", "null", '{"version":99,"drawings":[]}'])(
    "fails closed for invalid or unsupported data: %s",
    (serialized) => {
      const storage = new MemoryStorage();
      storage.values.set("test", serialized);
      const repository = createLocalStorageDrawingRepository({ storage, key: "test" });

      expect(repository.load()).toEqual([]);
    },
  );

  it("skips invalid and duplicate records without discarding valid drawings", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      "test",
      JSON.stringify({
        version: 1,
        drawings: [drawing, { ...drawing }, { ...drawing, id: "bad", anchors: [] }],
      }),
    );
    const repository = createLocalStorageDrawingRepository({ storage, key: "test" });

    expect(repository.load()).toEqual([drawing]);
  });

  it("contains browser storage exceptions", () => {
    const storage: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const repository = createLocalStorageDrawingRepository({ storage });

    expect(repository.load()).toEqual([]);
    expect(() => repository.save([drawing])).not.toThrow();
    expect(() => repository.clear()).not.toThrow();
  });
});

