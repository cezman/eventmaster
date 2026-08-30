import { Router } from "express";
import { db } from "./db.js";
import { authRequired } from "./auth.js";

// история игр ведущего (записи создаёт game.js при завершении партии)
export const resultRoutes = Router();
resultRoutes.use(authRequired);

resultRoutes.get("/", (req, res) => {
  const rows = db
    .prepare(
      "SELECT id, quiz_title, quiz_type, players_count, played_at FROM game_results WHERE host_id = ? ORDER BY id DESC LIMIT 100"
    )
    .all(req.userId);
  res.json({ results: rows });
});

resultRoutes.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM game_results WHERE id = ? AND host_id = ?")
    .get(Number(req.params.id), req.userId);
  if (!row) return res.status(404).json({ error: "Результат не найден" });
  res.json({ result: { ...row, results: JSON.parse(row.results) } });
});
