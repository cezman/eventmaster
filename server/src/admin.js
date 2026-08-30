import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "./db.js";
import { authRequired } from "./auth.js";

// админка пользователей (EM-14): назначение админа — вручную SQL на сервере
// (UPDATE users SET role='admin' WHERE email=...), без самоназначения через UI
export const adminRoutes = Router();
adminRoutes.use(authRequired);

function adminRequired(req, res, next) {
  const row = db.prepare("SELECT role FROM users WHERE id = ?").get(req.userId);
  if (!row || row.role !== "admin") return res.status(403).json({ error: "Нужны права администратора" });
  next();
}
adminRoutes.use(adminRequired);

adminRoutes.get("/users", (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.surname, u.role, u.status, u.created_at,
              (SELECT COUNT(*) FROM quizzes q WHERE q.host_id = u.id) AS quiz_count
       FROM users u ORDER BY u.id`
    )
    .all();
  res.json({ users: rows });
});

adminRoutes.put("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Введите корректный email" });
  const dup = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, id);
  if (dup) return res.status(400).json({ error: "Пользователь с таким email уже есть" });
  const name = String(req.body?.name || "").trim().slice(0, 30);
  const surname = String(req.body?.surname || "").trim().slice(0, 30);
  db.prepare("UPDATE users SET email = ?, name = ?, surname = ? WHERE id = ?").run(email, name, surname, id);
  res.json({ ok: true });
});

// сброс пароля: генерируем новый и показываем админу один раз
adminRoutes.put("/users/:id/password", (req, res) => {
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let password = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), target.id);
  res.json({ ok: true, password });
});

adminRoutes.put("/users/:id/status", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) return res.status(400).json({ error: "Нельзя изменить свой статус" });
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  const status = req.body?.status === "blocked" ? "blocked" : "active";
  db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
  res.json({ ok: true, status });
});

adminRoutes.delete("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) return res.status(400).json({ error: "Нельзя удалить свой аккаунт" });
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  // квизы и результаты удалятся каскадом (FK ON DELETE CASCADE)
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});
