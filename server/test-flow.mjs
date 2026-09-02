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
        {
          text: "3 + 3 = ?",
          answers: [
            { text: "5", is_correct: false },
            { text: "6", is_correct: true },
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

const join1 = await playerJoin(p1, "Аня");
const join2 = await playerJoin(p2, "Боря");
if (!join1.token || !join2.token) throw new Error("join не вернул токен");
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

// — reconnect: Боря теряет связь и возвращается по токену с сохранением счёта —
p2.close();
await wait(200);
const p2b = io(URL);
const rejoin = await new Promise((resolve, reject) => {
  p2b.emit("player:join", { pin, name: "Боря", token: join2.token }, (res) =>
    res.error ? reject(new Error(res.error)) : resolve(res)
  );
});
if (!rejoin.rejoined) throw new Error("reconnect: токен не восстановил игрока");
const q2b = await new Promise((resolve) => p2b.once("question", resolve));
log("Reconnect: Боря вернулся, состояние =", rejoin.state, "| вопрос:", q2b.text);

// — счётчик ответов не ждёт offline-игроков —
p2b.disconnect();
await wait(200);
const countOffline = await new Promise((resolve) => {
  host.once("answer-count", resolve);
  p1.emit("player:answer", { choice: 1 }); // верно
});
if (countOffline.total !== 1) throw new Error(`offline-игрок не исключён из total: ${countOffline.total}`);
log("Счётчик с offline-игроком: answered = 1 / total = 1 ✓");

// Боря возвращается снова и отвечает на Q2
const p2c = io(URL);
const rejoin2 = await new Promise((resolve, reject) => {
  p2c.emit("player:join", { pin, name: "Боря", token: join2.token }, (res) =>
    res.error ? reject(new Error(res.error)) : resolve(res)
  );
});
if (!rejoin2.rejoined) throw new Error("повторный reconnect не сработал");
const reveal2 = await new Promise((resolve) => {
  p1.once("reveal", resolve);
  p2c.emit("player:answer", { choice: 1 }); // верно
  setTimeout(() => host.emit("host:reveal"), 300);
});
const a2 = reveal2.leaderboard.find((p) => p.name === "Аня");
const b2 = reveal2.leaderboard.find((p) => p.name === "Боря");
log("Reveal Q2: Аня =", a2.score, "| Боря =", b2.score, "( Боря сохранил очко за Q1 )");
if (a2.score !== 2 || b2.score !== 1) throw new Error(`счёт после reconnect неверен: Аня ${a2.score}, Боря ${b2.score}`);

// — rejoin во время reveal не начисляет очки повторно —
const p2d = io(URL);
const revealDup = await new Promise((resolve, reject) => {
  p2d.emit("player:join", { pin, name: "Боря", token: join2.token }, (res) => {
    if (res.error) reject(new Error(res.error));
  });
  p2d.once("reveal", resolve);
});
const bDup = revealDup.leaderboard.find((p) => p.name === "Боря");
if (bDup.score !== 1) throw new Error(`двойное начисление при rejoin в reveal: ${bDup.score}`);
log("Rejoin во время reveal: очки не задвоились ✓");
p2d.disconnect();

// — skip последнего вопроса: финал без очков —
const question3 = await new Promise((resolve) => {
  host.emit("host:next");
  host.once("question", resolve);
});
log("Q3:", question3.text, "— пропускаем");
const finished = await new Promise((resolve) => {
  host.once("finished", resolve);
  host.emit("host:skip");
});
const a3 = finished.leaderboard.find((p) => p.name === "Аня");
const b3 = finished.leaderboard.find((p) => p.name === "Боря");
if (a3.score !== 2 || b3.score !== 1) throw new Error(`skip начислил очки: Аня ${a3.score}, Боря ${b3.score}`);
log("Финал после skip:", JSON.stringify(finished.leaderboard));

log("✅ Все этапы пройдены: создание, лобби, 3 вопроса, reconnect по токену, offline-счётчик, skip, финал");
host.close();
p1.close();
p2c.close();
process.exit(0);
