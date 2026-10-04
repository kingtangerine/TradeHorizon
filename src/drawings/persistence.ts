import { cloneDrawing, parseDrawing, type Drawing } from "./model";

export const DRAWING_DOCUMENT_VERSION = 1 as const;
export const DEFAULT_DRAWING_STORAGE_KEY = "trade-horizon:drawings";

export interface DrawingDocumentV1 {
  readonly version: typeof DRAWING_DOCUMENT_VERSION;
  readonly drawings: readonly Drawing[];
}

export interface DrawingRepository {
  load(): readonly Drawing[];
  save(drawings: readonly Drawing[]): void;
  clear(): void;
}

/** The subset of the Web Storage API needed by the repository. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalStorageDrawingRepositoryOptions {
  readonly storage?: KeyValueStorage;
  readonly key?: string;
}

type DocumentMigration = (document: Record<string, unknown>) => unknown;

/*
 * Add old-version -> next-version functions here when the envelope changes.
 * Keeping migration at the document boundary lets the drawing parser remain
 * strict and prevents partially migrated records from reaching the store.
 */
const DOCUMENT_MIGRATIONS: Readonly<Record<number, DocumentMigration>> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateDocument(value: unknown): unknown {
  let candidate = value;
  const visited = new Set<number>();

  while (isRecord(candidate) && typeof candidate.version === "number") {
    const version = candidate.version;
    if (version === DRAWING_DOCUMENT_VERSION) return candidate;
    if (!Number.isSafeInteger(version) || visited.has(version)) return null;
    visited.add(version);

    const migration = DOCUMENT_MIGRATIONS[version];
    if (!migration) return null;
    candidate = migration(candidate);
  }

  return null;
}

export function parseDrawingDocument(value: unknown): DrawingDocumentV1 | null {
  const migrated = migrateDocument(value);
  if (!isRecord(migrated) || migrated.version !== DRAWING_DOCUMENT_VERSION) {
    return null;
  }
  if (!Array.isArray(migrated.drawings)) return null;

  const drawings: Drawing[] = [];
  const ids = new Set<string>();
  for (const value of migrated.drawings) {
    const drawing = parseDrawing(value);
    if (!drawing || ids.has(drawing.id)) continue;
    ids.add(drawing.id);
    drawings.push(drawing);
  }

  return { version: DRAWING_DOCUMENT_VERSION, drawings };
}

function resolveBrowserStorage(): KeyValueStorage | undefined {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? undefined
      : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Creates a repository that fails closed. Invalid JSON, unsupported versions,
 * privacy-mode storage errors, and quota errors never break chart interaction.
 */
export function createLocalStorageDrawingRepository(
  options: LocalStorageDrawingRepositoryOptions = {},
): DrawingRepository {
  const storage = options.storage ?? resolveBrowserStorage();
  const key = options.key ?? DEFAULT_DRAWING_STORAGE_KEY;

  return {
    load(): readonly Drawing[] {
      if (!storage) return [];
      try {
        const serialized = storage.getItem(key);
        if (serialized === null) return [];
        const document = parseDrawingDocument(JSON.parse(serialized) as unknown);
        return document ? document.drawings.map(cloneDrawing) : [];
      } catch {
        return [];
      }
    },

    save(drawings: readonly Drawing[]): void {
      if (!storage) return;
      try {
        const sanitized = drawings.map(cloneDrawing);
        const document: DrawingDocumentV1 = {
          version: DRAWING_DOCUMENT_VERSION,
          drawings: sanitized,
        };
        storage.setItem(key, JSON.stringify(document));
      } catch {
        // Persistence is best-effort. The in-memory store remains authoritative.
      }
    },

    clear(): void {
      if (!storage) return;
      try {
        storage.removeItem(key);
      } catch {
        // See save(): storage availability must not affect drawing interaction.
      }
    },
  };
}

