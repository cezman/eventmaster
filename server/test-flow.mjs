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

// EM-27: у квиза без флага распределение до reveal скрыто (counts = null)
const count0 = await new Promise((resolve) => host.once("answer-count", resolve));
if (question1.showLiveResults !== false) throw new Error("у квиза showLiveResults должен быть false");
if (count0.counts !== null) throw new Error(`квиз: распределение должно быть скрыто, пришло ${JSON.stringify(count0.counts)}`);
log("Квиз: распределение до reveal скрыто ✓");

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
if (reveal1.myAnswered !== true) throw new Error("reveal: myAnswered должен быть true у ответившего");
log("Reveal: myAnswered ✓");

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

// — EM-27: голосование с включённым live-распределением —
async function api(method, path, body) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
const pollCreated = await api("POST", "/api/quizzes", {
  title: "Тест-голосование",
  type: "poll",
  questions: [
    {
      text: "Кто победит?",
      answers: [
        { text: "Красные", is_correct: false },
        { text: "Синие", is_correct: false },
      ],
    },
  ],
});
if (!pollCreated.quiz) throw new Error("poll create failed: " + JSON.stringify(pollCreated));
const saved = await api("PUT", `/api/quizzes/${pollCreated.quiz.id}`, {
  settings: { showLiveResults: true },
});
if (saved.quiz?.settings?.showLiveResults !== true) {
  throw new Error("settings.showLiveResults не сохранился: " + JSON.stringify(saved.quiz?.settings));
}
const h2 = io(URL);
const p3 = io(URL);
const pin2 = await new Promise((resolve, reject) => {
  h2.emit("host:create-game", { token: TOKEN, quizId: pollCreated.quiz.id }, (res) =>
    res.error ? reject(new Error(res.error)) : resolve(res.pin)
  );
});
await wait(300);
await new Promise((resolve, reject) => {
  p3.emit("player:join", { pin: pin2, name: "Гость" }, (res) => (res.error ? reject(new Error(res.error)) : resolve()));
});
const pollQ = await new Promise((resolve) => {
  h2.emit("host:start");
  h2.once("question", resolve);
});
const pollCount0 = await new Promise((resolve) => h2.once("answer-count", resolve));
if (pollQ.showLiveResults !== true) throw new Error("у голосования showLiveResults должен быть true");
if (!Array.isArray(pollCount0.counts)) throw new Error("live-голосование: counts должны приходить");
p3.emit("player:answer", { choice: 0 });
const pollCount1 = await new Promise((resolve) => h2.once("answer-count", resolve));
if (pollCount1.answered !== 1 || pollCount1.counts[0] !== 1) {
  throw new Error(`live-голосование: неверный counts: ${JSON.stringify(pollCount1.counts)}`);
}
log("Голосование с live-распределением: counts приходят до reveal ✓");
// EM-43: reveal в голосовании — молчун получает myAnswered: false («Время вышло!»)
const p4 = io(URL);
await new Promise((resolve, reject) => {
  p4.emit("player:join", { pin: pin2, name: "Молчун" }, (res) => (res.error ? reject(new Error(res.error)) : resolve()));
});
const [pollRevealVoted, pollRevealSilent] = await Promise.all([
  new Promise((resolve) => p3.once("reveal", resolve)),
  new Promise((resolve) => p4.once("reveal", resolve)),
]);
if (pollRevealVoted.myAnswered !== true) throw new Error("poll: у голосовавшего myAnswered должен быть true");
if (pollRevealSilent.myAnswered !== false) throw new Error("poll: у молчуна myAnswered должен быть false");
log("Голосование reveal: myAnswered true/false ✓");
h2.close();
p3.close();
p4.close();

// — EM-28: сервер отклоняет вопрос викторины без верного ответа —
const badQuiz = await api("PUT", `/api/quizzes/${quiz.id}`, {
  questions: [
    {
      text: "Без верного",
      answers: [
        { text: "Один", is_correct: false },
        { text: "Два", is_correct: false },
      ],
    },
  ],
});
if (!badQuiz.error || !badQuiz.error.includes("верный ответ")) {
  throw new Error("сервер принял викторину без верного ответа: " + JSON.stringify(badQuiz));
}
log("Викторина без верного ответа отклонена сервером ✓");

// — EM-36: экран зала (screen:join) и пульт (host:attach) —
const em36token = async (email, password) => {
  const login = await fetch(URL + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  if (login.token) return login.token;
  await fetch(URL + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Тест", surname: "Тестов" }),
  }).then((r) => r.json());
  const retry = await fetch(URL + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  if (!retry.token) throw new Error("em36: второй аккаунт не создан");
  return retry.token;
};
const otherToken = await em36token("em36-test@example.com", "secret2");
const em36quiz = await api("POST", "/api/quizzes", {
  title: "EM-36 зал+пульт",
  type: "quiz",
  questions: [{
    text: "2 + 2?",
    time_limit: 20,
    answers: [
      { text: "4", is_correct: true },
      { text: "5", is_correct: false },
    ],
  }],
});
const h36 = io(URL);
const pin36 = await new Promise((resolve, reject) => {
  h36.emit("host:create-game", { token: TOKEN, quizId: em36quiz.quiz.id }, (res) =>
    res.error ? reject(new Error(res.error)) : resolve(res.pin)
  );
});
// чужой пульт не подключается к чужой партии
const h36alien = io(URL);
const alienAck = await new Promise((resolve) => h36alien.emit("host:attach", { token: otherToken, pin: pin36 }, resolve));
if (!alienAck.error) throw new Error("em36: чужой host:attach должен быть отклонён");
log("EM-36: чужой host:attach отклонён ✓");
// экран зала: пассивная подписка на комнату
const screen36 = io(URL);
const screenAck = await new Promise((resolve) => screen36.emit("screen:join", { pin: pin36 }, resolve));
if (screenAck.error || screenAck.state !== "lobby") throw new Error("em36: screen:join failed: " + JSON.stringify(screenAck));
await new Promise((resolve) => screen36.once("players", resolve));
h36.emit("host:start");
const screenQ = await new Promise((resolve) => screen36.once("question", resolve));
if (!screenQ.text) throw new Error("em36: экран не получил question");
log("EM-36: screen:join получает players/question ✓");
// пульт владельца перехватывает роль: старый хост больше не управляет
let screenRevealed = false;
screen36.once("reveal", () => { screenRevealed = true; });
const h36panel = io(URL);
const attachAck = await new Promise((resolve) => h36panel.emit("host:attach", { token: TOKEN, pin: pin36 }, resolve));
if (attachAck.error) throw new Error("em36: свой host:attach не удался: " + JSON.stringify(attachAck));
h36.emit("host:reveal"); // старый сокет: сервер отклоняет по hostSocketId
await wait(400);
if (screenRevealed) throw new Error("em36: старый хост управляет игрой после attach");
h36panel.emit("host:reveal"); // новый пульт управляет
await new Promise((resolve) => screen36.once("reveal", resolve));
log("EM-36: host:attach перехватывает роль, reveal от нового пульта ✓");

// EM-46: повторный host:create-game того же квиза подключается к живой партии, а не создаёт вторую
const h36c = io(URL);
const reAck = await new Promise((resolve) => h36c.emit("host:create-game", { token: TOKEN, quizId: em36quiz.quiz.id }, resolve));
if (reAck.error || reAck.pin !== pin36) {
  throw new Error("em36/46: create-game не вернул живую партию: " + JSON.stringify(reAck));
}
log("EM-46: повторный create-game подключает пульт к живой партии ✓");
h36c.emit("host:end"); // роль теперь у h36c — заканчивает он
h36.close(); h36alien.close(); h36panel.close(); h36c.close(); screen36.close();

log("✅ Все этапы пройдены: создание, лобби, 3 вопроса, reconnect по токену, offline-счётчик, skip, финал, EM-27");
host.close();
p1.close();
p2c.close();
process.exit(0);
