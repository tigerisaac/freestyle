import type { DatabaseSync } from "node:sqlite";

/** Apply user dictionary word replacements (longest keys first). */
export function applyDictionaryReplacements(
  text: string,
  db: DatabaseSync,
): string {
  let cleanedText = text;

  try {
    const dictRows = db
      .prepare(
        "SELECT id, key, value FROM dictionary ORDER BY length(key) DESC",
      )
      .all() as { id: number; key: string; value: string }[];

    if (dictRows.length === 0) return cleanedText;

    const matchedIds: number[] = [];
    for (const { id, key, value } of dictRows) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "gi");
      if (regex.test(cleanedText)) {
        matchedIds.push(id);
        cleanedText = cleanedText.replace(
          new RegExp(`\\b${escaped}\\b`, "gi"),
          value,
        );
      }
    }

    if (matchedIds.length > 0) {
      const updateStmt = db.prepare(
        "UPDATE dictionary SET usage_count = usage_count + 1 WHERE id = ?",
      );
      for (const id of matchedIds) {
        updateStmt.run(id);
      }
    }
  } catch {
    // Dictionary table may not exist yet
  }

  return cleanedText;
}
