import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { authRoutes } from "./auth.js";
import { quizRoutes } from "./quizzes.js";
import { registerGameHandlers } from "./game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/quizzes", quizRoutes);

// в продакшене раздаём собранный клиент
const dist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(dist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
  res.sendFile(path.join(dist, "index.html"));
});

registerGameHandlers(io);

server.listen(PORT, () => {
  console.log(`EventMaster server: http://localhost:${PORT}`);
});
