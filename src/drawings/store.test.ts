import { describe, expect, it, vi } from "vitest";

import type { Drawing } from "./model";
import type { DrawingRepository } from "./persistence";
import {
  createDrawing,
  deleteDrawing,
  DrawingStore,
  updateDrawing,
} from "./store";

const makeDrawing = (id = "trend-1"): Drawing => ({
  schemaVersion: 1,
  id,
  marketId: "binance:spot:BTC-USDT",
  type: "trendLine",
  anchors: [
    { timeMs: 1_700_000_000_000, price: "42000" },
    { timeMs: 1_700_000_060_000, price: "42100" },
  ],
  style: { color: "#8b5cf6" },
  revision: 0,
});

describe("DrawingStore", () => {
  it("returns a stable external-store snapshot until state changes", () => {
    const store = new DrawingStore();
    const before = store.getSnapshot();

    expect(store.getSnapshot()).toBe(before);
    store.execute(createDrawing(makeDrawing()));
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("applies immutable create, update, and delete commands", () => {
    const original = makeDrawing();
    const store = new DrawingStore();

    expect(store.execute(createDrawing(original))).toBe(true);
    const afterCreate = store.getSnapshot().drawings;
    expect(afterCreate).toEqual([original]);

    expect(
      store.execute(
        updateDrawing(original.id, {
          anchors: [original.anchors[0], { ...original.anchors[1], price: "43000" }],
        }),
      ),
    ).toBe(true);
    const afterUpdate = store.getSnapshot().drawings;

    expect(afterUpdate).not.toBe(afterCreate);
    expect(afterUpdate[0]).not.toBe(afterCreate[0]);
    expect(afterUpdate[0].anchors[1].price).toBe("43000");
    expect(afterUpdate[0].revision).toBe(1);
    expect(original.anchors[1].price).toBe("42100");

    expect(store.execute(deleteDrawing(original.id))).toBe(true);
    expect(store.getSnapshot().drawings).toEqual([]);
  });

  it("undoes and redoes exact states and clears redo on a new branch", () => {
    const store = new DrawingStore();
    const first = makeDrawing("first");
    const second = makeDrawing("second");

    store.execute(createDrawing(first));
    store.execute(createDrawing(second));
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().drawings.map(({ id }) => id)).toEqual(["first"]);
    expect(store.getSnapshot().canRedo).toBe(true);

    expect(store.redo()).toBe(true);
    expect(store.getSnapshot().drawings.map(({ id }) => id)).toEqual([
      "first",
      "second",
    ]);

    store.undo();
    store.execute(deleteDrawing("first"));
    expect(store.getSnapshot().canRedo).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it("does not record invalid or no-op commands", () => {
    const store = new DrawingStore({ initialDrawings: [makeDrawing()] });

    expect(store.execute(createDrawing(makeDrawing()))).toBe(false);
    expect(store.execute(deleteDrawing("missing"))).toBe(false);
    expect(
      store.execute(updateDrawing("trend-1", { anchors: [] })),
    ).toBe(false);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("persists and notifies once per successful transition", () => {
    const save = vi.fn();
    const repository: DrawingRepository = {
      load: () => [],
      save,
      clear: vi.fn(),
    };
    const listener = vi.fn();
    const store = new DrawingStore({ repository });
    store.subscribe(listener);

    store.execute(createDrawing(makeDrawing()));
    store.undo();
    store.redo();

    expect(save).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().version).toBe(3);
  });
});
