import express from "express";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { authRequired } from "./auth.js";
import { dataDir } from "./db.js";

// EM-66: загрузка медиа для rich-блоков (спека §3.5). Файлы лежат на диске рядом
// с DATA_DIR (тот же примонтированный диск, что и база), отдаются как статика.
// Клиент шлёт файл сырым телом (fetch + Content-Type), без multipart — multer не тянем.

export const mediaApi = Router(); // POST /api/media — только владелец токена
export const mediaFiles = Router(); // GET /media/:name — публично: зал/телефон тянут <img>/<audio> без заголовков

const uploadsDir = path.join(dataDir, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// whitelist форматов; лимиты — как в спеке фото-стены (5 МБ фото) с запасом на аудио
const KINDS = {
  jpg: { ext: ".jpg", mime: "image/jpeg", mb: 10 },
  png: { ext: ".png", mime: "image/png", mb: 10 },
  webp: { ext: ".webp", mime: "image/webp", mb: 10 },
  gif: { ext: ".gif", mime: "image/gif", mb: 10 },
  mp3: { ext: ".mp3", mime: "audio/mpeg", mb: 25 },
  ogg: { ext: ".ogg", mime: "audio/ogg", mb: 25 },
  wav: { ext: ".wav", mime: "audio/wav", mb: 25 },
  m4a: { ext: ".m4a", mime: "audio/mp4", mb: 25 },
};
// декларируемый MIME от клиента — только первичный фильтр, истина — магические байты
const DECLARED = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
};

function sniff(buf) {
  if (buf.length < 12) return null;
  const tag = (from, to) => buf.slice(from, to).toString("latin1");
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && tag(1, 4) === "PNG") return "png";
  if (tag(0, 4) === "RIFF" && tag(8, 12) === "WEBP") return "webp";
  if (tag(0, 4) === "RIFF" && tag(8, 12) === "WAVE") return "wav";
  if (tag(0, 3) === "ID3") return "mp3";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
  if (tag(0, 4) === "OggS") return "ogg";
  // только аудио-контейнер M4A: голый ftyp пропустил бы видеомп4
  if (tag(4, 8) === "ftyp" && tag(8, 12).startsWith("M4A")) return "m4a";
  if (tag(0, 3) === "GIF") return "gif";
  return null;
}

const declaredKind = (req) =>
  DECLARED[String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase()];

// размер тела известен из заголовка — лишние 30 МБ в память не читаем
function rejectOversize(req, res, next) {
  const kind = declaredKind(req);
  const limit = kind ? KINDS[kind].mb * 1024 * 1024 : 30 * 1024 * 1024;
  const length = Number(req.headers["content-length"]);
  if (Number.isFinite(length) && length > limit) {
    return res.status(400).json({ error: `Файл больше ${KINDS[kind]?.mb ?? 30} МБ` });
  }
  next();
}

const RAW_LIMIT = "30mb"; // жёсткий потолок тела; реальные лимиты — по типу (mb в KINDS)
mediaApi.post("/", authRequired, rejectOversize, express.raw({ type: () => true, limit: RAW_LIMIT }), async (req, res) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: "Файл пустой" });
    const kind = declaredKind(req);
    if (!kind) return res.status(400).json({ error: "Формат не поддерживается: JPG, PNG, WebP, GIF, MP3, OGG, WAV или M4A" });
    const sniffed = sniff(buf);
    if (sniffed !== kind) return res.status(400).json({ error: `Содержимое файла не похоже на ${kind.toUpperCase()}` });
    const meta = KINDS[kind];
    if (buf.length > meta.mb * 1024 * 1024) return res.status(400).json({ error: `Файл больше ${meta.mb} МБ` });
    const name = `${randomUUID()}${meta.ext}`;
    await fs.promises.writeFile(path.join(uploadsDir, name), buf);
    res.json({ url: `/media/${name}`, mime: meta.mime, size: buf.length });
  } catch (e) {
    // падение записи (диск/права) не должно ронять процесс с живыми играми
    console.error("media upload failed:", e.message);
    res.status(500).json({ error: "Не удалось сохранить файл" });
  }
});

// переполнение лимита express.raw приходит ошибкой парсера — отдаём как обычную ошибку API.
// Чужие ошибки (например, json-тело >100kb от глобального express.json) передаём дальше
mediaApi.use((err, req, res, next) => {
  const isUpload = !String(req.headers["content-type"] || "").includes("application/json");
  if (err && err.type === "entity.too.large" && isUpload) {
    return res.status(400).json({ error: "Файл больше 30 МБ" });
  }
  next(err);
});

// имя только нашего формата — uuid + известное расширение, путь из запроса не собирается
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif|mp3|ogg|wav|m4a)$/;
mediaFiles.get("/:name", async (req, res) => {
  const name = String(req.params.name || "");
  if (!NAME_RE.test(name)) return res.status(404).json({ error: "Файл не найден" });
  const file = path.join(uploadsDir, name);
  try {
    await fs.promises.stat(file);
  } catch {
    // без immutable: 404 не должен кэшироваться, иначе медиа не оживёт после починки
    return res.status(404).json({ error: "Файл не найден" });
  }
  // uuid-имена не переиспользуются — кэшируем навсегда
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(file, (err) => {
    if (err) res.status(404).json({ error: "Файл не найден" });
  });
});
