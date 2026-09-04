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

// настройки квиза (EM-27): JSON-строка, сейчас только showLiveResults (живое распределение)
try {
  db.exec("ALTER TABLE quizzes ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
} catch {
  // колонка уже есть
}

// админка (EM-14): role 'host'|'admin', статус 'active'|'blocked'
for (const [col, def] of [["role", "'host'"], ["status", "'active'"]]) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT NOT NULL DEFAULT ${def}`);
  } catch {
    // колонка уже есть
  }
}

// мероприятия (EM-52, спека design-new-features-spec §1.3): event = контейнер со сценарием
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_image TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'live', 'completed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scenario_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('quiz', 'poll', 'text', 'image', 'audio', 'break', 'activity')),
    position INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '{}',
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// кросс-блочные очки мероприятия (EM-55, Гэп 3): player_id — join-токен игрока
// (стабилен при reconnect), block_id — ссылка на блок сценария;
// UNIQUE = один рекорд на игрока на блок, по нему работает UPSERT-накопление
db.exec(`
  CREATE TABLE IF NOT EXISTS event_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    player_avatar TEXT NOT NULL DEFAULT '',
    block_id INTEGER REFERENCES scenario_blocks(id) ON DELETE CASCADE,
    points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (event_id, player_id, block_id)
  );
`);

// snapshot-копии квизов (EM-55, патч L1): quiz/poll-блок ссылается на копию,
// созданную при вставке из библиотеки; NULL — оригинал (и простое мероприятие-обёртка)
try {
  db.exec("ALTER TABLE quizzes ADD COLUMN cloned_from_quiz_id INTEGER");
} catch {
  // колонка уже есть
}

// обёртка квизов в «простое мероприятие» (§1.2): идемпотентно при каждом старте —
// добирает только квизы, на которые ещё не ссылается ни один quiz/poll-блок;
// json_valid — чтобы внешне испорченный content не валил старт сервера
const orphanQuizzes = db
  .prepare(
    `SELECT q.id, q.host_id, q.title, q.type FROM quizzes q
     WHERE q.cloned_from_quiz_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM scenario_blocks b
         WHERE b.type IN ('quiz', 'poll') AND json_valid(b.content)
           AND json_extract(b.content, '$.quizId') = q.id
       )`
  )
  .all();
for (const quiz of orphanQuizzes) {
  db.exec("BEGIN");
  try {
    const ev = db
      .prepare("INSERT INTO events (host_id, title, status) VALUES (?, ?, 'draft')")
      .run(quiz.host_id, quiz.title);
    db.prepare("INSERT INTO scenario_blocks (event_id, type, position, content) VALUES (?, ?, 0, ?)").run(
      Number(ev.lastInsertRowid),
      quiz.type,
      JSON.stringify({ quizId: quiz.id })
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
