import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db.js";

const SECRET = process.env.JWT_SECRET || "eventmaster-dev-secret-change-me";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Не авторизован" });
  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = payload.uid;
    next();
  } catch {
    return res.status(401).json({ error: "Сессия истекла, войдите заново" });
  }
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    return payload.uid;
  } catch {
    return null;
  }
}

// публичные поля пользователя — без хэша пароля
function userPublic(row) {
  return { id: row.id, email: row.email, name: row.name || "", surname: row.surname || "", avatar: row.avatar || "" };
}

export const authRoutes = Router();

authRoutes.post("/register", (req, res) => {
  const { email, password } = req.body || {};
  const normEmail = String(email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normEmail)) {
    return res.status(400).json({ error: "Введите корректный email" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
  }
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(normEmail);
  if (exists) return res.status(400).json({ error: "Пользователь с таким email уже есть" });

  const hash = bcrypt.hashSync(password, 10);
  const name = String(req.body?.name || "").trim().slice(0, 30);
  const surname = String(req.body?.surname || "").trim().slice(0, 30);
  const result = db
    .prepare("INSERT INTO users (email, password_hash, name, surname) VALUES (?, ?, ?, ?)")
    .run(normEmail, hash, name, surname);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(result.lastInsertRowid));
  const token = jwt.sign({ uid: Number(result.lastInsertRowid) }, SECRET, { expiresIn: "30d" });
  res.json({ token, user: userPublic(row) });
});

authRoutes.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").trim().toLowerCase());
  if (!row || !bcrypt.compareSync(String(password || ""), row.password_hash)) {
    return res.status(400).json({ error: "Неверный email или пароль" });
  }
  const token = jwt.sign({ uid: row.id }, SECRET, { expiresIn: "30d" });
  res.json({ token, user: userPublic(row) });
});

authRoutes.get("/me", authRequired, (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (!row) return res.status(401).json({ error: "Пользователь не найден" });
  res.json({ user: userPublic(row) });
});

authRoutes.put("/profile", authRequired, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 30);
  const surname = String(req.body?.surname || "").trim().slice(0, 30);
  let avatar = String(req.body?.avatar || "");
  // аватар — JSON BigHead, обрезаем как у игроков
  if (avatar) {
    try {
      JSON.parse(avatar);
    } catch {
      return res.status(400).json({ error: "Некорректный аватар" });
    }
    avatar = avatar.slice(0, 500);
  }
  db.prepare("UPDATE users SET name = ?, surname = ?, avatar = ? WHERE id = ?").run(name, surname, avatar, req.userId);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  res.json({ user: userPublic(row) });
});

authRoutes.put("/password", authRequired, (req, res) => {
  const current = String(req.body?.currentPassword || "");
  const next = String(req.body?.newPassword || "");
  if (next.length < 6) return res.status(400).json({ error: "Новый пароль должен быть не короче 6 символов" });
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.userId);
  if (!row) return res.status(401).json({ error: "Пользователь не найден" });
  if (!bcrypt.compareSync(current, row.password_hash)) {
    return res.status(400).json({ error: "Текущий пароль неверный" });
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(next, 10), req.userId);
  res.json({ ok: true });
});
