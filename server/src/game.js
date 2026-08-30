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
  game.recorded = true;
  try {
    db.prepare(
      "INSERT INTO game_results (host_id, quiz_id, quiz_title, quiz_type, players_count, results) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(game.hostId, game.quizId, game.title, game.type, game.players.size, JSON.stringify(fullLeaderboard(game)));
  } catch (e) {
    console.error("Не удалось сохранить результат игры:", e.message);
  }
}

function playersList(game) {
  return [...game.players.values()].map((p) => ({
    name: p.name,
    score: p.score,
    avatar: p.avatar,
    color: p.color,
  }));
}

function questionForRoom(game) {
  const q = game.quiz.questions[game.qIndex];
  return {
    index: game.qIndex,
    total: game.quiz.questions.length,
    type: game.type,
    text: q.text,
    timeLimit: q.time_limit || 20,
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
  const host = io.sockets.sockets.get(game.hostSocketId);
  host?.emit("answer-count", { answered: 0, total: game.players.size, counts: countsFor(game) });
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
    });
  }
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
          game.hostSocketId = socket.id;
          socket.join(`game:${game.pin}`);
          socket.emit("host:game", snapshotForHost(game));
          broadcastPlayers(io, game);
          if (game.state === "question") socket.emit("question", questionForRoom(game));
          if (game.state === "reveal") reveal(io, game);
          return ack({ ok: true, pin: game.pin });
        }
      }

      const quiz = db
        .prepare("SELECT id, title, type FROM quizzes WHERE id = ? AND host_id = ?")
        .get(Number(quizId), hostId);
      if (!quiz) return ack({ error: "Викторина не найдена" });
      const questions = db
        .prepare("SELECT id, text, position, time_limit, points FROM questions WHERE quiz_id = ? ORDER BY position")
        .all(quiz.id);
      if (!questions.length) return ack({ error: "Добавьте хотя бы один вопрос" });
      const answersStmt = db.prepare("SELECT text, is_correct FROM answers WHERE question_id = ? ORDER BY position");
      const fullQuestions = questions.map((q) => ({
        text: q.text,
        time_limit: q.time_limit,
        points: q.points,
        answers: answersStmt.all(q.id),
      }));

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
        questionStart: 0,
        quiz: { title: quiz.title, questions: fullQuestions },
        players: new Map(),
        closeTimer: null,
      };
      games.set(game.pin, game);
      socket.join(`game:${game.pin}`);
      socket.emit("host:game", snapshotForHost(game));
      ack({ ok: true, pin: game.pin });
    });

    socket.on("player:join", ({ pin, name, avatar, color } = {}, ack = () => {}) => {
      const game = games.get(String(pin || "").trim());
      if (!game) return ack({ error: "Игра с таким PIN не найдена" });
      if (game.state === "finished") return ack({ error: "Игра уже закончилась" });

      let clean = String(name || "").trim().slice(0, 20);
      if (!clean) return ack({ error: "Введите имя" });
      const taken = new Set([...game.players.values()].map((p) => p.name.toLowerCase()));
      let candidate = clean;
      let i = 2;
      while (taken.has(candidate.toLowerCase())) candidate = `${clean} ${i++}`;

      game.players.set(socket.id, {
        name: candidate,
        score: 0,
        answer: null,
        lastCorrect: false,
        awarded: 0,
        avatar: typeof avatar === "string" ? avatar.slice(0, 500) : "🙂",
        color: Number.isInteger(color) && color >= 0 && color < 8 ? color : 0,
        lastReaction: 0,
      });
      socket.join(`game:${game.pin}`);
      socket.data.gamePin = game.pin;
      ack({
        ok: true,
        type: game.type,
        state: game.state,
        hostName: game.hostName || "",
        hostAvatar: game.hostAvatar || "",
      });
      broadcastPlayers(io, game);
      if (game.state === "question") socket.emit("question", questionForRoom(game));
      if (game.state === "reveal") reveal(io, game);
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
      const host = io.sockets.sockets.get(game.hostSocketId);
      const answered = [...game.players.values()].filter((x) => x.answer != null).length;
      host?.emit("answer-count", { answered, total: game.players.size, counts: countsFor(game) });
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
        game.state = "finished";
        recordResult(game);
        io.to(`game:${game.pin}`).emit("finished", {
          leaderboard: leaderboard(game),
          players: playersList(game),
        });
      }
    });

    socket.on("host:play-again", () => {
      const game = hostGame(socket);
      if (!game || game.state !== "finished") return;
      stopRevealTimer(game);
      game.state = "lobby";
      game.qIndex = -1;
      game.recorded = false;
      for (const p of game.players.values()) {
        p.score = 0;
        p.answer = null;
        p.awarded = 0;
        p.lastCorrect = false;
      }
      broadcastPlayers(io, game);
      socket.emit("host:game", snapshotForHost(game));
    });

    socket.on("host:end", () => {
      const game = hostGame(socket);
      if (!game) return;
      // игра шла хотя бы один вопрос — сохраняем её в историю даже незавершённой
      if (game.qIndex >= 0) recordResult(game);
      deleteGame(io, game);
    });

    socket.on("disconnect", () => {
      const pin = socket.data.gamePin;
      if (pin && games.has(pin)) {
        const game = games.get(pin);
        if (game.players.delete(socket.id)) broadcastPlayers(io, game);
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
