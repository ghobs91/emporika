// ── Minimal typings for node:sqlite ────────────────────────────────────
//
// `node:sqlite` is a Node built-in (≥22.5) but this repo pins
// `@types/node@^20`, which predates it. Rather than bump the types package —
// which would re-check every file in a large in-flight working tree — this
// declares only the surface `lib/target-index.ts` actually uses.
//
// Delete this file once `@types/node` is upgraded to ≥22.

declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): Array<Record<string, unknown>>;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  }

  export interface DatabaseSyncOptions {
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
