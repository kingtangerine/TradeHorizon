/**
 * Drawing coordinates deliberately live in market space. Screen coordinates and
 * candle indexes belong to the chart adapter and must never be persisted here.
 */
export type DecimalPrice = string;

export const DRAWING_SCHEMA_VERSION = 1 as const;

export const DRAWING_TYPES = [
  "trendLine",
  "ray",
  "horizontalLine",
  "verticalLine",
  "rectangle",
  "fibRetracement",
  "longPosition",
  "shortPosition",
  "priceRange",
] as const;

export type DrawingType = (typeof DRAWING_TYPES)[number];

export const SNAP_FIELDS = ["open", "high", "low", "close"] as const;

export type SnapField = (typeof SNAP_FIELDS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type DrawingStyle = Readonly<Record<string, JsonValue>>;

export interface AnchorSnapV1 {
  readonly barOpenMs: number;
  readonly field: SnapField;
}

export interface AnchorV1 {
  readonly timeMs: number;
  readonly price: DecimalPrice;
  readonly snap?: AnchorSnapV1;
}

export type Anchor = AnchorV1;

export interface DrawingV1 {
  readonly schemaVersion: typeof DRAWING_SCHEMA_VERSION;
  readonly id: string;
  readonly marketId: string;
  readonly type: DrawingType;
  readonly anchors: readonly AnchorV1[];
  readonly style: DrawingStyle;
  readonly revision: number;
  readonly locked?: boolean;
  readonly hidden?: boolean;
}

export type Drawing = DrawingV1;

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isDecimalPrice(value: unknown): value is DecimalPrice {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

export function isTimestampMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function isDrawingType(value: unknown): value is DrawingType {
  return (
    typeof value === "string" &&
    (DRAWING_TYPES as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
): JsonValue | undefined {
  if (depth > 32) return undefined;

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const parsed: JsonValue[] = [];
    for (const item of value) {
      const next = parseJsonValue(item, seen, depth + 1);
      if (next === undefined) {
        seen.delete(value);
        return undefined;
      }
      parsed.push(next);
    }
    seen.delete(value);
    return parsed;
  }

  if (!isRecord(value)) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const parsed: Record<string, JsonValue> = Object.create(null) as Record<
    string,
    JsonValue
  >;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      seen.delete(value);
      return undefined;
    }
    const next = parseJsonValue(item, seen, depth + 1);
    if (next === undefined) {
      seen.delete(value);
      return undefined;
    }
    parsed[key] = next;
  }
  seen.delete(value);
  return parsed;
}

function parseAnchor(value: unknown): AnchorV1 | null {
  if (!isRecord(value)) return null;
  if (!isTimestampMs(value.timeMs) || !isDecimalPrice(value.price)) return null;

  let snap: AnchorSnapV1 | undefined;
  if (value.snap !== undefined) {
    if (!isRecord(value.snap)) return null;
    if (
      !isTimestampMs(value.snap.barOpenMs) ||
      typeof value.snap.field !== "string" ||
      !(SNAP_FIELDS as readonly string[]).includes(value.snap.field)
    ) {
      return null;
    }
    snap = {
      barOpenMs: value.snap.barOpenMs,
      field: value.snap.field as SnapField,
    };
  }

  return snap
    ? { timeMs: value.timeMs, price: value.price, snap }
    : { timeMs: value.timeMs, price: value.price };
}

function decimalString(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const direct = String(value);
  if (!/[eE]/.test(direct)) return direct;

  return value
    .toLocaleString("en-US", {
      useGrouping: false,
      maximumFractionDigits: 20,
    })
    .replace(/\.0+$/, "");
}

export function expandRectangleAnchors(anchors: readonly AnchorV1[]): AnchorV1[] {
  if (anchors.length >= 2) {
    const times = anchors.map((a) => a.timeMs);
    const prices = anchors.map((a) => Number(a.price)).filter((p) => Number.isFinite(p));
    if (prices.length === 0) return [...anchors];

    const timeStart = Math.min(...times);
    const timeEnd = Math.max(...times);
    const timeMid = Math.round((timeStart + timeEnd) / 2);
    const priceTopVal = Math.max(...prices);
    const priceBottomVal = Math.min(...prices);
    const priceMidVal = (priceTopVal + priceBottomVal) / 2;

    const priceTop = decimalString(priceTopVal);
    const priceMid = decimalString(priceMidVal);
    const priceBottom = decimalString(priceBottomVal);

    return [
      { timeMs: timeStart, price: priceTop },
      { timeMs: timeMid, price: priceTop },
      { timeMs: timeEnd, price: priceTop },
      { timeMs: timeEnd, price: priceMid },
      { timeMs: timeEnd, price: priceBottom },
      { timeMs: timeMid, price: priceBottom },
      { timeMs: timeStart, price: priceBottom },
      { timeMs: timeStart, price: priceMid },
    ];
  }
  return [...anchors];
}

function isValidAnchorCount(type: DrawingType, count: number): boolean {
  if (type === "horizontalLine" || type === "verticalLine") return count === 1;
  if (type === "priceRange") return count === 2;
  if (type === "longPosition" || type === "shortPosition") return count === 3;
  if (type === "rectangle") return count === 8 || count === 6 || count === 2;
  return count === 2;
}

/**
 * Parses and sanitizes an untrusted value into the current domain model.
 * Unknown properties (including accidental x/y/dataIndex fields) are discarded.
 */
export function parseDrawing(value: unknown): DrawingV1 | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== DRAWING_SCHEMA_VERSION) return null;
  if (typeof value.id !== "string" || value.id.trim().length === 0) return null;
  if (typeof value.marketId !== "string" || value.marketId.trim().length === 0) {
    return null;
  }
  if (!isDrawingType(value.type)) return null;
  if (!Array.isArray(value.anchors)) return null;
  if (!isValidAnchorCount(value.type, value.anchors.length)) return null;

  const rawAnchors: AnchorV1[] = [];
  for (const anchor of value.anchors) {
    const parsed = parseAnchor(anchor);
    if (!parsed) return null;
    rawAnchors.push(parsed);
  }

  const anchors = value.type === "rectangle" ? expandRectangleAnchors(rawAnchors) : rawAnchors;

  const parsedStyle = parseJsonValue(value.style);
  if (!parsedStyle || Array.isArray(parsedStyle) || typeof parsedStyle !== "object") {
    return null;
  }

  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    return null;
  }
  if (value.locked !== undefined && typeof value.locked !== "boolean") return null;
  if (value.hidden !== undefined && typeof value.hidden !== "boolean") return null;

  const drawing: DrawingV1 = {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    id: value.id,
    marketId: value.marketId,
    type: value.type,
    anchors,
    style: parsedStyle as DrawingStyle,
    revision: value.revision as number,
  };

  return {
    ...drawing,
    ...(value.locked === undefined ? {} : { locked: value.locked }),
    ...(value.hidden === undefined ? {} : { hidden: value.hidden }),
  };
}

export function cloneDrawing(drawing: Drawing): Drawing {
  const parsed = parseDrawing(drawing);
  if (!parsed) {
    throw new TypeError("Cannot clone an invalid drawing");
  }
  return parsed;
}
