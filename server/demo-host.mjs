// поднимает демо-игру и пишет PIN в файл (для ручных проверок в браузере)
import fs from "node:fs";
import { io } from "../client/node_modules/socket.io-client/build/esm/index.js";

const URL = "http://localhost:3001";
const login = await fetch(URL + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "test@example.com", password: "secret1" }),
});
const T = (await login.json()).token;
const res = await fetch(URL + "/api/quizzes", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + T },
  body: JSON.stringify({
    title: "Демо дропдауна",
    type: "quiz",
    questions: [{ text: "Демо", answers: [{ text: "a", is_correct: true }, { text: "b", is_correct: false }] }],
  }),
});
const quiz = (await res.json()).quiz;
const host = io(URL);
host.emit("host:create-game", { token: T, quizId: quiz.id }, (r) => {
  fs.writeFileSync("demo-pin.txt", String(r.pin));
  console.log("PIN:", r.pin);
});
