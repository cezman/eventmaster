import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { instrument } from "@socket.io/admin-ui";
import { authRoutes } from "./auth.js";
import { quizRoutes } from "./quizzes.js";
import { resultRoutes } from "./results.js";
import { adminRoutes } from "./admin.js";
import { registerGameHandlers } from "./game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// nginx проксирует на 127.0.0.1 — без этого rate-limit увидит все запросы с одного IP
app.set("trust proxy", 1);

// CSP и HSTS включим осознанно после переезда на HTTPS: дефолтный CSP helmet
// содержит upgrade-insecure-requests, а HSTS ломает доступ по http://<IP>
app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
app.use(compression());
app.use(express.json());

// healthcheck для мониторинга — без лимитов
app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50, // /api/auth/me дергается на каждой загрузке страницы — лимит с запасом
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Подождите 15 минут." },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Подождите минуту." },
});
app.use("/api/auth", authLimiter);
app.use("/api", apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/admin", adminRoutes);

// в продакшене раздаём собранный клиент
const dist = path.join(__dirname, "..", "..", "client", "dist");
// index: false — весь HTML (включая корень) идёт через app.get("*"), где подставляется %OG_ORIGIN%
app.use(express.static(dist, { index: false }));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
  // %OG_ORIGIN% в index.html подставляем на лету: краулеры требуют абсолютный URL в og:image,
  // а origin известен только в рантайме (сейчас IP, позже — домен с HTTPS)
  fs.readFile(path.join(dist, "index.html"), "utf8", (err, html) => {
    if (err) return next(err);
    const origin = `${req.protocol}://${req.get("host")}`;
    res.type("html").send(html.replaceAll("%OG_ORIGIN%", origin));
  });
});

registerGameHandlers(io);

// админка Socket.IO только в dev: https://admin.socket.io → http://localhost:3001 (admin / eventmaster-dev)
if (process.env.NODE_ENV !== "production") {
  instrument(io, {
    auth: {
      type: "basic",
      username: "admin",
      password: "$2a$10$.vMMqkIOMEw8FryIyV8cf.7cibbGOcPhsdKOYcEBFg5ftYTU4m5ce",
    },
  });
}

server.listen(PORT, () => {
  console.log(`EventMaster server: http://localhost:${PORT}`);
});
