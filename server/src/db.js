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
    time_limit INTEGER NOT NULL DEFAULT 20,
    points INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    is_correct INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
  );
`);

// миграции для баз, созданных до появления таймера и настраиваемых очков
try {
  db.exec("ALTER TABLE questions ADD COLUMN time_limit INTEGER NOT NULL DEFAULT 20");
} catch {
  // колонка уже есть
}
try {
  db.exec("ALTER TABLE questions ADD COLUMN points INTEGER NOT NULL DEFAULT 1");
  // в старых базах очки уже создались со значением 1000 — приводим к новому дефолту
  db.exec("UPDATE questions SET points = 1 WHERE points = 1000");
} catch {
  // колонка уже есть
}
// профиль ведущего (EM-11): имя/фамилия для лобби игроков, аватар — JSON BigHead
for (const col of ["name", "surname", "avatar"]) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  } catch {
    // колонка уже есть
  }
}

// история игр (EM-12): одна строка на завершённую партию; results — JSON лидерборда
db.exec(`
  CREATE TABLE IF NOT EXISTS game_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_id INTEGER NOT NULL,
    quiz_title TEXT NOT NULL,
    quiz_type TEXT NOT NULL,
    players_count INTEGER NOT NULL,
    results TEXT NOT NULL,
    played_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// режим вопроса (EM-13): 'choice' — варианты, 'tf' — правда/ложь
try {
  db.exec("ALTER TABLE questions ADD COLUMN mode TEXT NOT NULL DEFAULT 'choice'");
} catch {
  // колонка уже есть
}
