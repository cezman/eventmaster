import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { verifyToken } from "./auth.js";
import { containsProfanity } from "./profanity.js";
import { parseVideoEmbed } from "./video.js";

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
    // EM-55: контекст блока для пульта (аддитивно, только в мероприятии);
    // EM-56: + название/тип блока для BlockProgress в шапке пульта
    ...(game.eventId
      ? { blockIndex: game.blockIndex, blockTotal: game.scenario.length, blockTitle: game.title, blockType: game.type }
      : {}),
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
  stopBlockTimers(game);
  flushBlockScores(game);
  if (game.closeTimer) {
    clearTimeout(game.closeTimer);
    game.closeTimer = null;
  }
  // партия умерла (все пульты отвалились или хост завершил) — недоигранное
  // мероприятие не должно зависать в live; доигранное остаётся completed
  if (game.eventId && !game.eventFinished) {
    try {
      db.prepare("UPDATE events SET status = 'ready', updated_at = datetime('now') WHERE id = ?").run(game.eventId);
    } catch (e) {
      console.error("Не удалось вернуть статус мероприятия:", e.message);
    }
  }
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
          // кросс-блочный зачёт мероприятия: те же плоские очки (Гэп 3.2)
          addBlockScore(game, p.token, p.name, p.avatar, p.awarded);
        } else {
          p.awarded = 0;
          p.lastCorrect = false;
        }
      }
    } else if (game.eventId && game.type === "poll") {
      // опрос в мероприятии: плоское очко за участие (спека Гэп 3.2, v1 без бонусов);
      // в одиночной партии опрос очков не даёт — поведение не меняется
      for (const p of game.players.values()) {
        if (p.answer != null) {
          p.awarded = 1;
          p.score += 1;
          addBlockScore(game, p.token, p.name, p.avatar, 1);
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

// === EM-55: движок сценария (спека design-new-features-spec §4.3–4.4, Гэп 3) ===

function parseObj(raw) {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// сценарий снимается в память на момент запуска: живая партия не зависит от
// правок редактора и от того, что хост параллельно меняет сценарий в кабинете
function loadScenario(eventId, hostId) {
  const event = db
    .prepare("SELECT id, title FROM events WHERE id = ? AND host_id = ?")
    .get(eventId, hostId);
  if (!event) return null;
  const rows = db
    .prepare("SELECT id, type, content, settings FROM scenario_blocks WHERE event_id = ? ORDER BY position")
    .all(event.id);
  const quizTitle = db.prepare("SELECT title FROM quizzes WHERE id = ?");
  const scenario = rows.map((b) => {
    const block = { id: b.id, type: b.type, content: parseObj(b.content), settings: parseObj(b.settings) };
    if ((block.type === "quiz" || block.type === "poll") && Number.isInteger(block.content.quizId))
      block.quizTitle = quizTitle.get(block.content.quizId)?.title || null;
    return block;
  });
  return { event, scenario };
}

// человекочитаемое имя блока — для transition-карточки и BlockProgress пульта
function blockTitle(block) {
  if (!block) return "";
  switch (block.type) {
    case "quiz":
    case "poll":
      return block.quizTitle || "Раунд";
    case "text":
      return String(block.content.heading || "").trim() || "Текст";
    case "break":
      return String(block.content.label || "").trim() || "Перерыв";
    case "image":
      return String(block.content.caption || "").trim() || "Изображение";
    case "audio":
      return String(block.content.title || "").trim() || "Музыка";
    case "rating":
      return String(block.content.prompt || "").trim() || "Оценка";
    default:
      return String(block.content.title || "").trim() || "Блок";
  }
}

function stopBlockTimers(game) {
  if (game.blockTimer) {
    clearTimeout(game.blockTimer);
    game.blockTimer = null;
  }
  if (game.transitionTimer) {
    clearTimeout(game.transitionTimer);
    game.transitionTimer = null;
  }
}

// очки блока копятся в памяти; в SQLite пишутся батчем на стыке блоков (Гэп 3):
// crash сервера теряет только очки текущего блока — компромисс MVP «игры в памяти»
function addBlockScore(game, token, name, avatar, delta) {
  if (!game.eventId || !token || !delta) return;
  const cur = game.blockScores.get(token) || { name, avatar, points: 0 };
  cur.name = name;
  cur.avatar = avatar;
  cur.points += delta;
  game.blockScores.set(token, cur);
}

function flushBlockScores(game) {
  // currentBlockId == null не встречается (очки копятся только внутри блока),
  // но без guard-а UPSERT по NULL вставлял бы дубли вместо накопления
  if (!game.eventId || game.currentBlockId == null || game.blockScores.size === 0) return;
  // UPSERT по UNIQUE(event_id, player_id, block_id): повторная запись блока
  // (skip/дочёт хвоста) добавляет дельту, а не дублирует рекорд
  const stmt = db.prepare(
    `INSERT INTO event_scores (event_id, player_id, player_name, player_avatar, block_id, points)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (event_id, player_id, block_id)
     DO UPDATE SET points = points + excluded.points,
       player_name = excluded.player_name, player_avatar = excluded.player_avatar`
  );
  db.exec("BEGIN");
  try {
    for (const [token, s] of game.blockScores)
      stmt.run(game.eventId, token, s.name, s.avatar || "", game.currentBlockId, s.points);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    console.error("Не удалось записать очки мероприятия:", e.message);
  }
  game.blockScores.clear();
}

// === Волна 6 (EM-57): активности. Статистика рейтинга (спека §5.3) ===
function ratingStats(game) {
  const scale = game.currentBlock?.payload?.scale || 10;
  const distribution = Array.from({ length: scale }, () => 0);
  let sum = 0;
  let n = 0;
  for (const { value } of game.activity.values.values()) {
    distribution[value - 1] += 1;
    sum += value;
    n += 1;
  }
  return {
    average: n ? Math.round((sum / n) * 10) / 10 : 0,
    distribution,
    totalResponses: n,
    totalGuests: game.players.size,
  };
}

// снапшот активности (пере)подключившемуся: телефон получает свой myValue,
// зал и пульт — агрегат без него; событие <kind>:state по конвенции спек
function activityStatePayload(game, token) {
  if (!game.activity) return null;
  if (game.activity?.kind === "rating") {
    const stats = ratingStats(game);
    const myValue = token ? game.activity.values.get(token)?.value ?? null : undefined;
    return { event: "rating:state", payload: { kind: "rating", ...stats, myValue } };
  }
  // EM-58: лента свободных ответов — без авторских меток сверх имени
  if (game.activity?.kind === "openended") {
    const a = game.activity;
    return {
      event: "openended:state",
      payload: {
        kind: "openended",
        responses: a.responses.map(({ id, text, guestName }) => ({ id, text, guestName })),
        totalResponses: a.responses.length,
        totalGuests: game.players.size,
        myCount: token ? a.byToken.get(token) || 0 : undefined,
      },
    };
  }
  // EM-59: облако — топ-100 слов по частоте (спека §1.4); показываем display —
  // вариант первого ввода, а не нормализованный ключ дедупликации
  if (game.activity?.kind === "wordcloud") {
    const a = game.activity;
    const words = [...a.words.entries()]
      .map(([key, info]) => ({ word: info.display || key, count: info.count }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 100);
    return {
      event: "wordcloud:state",
      payload: {
        kind: "wordcloud",
        words,
        totalSubmissions: [...a.byToken.values()].reduce((s, n) => s + n, 0),
        totalGuests: game.players.size,
        myCount: token ? a.byToken.get(token) || 0 : undefined,
      },
    };
  }
  return null;
}

function sendActivityState(socket, game, token) {
  if (game.state !== "block") return;
  const st = activityStatePayload(game, token);
  if (st) socket.emit(st.event, st.payload);
}

// нулевая база активности всей комнате сразу при старте блока — зал и пульт
// не ждут первого голоса, чтобы узнать totalGuests/пустое состояние
function broadcastActivityState(io, game) {
  const st = activityStatePayload(game);
  if (st) io.to(`game:${game.pin}`).emit(st.event, st.payload);
}

// единый контекст блока в пейлоадах block:* — пульт и зал рисуют прогресс (§4.5)
function blockPayload(game, block, extra) {
  return {
    blockIndex: game.blockIndex,
    blockTotal: game.scenario.length,
    blockType: block.type,
    ...extra,
  };
}

function executeBlock(io, game, index) {
  if (games.get(game.pin) !== game) return;
  const block = game.scenario[index];
  game.blockIndex = index;
  game.currentBlockId = block.id ?? null;
  // активность живёт только пока идёт её блок; предыдущая гасится при любом переходе
  game.activity = null;
  // то же для видео-состояния (EM-67): control-состояние прошлого блока не тянется дальше
  game.videoState = null;
  const str = (v, cap) => String(v ?? "").slice(0, cap);

  if (block.type === "quiz" || block.type === "poll") return startQuizBlock(io, game, block);

  let event = "block:text";
  let extra;
  switch (block.type) {
    case "break": {
      event = "block:break";
      const duration = Math.min(600, Math.max(0, Number(block.content.duration) || 0));
      extra = { label: str(block.content.label, 200), duration };
      break;
    }
    case "image":
      event = "block:image";
      extra = { url: str(block.content.url, 500), caption: str(block.content.caption, 300), fullscreen: !!block.content.fullscreen };
      break;
    case "audio":
      event = "block:audio";
      extra = { url: str(block.content.url, 500), title: str(block.content.title, 200) };
      break;
    case "activity":
      event = "block:activity";
      extra = { type: str(block.content.type, 50), title: str(block.content.title, 200), description: str(block.content.description, 2000) };
      break;
    case "rating": {
      // Волна 6 (EM-57, спека активностей §5): оценка 1–scale, среднее в реальном времени
      event = "block:rating";
      const labels = block.content.labels && typeof block.content.labels === "object" ? block.content.labels : {};
      extra = {
        prompt: str(block.content.prompt, 200),
        scale: Math.min(10, Math.max(2, Number.isInteger(block.content.scale) ? block.content.scale : 10)),
        showAverage: block.content.showAverage !== false,
        labels: { low: str(labels.low, 40), mid: str(labels.mid, 40), high: str(labels.high, 40) },
      };
      game.activity = { kind: "rating", values: new Map() };
      break;
    }
    case "openended": {
      // Волна 6 (EM-58, спека активностей §7): свободный ввод, лента ответов
      event = "block:openended";
      extra = {
        prompt: str(block.content.prompt, 200),
        maxLength: Math.min(500, Math.max(1, Number.isInteger(block.content.maxLength) ? block.content.maxLength : 500)),
        filterProfanity: block.content.filterProfanity !== false,
        maxPerGuest: Math.min(10, Math.max(1, Number.isInteger(block.content.maxPerGuest) ? block.content.maxPerGuest : 3)),
      };
      game.activity = { kind: "openended", responses: [], byToken: new Map(), nextId: 1 };
      break;
    }
    case "wordcloud": {
      // Волна 6 (EM-59, спека активностей §1): облако слов на проекторе
      event = "block:wordcloud";
      const suggested = Array.isArray(block.content.suggestedWords)
        ? block.content.suggestedWords.slice(0, 10).map((w) => str(w, 30))
        : [];
      extra = {
        prompt: str(block.content.prompt, 200),
        maxLength: Math.min(30, Math.max(1, Number.isInteger(block.content.maxLength) ? block.content.maxLength : 30)),
        maxWordsPerGuest: Math.min(10, Math.max(1, Number.isInteger(block.content.maxWordsPerGuest) ? block.content.maxWordsPerGuest : 3)),
        filterProfanity: block.content.filterProfanity !== false,
        suggestedWords: suggested,
        allowCustom: block.content.allowCustom !== false,
        colorScheme: block.content.colorScheme === "rainbow" ? "rainbow" : "brand",
      };
      game.activity = { kind: "wordcloud", words: new Map(), byToken: new Map() };
      break;
    }
    case "video": {
      // EM-67 (мини-спека): ролик на экране зала, ▶/⏸/громкость с пульта;
      // состояние управления реплеится при подключении зала/пульта
      event = "block:video";
      const source = ["file", "youtube", "vk", "rutube"].includes(block.content.source) ? block.content.source : "file";
      extra = {
        source,
        url: str(block.content.url, 500),
        embedUrl: source === "file" ? null : parseVideoEmbed(source, block.content.url),
        title: str(block.content.title, 200),
      };
      game.videoState = { playing: false, volume: 0.8, position: 0, startedAt: null };
      break;
    }
    default:
      event = "block:text";
      extra = {
        heading: str(block.content.heading, 200),
        body: str(block.content.body, 2000),
        layout: str(block.content.layout, 20) || "center",
        imageUrl: str(block.content.imageUrl, 500),
      };
  }

  game.state = "block";
  const payload = blockPayload(game, block, extra);
  game.currentBlock = { event, payload };
  io.to(`game:${game.pin}`).emit(event, payload);
  // нулевая база активности сразу — totalGuests и пустые состояния известны до первого голоса
  if (game.activity) broadcastActivityState(io, game);
  // пауза с таймером переходит сама; duration 0/нет — ждём ведущего
  if (block.type === "break" && extra.duration > 0) {
    game.blockTimer = setTimeout(() => {
      game.blockTimer = null;
      if (games.get(game.pin) === game) advanceBlock(io, game);
    }, extra.duration * 60 * 1000);
  }
}

// квиз/опрос как блок сценария: тот же вопросный флоу, что у одиночной партии,
// но без отдельного лобби — игроков приводит transition-карточка (§4.1)
function startQuizBlock(io, game, block) {
  const loaded = loadQuiz(block.content.quizId);
  if (!loaded) {
    // ссылка протухла мимо всех чисток — пропускаем блок, не роняя партию
    console.error(`Блок ${block.id}: квиз недоступен, пропускаю`);
    advanceBlock(io, game);
    return;
  }
  // настройки блока перекрывают квиз: таймер вопроса и live-распределение опроса
  const s = block.settings;
  if (Number.isInteger(s.timeLimit) && s.timeLimit > 0 && s.timeLimit <= 300)
    loaded.questions = loaded.questions.map((q) => ({ ...q, time_limit: s.timeLimit }));
  if (typeof s.showLiveResults === "boolean") loaded.showLiveResults = s.showLiveResults;
  game.quiz = loaded;
  game.type = loaded.type;
  game.title = block.quizTitle || loaded.title;
  game.qIndex = -1;
  game.scoredQIndex = -1;
  startQuestion(io, game);
}

function advanceBlock(io, game) {
  if (games.get(game.pin) !== game) return;
  flushBlockScores(game);
  stopBlockTimers(game);
  // гасим активность сразу: в 2с-окне transition state ещё «block», и голос,
  // прилетевший в этот момент, ушёл бы в очки следующего блока
  game.activity = null;
  const next = game.blockIndex + 1;
  if (next >= game.scenario.length) return finishEvent(io, game);
  game.blockIndex = next;
  const from = blockTitle(game.scenario[next - 1]);
  const to = blockTitle(game.scenario[next]);
  const payload = blockPayload(game, game.scenario[next], {
    from: { type: game.scenario[next - 1].type, title: from },
    to: { type: game.scenario[next].type, title: to },
    index: next,
    total: game.scenario.length,
  });
  game.state = "block";
  game.currentBlock = { event: "block:transition", payload };
  io.to(`game:${game.pin}`).emit("block:transition", payload);
  game.transitionTimer = setTimeout(() => {
    game.transitionTimer = null;
    executeBlock(io, game, next);
  }, 2000);
}

// финал мероприятия: общий подиум, статус completed в БД; очки — батчем до сигнала
function finishEvent(io, game) {
  flushBlockScores(game);
  stopBlockTimers(game);
  game.activity = null;
  game.state = "finished";
  game.eventFinished = true;
  try {
    db.prepare("UPDATE events SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(game.eventId);
  } catch (e) {
    console.error("Не удалось пометить мероприятие completed:", e.message);
  }
  const payload = { title: game.eventTitle, leaderboard: leaderboard(game), players: playersList(game) };
  io.to(`game:${game.pin}`).emit("event:finished", payload);
  // прежний finished с той же формой: текущие зал/пульт/телефон показывают общий
  // подиум без правок — финал мероприятия переиспользует финал партии
  io.to(`game:${game.pin}`).emit("finished", { leaderboard: payload.leaderboard, players: payload.players });
}

function startEvent(io, game) {
  executeBlock(io, game, 0);
}

// переподключившемуся посреди неигрового блока досылаем текущий блок
function replayBlock(socket, game) {
  if (game.state === "block" && game.currentBlock) {
    socket.emit(game.currentBlock.event, game.currentBlock.payload);
    // видео: подключившийся зал/пульт встаёт на текущую позицию (мини-спека EM-67 §5)
    if (game.currentBlock.payload.blockType === "video" && game.videoState)
      socket.emit("video:state", videoStateForRoom(game.videoState));
  }
}

// позиция воспроизведения: на паузе зафиксированная, при игре — вычисленная из startedAt
function videoStateForRoom(st) {
  return {
    playing: !!st.playing,
    volume: Number.isFinite(st.volume) ? st.volume : 0.8,
    position: st.playing && st.startedAt ? Math.max(0, (Date.now() - st.startedAt) / 1000) : st.position || 0,
  };
}

// фабрика партий: одиночный квиз (EM-46) и мероприятие (EM-55) отличаются только
// сценарием; поля мероприятия заведены сразу, чтобы движок не проверял undefined
function newGame({ pin, hostId, host, title, type, quizId, quiz }) {
  return {
    pin,
    quizId,
    eventId: null,
    eventTitle: null,
    scenario: null,
    blockIndex: -1,
    blockScores: new Map(),
    blockTimer: null,
    transitionTimer: null,
    eventFinished: false,
    currentBlockId: null,
    currentBlock: null,
    activity: null, // Волна 6: живое состояние activity-блока (rating: values по токенам)
    title,
    type,
    hostId,
    // EM-48: пультов может быть несколько (hostSocketIds), залы — screenSocketIds
    hostSocketIds: new Set(),
    screenSocketIds: new Set(),
    hostName: [host?.name, host?.surname].filter(Boolean).join(" "),
    hostAvatar: typeof host?.avatar === "string" ? host.avatar.slice(0, 500) : "",
    state: "lobby",
    qIndex: -1,
    scoredQIndex: -1,
    questionStart: 0,
    quiz,
    players: new Map(),
    kickedTokens: new Set(), // кик: повторный вход по токену блокируется до конца партии
    closeTimer: null,
    recorded: false,
  };
}

export function registerGameHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("host:create-game", ({ token, quizId, eventId } = {}, ack = () => {}) => {
      const hostId = verifyToken(token);
      if (!hostId) return ack({ error: "Не авторизован" });
      releaseOtherHostGames(io, socket);

      // EM-55: запуск мероприятия — движок сценария, партия идёт блок за блоком.
      // Пульт при переподключении цепляется к живой партии своего мероприятия.
      if (eventId !== undefined && eventId !== null && eventId !== "") {
        const id = Number(eventId);
        const live = [...games.values()].find((g) => g.hostId === hostId && g.eventId === id);
        if (live) {
          attachHost(io, socket, live);
          return ack({ ok: true, pin: live.pin });
        }
        const data = loadScenario(id, hostId);
        if (!data) return ack({ error: "Мероприятие не найдено" });
        if (data.scenario.length === 0) return ack({ error: "Сценарий пуст — добавьте блоки" });
        // пустой или незаполненный квиз-блок иначе молча пропускался бы в партии —
        // честнее не начинать и показать, какой блок чинить
        for (let i = 0; i < data.scenario.length; i++) {
          const b = data.scenario[i];
          if (b.type !== "quiz" && b.type !== "poll") continue;
          if (!Number.isInteger(b.content.quizId))
            return ack({ error: `Блок ${i + 1} не заполнен квизом` });
          const n = db.prepare("SELECT COUNT(*) AS n FROM questions WHERE quiz_id = ?").get(b.content.quizId).n;
          if (n === 0) return ack({ error: `Блок ${i + 1} «${b.quizTitle || "Раунд"}» без вопросов — заполните квиз` });
        }
        const host = db.prepare("SELECT name, surname, avatar FROM users WHERE id = ?").get(hostId);
        const game = newGame({ pin: makePin(), hostId, host, title: data.event.title, type: "quiz", quizId: null, quiz: null });
        game.eventId = data.event.id;
        game.eventTitle = data.event.title;
        game.scenario = data.scenario;
        games.set(game.pin, game);
        game.hostSocketIds.add(socket.id);
        socket.join(`game:${game.pin}`);
        try {
          db.prepare("UPDATE events SET status = 'live', updated_at = datetime('now') WHERE id = ?").run(game.eventId);
        } catch (e) {
          console.error("Не удалось пометить мероприятие live:", e.message);
        }
        socket.emit("host:game", snapshotForHost(game));
        return ack({ ok: true, pin: game.pin });
      }

      // EM-46: пульт при открытии подключается к живой партии своего квиза (обновление
      // страницы, второе устройство) и только при её отсутствии создаёт новую —
      // запуск остаётся в один клик и вторая партия не плодится
      const live = [...games.values()].find((g) => g.hostId === hostId && g.quizId === Number(quizId));
      if (live) {
        attachHost(io, socket, live);
        return ack({ ok: true, pin: live.pin });
      }

      const quiz = db
        .prepare("SELECT id, title, type FROM quizzes WHERE id = ? AND host_id = ?")
        .get(Number(quizId), hostId);
      if (!quiz) return ack({ error: "Викторина не найдена" });
      const loaded = loadQuiz(quiz.id);
      if (!loaded) return ack({ error: "Добавьте хотя бы один вопрос" });
      const fullQuestions = loaded.questions;

      const host = db.prepare("SELECT name, surname, avatar FROM users WHERE id = ?").get(hostId);
      // имя/аватар хоста фиксируются на момент создания партии
      const game = newGame({
        pin: makePin(),
        hostId,
        host,
        title: quiz.title,
        type: quiz.type,
        quizId: quiz.id,
        quiz: { title: quiz.title, showLiveResults: loaded.showLiveResults, questions: fullQuestions },
      });
      games.set(game.pin, game);
      game.hostSocketIds.add(socket.id);
      socket.join(`game:${game.pin}`);
      socket.emit("host:game", snapshotForHost(game));
      ack({ ok: true, pin: game.pin });
    });

    // EM-36: экран зала — просмотр комнаты по PIN без каких-либо прав.
    // Сокет не попадает в players и никогда не получает роль хоста, поэтому
    // disconnect экрана не помечает игроков и не запускает close-таймер хоста.
    socket.on("screen:join", ({ pin } = {}, ack = () => {}) => {
      const game = games.get(String(pin || "").trim());
      if (!game) return ack({ error: "Игра с таким PIN не найдена" });
      socket.join(`game:${game.pin}`);
      // защитно: сокет уже смотрел другой зал — вычищаем из прежней партии,
      // иначе её пульт видел бы «зал открыт» до самого дисконнекта сокета
      const prevPin = socket.data.screenPin;
      if (prevPin && prevPin !== game.pin && games.has(prevPin)) {
        const prev = games.get(prevPin);
        prev.screenSocketIds.delete(socket.id);
        if (prev.screenSocketIds.size === 0)
          io.to(`game:${prevPin}`).emit("screen:presence", { open: false });
      }
      // EM-48: комната узнаёт, что зал открыт (screen:presence), — пульт
      // переключает лаунчпад лобби на ghost «Зал ↗»
      socket.data.screenPin = game.pin;
      game.screenSocketIds.add(socket.id);
      if (game.screenSocketIds.size === 1)
        io.to(`game:${game.pin}`).emit("screen:presence", { open: true });
      ack({ ok: true, pin: game.pin, title: game.title, type: game.type, state: game.state, quizId: game.quizId });
      socket.emit("players", { players: playersList(game) });
      if (game.state === "question") socket.emit("question", questionForRoom(game));
      if (game.state === "reveal") {
        socket.emit("question", questionForRoom(game));
        reveal(io, game);
      }
      if (game.state === "finished")
        socket.emit("finished", { leaderboard: leaderboard(game), players: playersList(game) });
      replayBlock(socket, game);
      sendActivityState(socket, game);
    });

    // EM-36: пульт ведущего подключается к ИДУЩЕЙ игре по PIN (второе устройство).
    // EM-48: второй пульт не перехватывает роль — пульты равноправны.
    socket.on("host:attach", ({ token, pin } = {}, ack = () => {}) => {
      const hostId = verifyToken(token);
      if (!hostId) return ack({ error: "Не авторизован" });
      const game = games.get(String(pin || "").trim());
      if (!game || game.hostId !== hostId) return ack({ error: "Игра не найдена" });
      releaseOtherHostGames(io, socket);
      attachHost(io, socket, game);
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
          replayBlock(socket, game);
          sendActivityState(socket, game, p.token);
          broadcastActivityState(io, game); // totalGuests у зала/пульта обновляется при входе
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
      replayBlock(socket, game);
      sendActivityState(socket, game, player.token);
      broadcastActivityState(io, game); // totalGuests у зала/пульта обновляется при входе
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

    // Волна 6 (EM-57): оценка гостя в rating-блоке. Перезаголосование обновляет
    // значение без второй порции очков — участие в блоке оплачивается один раз (§5.5)
    socket.on("rating:submit", ({ value } = {}, ack = () => {}) => {
      const pin = socket.data.gamePin;
      const game = pin && games.get(pin);
      if (!game || game.state !== "block" || game.activity?.kind !== "rating")
        return ack({ error: "Оценка сейчас не принимается" });
      const p = game.players.get(socket.id);
      if (!p) return ack({ error: "Вы не в игре" });
      const v = value;
      const scale = game.currentBlock?.payload?.scale || 10;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > scale)
        return ack({ error: `Оценка — целое число от 1 до ${scale}` });
      // антиспам: каждый спам-голос рассылал бы rating:update всей комнате
      const now = Date.now();
      if (now - (p.lastRatingSubmit || 0) < 300) return ack({ error: "Слишком часто" });
      p.lastRatingSubmit = now;
      const first = !game.activity.values.has(p.token);
      game.activity.values.set(p.token, { value: v, name: p.name, avatar: p.avatar });
      if (first) addBlockScore(game, p.token, p.name, p.avatar, 1);
      io.to(`game:${pin}`).emit("rating:update", ratingStats(game));
      ack({ ok: true });
    });

    // Волна 6 (EM-58): свободный ответ гостя. Очки +1 за каждый принятый ответ
    // (спека §7.5), лимит maxPerGuest на гостя; нецензурное — отклоняем целиком
    socket.on("openended:submit", ({ text } = {}, ack = () => {}) => {
      const pin = socket.data.gamePin;
      const game = pin && games.get(pin);
      if (!game || game.state !== "block" || game.activity?.kind !== "openended")
        return ack({ error: "Ответы сейчас не принимаются" });
      const p = game.players.get(socket.id);
      if (!p) return ack({ error: "Вы не в игре" });
      const now = Date.now();
      if (now - (p.lastOpenendedSubmit || 0) < 300) return ack({ error: "Слишком часто" });
      const a = game.activity;
      const used = a.byToken.get(p.token) || 0;
      const maxLength = game.currentBlock?.payload?.maxLength || 500;
      const maxPerGuest = game.currentBlock?.payload?.maxPerGuest || 3;
      if (used >= maxPerGuest) return ack({ error: "Лимит ответов исчерпан" });
      const raw = typeof text === "string" ? text.trim() : "";
      if (!raw) return ack({ error: "Введите текст" });
      if (raw.length > maxLength) return ack({ error: `Максимум ${maxLength} символов` });
      p.lastOpenendedSubmit = now;
      const filterProfanity = game.currentBlock?.payload?.filterProfanity !== false;
      if (filterProfanity && containsProfanity(raw))
        return ack({ error: "Такие слова лучше не показывать — переформулируйте" });
      const response = { id: a.nextId++, text: raw, guestName: p.name };
      a.responses.push(response);
      a.byToken.set(p.token, used + 1);
      addBlockScore(game, p.token, p.name, p.avatar, 1);
      io.to(`game:${pin}`).emit("openended:response", {
        id: response.id,
        text: response.text,
        guestName: response.guestName,
      });
      ack({ ok: true });
    });

    // Волна 6 (EM-59): слово в облако. Дедуп по нормализованной форме (регистр/ё),
    // очки +1 за каждое принятое слово в пределах лимита (спека §1.5)
    socket.on("wordcloud:submit", ({ word } = {}, ack = () => {}) => {
      const pin = socket.data.gamePin;
      const game = pin && games.get(pin);
      if (!game || game.state !== "block" || game.activity?.kind !== "wordcloud")
        return ack({ error: "Слова сейчас не принимаются" });
      const p = game.players.get(socket.id);
      if (!p) return ack({ error: "Вы не в игре" });
      const now = Date.now();
      if (now - (p.lastWordcloudSubmit || 0) < 300) return ack({ error: "Слишком часто" });
      const a = game.activity;
      const used = a.byToken.get(p.token) || 0;
      const maxLength = game.currentBlock?.payload?.maxLength || 30;
      const maxWordsPerGuest = game.currentBlock?.payload?.maxWordsPerGuest || 3;
      if (used >= maxWordsPerGuest) return ack({ error: "Лимит слов исчерпан" });
      const raw = typeof word === "string" ? word.trim().slice(0, maxLength) : "";
      if (!raw) return ack({ error: "Введите слово" });
      p.lastWordcloudSubmit = now;
      const filterProfanity = game.currentBlock?.payload?.filterProfanity !== false;
      if (filterProfanity && containsProfanity(raw))
        return ack({ error: "Такие слова лучше не показывать — переформулируйте" });
      if (game.currentBlock?.payload?.allowCustom === false) {
        const suggestions = (game.currentBlock?.payload?.suggestedWords || []).map((w) =>
          String(w).toLowerCase().replace(/ё/g, "е")
        );
        if (!suggestions.includes(raw.toLowerCase().replace(/ё/g, "е")))
          return ack({ error: "Выберите слово из подсказок" });
      }
      const key = raw.toLowerCase().replace(/ё/g, "е");
      const prev = a.words.get(key);
      const count = (prev?.count || 0) + 1;
      a.words.set(key, { count, display: prev?.display || raw });
      a.byToken.set(p.token, used + 1);
      addBlockScore(game, p.token, p.name, p.avatar, 1);
      io.to(`game:${pin}`).emit("wordcloud:word", { word: prev?.display || raw, count, guestName: p.name });
      ack({ ok: true });
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
      // EM-48: пустую партию не начинаем — disabled-кнопка на пульте не единственный барьер
      if (!game || game.state !== "lobby" || game.players.size === 0) return;
      // EM-55: в мероприятии «Начать игру» запускает первый блок сценария
      if (game.eventId) return startEvent(io, game);
      startQuestion(io, game);
    });

    // каноническое событие спеки §4.3; host:start остаётся алиасом — им работает
    // существующая кнопка лобби пульта
    socket.on("host:start-event", () => {
      const game = hostGame(socket);
      if (!game || !game.eventId || game.state !== "lobby" || game.players.size === 0) return;
      startEvent(io, game);
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
      } else if (game.eventId) {
        // квиз-блок кончился — это не финал партии, а следующий блок сценария
        advanceBlock(io, game);
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
      } else if (game.eventId) {
        advanceBlock(io, game);
      } else {
        finishGame(io, game);
      }
    });

    // EM-55: следующий блок после неигрового (text/image/audio/activity);
    // во время 2с-перехода управление заблокировано — переход уходит сам
    socket.on("host:next-block", () => {
      const game = hostGame(socket);
      if (!game || !game.eventId || game.state !== "block" || game.transitionTimer) return;
      advanceBlock(io, game);
    });

    // пропустить блок целиком: неигровой блок или недоигранный квиз-блок
    // (набранные к этому моменту очки блока сохраняются)
    socket.on("host:skip-block", () => {
      const game = hostGame(socket);
      if (!game || !game.eventId || game.transitionTimer) return;
      if (game.blockIndex < 0 || !["block", "question", "reveal"].includes(game.state)) return;
      stopRevealTimer(game);
      advanceBlock(io, game);
    });

    // EM-67: управление видео на зале (▶/⏸/громкость/сначала) — только хост и
    // только в активном video-блоке; состояние уходит всей комнате и реплеится
    socket.on("host:video-control", ({ action, value } = {}, ack = () => {}) => {
      const game = hostGame(socket);
      if (!game || game.state !== "block" || game.currentBlock?.payload?.blockType !== "video")
        return ack({ error: "Видео-блок сейчас не активен" });
      const st = game.videoState;
      if (action === "play") {
        if (!st.playing) {
          st.startedAt = Date.now() - (st.position || 0) * 1000;
          st.playing = true;
        }
      } else if (action === "pause") {
        if (st.playing) {
          st.position = (Date.now() - st.startedAt) / 1000;
          st.playing = false;
        }
      } else if (action === "volume") {
        st.volume = Math.min(1, Math.max(0, Number(value) || 0));
      } else if (action === "restart") {
        st.position = 0;
        st.startedAt = Date.now();
        st.playing = true;
      } else {
        return ack({ error: "Неизвестное действие" });
      }
      io.to(`game:${game.pin}`).emit("video:state", videoStateForRoom(st));
      ack({ ok: true, playing: st.playing, volume: st.volume });
    });

    socket.on("host:play-again", () => {
      const game = hostGame(socket);
      if (!game || game.state !== "finished") return;
      stopRevealTimer(game);
      if (game.eventId) {
        // новая партия мероприятия: очки прошлого прогона стираются целиком
        // (иначе повторный прогон блоков удвоил бы рекорды в event_scores)
        stopBlockTimers(game);
        flushBlockScores(game);
        try {
          db.prepare("DELETE FROM event_scores WHERE event_id = ?").run(game.eventId);
          db.prepare("UPDATE events SET status = 'live', updated_at = datetime('now') WHERE id = ?").run(game.eventId);
        } catch (e) {
          console.error("Не удалось перезапустить мероприятие:", e.message);
        }
        game.blockIndex = -1;
        game.currentBlockId = null;
        game.currentBlock = null;
        game.activity = null;
        game.eventFinished = false;
        game.quiz = null;
        game.title = game.eventTitle;
        game.state = "lobby";
        game.qIndex = -1;
        game.scoredQIndex = -1;
        for (const p of game.players.values()) {
          p.score = 0;
          p.answer = null;
          p.awarded = 0;
          p.lastCorrect = false;
        }
        game.blockScores.clear();
        io.to(`game:${game.pin}`).emit("game:lobby", { title: game.eventTitle });
        broadcastPlayers(io, game);
        for (const sid of game.hostSocketIds)
          io.sockets.sockets.get(sid)?.emit("host:game", snapshotForHost(game));
        return;
      }
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
      // снапшот — всем пультам: остальные тоже возвращаются в лобби (EM-48)
      for (const sid of game.hostSocketIds)
        io.sockets.sockets.get(sid)?.emit("host:game", snapshotForHost(game));
    });

    socket.on("host:end", () => {
      const game = hostGame(socket);
      if (!game) return;
      if (game.eventId) {
        flushBlockScores(game);
        // недоигранное мероприятие возвращаем в ready (можно запустить снова);
        // доигранное до финала уже помечено completed в finishEvent
        if (!game.eventFinished) {
          try {
            db.prepare("UPDATE events SET status = 'ready', updated_at = datetime('now') WHERE id = ?").run(game.eventId);
          } catch (e) {
            console.error("Не удалось обновить статус мероприятия:", e.message);
          }
        }
        deleteGame(io, game);
        return;
      }
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
      // экран зала отвалился: когда вкладок зала не осталось — «зал не открыт» (EM-48)
      const screenPin = socket.data.screenPin;
      if (screenPin && games.has(screenPin)) {
        const screenGame = games.get(screenPin);
        screenGame.screenSocketIds.delete(socket.id);
        if (screenGame.screenSocketIds.size === 0)
          io.to(`game:${screenPin}`).emit("screen:presence", { open: false });
      }
      for (const game of games.values()) {
        if (game.hostSocketIds.has(socket.id)) {
          game.hostSocketIds.delete(socket.id);
          // close-таймер — только когда не осталось ни одного пульта; даём 2 минуты
          // на переподключение (обновление страницы)
          if (game.hostSocketIds.size === 0 && !game.closeTimer) {
            game.closeTimer = setTimeout(() => {
              if (game.hostSocketIds.size === 0) deleteGame(io, game);
            }, 2 * 60 * 1000);
          }
        }
      }
    });
  });
}

function hostGame(socket) {
  for (const game of games.values()) {
    if (game.hostSocketIds.has(socket.id)) return game;
  }
  return null;
}

// сокет пульта ведёт ровно одну партию: при подключении к новой выходим из прежних,
// иначе hostGame нашёл бы старую игру и кнопки управляли бы не той партией
// (переход «кабинет → Перейти к пульту» другого мероприятия без перезагрузки страницы)
function releaseOtherHostGames(io, socket) {
  for (const game of games.values()) {
    if (!game.hostSocketIds.delete(socket.id)) continue;
    socket.leave(`game:${game.pin}`);
    if (game.hostSocketIds.size === 0 && !game.closeTimer) {
      game.closeTimer = setTimeout(() => {
        if (game.hostSocketIds.size === 0) deleteGame(io, game);
      }, 2 * 60 * 1000);
    }
  }
}

// EM-46: подключение пульта к живой партии с досылом полного состояния фазы.
// Общий для host:attach и повторного host:create-game того же квиза.
// EM-48: пульты равноправны — новый сокет добавляется к hostSocketIds,
// прежний пульт продолжает управлять (host:detached упразднён).
function attachHost(io, socket, game) {
  clearTimeout(game.closeTimer);
  game.closeTimer = null;
  game.hostSocketIds.add(socket.id);
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
  replayBlock(socket, game);
  sendActivityState(socket, game);
}

function snapshotForHost(game) {
  return {
    pin: game.pin,
    title: game.title,
    type: game.type,
    state: game.state,
    qIndex: game.qIndex,
    total: game.quiz ? game.quiz.questions.length : 0,
    players: playersList(game),
    // EM-48: пульт сразу знает, открыт ли зал (важно после переподключения)
    screenOpen: game.screenSocketIds.size > 0,
    // EM-55: контекст мероприятия для пульта (аддитивно — старые клиенты игнорируют)
    eventId: game.eventId,
    eventTitle: game.eventTitle,
    blockIndex: game.eventId ? game.blockIndex : null,
    blockTotal: game.eventId ? game.scenario.length : null,
    block:
      game.eventId && game.blockIndex >= 0
        ? { type: game.scenario[game.blockIndex].type, title: blockTitle(game.scenario[game.blockIndex]) }
        : null,
  };
}
