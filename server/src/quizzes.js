import { Router } from "express";
import { db } from "./db.js";
import { authRequired } from "./auth.js";

export const quizRoutes = Router();

quizRoutes.use(authRequired);

function parseSettings(raw) {
  try {
    const s = JSON.parse(raw || "{}");
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}

function loadFullQuiz(id, hostId) {
  const quiz = db.prepare("SELECT * FROM quizzes WHERE id = ? AND host_id = ?").get(id, hostId);
  if (!quiz) return null;
  const questions = db
    .prepare("SELECT id, text, position, time_limit, points, mode FROM questions WHERE quiz_id = ? ORDER BY position")
    .all(id);
  const answersStmt = db.prepare(
    "SELECT id, text, is_correct, position FROM answers WHERE question_id = ? ORDER BY position"
  );
  return {
    ...quiz,
    settings: parseSettings(quiz.settings),
    questions: questions.map((q) => ({
      text: q.text,
      time_limit: q.time_limit,
      points: q.points,
      mode: q.mode || "choice",
      answers: answersStmt.all(q.id).map((a) => ({ text: a.text, is_correct: !!a.is_correct })),
    })),
  };
}

function saveQuestions(quizId, questions) {
  db.prepare("DELETE FROM questions WHERE quiz_id = ?").run(quizId);
  const qStmt = db.prepare("INSERT INTO questions (quiz_id, text, position) VALUES (?, ?, ?)");
  const aStmt = db.prepare("INSERT INTO answers (question_id, text, is_correct, position) VALUES (?, ?, ?, ?)");
  questions.forEach((q, qi) => {
    if (!q.text || !q.text.trim()) throw new Error("Текст вопроса не может быть пустым");
    const mode = q.mode === "tf" ? "tf" : "choice";
    let answers = (q.answers || []).filter((a) => a.text && a.text.trim());
    if (mode === "tf") {
      // правда/ложь — всегда ровно два варианта с фиксированными подписями
      answers = [
        { text: "Правда", is_correct: !!answers[0]?.is_correct },
        { text: "Ложь", is_correct: !answers[0]?.is_correct && !!answers[1]?.is_correct },
      ];
      // ровно один правильный: если хост не отметил — правильной считаем «Правду»
      if (!answers[0].is_correct && !answers[1].is_correct) answers[0].is_correct = true;
      if (answers[0].is_correct && answers[1].is_correct) answers[1].is_correct = false;
    }
    if (answers.length < 2) throw new Error("У вопроса должно быть минимум 2 варианта ответа");
    const qRes = qStmt.run(quizId, q.text.trim(), qi);
    const timeLimit = Math.min(120, Math.max(5, Number(q.time_limit) || 20));
    const pointsRaw = Math.round(Number(q.points));
    const points = Number.isFinite(pointsRaw) ? Math.min(100000, Math.max(1, pointsRaw)) : 1;
    answers.forEach((a, ai) => {
      aStmt.run(Number(qRes.lastInsertRowid), a.text.trim(), a.is_correct ? 1 : 0, ai);
    });
    db.prepare("UPDATE questions SET time_limit = ?, points = ?, mode = ? WHERE id = ?").run(
      timeLimit,
      points,
      mode,
      Number(qRes.lastInsertRowid)
    );
  });
}

quizRoutes.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT q.*, (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count
       FROM quizzes q WHERE q.host_id = ? ORDER BY q.created_at DESC`
    )
    .all(req.userId);
  res.json({ quizzes: rows });
});

quizRoutes.post("/", (req, res) => {
  const { title, type, questions } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "Введите название" });
  if (!["quiz", "poll"].includes(type)) return res.status(400).json({ error: "Неверный тип" });
  try {
    const result = db
      .prepare("INSERT INTO quizzes (host_id, title, type) VALUES (?, ?, ?)")
      .run(req.userId, title.trim(), type);
    const quizId = Number(result.lastInsertRowid);
    if (Array.isArray(questions) && questions.length) saveQuestions(quizId, questions);
    res.json({ quiz: loadFullQuiz(quizId, req.userId) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

quizRoutes.get("/:id", (req, res) => {
  const quiz = loadFullQuiz(req.params.id, req.userId);
  if (!quiz) return res.status(404).json({ error: "Викторина не найдена" });
  res.json({ quiz });
});

quizRoutes.put("/:id", (req, res) => {
  const quiz = db.prepare("SELECT id, type FROM quizzes WHERE id = ? AND host_id = ?").get(req.params.id, req.userId);
  if (!quiz) return res.status(404).json({ error: "Викторина не найдена" });
  const { title, questions, settings } = req.body || {};
  // title/settings/questions — одной транзакцией: частичный коммит при 400 недопустим
  db.exec("BEGIN");
  try {
    if (title && title.trim()) db.prepare("UPDATE quizzes SET title = ? WHERE id = ?").run(title.trim(), quiz.id);
    if (settings && typeof settings === "object" && !Array.isArray(settings)) {
      // храним только известные флаги; live-распределение — только для голосований (EM-27)
      db.prepare("UPDATE quizzes SET settings = ? WHERE id = ?").run(
        JSON.stringify({ showLiveResults: quiz.type === "poll" && settings.showLiveResults === true }),
        quiz.id
      );
    }
    if (Array.isArray(questions)) saveQuestions(quiz.id, questions);
    db.exec("COMMIT");
    res.json({ quiz: loadFullQuiz(quiz.id, req.userId) });
  } catch (e) {
    db.exec("ROLLBACK");
    res.status(400).json({ error: e.message });
  }
});

quizRoutes.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM quizzes WHERE id = ? AND host_id = ?").run(req.params.id, req.userId);
  res.json({ ok: true });
});
