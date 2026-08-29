import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { instrument } from "@socket.io/admin-ui";
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
