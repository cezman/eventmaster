import { Router } from "express";
import { db } from "./db.js";
import { authRequired } from "./auth.js";

export const eventRoutes = Router();

// сценарий = упорядоченные блоки, позиции 0..n-1 без дыр (спека §1.3).
// rating — Волна 6 (EM-57); openended/wordcloud добавляются в своих итерациях
const BLOCK_TYPES = ["quiz", "poll", "text", "image", "audio", "break", "activity", "rating"];

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

// валидация content по типу блока: quizId может быть null — «пустой» блок
// заполнят позже с экрана сценария (патч дизайнера, L2); заполненный должен
// быть целым и указывать на квиз самого ведущего
function validateContent(type, content, hostId) {
  if (content === undefined) return {};
  if (!isPlainObject(content)) throw new Error("content должен быть объектом");
  if (type === "quiz" || type === "poll") {
    if (content.quizId === null || content.quizId === undefined) return { ...content, quizId: null };
    if (!Number.isInteger(content.quizId)) throw new Error("quizId должен быть числом или null");
    const quiz = db
      .prepare("SELECT id FROM quizzes WHERE id = ? AND host_id = ?")
      .get(content.quizId, hostId);
    if (!quiz) throw new Error("Квиз не найден");
    return { ...content };
  }
  // оценка 1–N (спека активностей §5.2): нормализуем поля content, мусор отбрасываем
  if (type === "rating") {
    const labels = isPlainObject(content.labels) ? content.labels : {};
    const label = (v) => (typeof v === "string" ? v.slice(0, 40) : "");
    return {
      prompt: typeof content.prompt === "string" ? content.prompt.slice(0, 200) : "",
      scale: Math.min(10, Math.max(2, Number.isInteger(content.scale) ? content.scale : 10)),
      showAverage: content.showAverage !== false,
      labels: { low: label(labels.low), mid: label(labels.mid), high: label(labels.high) },
    };
  }
  return content;
}

// позиция должна быть конечным числом — иначе иная ошибка уйдёт глубже в SQL
function parsePosition(raw, max) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) throw new Error("Некорректная позиция");
  return Math.min(max, Math.max(0, n));
}

// === EM-55: snapshot-семантика квиз-блоков (патч L1) ===
// Вставка квиза из библиотеки в сценарий создаёт его копию (cloned_from_quiz_id):
// правки и удаление библиотечного оригинала не задевают уже вставленные блоки.
// Хелперы выполняются внутри открытой транзакции вызывающего эндпоинта.

function cloneQuizForBlock(hostId, quizId) {
  const src = db
    .prepare("SELECT id, title, type, settings FROM quizzes WHERE id = ? AND host_id = ?")
    .get(quizId, hostId);
  if (!src) throw new Error("Квиз не найден");
  const copy = db
    .prepare("INSERT INTO quizzes (host_id, title, type, settings, cloned_from_quiz_id) VALUES (?, ?, ?, ?, ?)")
    .run(hostId, src.title, src.type, src.settings || "{}", src.id);
  const copyId = Number(copy.lastInsertRowid);
  const questions = db
    .prepare("SELECT id, text, position, time_limit, points, mode FROM questions WHERE quiz_id = ? ORDER BY position")
    .all(src.id);
  const insQuestion = db.prepare(
    "INSERT INTO questions (quiz_id, text, position, time_limit, points, mode) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insAnswer = db.prepare("INSERT INTO answers (question_id, text, is_correct, position) VALUES (?, ?, ?, ?)");
  const srcAnswers = db.prepare("SELECT text, is_correct, position FROM answers WHERE question_id = ? ORDER BY position");
  for (const q of questions) {
    const res = insQuestion.run(copyId, q.text, q.position, q.time_limit, q.points, q.mode);
    for (const a of srcAnswers.all(q.id)) insAnswer.run(Number(res.lastInsertRowid), a.text, a.is_correct, a.position);
  }
  return copyId;
}

// копия живёт вместе со своим блоком: когда на неё больше не ссылается ни один
// блок ни одного сценария (блок удалили/заменили, мероприятие удалили) — удаляем
function deleteQuizCopyIfOrphan(quizId) {
  if (!Number.isInteger(quizId)) return;
  const quiz = db.prepare("SELECT id FROM quizzes WHERE id = ? AND cloned_from_quiz_id IS NOT NULL").get(quizId);
  if (!quiz) return;
  const refs = db
    .prepare(
      `SELECT COUNT(*) AS n FROM scenario_blocks
       WHERE type IN ('quiz', 'poll') AND json_valid(content) AND json_extract(content, '$.quizId') = ?`
    )
    .get(quizId).n;
  if (refs === 0) db.prepare("DELETE FROM quizzes WHERE id = ?").run(quizId);
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
  // фильтр по статусу (патч дизайнера §2); неизвестное значение — просто «Все»
  const statusFilter = ["draft", "ready", "live", "completed"].includes(req.query.status)
    ? req.query.status
    : null;
  const rows = db
    .prepare(
      `SELECT e.*,
        (SELECT COUNT(*) FROM scenario_blocks b WHERE b.event_id = e.id) AS block_count,
        (SELECT COUNT(*) FROM scenario_blocks b WHERE b.event_id = e.id AND b.type = 'quiz') AS quiz_count,
        (SELECT COUNT(*) FROM scenario_blocks b WHERE b.event_id = e.id AND b.type = 'poll') AS poll_count,
        (SELECT COUNT(*) FROM scenario_blocks b WHERE b.event_id = e.id AND b.type IN ('quiz', 'poll')
           AND (json_valid(b.content) = 0 OR json_extract(b.content, '$.quizId') IS NULL)) AS broken_blocks,
        (SELECT COALESCE(SUM(
           (SELECT COUNT(*) FROM questions q
            WHERE q.quiz_id = json_extract(b.content, '$.quizId'))), 0)
         FROM scenario_blocks b WHERE b.event_id = e.id AND b.type IN ('quiz', 'poll')) AS question_count
       FROM events e WHERE e.host_id = ?${statusFilter ? " AND e.status = ?" : ""}
       ORDER BY e.created_at DESC`
    )
    .all(...(statusFilter ? [req.userId, statusFilter] : [req.userId]));
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
  const event = getEvent(req.params.id, req.userId);
  if (!event) return res.status(404).json({ error: "Мероприятие не найдено" });
  db.exec("BEGIN");
  try {
    // snapshot-копии квизов удаляются вместе с мероприятием (спека §1.3):
    // сначала запоминаем ссылки, потом удаляем событие (блоки уйдут каскадом),
    // затем чистим осиротевшие копии
    const quizIds = db
      .prepare(
        `SELECT json_extract(content, '$.quizId') AS qid FROM scenario_blocks
         WHERE event_id = ? AND type IN ('quiz', 'poll') AND json_valid(content)`
      )
      .all(event.id)
      .map((r) => r.qid)
      .filter(Number.isInteger);
    db.prepare("DELETE FROM events WHERE id = ?").run(event.id);
    quizIds.forEach((qid) => deleteQuizCopyIfOrphan(qid));
    db.exec("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    db.exec("ROLLBACK");
    res.status(400).json({ error: e.message });
  }
});

eventRoutes.post("/:id/blocks", (req, res) => {
  const event = getEvent(req.params.id, req.userId);
  if (!event) return res.status(404).json({ error: "Мероприятие не найдено" });
  const { type, content, settings, position } = req.body || {};
  if (!BLOCK_TYPES.includes(type)) return res.status(400).json({ error: "Неверный тип блока" });
  db.exec("BEGIN");
  try {
    let validContent = validateContent(type, content, req.userId);
    // L1: блок ссылается на копию квиза, а не на библиотечный оригинал
    if ((type === "quiz" || type === "poll") && Number.isInteger(validContent.quizId))
      validContent = { ...validContent, quizId: cloneQuizForBlock(req.userId, validContent.quizId) };
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
  // прежний квиз блока: если это копия и ссылок на неё не осталось — удалим в конце
  const prevQuizId = parseJson(block.content).quizId;
  let replacedQuizId = null;
  db.exec("BEGIN");
  try {
    if (content !== undefined) {
      let validContent = validateContent(block.type, content, req.userId);
      // L1: замена квиза в блоке — тоже вставка копии; тот же quizId повторно не клонируем
      if (
        (block.type === "quiz" || block.type === "poll") &&
        Number.isInteger(validContent.quizId) &&
        validContent.quizId !== prevQuizId
      )
        validContent = { ...validContent, quizId: cloneQuizForBlock(req.userId, validContent.quizId) };
      db.prepare("UPDATE scenario_blocks SET content = ? WHERE id = ?").run(JSON.stringify(validContent), block.id);
      replacedQuizId = prevQuizId;
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
    // чистим старую копию после всех правок блока — когда счётчик ссылок уже честный
    if (replacedQuizId != null) deleteQuizCopyIfOrphan(replacedQuizId);
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
    .prepare("SELECT id, type, content FROM scenario_blocks WHERE id = ? AND event_id = ?")
    .get(req.params.blockId, event.id);
  if (!block) return res.status(404).json({ error: "Блок не найден" });
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM scenario_blocks WHERE id = ?").run(block.id);
    compactPositions(event.id);
    if (block.type === "quiz" || block.type === "poll")
      deleteQuizCopyIfOrphan(parseJson(block.content).quizId);
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
      let contentRaw = b.content;
      // копии квизов не делятся между мероприятиями: у клона события — свои копии,
      // иначе удаление одного события разорвало бы блоки другого
      if (b.type === "quiz" || b.type === "poll") {
        const content = parseJson(b.content);
        const owned =
          Number.isInteger(content.quizId) &&
          db.prepare("SELECT id FROM quizzes WHERE id = ? AND host_id = ?").get(content.quizId, req.userId);
        if (owned) {
          // протухшую ссылку (квиз удалён) переносим как есть — как её отдаёт loadBlocks
          content.quizId = cloneQuizForBlock(req.userId, content.quizId);
          contentRaw = JSON.stringify(content);
        }
      }
      db.prepare(
        "INSERT INTO scenario_blocks (event_id, type, position, content, settings) VALUES (?, ?, ?, ?, ?)"
      ).run(cloneId, b.type, b.position, contentRaw, b.settings);
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
