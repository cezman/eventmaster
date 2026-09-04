import { Router } from "express";
import { db } from "./db.js";
import { authRequired } from "./auth.js";

export const eventRoutes = Router();

// сценарий = упорядоченные блоки, позиции 0..n-1 без дыр (спека §1.3)
const BLOCK_TYPES = ["quiz", "poll", "text", "image", "audio", "break", "activity"];

eventRoutes.use(authRequired);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function getEvent(id, hostId) {
  return db.prepare("SELECT * FROM events WHERE id = ? AND host_id = ?").get(id, hostId);
}

function touchEvent(eventId) {
  db.prepare("UPDATE events SET updated_at = datetime('now') WHERE id = ?").run(eventId);
}

function loadBlocks(eventId) {
  const blocks = db
    .prepare("SELECT * FROM scenario_blocks WHERE event_id = ? ORDER BY position")
    .all(eventId);
  // для карточек сценария подтягиваем название квиза; ссылка может протухнуть — это не ошибка
  const quizStmt = db.prepare("SELECT title FROM quizzes WHERE id = ?");
  return blocks.map((b) => {
    const content = parseJson(b.content);
    const out = { ...b, content, settings: parseJson(b.settings) };
    // ссылка может протухнуть или отсутствовать — это не ошибка выдачи
    if ((b.type === "quiz" || b.type === "poll") && Number.isInteger(content.quizId)) {
      out.quizTitle = quizStmt.get(content.quizId)?.title ?? null;
    }
    return out;
  });
}

function parseJson(raw) {
  try {
    const v = JSON.parse(raw || "{}");
    return isPlainObject(v) ? v : {};
  } catch {
    return {};
  }
}

// валидация content по типу блока: у quiz/poll обязателен квиз самого ведущего
function validateContent(type, content, hostId) {
  if (content === undefined) return {};
  if (!isPlainObject(content)) throw new Error("content должен быть объектом");
  if (type === "quiz" || type === "poll") {
    if (!Number.isInteger(content.quizId)) throw new Error("Для блока quiz/poll нужен целочисленный quizId");
    const quiz = db
      .prepare("SELECT id FROM quizzes WHERE id = ? AND host_id = ?")
      .get(content.quizId, hostId);
    if (!quiz) throw new Error("Квиз не найден");
    return { ...content, quizId: content.quizId };
  }
  return content;
}

// позиция должна быть конечным числом — иначе иная ошибка уйдёт глубже в SQL
function parsePosition(raw, max) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) throw new Error("Некорректная позиция");
  return Math.min(max, Math.max(0, n));
}

// схлопываем дыры в нумерации после удалений
function compactPositions(eventId) {
  const rest = db
    .prepare("SELECT id FROM scenario_blocks WHERE event_id = ? ORDER BY position")
    .all(eventId);
  rest.forEach((b, i) => {
    db.prepare("UPDATE scenario_blocks SET position = ? WHERE id = ?").run(i, b.id);
  });
}

eventRoutes.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT e.*,
        (SELECT COUNT(*) FROM scenario_blocks b WHERE b.event_id = e.id) AS block_count,
        (SELECT COALESCE(SUM(
           (SELECT COUNT(*) FROM questions q
            WHERE q.quiz_id = json_extract(b.content, '$.quizId'))), 0)
         FROM scenario_blocks b WHERE b.event_id = e.id AND b.type IN ('quiz', 'poll')) AS question_count
       FROM events e WHERE e.host_id = ? ORDER BY e.created_at DESC`
    )
    .all(req.userId);
  res.json({ events: rows });
});

eventRoutes.post("/", (req, res) => {
  const { title, description, cover_image } = req.body || {};
  if (typeof title !== "string" || !title.trim()) return res.status(400).json({ error: "Введите название" });
  const result = db
    .prepare("INSERT INTO events (host_id, title, description, cover_image) VALUES (?, ?, ?, ?)")
    .run(
      req.userId,
      title.trim().slice(0, 200),
      typeof description === "string" ? description.slice(0, 2000) : "",
      typeof cover_image === "string" ? cover_image.slice(0, 500) : ""
    );
  const event = getEvent(Number(result.lastInsertRowid), req.userId);
  res.json({ event, blocks: [] });
});

eventRoutes.get("/:id", (req, res) => {
  const event = getEvent(req.params.id, req.userId);
  if (!event) return res.status(404).json({ error: "Мероприятие не найдено" });
  res.json({ event, blocks: loadBlocks(event.id) });
});

eventRoutes.put("/:id", (req, res) => {
  const event = getEvent(req.params.id, req.userId);
  if (!event) return res.status(404).json({ error: "Мероприятие не найдено" });
  const { title, description, cover_image, status } = req.body || {};
  // live/completed выставляет только движок сценария (EM-55), клиенту — draft/ready
  if (status !== undefined && !["draft", "ready"].includes(status)) {
    return res.status(400).json({ error: "Неверный статус" });
  }
  db.exec("BEGIN");
  try {
    if (typeof title === "string" && title.trim())
      db.prepare("UPDATE events SET title = ? WHERE id = ?").run(title.trim().slice(0, 200), event.id);
    if (typeof description === "string")
      db.prepare("UPDATE events SET description = ? WHERE id = ?").run(description.slice(0, 2000), event.id);
    if (typeof cover_image === "string")
      db.prepare("UPDATE events SET cover_image = ? WHERE id = ?").run(cover_image.slice(0, 500), event.id);
    if (status !== undefined)
      db.prepare("UPDATE events SET status = ? WHERE id = ?").run(status, event.id);
    touchEvent(event.id);
    db.exec("COMMIT");
    res.json({ event: getEvent(event.id, req.userId) });
  } catch (e) {
    db.exec("ROLLBACK");
    res.status(400).json({ error: e.message });
  }
});

eventRoutes.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM events WHERE id = ? AND host_id = ?").run(req.params.id, req.userId);
  res.json({ ok: true });
});

eventRoutes.post("/:id/blocks", (req, res) => {
  const event = getEvent(req.params.id, req.userId);
  if (!event) return res.status(404).json({ error: "Мероприятие не найдено" });
  const { type, content, settings, position } = req.body || {};
  if (!BLOCK_TYPES.includes(type)) return res.status(400).json({ error: "Неверный тип блока" });
  db.exec("BEGIN");
  try {
    const validContent = validateContent(type, content, req.userId);
    // quiz/poll без квиза не имеет смысла для движка сценария — отбрасываем сразу
    if ((type === "quiz" || type === "poll") && !Number.isInteger(validContent.quizId)) {
      throw new Error("Для блока quiz/poll нужен целочисленный quizId");
    }
    // MAX вместо COUNT — не ломается, если в нумерации есть дыры
    const maxPos = db
      .prepare("SELECT COALESCE(MAX(position), -1) AS m FROM scenario_blocks WHERE event_id = ?")
      .get(event.id).m;
    // без position — в конец; с position — вставка со сдвигом остальных
    const pos = position === undefined ? maxPos + 1 : parsePosition(position, maxPos + 1);
    if (position !== undefined) {
      db.prepare("UPDATE scenario_blocks SET position = position + 1 WHERE event_id = ? AND position >= ?").run(
        event.id,
        pos
      );
    }
    db.prepare(
      "INSERT INTO scenario_blocks (event_id, type, position, content, settings) VALUES (?, ?, ?, ?, ?)"
    ).run(event.id, type, pos, JSON.stringify(validContent), JSON.stringify(isPlainObject(settings) ? settings : {}));
    touchEvent(event.id);
    db.exec("COMMIT");
    res.json({ blocks: loadBlocks(event.id) });
  } catch (e) {
    db.exec("ROLLBACK");
    res.status(400).json({ error: e.message });
  }
});

eventRoutes.put("/:id/blocks/:blockId", (req, res) => {
  const event = getEvent(req.params.id, req.userId);
  if (!event) return res.status(404).json({ error: "Мероприятие не найдено" });
  const block = db
    .prepare("SELECT * FROM scenario_blocks WHERE id = ? AND event_id = ?")
    .get(req.params.blockId, event.id);
  if (!block) return res.status(404).json({ error: "Блок не найден" });
  const { content, settings, position } = req.body || {};
  db.exec("BEGIN");
  try {
    if (content !== undefined) {
      const validContent = validateContent(block.type, content, req.userId);
      db.prepare("UPDATE scenario_blocks SET content = ? WHERE id = ?").run(JSON.stringify(validContent), block.id);
    }
    if (settings !== undefined) {
      if (!isPlainObject(settings)) throw new Error("settings должен быть объектом");
      db.prepare("UPDATE scenario_blocks SET settings = ? WHERE id = ?").run(JSON.stringify(settings), block.id);
    }
    if (position !== undefined) {
      const maxPos = db
        .prepare("SELECT COALESCE(MAX(position), -1) AS m FROM scenario_blocks WHERE event_id = ?")
        .get(event.id).m;
      const pos = parsePosition(position, maxPos);
      // сначала убираем блок с текущего места, сдвигаем остальные, ставим на новое
      db.prepare("UPDATE scenario_blocks SET position = -1 WHERE id = ?").run(block.id);
      db.prepare("UPDATE scenario_blocks SET position = position - 1 WHERE event_id = ? AND position > ?").run(
        event.id,
        block.position
      );
      db.prepare("UPDATE scenario_blocks SET position = position + 1 WHERE event_id = ? AND position >= ?").run(
        event.id,
        pos
      );
      db.prepare("UPDATE scenario_blocks SET position = ? WHERE id = ?").run(pos, block.id);
    }
    touchEvent(event.id);
    db.exec("COMMIT");
    res.json({ blocks: loadBlocks(event.id) });
  } catch (e) {
    db.exec("ROLLBACK");
    res.status(400).json({ error: e.message });
  }
});

eventRoutes.delete("/:id/blocks/:blockId", (req, res) => {
  const event = getEvent(req.params.id, req.userId);
  if (!event) return res.status(404).json({ error: "Мероприятие не найдено" });
  const block = db
    .prepare("SELECT id FROM scenario_blocks WHERE id = ? AND event_id = ?")
    .get(req.params.blockId, event.id);
  if (!block) return res.status(404).json({ error: "Блок не найден" });
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM scenario_blocks WHERE id = ?").run(block.id);
    compactPositions(event.id);
    touchEvent(event.id);
    db.exec("COMMIT");
    res.json({ blocks: loadBlocks(event.id) });
  } catch (e) {
    db.exec("ROLLBACK");
    res.status(400).json({ error: e.message });
  }
});

eventRoutes.post("/:id/clone", (req, res) => {
  const event = getEvent(req.params.id, req.userId);
  if (!event) return res.status(404).json({ error: "Мероприятие не найдено" });
  db.exec("BEGIN");
  try {
    const result = db
      .prepare("INSERT INTO events (host_id, title, description, cover_image) VALUES (?, ?, ?, ?)")
      .run(req.userId, `${event.title} (копия)`, event.description, event.cover_image);
    const cloneId = Number(result.lastInsertRowid);
    const blocks = db
      .prepare("SELECT * FROM scenario_blocks WHERE event_id = ? ORDER BY position")
      .all(event.id);
    for (const b of blocks) {
      db.prepare(
        "INSERT INTO scenario_blocks (event_id, type, position, content, settings) VALUES (?, ?, ?, ?, ?)"
      ).run(cloneId, b.type, b.position, b.content, b.settings);
    }
    db.exec("COMMIT");
    res.json({ event: getEvent(cloneId, req.userId), blocks: loadBlocks(cloneId) });
  } catch (e) {
    db.exec("ROLLBACK");
    res.status(400).json({ error: e.message });
  }
});

eventRoutes.post("/:id/reorder", (req, res) => {
  const event = getEvent(req.params.id, req.userId);
  if (!event) return res.status(404).json({ error: "Мероприятие не найдено" });
  const { blockIds } = req.body || {};
  if (!Array.isArray(blockIds)) return res.status(400).json({ error: "Ожидается массив blockIds" });
  const existing = db
    .prepare("SELECT id FROM scenario_blocks WHERE event_id = ?")
    .all(event.id)
    .map((b) => b.id);
  // переставить можно ровно существующий набор блоков, без дублей
  const same =
    blockIds.length === existing.length &&
    blockIds.every((id) => existing.includes(Number(id))) &&
    new Set(blockIds.map(Number)).size === blockIds.length;
  if (!same) return res.status(400).json({ error: "Набор блоков не совпадает со сценарием" });
  db.exec("BEGIN");
  try {
    blockIds.forEach((id, i) => {
      db.prepare("UPDATE scenario_blocks SET position = ? WHERE id = ? AND event_id = ?").run(
        i,
        Number(id),
        event.id
      );
    });
    touchEvent(event.id);
    db.exec("COMMIT");
    res.json({ blocks: loadBlocks(event.id) });
  } catch (e) {
    db.exec("ROLLBACK");
    res.status(400).json({ error: e.message });
  }
});

// EM-52: квиз — это блок сценария. Создали квиз → сразу появилось «простое мероприятие»
export function createSimpleEventForQuiz(hostId, quizId, title, quizType) {
  const result = db
    .prepare("INSERT INTO events (host_id, title, status) VALUES (?, ?, 'draft')")
    .run(hostId, title);
  db.prepare("INSERT INTO scenario_blocks (event_id, type, position, content) VALUES (?, ?, 0, ?)").run(
    Number(result.lastInsertRowid),
    quizType,
    JSON.stringify({ quizId })
  );
}

// EM-52: при удалении квиза убираем ссылающиеся блоки; мероприятие, оставшееся
// без единого блока, тоже удаляем — пустой сценарий ведущему ни к чему
export function removeQuizFromEvents(quizId, hostId) {
  const affected = db
    .prepare(
      `SELECT DISTINCT event_id FROM scenario_blocks
       WHERE type IN ('quiz', 'poll') AND json_extract(content, '$.quizId') = ?`
    )
    .all(quizId);
  for (const { event_id } of affected) {
    const event = getEvent(event_id, hostId);
    if (!event) continue;
    db.prepare(
      `DELETE FROM scenario_blocks WHERE event_id = ? AND type IN ('quiz', 'poll')
       AND json_extract(content, '$.quizId') = ?`
    ).run(event_id, quizId);
    compactPositions(event_id);
    const left = db
      .prepare("SELECT COUNT(*) AS n FROM scenario_blocks WHERE event_id = ?")
      .get(event_id).n;
    if (left === 0) db.prepare("DELETE FROM events WHERE id = ?").run(event_id);
  }
}
