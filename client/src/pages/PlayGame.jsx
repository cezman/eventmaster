import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getSocket } from "../socket";

const ANSWER_COLORS = ["c0", "c1", "c2", "c3"];
const ANSWER_SHAPES = ["▲", "◆", "●", "■"];

export default function PlayGame() {
  const { pin: pinParam } = useParams();
  const navigate = useNavigate();
  const socket = getSocket();

  const [pin, setPin] = useState(pinParam || "");
  const [name, setName] = useState(sessionStorage.getItem("playerName") || "");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const [players, setPlayers] = useState([]);
  const [question, setQuestion] = useState(null);
  const [submitted, setSubmitted] = useState(null); // индекс ответа
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const nameRef = useRef(null);

  useEffect(() => {
    const onPlayers = (d) => setPlayers(d.players);
    const onQuestion = (q) => {
      setQuestion(q);
      setSubmitted(null);
      setReveal(null);
      setFinal(null);
    };
    const onReveal = (r) => setReveal(r);
    const onFinished = (f) => {
      setFinal(f);
      setQuestion(null);
      setReveal(null);
    };
    const onClosed = () => setClosed(true);

    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    socket.on("finished", onFinished);
    socket.on("game:closed", onClosed);
    return () => {
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("game:closed", onClosed);
    };
  }, [socket]);

  const join = (e) => {
    e.preventDefault();
    setError("");
    const cleanPin = pin.replace(/\D/g, "");
    const cleanName = name.trim().slice(0, 20);
    if (cleanPin.length !== 6) return setError("PIN состоит из 6 цифр");
    if (!cleanName) return setError("Введите имя");
    socket.emit("player:join", { pin: cleanPin, name: cleanName }, (res) => {
      if (res.error) return setError(res.error);
      sessionStorage.setItem("playerName", cleanName);
      setJoined(true);
    });
  };

  const answer = (i) => {
    if (submitted != null) return;
    setSubmitted(i);
    socket.emit("player:answer", { choice: i });
  };

  if (closed) {
    return (
      <div className="play-screen">
        <h1>Игра закрыта</h1>
        <p className="muted">Ведущий завершил игру или она устарела.</p>
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
          <input
            className="pin-input"
            placeholder="PIN игры"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
          <input
            placeholder="Ваше имя"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            ref={nameRef}
            required
          />
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary btn-lg">Войти в игру</button>
        </form>
      </div>
    );
  }

  if (final) {
    const me = final.leaderboard.findIndex((p) => p.name === (sessionStorage.getItem("playerName") || "").trim());
    const myRow = final.players.find((p) => p.name === (sessionStorage.getItem("playerName") || "").trim());
    return (
      <div className="play-screen">
        <h1>{["🎉 Победа!", "👏 Отлично!", "👍 Спасибо за игру!"][me >= 0 ? Math.min(me, 2) : 2]}</h1>
        {me >= 0 ? (
          <p>
            Вы заняли <b>{me + 1}</b> место с <b>{final.leaderboard[me].score}</b> очков
          </p>
        ) : (
          myRow && <p>Ваш счёт: <b>{myRow.score}</b></p>
        )}
        <div className="board">
          {final.leaderboard.map((p, i) => (
            <div className={`board-row ${i === 0 ? "winner" : ""}`} key={p.name}>
              <span>
                {["🥇", "🥈", "🥉"][i] || `${i + 1}.`} {p.name}
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
        <div className="q-meta">Вопрос {question.index + 1} / {question.total}</div>
        <h2 className="q-text-sm">{question.text}</h2>
        {submitted == null ? (
          <div className="play-answers">
            {question.answers.map((a, i) => (
              <button className={`answer-btn ${ANSWER_COLORS[i]}`} key={i} onClick={() => answer(i)}>
                <span>{ANSWER_SHAPES[i]}</span>
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
                <p>+{reveal.myAwarded} очков</p>
              </>
            ) : (
              <>
                <h1>✗ Мимо</h1>
                <p>
                  Правильный ответ:{" "}
                  <b>{question.answers[reveal.correctIndex]?.text}</b>
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="reveal-card ok">
            <h1>🗳️ Голос учтён</h1>
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

  // лобби
  return (
    <div className="play-screen">
      <h1>Вы в игре!</h1>
      <div className="spin" />
      <p className="muted">Ждём, пока ведущий начнёт…</p>
      <p>
        Игроков в комнате: <b>{players.length}</b>
      </p>
    </div>
  );
}
