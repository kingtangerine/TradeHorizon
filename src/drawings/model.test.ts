import { describe, expect, it } from "vitest";

import { parseDrawing, type Drawing } from "./model";

const drawing = (): Drawing => ({
  schemaVersion: 1,
  id: "trend-1",
  marketId: "binance:spot:BTC-USDT",
  type: "trendLine",
  anchors: [
    { timeMs: 1_700_000_000_000, price: "42000.125" },
    {
      timeMs: 1_700_000_060_000,
      price: "42100",
      snap: { barOpenMs: 1_700_000_040_000, field: "high" },
    },
  ],
  style: { color: "#8b5cf6", width: 2 },
  revision: 0,
});

describe("parseDrawing", () => {
  it("keeps market coordinates and strips renderer-specific fields", () => {
    const parsed = parseDrawing({
      ...drawing(),
      x: 123,
      dataIndex: 42,
      anchors: drawing().anchors.map((anchor, index) => ({
        ...anchor,
        x: index * 100,
        y: index * 20,
        dataIndex: index,
      })),
    });

    expect(parsed).toEqual(drawing());
    expect(parsed).not.toHaveProperty("x");
    expect(parsed?.anchors[0]).not.toHaveProperty("dataIndex");
  });

  it.each(["42e3", "NaN", "01.5", "", 42000])(
    "rejects the non-canonical decimal price %p",
    (price) => {
      const candidate = drawing();
      expect(
        parseDrawing({
          ...candidate,
          anchors: [{ ...candidate.anchors[0], price }, candidate.anchors[1]],
        }),
      ).toBeNull();
    },
  );

  it("rejects the wrong number of anchors for a tool", () => {
    expect(parseDrawing({ ...drawing(), anchors: drawing().anchors.slice(0, 1) })).toBeNull();
    expect(
      parseDrawing({
        ...drawing(),
        type: "rectangle",
        anchors: drawing().anchors.slice(0, 1),
      }),
    ).toBeNull();
    expect(
      parseDrawing({
        ...drawing(),
        type: "rectangle",
        anchors: [...drawing().anchors, ...drawing().anchors],
      }),
    ).toBeNull();
  });

  it("expands 2-point rectangle anchors to 8 points", () => {
    const rect = parseDrawing({
      ...drawing(),
      type: "rectangle",
      anchors: [
        { timeMs: 1_000, price: "100" },
        { timeMs: 2_000, price: "200" },
      ],
    });

    expect(rect?.anchors).toHaveLength(8);
    expect(rect?.anchors).toEqual([
      { timeMs: 1_000, price: "200" },
      { timeMs: 1_500, price: "200" },
      { timeMs: 2_000, price: "200" },
      { timeMs: 2_000, price: "150" },
      { timeMs: 2_000, price: "100" },
      { timeMs: 1_500, price: "100" },
      { timeMs: 1_000, price: "100" },
      { timeMs: 1_000, price: "150" },
    ]);
  });

  it("preserves canonical 8-point rectangle anchors", () => {
    const anchors = [
      { timeMs: 1_000, price: "200" },
      { timeMs: 1_500, price: "200" },
      { timeMs: 2_000, price: "200" },
      { timeMs: 2_000, price: "150" },
      { timeMs: 2_000, price: "100" },
      { timeMs: 1_500, price: "100" },
      { timeMs: 1_000, price: "100" },
      { timeMs: 1_000, price: "150" },
    ];
    const rect = parseDrawing({
      ...drawing(),
      type: "rectangle",
      anchors,
    });

    expect(rect?.anchors).toEqual(anchors);
  });

  it("parses valid horizontalLine and priceRange drawings", () => {
    const hLine = parseDrawing({
      ...drawing(),
      type: "horizontalLine",
      anchors: [{ timeMs: 1_700_000_000_000, price: "42000" }],
    });
    expect(hLine).not.toBeNull();
    expect(hLine?.anchors).toHaveLength(1);

    const priceRange = parseDrawing({
      ...drawing(),
      type: "priceRange",
      anchors: [
        { timeMs: 1_700_000_000_000, price: "42000" },
        { timeMs: 1_700_000_060_000, price: "43500" },
      ],
    });
    expect(priceRange).not.toBeNull();
    expect(priceRange?.anchors).toHaveLength(2);
  });

  it("fails closed for cyclic style data", () => {
    const style: Record<string, unknown> = {};
    style.self = style;

    expect(parseDrawing({ ...drawing(), style })).toBeNull();
  });
});
