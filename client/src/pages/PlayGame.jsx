import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getSocket } from "../socket";
import PlayerAvatar, { parseAvatar } from "../components/PlayerAvatar";
import Dropdown from "../components/Dropdown";
import { ClockIcon, PollIcon } from "../components/icons";
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

// салют с уважением к prefers-reduced-motion (канвас-анимация недоступна/не нужна)
function canConfetti() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const ANSWER_COLORS = ["c0", "c1", "c2", "c3"];
const ANSWER_SHAPES = ["▲", "◆", "●", "■"];

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
  const [customizeOpen, setCustomizeOpen] = useState(false); // конструктор аватара в лобби свёрнут
  const [players, setPlayers] = useState([]);
  const [question, setQuestion] = useState(null);
  const [submitted, setSubmitted] = useState(null); // индекс ответа
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const nameRef = useRef(null);

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
      setSubmitted(null);
      setSecondsLeft(null);
      setGameOver(false); // хост нажал «Играть снова» — экран «Игра завершена» больше не нужен
    };
    const onClosed = () => setClosed(true);

    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    socket.on("finished", onFinished);
    socket.on("game:lobby", onLobby);
    socket.on("game:closed", onClosed);
    return () => {
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("game:lobby", onLobby);
      socket.off("game:closed", onClosed);
    };
  }, [socket]);

  // обратный отсчёт на вопросе
  useEffect(() => {
    if (secondsLeft == null || secondsLeft <= 0) return undefined;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const myName = (sessionStorage.getItem("playerName") || "").trim();

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

  // авто-reconnect: после обрыва связи игрок восстанавливается по токену (очки и имя сохраняются)
  useEffect(() => {
    const token = sessionStorage.getItem("playerToken");
    const savedPin = sessionStorage.getItem("playerPin");
    const savedName = (sessionStorage.getItem("playerName") || "").trim();
    if (!pinParam || !token || savedPin !== pinParam || !savedName) return undefined;
    socket.emit(
      "player:join",
      {
        pin: pinParam,
        name: savedName,
        avatar: sessionStorage.getItem("playerAvatar"),
        color: Number(sessionStorage.getItem("playerColor") ?? 0),
        token,
      },
      (res) => {
        if (res?.finished) return setGameOver(true); // завершённая игра — экран «Игра завершена»
        if (!res || res.error) return; // тихо остаёмся на форме входа
        setHostName(res.hostName || "");
        setHostAvatar(parseAvatar(res.hostAvatar || ""));
        setJoined(true);
      }
    );
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = (e) => {
    e.preventDefault();
    setError("");
    const cleanPin = pin.replace(/\D/g, "");
    const cleanName = name.trim().slice(0, 20);
    if (cleanPin.length !== 6) return setError("PIN состоит из 6 цифр");
    if (!cleanName) return setError("Введите имя");
    // токен шлём только под своим сохранённым именем: иначе на общем устройстве
    // новый игрок молча «присвоил» бы сессию предыдущего
    const savedName = (sessionStorage.getItem("playerName") || "").trim();
    const token = cleanName === savedName ? sessionStorage.getItem("playerToken") : null;
    socket.emit(
      "player:join",
      { pin: cleanPin, name: cleanName, avatar: JSON.stringify(avatar), color, token },
      (res) => {
        if (res?.finished) return setGameOver(true);
        if (res?.error) return setError(res.error);
        sessionStorage.setItem("playerName", cleanName);
        sessionStorage.setItem("playerAvatar", JSON.stringify(avatar));
        sessionStorage.setItem("playerColor", String(color));
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
          <button className="btn btn-primary btn-lg">Войти в игру</button>
        </form>
      </div>
    );
  }

  if (final) {
    const me = final.leaderboard.findIndex((p) => p.name === myName);
    const myRow = final.players.find((p) => p.name === myName);
    return (
      <div className="play-screen">
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

  if (question && !reveal) {
    return (
      <div className="play-screen">
        <div className="q-meta">
          Вопрос {question.index + 1} / {question.total}
        </div>
        <div className={`timer ${secondsLeft != null && secondsLeft <= 5 ? "timer-low" : ""}`}>
          <ClockIcon className="timer-icon" aria-hidden="true" />
          {secondsLeft != null && secondsLeft >= 0 ? secondsLeft : "…"}
        </div>
        <h2 className="q-text-sm">{question.text}</h2>
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
          <div className="wait-box">Ответ принят! Ждём остальных…</div>
        )}
      </div>
    );
  }

  if (reveal) {
    return (
      <div className="play-screen">
        {question && <h2 className="q-text-sm">{question.text}</h2>}
        {question?.type === "quiz" ? (
          <div className={`reveal-card ${reveal.myCorrect ? "ok" : "bad"}`}>
            {reveal.myCorrect ? (
              <>
                <h1>✓ Верно!</h1>
                <p className="points-big">
                  +{reveal.myAwarded} {plural(reveal.myAwarded, ["очко", "очка", "очков"])}
                </p>
              </>
            ) : (
              <>
                <h1>✗ Мимо</h1>
                <p>
                  Правильный ответ: <b>{question.answers[reveal.correctIndex]?.text}</b>
                </p>
              </>
            )}
            <div className="board mini">
              <h3>Промежуточные результаты</h3>
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
        ) : (
          <div className="reveal-card ok">
            <h1><PollIcon className="h1-icon" /> Голос учтён</h1>
            <p>Смотрите результаты на экране ведущего</p>
          </div>
        )}
        <p className="muted">
          {question && question.index + 1 < question.total
            ? "Дальше — следующий вопрос…"
            : "Скоро финальные результаты…"}
        </p>
      </div>
    );
  }

  // лобби: ждём начала, можно слать реакции
  return (
    <div className="play-screen">
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
