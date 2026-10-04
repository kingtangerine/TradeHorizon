import {
  cloneDrawing,
  parseDrawing,
  type Anchor,
  type Drawing,
  type DrawingStyle,
} from "./model";
import type { DrawingRepository } from "./persistence";

export interface DrawingUpdate {
  readonly anchors?: readonly Anchor[];
  readonly style?: DrawingStyle;
  readonly locked?: boolean;
  readonly hidden?: boolean;
}

export type DrawingCommand =
  | { readonly kind: "create"; readonly drawing: Drawing }
  | { readonly kind: "update"; readonly id: string; readonly changes: DrawingUpdate }
  | { readonly kind: "delete"; readonly id: string };

export function createDrawing(drawing: Drawing): DrawingCommand {
  return { kind: "create", drawing };
}

export function updateDrawing(id: string, changes: DrawingUpdate): DrawingCommand {
  return { kind: "update", id, changes };
}

export function deleteDrawing(id: string): DrawingCommand {
  return { kind: "delete", id };
}

export interface DrawingStoreSnapshot {
  readonly drawings: readonly Drawing[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Monotonically increases whenever the observable snapshot changes. */
  readonly version: number;
}

export interface DrawingStoreOptions {
  readonly initialDrawings?: readonly Drawing[];
  readonly repository?: DrawingRepository;
  readonly historyLimit?: number;
}

type Listener = () => void;

interface HistoryEntry {
  readonly before: readonly Drawing[];
  readonly after: readonly Drawing[];
}

function sanitizeCollection(drawings: readonly Drawing[]): readonly Drawing[] {
  const result: Drawing[] = [];
  const ids = new Set<string>();

  for (const drawing of drawings) {
    const parsed = parseDrawing(drawing);
    if (!parsed) throw new TypeError(`Invalid drawing: ${drawing.id ?? "unknown"}`);
    if (ids.has(parsed.id)) throw new TypeError(`Duplicate drawing id: ${parsed.id}`);
    ids.add(parsed.id);
    result.push(parsed);
  }

  return result;
}

function applyCommand(
  drawings: readonly Drawing[],
  command: DrawingCommand,
): readonly Drawing[] | null {
  switch (command.kind) {
    case "create": {
      const drawing = parseDrawing(command.drawing);
      if (!drawing || drawings.some((item) => item.id === drawing.id)) return null;
      return [...drawings, drawing];
    }

    case "update": {
      const index = drawings.findIndex((drawing) => drawing.id === command.id);
      if (index < 0) return null;

      const current = drawings[index];
      const candidate = parseDrawing({
        ...current,
        ...command.changes,
        id: current.id,
        marketId: current.marketId,
        type: current.type,
        schemaVersion: current.schemaVersion,
        revision: current.revision + 1,
      });
      if (!candidate) return null;

      const next = drawings.slice();
      next[index] = candidate;
      return next;
    }

    case "delete": {
      const index = drawings.findIndex((drawing) => drawing.id === command.id);
      if (index < 0) return null;
      return [...drawings.slice(0, index), ...drawings.slice(index + 1)];
    }
  }
}

export class DrawingStore {
  private drawings: readonly Drawing[];
  private readonly repository?: DrawingRepository;
  private readonly historyLimit: number;
  private undoStack: readonly HistoryEntry[] = [];
  private redoStack: readonly HistoryEntry[] = [];
  private readonly listeners = new Set<Listener>();
  private version = 0;
  private snapshot: DrawingStoreSnapshot;

  public constructor(options: DrawingStoreOptions = {}) {
    const historyLimit = options.historyLimit ?? 100;
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 0) {
      throw new RangeError("historyLimit must be a non-negative safe integer");
    }

    this.repository = options.repository;
    this.historyLimit = historyLimit;
    const source = options.initialDrawings ?? options.repository?.load() ?? [];
    this.drawings = sanitizeCollection(source);
    this.snapshot = this.createSnapshot();
  }

  /** Stable between transitions, so it is safe to use with useSyncExternalStore. */
  public getSnapshot = (): DrawingStoreSnapshot => this.snapshot;

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public execute(command: DrawingCommand): boolean {
    const next = applyCommand(this.drawings, command);
    if (!next) return false;

    const entry: HistoryEntry = { before: this.drawings, after: next };
    this.drawings = next;
    this.redoStack = [];
    this.undoStack =
      this.historyLimit === 0
        ? []
        : [...this.undoStack, entry].slice(-this.historyLimit);
    this.commit();
    return true;
  }

  public undo(): boolean {
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) return false;

    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [...this.redoStack, entry];
    this.drawings = entry.before;
    this.commit();
    return true;
  }

  public redo(): boolean {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) return false;

    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack =
      this.historyLimit === 0
        ? []
        : [...this.undoStack, entry].slice(-this.historyLimit);
    this.drawings = entry.after;
    this.commit();
    return true;
  }

  private commit(): void {
    this.version += 1;
    this.snapshot = this.createSnapshot();
    this.repository?.save(this.drawings.map(cloneDrawing));
    for (const listener of this.listeners) listener();
  }

  private createSnapshot(): DrawingStoreSnapshot {
    return {
      drawings: this.drawings,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      version: this.version,
    };
  }
}
