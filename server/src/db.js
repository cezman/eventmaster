import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// на Render база живёт на примонтированном диске (DATA_DIR=/data), локально — в server/data
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "app.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('quiz', 'poll')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    position INTEGER NOT NULL,
    time_limit INTEGER NOT NULL DEFAULT 20
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    is_correct INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
  );
`);

// миграция для баз, созданных до появления таймера
try {
  db.exec("ALTER TABLE questions ADD COLUMN time_limit INTEGER NOT NULL DEFAULT 20");
} catch {
  // колонка уже есть
}
