// Сквозной тест: хост создаёт игру, двое игроков подключаются, отвечают
// импорт напрямую из node_modules клиента, чтобы не дублировать зависимость
import { io } from "../client/node_modules/socket.io-client/build/esm/index.js";

const URL = "http://localhost:3001";
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjEsImlhdCI6MTc4NzkyMDU0NSwiZXhwIjoxNzkwNTEyNTQ1fQ.iwmm7NlgR5_VaBXR6s-KGGPICBe9Y4fkeTHUWEW1jco";

const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function createQuiz() {
  const res = await fetch(`${URL}/api/quizzes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      title: "Тест-викторина",
      type: "quiz",
      questions: [
        {
          text: "Столица Франции?",
          answers: [
            { text: "Париж", is_correct: true },
            { text: "Лондон", is_correct: false },
          ],
        },
        {
          text: "2 + 2 = ?",
          answers: [
            { text: "3", is_correct: false },
            { text: "4", is_correct: true },
          ],
        },
      ],
    }),
  });
  const data = await res.json();
  if (!data.quiz) throw new Error("quiz create failed: " + JSON.stringify(data));
  return data.quiz;
}

const quiz = await createQuiz();
const host = io(URL);
const p1 = io(URL);
const p2 = io(URL);

const pin = await new Promise((resolve, reject) => {
  host.emit("host:create-game", { token: TOKEN, quizId: quiz.id }, (res) =>
    res.error ? reject(new Error(res.error)) : resolve(res.pin)
  );
});
log("PIN:", pin);

const playerJoin = (s, name) =>
  new Promise((resolve, reject) => {
    s.emit("player:join", { pin, name }, (res) => (res.error ? reject(new Error(res.error)) : resolve(res)));
  });

await playerJoin(p1, "Аня");
await playerJoin(p2, "Боря");
await wait(200);

const question1 = await new Promise((resolve) => {
  host.emit("host:start");
  host.once("question", resolve);
});
log("Q1:", question1.text, "| варианты:", question1.answers.map((a) => a.text).join(", "));

const reveal1 = await new Promise((resolve) => {
  let n = 0;
  host.on("answer-count", () => {
    if (++n === 2) host.emit("host:reveal");
  });
  p1.once("reveal", resolve);
  p2.once("reveal", resolve);
  p1.emit("player:answer", { choice: 0 }); // верно
  setTimeout(() => p2.emit("player:answer", { choice: 1 }), 300); // неверно
});
log(
  "Reveal: correctIndex =", reveal1.correctIndex, "| counts =", reveal1.counts,
  "| Аня:", reveal1.leaderboard.find((p) => p.name === "Аня")?.score,
  "| Боря:", reveal1.leaderboard.find((p) => p.name === "Боря")?.score
);

const question2 = await new Promise((resolve) => {
  host.emit("host:next");
  host.once("question", resolve);
});
log("Q2:", question2.text);

const finished = await new Promise((resolve) => {
  host.on("answer-count", () => {});
  host.once("finished", resolve);
  p1.once("reveal", () => host.emit("host:next"));
  p1.emit("player:answer", { choice: 1 });
  p2.emit("player:answer", { choice: 1 });
  host.emit("host:reveal");
});
log("Финал:", JSON.stringify(finished.leaderboard));

log("✅ Все этапы пройдены: создание, лобби, 2 вопроса, очки, финал");
host.close();
p1.close();
p2.close();
process.exit(0);
