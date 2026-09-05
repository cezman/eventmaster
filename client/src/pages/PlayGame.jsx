import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getSocket } from "../socket";
import PlayerAvatar, { parseAvatar } from "../components/PlayerAvatar";
import Dropdown from "../components/Dropdown";
import { DoorIcon } from "../components/icons";
import ReconnectOverlay, { useReconnectStatus } from "../components/ReconnectOverlay";
import confetti from "canvas-confetti";
import {
  NAME_COLORS,
  REACTION_EMOJIS,
  REACTION_LABELS,
  AVATAR_PRESETS,
  randomAvatarProps,
  HAIR_OPTIONS,
  CLOTHING_OPTIONS,
  COLOR_OPTIONS,
  BODY_OPTIONS,
  SKIN_OPTIONS,
  HAIR_COLOR_OPTIONS,
} from "../customize";
import { plural } from "../plural";
import { BLOCK_TYPES, blockDisplayTitle } from "../blocks";

// салют с уважением к prefers-reduced-motion (канвас-анимация недоступна/не нужна)
function canConfetti() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const ANSWER_COLORS = ["c0", "c1", "c2", "c3"];
const ANSWER_SHAPES = ["▲", "◆", "●", "■"];
const RING_CIRC = 2 * Math.PI * 34; // длина окружности ring-таймера (r=34)

export default function PlayGame() {
  const { pin: pinParam } = useParams();
  const navigate = useNavigate();
  const socket = getSocket();

  const [pin, setPin] = useState(pinParam || "");
  const [name, setName] = useState(sessionStorage.getItem("playerName") || "");
  const [avatar, setAvatar] = useState(() => {
    const parsed = parseAvatar(sessionStorage.getItem("playerAvatar"));
    return parsed || randomAvatarProps(); // при первом входе — случайный, тап по превью перегенерирует
  });
  const [color, setColor] = useState(() => {
    const saved = sessionStorage.getItem("playerColor");
    return saved == null ? Math.floor(Math.random() * NAME_COLORS.length) : Number(saved);
  });
  const [joined, setJoined] = useState(false);
  const [hostName, setHostName] = useState("");
  const [hostAvatar, setHostAvatar] = useState(null);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const [gameOver, setGameOver] = useState(false); // вход в уже завершённую игру
  const [kicked, setKicked] = useState(false); // хост удалил игрока из партии
  const [kickedPin, setKickedPin] = useState(sessionStorage.getItem("kickedPin") || "");
  const [customizeOpen, setCustomizeOpen] = useState(false); // конструктор аватара в лобби свёрнут
  const [players, setPlayers] = useState([]);
  const [question, setQuestion] = useState(null);
  const [submitted, setSubmitted] = useState(null); // индекс ответа
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const [block, setBlock] = useState(null); // EM-55: неигровой блок сценария
  // EM-57: rating-блок — интерактивная оценка на телефоне
  const [ratingChoice, setRatingChoice] = useState(null); // выбранное на слайдере (до отправки)
  const [ratingSent, setRatingSent] = useState(null); // отправленная оценка (myValue)
  const [ratingStats, setRatingStats] = useState(null); // live-агрегат сервера
  const [ratingSending, setRatingSending] = useState(false);
  // EM-58: openended — текст ввода, мои ответы, лимит и лента чужих
  const [openText, setOpenText] = useState("");
  const [openFeed, setOpenFeed] = useState(null); // {responses,totalResponses,totalGuests}
  const [openMyCount, setOpenMyCount] = useState(0);
  const [openError, setOpenError] = useState("");
  const [openSending, setOpenSending] = useState(false);
  // EM-59: wordcloud — ввод слова, подсказки, лимит и счётчик облака
  const [cloudText, setCloudText] = useState("");
  const [cloudStats, setCloudStats] = useState(null); // {words,totalGuests}
  const [cloudMyCount, setCloudMyCount] = useState(0);
  const [cloudError, setCloudError] = useState("");
  const [cloudSending, setCloudSending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const nameRef = useRef(null);
  const playerJoinedRef = useRef(false); // EM-71: живая ли сессия (для rejoin после обрыва)

  // кик: чистим сессию игрока и запоминаем PIN — форма больше не пустит в эту партию
  const handleKicked = (pinSaved) => {
    const saved = String(pinSaved || sessionStorage.getItem("playerPin") || pinParam || "");
    sessionStorage.setItem("kickedPin", saved);
    sessionStorage.removeItem("playerToken");
    sessionStorage.removeItem("playerPin");
    setJoined(false); // иначе после экрана кика останемся в «лобби» игры, из которой выгнаны
    setQuestion(null); // стейт партии мог доехать до кика — сбрасываем, чтобы не «вернулся» после экрана
    setReveal(null);
    setFinal(null);
    setBlock(null);
    setSubmitted(null);
    setSecondsLeft(null);
    setRatingChoice(null);
    setRatingSent(null);
    setRatingStats(null);
    setOpenText("");
    setOpenFeed(null);
    setOpenMyCount(0);
    setOpenError("");
    setCloudText("");
    setCloudStats(null);
    setCloudMyCount(0);
    setCloudError("");
    setKickedPin(saved);
    playerJoinedRef.current = false;
    setKicked(true);
  };

  useEffect(() => {
    const onPlayers = (d) => setPlayers(d.players);
    const onQuestion = (q) => {
      setQuestion(q);
      setSubmitted(null);
      setReveal(null);
      setFinal(null);
      setSecondsLeft(q.timeLimit);
    };
    const onReveal = (r) => {
      setReveal(r);
      setSecondsLeft(null);
    };
    const onFinished = (f) => {
      setFinal(f);
      setQuestion(null);
      setReveal(null);
      setSecondsLeft(null);
    };
    // ведущий нажал «Играть снова» — возвращаемся в лобби
    const onLobby = () => {
      setQuestion(null);
      setReveal(null);
      setFinal(null);
      setBlock(null);
      setSubmitted(null);
      setSecondsLeft(null);
      setRatingChoice(null);
      setRatingSent(null);
      setRatingStats(null);
      setOpenText("");
      setOpenFeed(null);
      setOpenMyCount(0);
      setOpenError("");
      setCloudText("");
      setCloudStats(null);
      setCloudMyCount(0);
      setCloudError("");
      setGameOver(false); // хост нажал «Играть снова» — экран «Игра завершена» больше не нужен
    };
    const onClosed = () => setClosed(true);
    const onKicked = () => handleKicked();
    // EM-55: неигровые блоки — телефон в свёрнутом состоянии «Сейчас: …»
    const onBlock = (payload) => {
      setBlock(payload);
      setQuestion(null);
      setReveal(null);
      setFinal(null);
      setSubmitted(null);
      setSecondsLeft(null);
      // EM-57: локальное состояние оценки гасим — live-агрегат придёт следом (state/update)
      setRatingChoice(null);
      setRatingSent(null);
      setRatingStats(null);
      // EM-58: сброс свободного ввода на новом блоке
      setOpenText("");
      setOpenFeed(null);
      setOpenMyCount(0);
      setOpenError("");
      // EM-59: сброс облака (иначе лимит прошлого блока блокирует ввод)
      setCloudText("");
      setCloudStats(null);
      setCloudMyCount(0);
      setCloudError("");
    };
    // EM-57: агрегат оценок — и снапшот при входе (state, с myValue), и каждый голос (update)
    const onRatingStats = (d) => {
      setRatingStats(d);
      if (d.myValue != null) setRatingSent(d.myValue);
    };
    // EM-58: лента ответов — state при входе (с myCount), response — каждый новый ответ
    const onOpenendedState = (d) => {
      setOpenFeed({ responses: d.responses, totalResponses: d.totalResponses, totalGuests: d.totalGuests });
      if (typeof d.myCount === "number") setOpenMyCount(d.myCount);
    };
    const onOpenendedResponse = (r) =>
      setOpenFeed((cur) =>
        cur
          ? { ...cur, responses: [...cur.responses, r], totalResponses: cur.totalResponses + 1 }
          : { kind: "openended", responses: [r], totalResponses: 1, totalGuests: 0 }
      );
    // EM-59: облако — state при входе (с myCount), word — каждое новое слово
    const onWordcloudState = (d) => {
      setCloudStats({ words: d.words, totalSubmissions: d.totalSubmissions, totalGuests: d.totalGuests });
      if (typeof d.myCount === "number") setCloudMyCount(d.myCount);
    };
    const onWordcloudWord = (w) =>
      setCloudStats((cur) => {
        const words = cur ? cur.words.map((x) => ({ ...x })) : [];
        const found = words.find((x) => x.word === w.word);
        if (found) found.count = w.count;
        else words.push({ word: w.word, count: w.count });
        return { words, totalGuests: cur?.totalGuests ?? 0 };
      });

    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    socket.on("finished", onFinished);
    socket.on("event:finished", onFinished);
    socket.on("game:lobby", onLobby);
    socket.on("game:closed", onClosed);
    socket.on("kicked", onKicked);
    for (const ev of ["block:text", "block:image", "block:audio", "block:break", "block:activity", "block:rating", "block:openended", "block:wordcloud", "block:video", "block:transition"])
      socket.on(ev, onBlock);
    socket.on("rating:state", onRatingStats);
    socket.on("rating:update", onRatingStats);
    socket.on("openended:state", onOpenendedState);
    socket.on("openended:response", onOpenendedResponse);
    socket.on("wordcloud:state", onWordcloudState);
    socket.on("wordcloud:word", onWordcloudWord);
    return () => {
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("event:finished", onFinished);
      socket.off("game:lobby", onLobby);
      socket.off("game:closed", onClosed);
      socket.off("kicked", onKicked);
      for (const ev of ["block:text", "block:image", "block:audio", "block:break", "block:activity", "block:rating", "block:openended", "block:wordcloud", "block:video", "block:transition"])
        socket.off(ev, onBlock);
      socket.off("rating:state", onRatingStats);
      socket.off("rating:update", onRatingStats);
      socket.off("openended:state", onOpenendedState);
      socket.off("openended:response", onOpenendedResponse);
      socket.off("wordcloud:state", onWordcloudState);
      socket.off("wordcloud:word", onWordcloudWord);
    };
  }, [socket]);

  // обратный отсчёт на вопросе
  useEffect(() => {
    if (secondsLeft == null || secondsLeft <= 0) return undefined;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const myName = (sessionStorage.getItem("playerName") || "").trim();
  // EM-45: оверлей переподключения — только пока игрок в партии и игра ещё не доиграна
  // (на финале данные не нужны; EM-71, принятая правка ревью)
  const reconnect = useReconnectStatus(socket, joined && !final);
  const reconnectOverlay = (
    <ReconnectOverlay
      state={reconnect.state}
      secondsLeft={reconnect.secondsLeft}
      retryLabel="Переподключить"
      onRetry={() => {
        if (socket.disconnected) socket.connect();
      }}
      onHome={() => navigate("/")}
    />
  );

  // салют при финале — громче, если игрок в топ-3
  useEffect(() => {
    if (!final || !canConfetti()) return;
    const place = final.leaderboard.findIndex((p) => p.name === myName);
    if (place < 0 || place > 2) return;
    confetti({
      particleCount: place === 0 ? 160 : 90,
      spread: place === 0 ? 100 : 70,
      origin: { y: 0.6 },
    });
  }, [final, myName]);

  // правка аватара/цвета: состояние + sessionStorage (для rejoin) + сервер, если уже в игре
  const applyAvatar = (patch) => {
    const nextAvatar = patch.avatar != null ? patch.avatar : { ...avatar, ...patch.props };
    const nextColor = patch.color != null ? patch.color : color;
    setAvatar(nextAvatar);
    setColor(nextColor);
    sessionStorage.setItem("playerAvatar", JSON.stringify(nextAvatar));
    sessionStorage.setItem("playerColor", String(nextColor));
    if (joined) socket.emit("update-avatar", { avatar: JSON.stringify(nextAvatar), color: nextColor });
  };

  const react = (emoji) => socket.emit("player:reaction", { emoji });

  // EM-57: отправка оценки rating-блока; при ошибке кнопка просто снова активна.
  // Таймаут — если сокет умер и ack не придёт никогда, кнопка не зависнет в «Отправляем…»
  const sendRating = () => {
    if (ratingSending || ratingChoice == null) return;
    setRatingSending(true);
    const timer = setTimeout(() => setRatingSending(false), 5000);
    socket.emit("rating:submit", { value: ratingChoice }, (res) => {
      clearTimeout(timer);
      setRatingSending(false);
      if (res?.ok) setRatingSent(ratingChoice);
    });
  };

  // EM-59: отправка слова в облако
  const sendWord = () => {
    if (cloudSending || !cloudText.trim()) return;
    setCloudSending(true);
    setCloudError("");
    const timer = setTimeout(() => {
      setCloudSending(false);
      setCloudError("Не отправилось — проверьте связь и попробуйте снова");
    }, 5000);
    socket.emit("wordcloud:submit", { word: cloudText }, (res) => {
      clearTimeout(timer);
      setCloudSending(false);
      if (res?.ok) {
        setCloudMyCount((c) => c + 1);
        setCloudText("");
      } else {
        setCloudError(res?.error || "Не отправилось");
      }
    });
  };

  // EM-58: отправка свободного ответа; ошибка сервера (лимит/мат) показывается под полем
  const sendOpen = () => {
    if (openSending || !openText.trim()) return;
    setOpenSending(true);
    setOpenError("");
    const timer = setTimeout(() => {
      setOpenSending(false);
      setOpenError("Не отправилось — проверьте связь и попробуйте снова");
    }, 5000);
    socket.emit("openended:submit", { text: openText }, (res) => {
      clearTimeout(timer);
      setOpenSending(false);
      if (res?.ok) {
        setOpenMyCount((c) => c + 1);
        setOpenText("");
      } else {
        setOpenError(res?.error || "Не отправилось");
      }
    });
  };

  // восстановление по токену: и на монтировании страницы, и на «connect» — при тёплом
  // переподключении транспорта (свернул браузер, умер TCP) сокет получает новый id,
  // повторный player:join по токену возвращает игрока в комнату (сервер идемпотентен).
  // EM-71: вход через форму оставляет URL без :pin — после обрыва берём сохранённый PIN.
  // НО только как восстановление живой сессии (playerJoinedRef): автологин по savedPin
  // на монтировании «/play» подменял бы собой форму входа в другую партию (нашёл ревью)
  useEffect(() => {
    const rejoin = (allowSavedPin) => {
      const token = sessionStorage.getItem("playerToken");
      const savedPin = sessionStorage.getItem("playerPin");
      const savedName = (sessionStorage.getItem("playerName") || "").trim();
      const pin = pinParam || (allowSavedPin ? savedPin : "");
      if (!pin || !token || !savedName || (pinParam && savedPin !== pinParam)) return;
      socket.emit(
        "player:join",
        {
          pin,
          name: savedName,
          avatar: sessionStorage.getItem("playerAvatar"),
          color: Number(sessionStorage.getItem("playerColor") ?? 0),
          token,
        },
        (res) => {
          if (res?.kicked) return handleKicked(pinParam); // сервер помнит кик по токену
          if (res?.finished) return setGameOver(true); // завершённая игра — экран «Игра завершена»
          if (!res || res.error) return; // тихо остаёмся на форме входа
          setHostName(res.hostName || "");
          setHostAvatar(parseAvatar(res.hostAvatar || ""));
          playerJoinedRef.current = true;
          setJoined(true);
        }
      );
    };
    // если сокет уже подключён, «connect» не прилетит — rejoin сразу (только по :pin из URL);
    // при живой сессии «connect» после обрыва берёт и сохранённый PIN
    if (socket.connected) rejoin(false);
    const onConnect = () => rejoin(playerJoinedRef.current);
    socket.on("connect", onConnect);
    return () => socket.off("connect", onConnect);
  }, [socket, pinParam]);

  const join = (e) => {
    e.preventDefault();
    setError("");
    const cleanPin = pin.replace(/\D/g, "");
    const cleanName = name.trim().slice(0, 20);
    if (cleanPin.length !== 6) return setError("PIN состоит из 6 цифр");
    if (!cleanName) return setError("Введите имя");
    // кикнутый с этого устройства не входит в ту же партию повторно
    if (kickedPin && cleanPin === kickedPin) {
      return setError("Вы были исключены из этой игры. Введите другой PIN или вернитесь позже.");
    }
    // токен шлём только под своим сохранённым именем: иначе на общем устройстве
    // новый игрок молча «присвоил» бы сессию предыдущего
    const savedName = (sessionStorage.getItem("playerName") || "").trim();
    const token = cleanName === savedName ? sessionStorage.getItem("playerToken") : null;
    socket.emit(
      "player:join",
      { pin: cleanPin, name: cleanName, avatar: JSON.stringify(avatar), color, token },
      (res) => {
        if (res?.kicked) {
          handleKicked(cleanPin);
          return setError(res.error);
        }
        if (res?.finished) return setGameOver(true);
        if (res?.error) return setError(res.error);
        sessionStorage.setItem("playerName", cleanName);
        sessionStorage.setItem("playerAvatar", JSON.stringify(avatar));
        sessionStorage.setItem("playerColor", String(color));
        playerJoinedRef.current = true;
        sessionStorage.setItem("playerPin", cleanPin);
        sessionStorage.setItem("playerToken", res.token);
        setHostName(res.hostName || "");
        setHostAvatar(parseAvatar(res.hostAvatar || ""));
        setJoined(true);
      }
    );
  };

  const answer = (i) => {
    if (submitted != null) return;
    setSubmitted(i);
    socket.emit("player:answer", { choice: i });
  };

  if (kicked) {
    return (
      <div className="play-screen kicked-screen">
        <DoorIcon className="kicked-icon" />
        <h1>Вас исключили из этой игры</h1>
        <p className="muted">Ведущий удалил вас из этой сессии.</p>
        <div className="kicked-actions">
          <button
            type="button"
            className="btn btn-outline btn-lg"
            onClick={() => {
              setKicked(false); // роутер не перемонтирует /play — сбрасываем экран вручную
              navigate("/play");
            }}
          >
            Ввести другой PIN
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => navigate("/")}>
            На главную
          </button>
        </div>
      </div>
    );
  }

  if (closed || gameOver) {
    return (
      <div className="play-screen">
        <h1>{gameOver ? "Игра завершена" : "Игра закрыта"}</h1>
        <p className="muted">
          {gameOver ? "Эта партия уже закончилась." : "Ведущий завершил игру или она устарела."}
        </p>
        <Link className="btn btn-primary" to="/">
          На главную
        </Link>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="play-screen">
        <form className="card play-card" onSubmit={join}>
          <h1>Присоединиться к игре</h1>
          <label className="field-label">
            PIN игры с экрана ведущего
            <input
              className="pin-input"
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </label>
          {kickedPin && kickedPin === pin.replace(/\D/g, "") && (
            <div className="error" role="alert">
              Вы были исключены из этой игры. Введите другой PIN или вернитесь позже.
            </div>
          )}
          <label className="field-label">
            Ваше имя
            <input
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
              ref={nameRef}
              required
            />
          </label>
          {/* вход из двух шагов: на форме только PIN, имя и случайный аватар (тап — перегенерация) */}
          <button
            type="button"
            className="avatar-tap"
            onClick={() => applyAvatar({ avatar: randomAvatarProps() })}
            aria-label="Сменить аватар на случайный"
          >
            <PlayerAvatar avatar={JSON.stringify(avatar)} size={96} />
          </button>
          <span className="muted small">Тапните по аватару, чтобы сменить</span>
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={kickedPin !== "" && kickedPin === pin.replace(/\D/g, "")}>
            Войти в игру
          </button>
        </form>
      </div>
    );
  }

  if (final) {
    const me = final.leaderboard.findIndex((p) => p.name === myName);
    const myRow = final.players.find((p) => p.name === myName);
    return (
      <div className="play-screen">
        {reconnectOverlay}
        <h1>{["🎉 Победа!", "👏 Отлично!", "👍 Спасибо за игру!"][me >= 0 ? Math.min(me, 2) : 2]}</h1>
        {me >= 0 ? (
          <p>
            Вы заняли <b>{me + 1}</b> {plural(me + 1, ["место", "места", "мест"])} с{" "}
            <b>{final.leaderboard[me].score}</b> {plural(final.leaderboard[me].score, ["очком", "очка", "очков"])}
          </p>
        ) : (
          myRow && <p>Ваш счёт: <b>{myRow.score}</b></p>
        )}
        <div className="board">
          {final.leaderboard.map((p, i) => (
            <div className={`board-row ${i === 0 ? "winner" : ""}`} key={p.name}>
              <span className="board-player">
                {["🥇", "🥈", "🥉"][i] || `${i + 1}.`}{" "}
                <span style={{ color: NAME_COLORS[p.color] || "#fff" }} className="board-player-name">
                  <PlayerAvatar avatar={p.avatar} size={26} /> {p.name}
                </span>
              </span>
              <b>{p.score}</b>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // EM-57: rating — единственный из неигровых блоков интерактивен на телефоне:
  // слайдер 1–scale, крупная цифра, подписи шкалы, после отправки — live-среднее
  if (block && !question && !reveal && !final && block.blockType === "rating") {
    const scale = block.scale || 10;
    const labels = block.labels || {};
    const choice = ratingChoice ?? Math.round(scale / 2);
    return (
      <div className="play-screen">
        {reconnectOverlay}
        <div className="play-rating">
          <h2 className="q-text-sm">{block.prompt || "Ваша оценка"}</h2>
          {ratingSent == null ? (
            <>
              <div className="play-rating-value" aria-hidden="true">{choice}</div>
              <input
                className="play-rating-slider"
                type="range"
                min="1"
                max={scale}
                step="1"
                value={choice}
                aria-label={`Оценка от 1 до ${scale}`}
                onChange={(e) => setRatingChoice(Number(e.target.value))}
              />
              {(labels.low || labels.mid || labels.high) && (
                <div className="play-rating-labels" aria-hidden="true">
                  <span>{labels.low}</span>
                  <span>{labels.mid}</span>
                  <span>{labels.high}</span>
                </div>
              )}
              <button
                className="btn btn-primary btn-xl btn-block"
                disabled={ratingSending}
                onClick={sendRating}
              >
                {ratingSending ? "Отправляем…" : "Отправить"}
              </button>
            </>
          ) : (
            <>
              <div className="play-rating-value play-rating-value--sent" aria-hidden="true">{ratingSent}</div>
              <p className="play-rating-caption">Ваша оценка</p>
              {block.showAverage !== false && ratingStats && ratingStats.totalResponses > 0 && (
                <p className="muted">Среднее: {ratingStats.average.toFixed(1)}</p>
              )}
              <button
                className="btn btn-outline btn-block"
                onClick={() => {
                  setRatingChoice(ratingSent);
                  setRatingSent(null);
                }}
              >
                Изменить оценку
              </button>
            </>
          )}
          {ratingStats && ratingStats.totalResponses > 0 && (
            <p className="muted small">Оценок: {ratingStats.totalResponses}</p>
          )}
        </div>
      </div>
    );
  }

  // EM-58: openended — свободный ввод на телефоне: textarea + лимит ответов,
  // после отправки показываем чужие ответы; «Ещё ответ» пока лимит не исчерпан
  if (block && !question && !reveal && !final && block.blockType === "openended") {
    const maxPerGuest = block.maxPerGuest || 3;
    const left = Math.max(0, maxPerGuest - openMyCount);
    const others = (openFeed?.responses || []).filter((r) => r.guestName !== myName).slice(-3);
    return (
      <div className="play-screen">
        {reconnectOverlay}
        <div className="play-openended">
          <h2 className="q-text-sm">{block.prompt || "Ваш ответ"}</h2>
          {left > 0 ? (
            <>
              <textarea
                className="play-openended-input"
                rows={4}
                maxLength={block.maxLength || 500}
                placeholder="Ваш ответ…"
                value={openText}
                onChange={(e) => setOpenText(e.target.value)}
              />
              {openError && (
                <p className="play-openended-error" role="alert">
                  {openError}
                </p>
              )}
              <button
                className="btn btn-primary btn-xl btn-block"
                disabled={openSending || !openText.trim()}
                onClick={sendOpen}
              >
                {openSending ? "Отправляем…" : "Отправить"}
              </button>
              <p className="muted small">
                Осталось {left} из {maxPerGuest}
              </p>
            </>
          ) : (
            <>
              <p className="play-openended-thanks">Ответ принят ✅</p>
              <p className="muted small">Вы использовали все ответы</p>
            </>
          )}
          {others.length > 0 && (
            <div className="play-openended-others">
              <p className="muted small">Последние ответы:</p>
              {others.map((r) => (
                <p className="play-openended-other" key={r.id}>
                  {r.text}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // EM-59: wordcloud — слово на телефоне: подсказки-чипы + инпут + лимит, мини-облако снизу
  if (block && !question && !reveal && !final && block.blockType === "wordcloud") {
    const maxWords = block.maxWordsPerGuest || 3;
    const left = Math.max(0, maxWords - cloudMyCount);
    const totalWords = cloudStats ? cloudStats.words.reduce((sum, w) => sum + w.count, 0) : 0;
    const suggestions = Array.isArray(block.suggestedWords) ? block.suggestedWords : [];
    return (
      <div className="play-screen">
        {reconnectOverlay}
        <div className="play-openended">
          <h2 className="q-text-sm">{block.prompt || "Ваше слово"}</h2>
          {left > 0 ? (
            <>
              {suggestions.length > 0 && (
                <div className="play-cloud-chips" role="group" aria-label="Подсказки">
                  {suggestions.map((w) => (
                    <button
                      key={w}
                      type="button"
                      className="play-cloud-chip"
                      aria-pressed={cloudText === w}
                      onClick={() => setCloudText(w)}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              )}
              <input
                className="play-openended-input"
                maxLength={block.maxLength || 30}
                placeholder={block.allowCustom === false ? "Выберите из подсказок" : "Ваше слово…"}
                value={cloudText}
                onChange={(e) => setCloudText(e.target.value)}
              />
              {cloudError && (
                <p className="play-openended-error" role="alert">{cloudError}</p>
              )}
              <button
                className="btn btn-primary btn-xl btn-block"
                disabled={cloudSending || !cloudText.trim() || (block.allowCustom === false && !suggestions.includes(cloudText.trim()))}
                onClick={sendWord}
              >
                {cloudSending ? "Отправляем…" : "Отправить"}
              </button>
              <p className="muted small">Осталось {left} из {maxWords}</p>
            </>
          ) : (
            <p className="play-openended-thanks">Все слова приняты ✅</p>
          )}
          {cloudStats && totalWords > 0 && (
            <p className="muted small">В облаке уже {totalWords} {plural(totalWords, ["слово", "слова", "слов"])}</p>
          )}
        </div>
      </div>
    );
  }

  // EM-56: свёрнутый телефон-блок (§4.2) — карточка «Сейчас в программе» с иконкой
  // типа; у паузы подпись с длительностью, иконка пульсирует до следующего блока
  if (block && !question && !reveal && !final) {
    const type = block.to ? block.to.type : block.blockType;
    const isBreak = type === "break";
    const now =
      isBreak && block.duration > 0 ? `Перерыв — ${block.duration} мин` : blockDisplayTitle(block) || "Программа";
    return (
      <div className="play-screen">
        {reconnectOverlay}
        <div className={`play-block-card${isBreak ? " play-block-card--pulse" : ""}`}>
          <div className="play-block-icon" aria-hidden="true">{BLOCK_TYPES[type]?.icon}</div>
          <p className="play-block-label">Сейчас в программе</p>
          <h2>{now}</h2>
        </div>
        <div className="spin" />
        <p className="muted small">Ждём ведущего…</p>
      </div>
    );
  }

  if (question && !reveal) {
    return (
      <div className="play-screen">
        {reconnectOverlay}
        <div className="q-meta">
          Вопрос {question.index + 1} / {question.total}
        </div>
        <div className={`timer-wrap ${secondsLeft != null && secondsLeft <= 5 ? "low" : ""}`}>
          <svg className="timer-ring" viewBox="0 0 80 80" aria-hidden="true">
            <circle className="timer-ring-track" cx="40" cy="40" r="34" />
            <circle
              className="timer-ring-fill"
              cx="40"
              cy="40"
              r="34"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={
                RING_CIRC *
                (1 - (secondsLeft == null ? 0 : Math.max(0, Math.min(1, secondsLeft / (question.timeLimit || 20)))))
              }
            />
          </svg>
          <span className="timer-digit">{secondsLeft != null && secondsLeft >= 0 ? secondsLeft : "…"}</span>
        </div>
        <h2 className="q-text-sm">{question.text}</h2>
        {/* EM-68: картинка вопроса — телефон тоже, решение владельца */}
        {question.image && <img className="q-image-sm" src={question.image} alt="" />}
        {submitted == null ? (
          <div className="play-answers">
            {question.mode === "tf"
              ? question.answers.map((a, i) => (
                  <button
                    className={`answer-btn ${i === 0 ? "tf-yes" : "tf-no"}`}
                    key={i}
                    onClick={() => answer(i)}
                  >
                    <span aria-hidden="true">{i === 0 ? "✓" : "✕"}</span>
                    {a.text}
                  </button>
                ))
              : question.answers.map((a, i) => (
                  <button className={`answer-btn ${ANSWER_COLORS[i]}`} key={i} onClick={() => answer(i)}>
                    <span aria-hidden="true">{ANSWER_SHAPES[i]}</span>
                    {a.text}
                  </button>
                ))}
          </div>
        ) : (
          <div className="waiting-card">Ответ принят! Ждём остальных…</div>
        )}
      </div>
    );
  }

  if (reveal) {
    // «Время вышло!» — сервер не засчитал ответ игрока на этом вопросе (хвост EM-44)
    const timedOut = reveal.myAnswered === false;
    return (
      <div className="play-screen">
        {reconnectOverlay}
        {question && <h2 className="q-text-sm">{question.text}</h2>}
        {question?.image && <img className="q-image-sm" src={question.image} alt="" />}
        {question?.type === "quiz" ? (
          <div className={`reveal-card ${reveal.myCorrect ? "ok" : timedOut ? "timeout" : "bad"}`}>
            <span className="reveal-mark" aria-hidden="true">
              {reveal.myCorrect ? "✓" : timedOut ? "⏱" : "✗"}
            </span>
            <div className="reveal-body">
              {reveal.myCorrect ? (
                <>
                  <h2>Верно!</h2>
                  <p className="points-big">
                    +{reveal.myAwarded} {plural(reveal.myAwarded, ["очко", "очка", "очков"])}
                  </p>
                </>
              ) : timedOut ? (
                <>
                  <h2>Время вышло!</h2>
                  <p>
                    Правильный ответ: <b>{question.answers[reveal.correctIndex]?.text}</b>
                  </p>
                </>
              ) : (
                <>
                  <h2>Мимо</h2>
                  <p>
                    Правильный ответ: <b>{question.answers[reveal.correctIndex]?.text}</b>
                  </p>
                </>
              )}
              <div className="board mini">
                <h2>Промежуточные результаты</h2>
                {reveal.leaderboard.slice(0, 5).map((p, i) => (
                  <div className="board-row" key={p.name}>
                    <span className="board-player">
                      {i + 1}.{" "}
                      <span style={{ color: NAME_COLORS[p.color] || "#fff" }} className="board-player-name">
                        <PlayerAvatar avatar={p.avatar} size={24} /> {p.name}
                      </span>
                    </span>
                    <b>{p.score}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : timedOut ? (
          <div className="reveal-card timeout">
            <span className="reveal-mark" aria-hidden="true">⏱</span>
            <div className="reveal-body">
              <h2>Время вышло!</h2>
              <p>Голос не засчитан — время на вопрос истекло</p>
            </div>
          </div>
        ) : (
          <div className="reveal-card ok">
            <span className="reveal-mark" aria-hidden="true">✓</span>
            <div className="reveal-body">
              <h2>Голос учтён</h2>
              <p>Смотрите результаты на экране ведущего</p>
            </div>
          </div>
        )}
        <p className="muted">
          {question && question.index + 1 < question.total
            ? "Дальше — следующий вопрос…"
            : question?.blockTotal != null
              ? "Дальше — следующий блок программы…"
              : "Скоро финальные результаты…"}
        </p>
      </div>
    );
  }

  // лобби: ждём начала, можно слать реакции
  return (
    <div className="play-screen">
      {reconnectOverlay}
      <h1>
        <span style={{ color: NAME_COLORS[color] }}>
          <PlayerAvatar avatar={JSON.stringify(avatar)} size={30} /> {myName}
        </span>
        , вы в игре!
      </h1>
      <div className="spin" />
      <p className="muted">Ждём, пока ведущий начнёт…</p>
      {hostName && (
        <p>
          Ведущий:{" "}
          {hostAvatar && <PlayerAvatar avatar={JSON.stringify(hostAvatar)} size={22} />}{" "}
          <b>{hostName}</b>
        </p>
      )}
      <p>
        В комнате: <b>{players.length}</b> {plural(players.length, ["игрок", "игрока", "игроков"])}
      </p>
      <div className="lobby-customize">
        <button
          type="button"
          className="btn btn-outline"
          aria-expanded={customizeOpen}
          onClick={() => setCustomizeOpen((o) => !o)}
        >
          {customizeOpen ? "Скрыть настройки аватара" : "Настроить аватар"}
        </button>
        {customizeOpen && (
          <div className="customize">
            <div className="avatar-preview-row">
              <div className="avatar-preview">
                <PlayerAvatar avatar={JSON.stringify(avatar)} size={110} />
              </div>
              <div className="preset-grid">
                {AVATAR_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.label}
                    title={p.label}
                    aria-label={`Пресет аватара: ${p.label}`}
                    aria-pressed={JSON.stringify(avatar) === JSON.stringify(p.props)}
                    className={`preset-choice ${JSON.stringify(avatar) === JSON.stringify(p.props) ? "selected" : ""}`}
                    onClick={() => applyAvatar({ avatar: p.props })}
                  >
                    <PlayerAvatar avatar={JSON.stringify(p.props)} size={44} />
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => applyAvatar({ avatar: randomAvatarProps() })}
            >
              🎲 Случайный аватар
            </button>
            <div className="picker-row">
              <label>
                Причёска
                <Dropdown
                  value={avatar.hair || "short"}
                  onChange={(v) => applyAvatar({ props: { hair: v } })}
                  options={HAIR_OPTIONS}
                />
              </label>
              <label>
                Одежда
                <Dropdown
                  value={avatar.clothing || "shirt"}
                  onChange={(v) => applyAvatar({ props: { clothing: v } })}
                  options={CLOTHING_OPTIONS}
                />
              </label>
            </div>
            <div className="picker-row">
              <label>
                Цвет одежды
                <Dropdown
                  value={avatar.clothingColor || "blue"}
                  onChange={(v) => applyAvatar({ props: { clothingColor: v } })}
                  options={COLOR_OPTIONS}
                />
              </label>
              <label>
                Тип
                <Dropdown
                  value={avatar.body || "chest"}
                  onChange={(v) => applyAvatar({ props: { body: v } })}
                  options={BODY_OPTIONS}
                />
              </label>
            </div>
            <div className="picker-row">
              <label>
                Кожа
                <Dropdown
                  value={avatar.skinTone || "light"}
                  onChange={(v) => applyAvatar({ props: { skinTone: v } })}
                  options={SKIN_OPTIONS}
                />
              </label>
              <label>
                Волосы
                <Dropdown
                  value={avatar.hairColor || "brown"}
                  onChange={(v) => applyAvatar({ props: { hairColor: v } })}
                  options={HAIR_COLOR_OPTIONS}
                />
              </label>
            </div>
            <div className="customize">
              <span className="muted">Цвет имени:</span>
              <div className="color-grid">
                {NAME_COLORS.map((c, i) => (
                  <button
                    type="button"
                    key={c}
                    className={`color-choice ${color === i ? "selected" : ""}`}
                    style={{ background: c }}
                    aria-label={`Цвет имени ${i + 1}`}
                    aria-pressed={color === i}
                    onClick={() => applyAvatar({ color: i })}
                  />
                ))}
              </div>
              <div className="preview-line" style={{ color: NAME_COLORS[color] }}>
                <PlayerAvatar avatar={JSON.stringify(avatar)} size={22} /> {myName || "Ваше имя"}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="reaction-bar">
        {REACTION_EMOJIS.map((e, i) => (
          <button
            key={e}
            className="reaction-btn"
            aria-label={`Отправить реакцию «${REACTION_LABELS[i] || e}»`}
            onClick={() => react(e)}
          >
            {e}
          </button>
        ))}
      </div>
      <p className="muted small">Реакции появятся на экране ведущего</p>
    </div>
  );
}
