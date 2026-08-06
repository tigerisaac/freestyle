import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { initSchema } from "../src/lib/schema.js";

let db: DatabaseSync | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("remix writing-memory migration (v21)", () => {
  it("creates the table for an existing v20 install", () => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO schema_version (id, version) VALUES (1, 20);

      CREATE TABLE remix_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    initSchema(db);

    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'remix_thread_memory'",
      )
      .get();
    expect(table).toBeDefined();

    db.prepare("INSERT INTO remix_threads DEFAULT VALUES").run();
    db.prepare(
      "INSERT INTO remix_thread_memory (thread_id, kind, content) VALUES (1, 'brief', 'A real brief')",
    ).run();
    expect(
      db.prepare("SELECT content FROM remix_thread_memory").get(),
    ).toMatchObject({ content: "A real brief" });
  });
});
