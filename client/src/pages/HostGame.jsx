import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { getSocket } from "../socket";
import { useAuth } from "../auth";

const ANSWER_LABELS = ["A", "B", "C", "D"];

export default function HostGame() {
  const { quizId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const socket = getSocket();

  const [game, setGame] = useState(null); // {pin,title,type,state,qIndex,total,players}
  const [question, setQuestion] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const [answered, setAnswered] = useState(0);
  const [error, setError] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const canvasRef = useRef(null);
  const pinKey = `hostpin-${quizId}`;

  useEffect(() => {
    socket.emit(
      "host:create-game",
      { token, quizId, reclaimPin: sessionStorage.getItem(pinKey) },
      (res) => {
        if (res.error) return setError(res.error);
        sessionStorage.setItem(pinKey, res.pin);
        setJoinUrl(`${window.location.origin}/play/${res.pin}`);
      }
    );

    const onSnapshot = (snap) => {
      setGame(snap);
      if (snap.state === "lobby") {
        setQuestion(null);
        setReveal(null);
        setFinal(null);
      }
    };
    const onPlayers = (d) => setGame((g) => (g ? { ...g, players: d.players } : g));
    const onQuestion = (q) => {
      setQuestion(q);
      setReveal(null);
      setFinal(null);
      setAnswered(0);
    };
    const onReveal = (r) => setReveal(r);
    const onFinished = (f) => {
      setFinal(f);
      setQuestion(null);
      setReveal(null);
    };
    const onCount = (d) => setAnswered(d.answered);
    const onClosed = () => navigate("/dashboard");

    socket.on("host:game", onSnapshot);
    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    socket.on("finished", onFinished);
    socket.on("answer-count", onCount);
    socket.on("game:closed", onClosed);
    return () => {
      socket.off("host:game", onSnapshot);
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("answer-count", onCount);
      socket.off("game:closed", onClosed);
    };
  }, [socket, token, quizId]);

  useEffect(() => {
    if (canvasRef.current && joinUrl) {
      QRCode.toCanvas(canvasRef.current, joinUrl, { width: 220, margin: 1 }, () => {});
    }
  }, [joinUrl, game?.state]);

  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/dashboard">← К списку игр</Link>
      </div>
    );
  }
  if (!game) return <div className="page"><p className="muted">Подключение…</p></div>;

  const phase = final ? "finished" : question ? (reveal ? "reveal" : "question") : game.state;

  const hostAction = (event) => () => socket.emit(event);

  return (
    <div className="host-screen">
      <header className="host-header">
        <span className="logo">{game.title}</span>
        <div className="spacer" />
        <button
          className="btn btn-danger"
          onClick={() => {
            socket.emit("host:end");
            sessionStorage.removeItem(pinKey);
            navigate("/dashboard");
          }}
        >
          Завершить игру
        </button>
      </header>

      {phase === "lobby" && (
        <div className="host-lobby">
          <div className="lobby-qr">
            <h2>Сканируйте, чтобы играть</h2>
            <canvas ref={canvasRef} />
            <p className="join-url">{joinUrl}</p>
            <div className="pin-box">
              <span className="muted">Или введите PIN на главной:</span>
              <div className="pin">{game.pin}</div>
            </div>
          </div>
          <div className="lobby-players">
            <h2>
              Игроки: {game.players.length} {game.players.length === 0 && "— ждём первых игроков…"}
            </h2>
            <div className="players-grid">
              {game.players.map((p) => (
                <div className="player-chip" key={p.name}>
                  {p.name}
                </div>
              ))}
            </div>
            {game.players.length > 0 && (
              <button className="btn btn-primary btn-xl" onClick={hostAction("host:start")}>
                Начать игру
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "question" && question && (
        <div className="host-question">
          <div className="q-meta">
            Вопрос {question.index + 1} / {question.total} · ответили: {answered} / {game.players.length}
          </div>
          <h1 className="q-text">{question.text}</h1>
          <div className="answers-grid big">
            {question.answers.map((a, i) => (
              <div className={`answer-tile c${i}`} key={i}>
                <b>{ANSWER_LABELS[i]}</b>
                {a.text}
              </div>
            ))}
          </div>
          <button className="btn btn-primary btn-xl" onClick={hostAction("host:reveal")}>
            Показать результаты
          </button>
        </div>
      )}

      {phase === "reveal" && reveal && (
        <div className="host-reveal">
          <h2>{game.type === "quiz" ? "Правильные ответы и очки" : "Результаты голосования"}</h2>
          <div className="results">
            {reveal.counts.map((count, i) => {
              const total = Math.max(1, reveal.counts.reduce((s, c) => s + c, 0));
              const correct = game.type === "quiz" && reveal.correctIndex === i;
              return (
                <div className={`result-row c${i} ${correct ? "correct" : ""}`} key={i}>
                  <span className="result-label">
                    {ANSWER_LABELS[i]}. {question?.answers[i]?.text}
                  </span>
                  <div className="result-bar-wrap">
                    <div className="result-bar" style={{ width: `${(count / total) * 100}%` }} />
                  </div>
                  <span className="result-count">{count}</span>
                </div>
              );
            })}
          </div>
          {game.type === "quiz" && (
            <div className="board">
              <h3>Таблица лидеров</h3>
              {reveal.leaderboard.map((p, i) => (
                <div className="board-row" key={p.name}>
                  <span>
                    {i + 1}. {p.name}
                  </span>
                  <b>{p.score}</b>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary btn-xl" onClick={hostAction("host:next")}>
            {question && question.index + 1 < question.total ? "Следующий вопрос →" : "Финальные результаты"}
          </button>
        </div>
      )}

      {phase === "finished" && final && (
        <div className="host-finished">
          <h1>🏆 Игра завершена!</h1>
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
          <div className="editor-actions center">
            <button className="btn btn-primary btn-lg" onClick={hostAction("host:play-again")}>
              Играть снова
            </button>
            <button
              className="btn btn-outline btn-lg"
              onClick={() => {
                socket.emit("host:end");
                sessionStorage.removeItem(pinKey);
                navigate("/dashboard");
              }}
            >
              В кабинет
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
