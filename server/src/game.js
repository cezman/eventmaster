import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { verifyToken } from "./auth.js";

const games = new Map(); // pin -> game

function makePin() {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (games.has(pin));
  return pin;
}

const REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "👏"];

function leaderboard(game) {
  return [...game.players.values()]
    .map((p) => ({ name: p.name, score: p.score, avatar: p.avatar, color: p.color }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// полный список без топ-10 — для истории игр
function fullLeaderboard(game) {
  return [...game.players.values()]
    .map((p) => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

// сохраняем партию в историю; один раз за раунд, флаг сбрасывается в play-again
function recordResult(game) {
  if (game.recorded) return;
  try {
    db.prepare(
      "INSERT INTO game_results (host_id, quiz_id, quiz_title, quiz_type, players_count, results) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(game.hostId, game.quizId, game.title, game.type, game.players.size, JSON.stringify(fullLeaderboard(game)));
    game.recorded = true;
  } catch (e) {
    console.error("Не удалось сохранить результат игры:", e.message);
  }
}

function playersList(game) {
  return [...game.players.entries()].map(([id, p]) => ({
    id,
    name: p.name,
    score: p.score,
    avatar: p.avatar,
    color: p.color,
    online: p.online !== false,
  }));
}

// offline-игроки остаются в игре до конца, но хост не ждёт их ответов
function onlineCount(game) {
  let n = 0;
  for (const p of game.players.values()) if (p.online !== false) n += 1;
  return n;
}

// вопросы квиза из БД — снапшот делаем при создании игры и при «Играть снова»,
// чтобы правки редактора (таймер, очки, ответы) применялись к новой партии
function loadQuiz(quizId) {
  const quiz = db.prepare("SELECT id, title, type, settings FROM quizzes WHERE id = ?").get(quizId);
  if (!quiz) return null;
  const questions = db
    .prepare("SELECT id, text, position, time_limit, points, mode FROM questions WHERE quiz_id = ? ORDER BY position")
    .all(quiz.id);
  if (!questions.length) return null;
  const answersStmt = db.prepare("SELECT text, is_correct FROM answers WHERE question_id = ? ORDER BY position");
  const fullQuestions = questions.map((q) => ({
    text: q.text,
    time_limit: q.time_limit,
    points: q.points,
    mode: q.mode === "tf" ? "tf" : "choice",
    answers: answersStmt.all(q.id),
  }));
  // флаг из quizzes.settings (EM-27): показывать распределение по вариантам до reveal
  let showLiveResults = false;
  try { showLiveResults = !!JSON.parse(quiz.settings).showLiveResults; } catch { /* выключен */ }
  return { title: quiz.title, type: quiz.type, showLiveResults, questions: fullQuestions };
}

function questionForRoom(game) {
  const q = game.quiz.questions[game.qIndex];
  return {
    index: game.qIndex,
    total: game.quiz.questions.length,
    type: game.type,
    text: q.text,
    timeLimit: q.time_limit || 20,
    mode: q.mode || "choice",
    showLiveResults: !!game.quiz.showLiveResults,
    answers: q.answers.map((a) => ({ text: a.text })),
  };
}

function stopRevealTimer(game) {
  if (game.revealTimer) {
    clearTimeout(game.revealTimer);
    game.revealTimer = null;
  }
}

function countsFor(game) {
  const q = game.quiz.questions[game.qIndex];
  const counts = q.answers.map(() => 0);
  for (const p of game.players.values()) {
    if (p.answer != null && counts[p.answer] != null) counts[p.answer] += 1;
  }
  return counts;
}

function broadcastPlayers(io, game) {
  io.to(`game:${game.pin}`).emit("players", { players: playersList(game) });
}

function deleteGame(io, game) {
  stopRevealTimer(game);
  io.to(`game:${game.pin}`).emit("game:closed");
  io.socketsLeave(`game:${game.pin}`);
  games.delete(game.pin);
}

function startQuestion(io, game) {
  game.state = "question";
  game.qIndex += 1;
  game.questionStart = Date.now();
  for (const p of game.players.values()) p.answer = null;
  io.to(`game:${game.pin}`).emit("question", questionForRoom(game));
  // счётчик в комнату: зал и пульт показывают «ответили N/M»; counts (распределение)
  // едет только при showLiveResults — анти-чит-инвариант
  io.to(`game:${game.pin}`).emit("answer-count", {
    answered: 0,
    total: onlineCount(game),
    counts: game.quiz.showLiveResults ? countsFor(game) : null,
  });
  const limit = (game.quiz.questions[game.qIndex].time_limit || 20) * 1000;
  stopRevealTimer(game);
  game.revealTimer = setTimeout(() => {
    if (games.get(game.pin) === game && game.state === "question") reveal(io, game);
  }, limit);
}

function reveal(io, game) {
  game.state = "reveal";
  stopRevealTimer(game);
  const counts = countsFor(game);
  const q = game.quiz.questions[game.qIndex];
  const correctIndex = game.type === "quiz" ? q.answers.findIndex((a) => a.is_correct) : null;

  // очки начисляются один раз на вопрос: rejoin/refresh хоста во время reveal
  // повторно вызывает reveal() — без защиты было бы двойное начисление
  if (game.scoredQIndex !== game.qIndex) {
    game.scoredQIndex = game.qIndex;
    if (game.type === "quiz" && correctIndex >= 0) {
      for (const p of game.players.values()) {
        if (p.answer === correctIndex) {
          p.awarded = q.points || 1;
          p.score += p.awarded;
          p.lastCorrect = true;
        } else {
          p.awarded = 0;
          p.lastCorrect = false;
        }
      }
    }
  }

  const board = leaderboard(game);
  for (const [socketId, socket] of io.sockets.sockets) {
    if (!socket.rooms.has(`game:${game.pin}`)) continue;
    const p = game.players.get(socketId);
    socket.emit("reveal", {
      type: game.type,
      correctIndex,
      counts,
      leaderboard: board,
      myCorrect: p ? p.lastCorrect : false,
      myAwarded: p ? p.awarded || 0 : 0,
      // EM-43: игрок без ответа видит «Время вышло!», а не «Мимо»
      myAnswered: p ? p.answer != null : false,
    });
  }
}

// завершение партии: в историю и всем сигнал финала (из host:next и host:skip)
function finishGame(io, game) {
  game.state = "finished";
  recordResult(game);
  io.to(`game:${game.pin}`).emit("finished", {
    leaderboard: leaderboard(game),
    players: playersList(game),
  });
}

export function registerGameHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("host:create-game", ({ token, quizId, reclaimPin } = {}, ack = () => {}) => {
      const hostId = verifyToken(token);
      if (!hostId) return ack({ error: "Не авторизован" });

      // Хост обновил страницу — возвращаем ему его же игру
      if (reclaimPin && games.has(String(reclaimPin))) {
        const game = games.get(String(reclaimPin));
        if (game.hostId === hostId && game.quizId === Number(quizId)) {
          clearTimeout(game.closeTimer);
          game.closeTimer = null;
          game.hostSocketId = socket.id;
          socket.join(`game:${game.pin}`);
          socket.emit("host:game", snapshotForHost(game));
          broadcastPlayers(io, game);
          if (game.state === "question") socket.emit("question", questionForRoom(game));
          // хосту в reveal тоже нужен вопрос (экран reveal показывает его текст)
          if (game.state === "reveal") {
            socket.emit("question", questionForRoom(game));
            reveal(io, game);
          }
          return ack({ ok: true, pin: game.pin });
        }
      }

      const quiz = db
        .prepare("SELECT id, title, type FROM quizzes WHERE id = ? AND host_id = ?")
        .get(Number(quizId), hostId);
      if (!quiz) return ack({ error: "Викторина не найдена" });
      const loaded = loadQuiz(quiz.id);
      if (!loaded) return ack({ error: "Добавьте хотя бы один вопрос" });
      const fullQuestions = loaded.questions;

      // одну викторину можно запустить только один раз одновременно
      for (const [pin, g] of games) {
        if (g.quizId === quiz.id && g.hostId === hostId) deleteGame(io, g);
      }

      const host = db.prepare("SELECT name, surname, avatar FROM users WHERE id = ?").get(hostId);
      // имя/аватар хоста фиксируются на момент создания игры (reclaim использует старый снапшот)
      const game = {
        pin: makePin(),
        quizId: quiz.id,
        title: quiz.title,
        type: quiz.type,
        hostId,
        hostSocketId: socket.id,
        hostName: [host?.name, host?.surname].filter(Boolean).join(" "),
        hostAvatar: typeof host?.avatar === "string" ? host.avatar.slice(0, 500) : "",
        state: "lobby",
        qIndex: -1,
        scoredQIndex: -1,
        questionStart: 0,
        quiz: { title: quiz.title, showLiveResults: loaded.showLiveResults, questions: fullQuestions },
        players: new Map(),
        kickedTokens: new Set(), // кик: повторный вход по токену блокируется до конца партии
        closeTimer: null,
        recorded: false,
      };
      games.set(game.pin, game);
      socket.join(`game:${game.pin}`);
      socket.emit("host:game", snapshotForHost(game));
      ack({ ok: true, pin: game.pin });
    });

    // EM-36: экран зала — просмотр комнаты по PIN без каких-либо прав.
    // Сокет не попадает в players и никогда не становится hostSocketId, поэтому
    // disconnect экрана не помечает игроков и не запускает close-таймер хоста.
    socket.on("screen:join", ({ pin } = {}, ack = () => {}) => {
      const game = games.get(String(pin || "").trim());
      if (!game) return ack({ error: "Игра с таким PIN не найдена" });
      socket.join(`game:${game.pin}`);
      ack({ ok: true, pin: game.pin, title: game.title, type: game.type, state: game.state });
      socket.emit("players", { players: playersList(game) });
      if (game.state === "question") socket.emit("question", questionForRoom(game));
      if (game.state === "reveal") {
        socket.emit("question", questionForRoom(game));
        reveal(io, game);
      }
      if (game.state === "finished")
        socket.emit("finished", { leaderboard: leaderboard(game), players: playersList(game) });
    });

    // EM-36: пульт ведущего подключается к ИДУЩЕЙ игре (обновление страницы пульта,
    // второй устройство) вместо создания второй партии. Перехватывает роль хоста:
    // старый пульт теряет управление (hostSocketId перезаписан).
    socket.on("host:attach", ({ token, pin } = {}, ack = () => {}) => {
      const hostId = verifyToken(token);
      if (!hostId) return ack({ error: "Не авторизован" });
      const game = games.get(String(pin || "").trim());
      if (!game || game.hostId !== hostId) return ack({ error: "Игра не найдена" });
      clearTimeout(game.closeTimer);
      game.closeTimer = null;
      // прежний пульт теряет управление — сообщаем ему об этом
      io.sockets.sockets.get(game.hostSocketId)?.emit("host:detached");
      game.hostSocketId = socket.id;
      socket.join(`game:${game.pin}`);
      socket.emit("host:game", snapshotForHost(game));
      broadcastPlayers(io, game);
      if (game.state === "question") {
        socket.emit("question", questionForRoom(game));
        socket.emit("answer-count", {
          answered: [...game.players.values()].filter((p) => p.answer != null && p.online !== false).length,
          total: onlineCount(game),
          counts: game.quiz.showLiveResults ? countsFor(game) : null,
        });
      }
      if (game.state === "reveal") {
        socket.emit("question", questionForRoom(game));
        reveal(io, game);
      }
      if (game.state === "finished")
        socket.emit("finished", { leaderboard: leaderboard(game), players: playersList(game) });
      ack({ ok: true, pin: game.pin });
    });

    socket.on("player:join", ({ pin, name, avatar, color, token } = {}, ack = () => {}) => {
      const game = games.get(String(pin || "").trim());
      if (!game) return ack({ error: "Игра с таким PIN не найдена" });

      // кикнутый игрок: повторный вход по сохранённому токену отклоняется
      if (token && game.kickedTokens.has(token)) {
        return ack({
          error: "Вы были исключены из этой игры. Введите другой PIN или вернитесь позже.",
          kicked: true,
        });
      }

      // повторный вход после обрыва связи: токен возвращает игрока с его счётом и именем
      if (token) {
        for (const [sid, p] of game.players) {
          if (p.token !== token) continue;
          game.players.delete(sid);
          p.online = true;
          // аватар/цвет могли измениться в лобби, но не доехать до сервера — берём из payload
          if (typeof avatar === "string") p.avatar = avatar.slice(0, 500);
          if (Number.isInteger(color) && color >= 0 && color < 8) p.color = color;
          game.players.set(socket.id, p);
          socket.join(`game:${game.pin}`);
          socket.data.gamePin = game.pin;
          ack({
            ok: true,
            token,
            rejoined: true,
            type: game.type,
            state: game.state,
            hostName: game.hostName || "",
            hostAvatar: game.hostAvatar || "",
          });
          broadcastPlayers(io, game);
          if (game.state === "question") socket.emit("question", questionForRoom(game));
          // в reveal игроку нужен и вопрос, и результат: без question квиз-карточка
          // («Верно!/Мимо») не рендерится — вернулся бы экран опроса
          if (game.state === "reveal") {
            socket.emit("question", questionForRoom(game));
            reveal(io, game);
          }
          // вернулся после финала (закрыл вкладку, открыл заново) — досылаем итоговый экран
          if (game.state === "finished")
            socket.emit("finished", { leaderboard: leaderboard(game), players: playersList(game) });
          return;
        }
      }

      // завершённая игра новых игроков не принимает: клиент покажет экран «Игра завершена»
      if (game.state === "finished") return ack({ error: "Игра уже завершилась", finished: true });

      let clean = String(name || "").trim().slice(0, 20);
      if (!clean) return ack({ error: "Введите имя" });
      const taken = new Set([...game.players.values()].map((p) => p.name.toLowerCase()));
      let candidate = clean;
      let i = 2;
      while (taken.has(candidate.toLowerCase())) candidate = `${clean} ${i++}`;

      const player = {
        name: candidate,
        score: 0,
        answer: null,
        lastCorrect: false,
        awarded: 0,
        avatar: typeof avatar === "string" ? avatar.slice(0, 500) : "🙂",
        color: Number.isInteger(color) && color >= 0 && color < 8 ? color : 0,
        lastReaction: 0,
        online: true,
        token: randomUUID(),
      };
      game.players.set(socket.id, player);
      socket.join(`game:${game.pin}`);
      socket.data.gamePin = game.pin;
      ack({
        ok: true,
        token: player.token,
        type: game.type,
        state: game.state,
        hostName: game.hostName || "",
        hostAvatar: game.hostAvatar || "",
      });
      broadcastPlayers(io, game);
      if (game.state === "question") socket.emit("question", questionForRoom(game));
      // в reveal игроку нужен и вопрос, и результат: без question квиз-карточка
      // («Верно!/Мимо») не рендерится — вернулся бы экран опроса
      if (game.state === "reveal") {
        socket.emit("question", questionForRoom(game));
        reveal(io, game);
      }
    });

    socket.on("player:answer", ({ choice } = {}) => {
      const pin = socket.data.gamePin;
      if (!pin) return;
      const game = games.get(pin);
      if (!game || game.state !== "question") return;
      const p = game.players.get(socket.id);
      if (!p || p.answer != null) return;
      const q = game.quiz.questions[game.qIndex];
      const idx = Number(choice);
      if (!Number.isInteger(idx) || idx < 0 || idx >= q.answers.length) return;
      p.answer = idx;
      const answered = [...game.players.values()].filter((x) => x.answer != null && x.online !== false).length;
      io.to(`game:${game.pin}`).emit("answer-count", {
        answered,
        total: onlineCount(game),
        counts: game.quiz.showLiveResults ? countsFor(game) : null,
      });
    });

    socket.on("player:reaction", ({ emoji } = {}) => {
      const pin = socket.data.gamePin;
      if (!pin) return;
      const game = games.get(pin);
      const p = game?.players.get(socket.id);
      if (!p || !REACTIONS.includes(emoji)) return;
      const now = Date.now();
      if (now - p.lastReaction < 700) return; // антиспам
      p.lastReaction = now;
      io.to(`game:${pin}`).emit("reaction", { name: p.name, avatar: p.avatar, color: p.color, emoji });
    });

    // кастомизация в лобби: игрок меняет аватар/цвет имени без повторного входа
    socket.on("update-avatar", ({ avatar, color } = {}, ack = () => {}) => {
      const pin = socket.data.gamePin;
      const game = games.get(pin);
      const p = game?.players.get(socket.id);
      if (!p) return ack({ error: "Вы не в игре" });
      if (typeof avatar === "string") p.avatar = avatar.slice(0, 500);
      if (Number.isInteger(color) && color >= 0 && color < 8) p.color = color;
      // состояние применяем всегда, а broadcast ограничиваем — иначе флуд дёргает всю комнату
      const now = Date.now();
      if (now - (p.lastAvatarBroadcast || 0) >= 300) {
        p.lastAvatarBroadcast = now;
        broadcastPlayers(io, game);
      }
      ack({ ok: true });
    });

    socket.on("host:start", () => {
      const game = hostGame(socket);
      if (!game || game.state !== "lobby") return;
      startQuestion(io, game);
    });

    socket.on("host:reveal", () => {
      const game = hostGame(socket);
      if (!game || game.state !== "question") return;
      reveal(io, game);
    });

    socket.on("host:next", () => {
      const game = hostGame(socket);
      if (!game || game.state !== "reveal") return;
      if (game.qIndex + 1 < game.quiz.questions.length) {
        startQuestion(io, game);
      } else {
        finishGame(io, game);
      }
    });

    // пропустить вопрос: без reveal и без очков, ответы текущего вопроса сбрасываются
    socket.on("host:skip", () => {
      const game = hostGame(socket);
      if (!game || game.state !== "question") return;
      if (game.qIndex + 1 < game.quiz.questions.length) {
        startQuestion(io, game);
      } else {
        finishGame(io, game);
      }
    });

    socket.on("host:play-again", () => {
      const game = hostGame(socket);
      if (!game || game.state !== "finished") return;
      stopRevealTimer(game);
      // перечитываем квиз из БД: правки между партиями применяются к новой игре;
      // если квиз удалён — тихо играем по последнему снапшоту, это graceful fallback
      const loaded = loadQuiz(game.quizId);
      if (loaded) {
        game.quiz = loaded;
        game.title = loaded.title;
        game.type = loaded.type;
      }
      game.state = "lobby";
      game.qIndex = -1;
      game.scoredQIndex = -1;
      game.recorded = false;
      for (const p of game.players.values()) {
        p.score = 0;
        p.answer = null;
        p.awarded = 0;
        p.lastCorrect = false;
      }
      // игрокам явный сигнал вернуться в лобби (иначе остаются на reveal);
      // title — экран зала обновляет заголовок после перечитывания квиза
      io.to(`game:${game.pin}`).emit("game:lobby", { title: game.title });
      broadcastPlayers(io, game);
      socket.emit("host:game", snapshotForHost(game));
    });

    socket.on("host:end", () => {
      const game = hostGame(socket);
      if (!game) return;
      // игра шла хотя бы один вопрос и был хотя бы один игрок — сохраняем в историю
      if (game.qIndex >= 0 && game.players.size > 0) recordResult(game);
      deleteGame(io, game);
    });

    // кик игрока из лобби: только хост и только до старта вопросов;
    // id игрока — ключ в Map (у offline-игрока остаётся старый socket.id)
    socket.on("kick-player", ({ playerId } = {}, ack = () => {}) => {
      const game = hostGame(socket);
      if (!game || game.state !== "lobby") return ack({ error: "Только из лобби" });
      const key = String(playerId || "");
      const p = game.players.get(key);
      if (!p) return ack({ error: "Игрок не найден" });
      game.kickedTokens.add(p.token);
      game.players.delete(key);
      const target = io.sockets.sockets.get(key);
      if (target) {
        target.emit("kicked");
        // без выхода из комнаты кикнутый продолжал бы получать question/reveal/finished
        target.leave(`game:${game.pin}`);
        delete target.data.gamePin;
      }
      broadcastPlayers(io, game);
      ack({ ok: true });
    });

    socket.on("disconnect", () => {
      const pin = socket.data.gamePin;
      if (pin && games.has(pin)) {
        const game = games.get(pin);
        const p = game.players.get(socket.id);
        if (p) {
          // не удаляем: игрок может вернуться по токену до конца игры, хост видит «нет связи»
          p.online = false;
          broadcastPlayers(io, game);
        }
      }
      for (const game of games.values()) {
        if (game.hostSocketId === socket.id && !game.closeTimer) {
          // даём хосту 2 минуты на переподключение (обновление страницы)
          game.closeTimer = setTimeout(() => {
            if (game.hostSocketId === socket.id) deleteGame(io, game);
          }, 2 * 60 * 1000);
        }
      }
    });
  });
}

function hostGame(socket) {
  for (const game of games.values()) {
    if (game.hostSocketId === socket.id) return game;
  }
  return null;
}

function snapshotForHost(game) {
  return {
    pin: game.pin,
    title: game.title,
    type: game.type,
    state: game.state,
    qIndex: game.qIndex,
    total: game.quiz.questions.length,
    players: playersList(game),
  };
}
