import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { getSocket } from "../socket";
import { useAuth } from "../auth";
import { NAME_COLORS } from "../customize";
import PlayerAvatar from "../components/PlayerAvatar";
import Logo from "../components/Logo";
import { TrophyIcon, ExpandIcon, MinimizeIcon } from "../components/icons";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import confetti from "canvas-confetti";

const ANSWER_LABELS = ["A", "B", "C", "D"];
const RING_CIRC = 2 * Math.PI * 34; // длина окружности ring-таймера (r=34)

function PlayerName({ p }) {
  return (
    <span className="board-player-name" style={{ color: NAME_COLORS[p.color] || "#fff" }}>
      <PlayerAvatar avatar={p.avatar} size={26} /> {p.name}
    </span>
  );
}

// строки reveal (спека §6.4/§6.6): появление со stagger i×200ms,
// бары анимируются от нуля после монтирования
function RevealRows({ reveal, correctIndex, isQuiz, question }) {
  const [barsIn, setBarsIn] = useState(false);
  useEffect(() => {
    setBarsIn(false);
    let cancelled = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled) setBarsIn(true);
      })
    );
    return () => {
      cancelled = true;
    };
  }, [reveal]);
  const total = Math.max(1, reveal.counts.reduce((s, c) => s + c, 0));
  return (
    <div className="results">
      {reveal.counts.map((count, i) => {
        const correct = isQuiz && correctIndex === i;
        return (
          <div
            className={`result-row c${i} ${correct ? "correct" : ""}`}
            key={i}
            style={{ animationDelay: `${i * 200}ms` }}
          >
            <span className="result-label">
              {ANSWER_LABELS[i]}. {question?.answers[i]?.text}
            </span>
            <div className="result-bar-wrap">
              <div
                className="result-bar"
                style={{ width: barsIn ? `${(count / total) * 100}%` : "0%", transitionDelay: `${i * 200}ms` }}
              />
            </div>
            <span className="result-count">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// чип игрока с кик-аффордансом (дизайн-спека EM-30): на десктопе × по hover,
// на таче long-press 500 мс → меню; онлайн-игроку — мини-confirm, оффлайн — сразу
function PlayerChip({ p, onKick }) {
  const [menuOpen, setMenuOpen] = useState(false); // меню long-press (тач)
  const [confirmOpen, setConfirmOpen] = useState(false); // мини-confirm для онлайн-игрока
  const ref = useRef(null);
  const pressTimer = useRef(null);
  const offline = p.online === false;

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  useEffect(() => clearPress, []);

  useEffect(() => {
    if (!menuOpen && !confirmOpen) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setMenuOpen(false);
        setConfirmOpen(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setConfirmOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen, confirmOpen]);

  const startKick = () => {
    setMenuOpen(false);
    if (offline) onKick(p);
    else setConfirmOpen(true);
  };
  const onPointerDown = (e) => {
    if (e.pointerType !== "touch") return;
    if (e.target.closest("button")) return; // нажатия кнопок поповера — не long-press
    clearPress();
    pressTimer.current = setTimeout(() => setMenuOpen(true), 500);
  };

  return (
    <div
      ref={ref}
      className={`player-chip kickable${offline ? " offline" : ""}`}
      data-kickable="true"
      onPointerDown={onPointerDown}
      onPointerUp={clearPress}
      onPointerMove={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
    >
      <PlayerName p={p} />
      {offline && <span className="chip-offline">нет связи</span>}
      <button type="button" className="chip-kick" aria-label={`Кикнуть ${p.name}`} onClick={startKick}>
        ×
      </button>
      {menuOpen && (
        <div className="chip-popover" role="menu">
          <button type="button" className="chip-popover-item" onClick={startKick}>
            Кик
          </button>
        </div>
      )}
      {confirmOpen && (
        <div className="chip-popover">
          <span className="chip-confirm-text">Кикнуть {p.name}?</span>
          <div className="chip-confirm-actions">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                setConfirmOpen(false);
                onKick(p);
              }}
            >
              Кик
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HostGame() {
  const { quizId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const socket = getSocket();
  const showToast = useToast();

  const [game, setGame] = useState(null); // {pin,title,type,state,qIndex,total,players}
  const [question, setQuestion] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const [answered, setAnswered] = useState(0);
  const [counts, setCounts] = useState([]);
  const [live, setLive] = useState(false); // показывать распределение по вариантам до reveal
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [reactions, setReactions] = useState([]); // летающие эмодзи
  const [error, setError] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [joinUrl, setJoinUrl] = useState("");
  const canvasRef = useRef(null);
  const claimedRef = useRef(false); // успешный claim уже был — не заводим новую партию после host:end
  const pinKey = `hostpin-${quizId}`;

  useEffect(() => {
    // claim = создать игру или вернуть свою по сохранённому PIN.
    // На «connect» вешаем тот же claim: при тёплом переподключении транспорта hostSocketId
    // протухает — reclaim по PIN возвращает хоста в игру со снапшотом состояния.
    const claim = () => {
      const savedPin = sessionStorage.getItem(pinKey);
      if (!savedPin && claimedRef.current) return; // после host:end (pinKey очищен)
      socket.emit(
        "host:create-game",
        { token, quizId, reclaimPin: savedPin },
        (res) => {
          if (res.error) return setError(res.error);
          claimedRef.current = true;
          sessionStorage.setItem(pinKey, res.pin);
          setJoinUrl(`${window.location.origin}/play/${res.pin}`);
        }
      );
    };
    if (socket.connected) claim();
    socket.on("connect", claim);

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
      setCounts(q.answers.map(() => 0));
      setLive(q.showLiveResults === true);
      setSecondsLeft(q.timeLimit);
    };
    const onReveal = (r) => {
      setReveal(r);
      setSecondsLeft(null);
      setCounts(r.counts);
    };
    const onFinished = (f) => {
      setFinal(f);
      setQuestion(null);
      setReveal(null);
      setSecondsLeft(null);
    };
    const onCount = (d) => {
      setAnswered(d.answered);
      // без showLiveResults сервер шлёт counts: null — распределение скрыто до reveal
      if (d.counts) setCounts(d.counts);
    };
    const onReaction = (r) => {
      const item = { ...r, id: Date.now() + Math.random(), left: 8 + Math.random() * 84 };
      setReactions((cur) => [...cur.slice(-15), item]);
      setTimeout(() => setReactions((cur) => cur.filter((x) => x.id !== item.id)), 3000);
    };
    const onClosed = () => navigate("/dashboard");

    socket.on("host:game", onSnapshot);
    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    socket.on("finished", onFinished);
    socket.on("answer-count", onCount);
    socket.on("reaction", onReaction);
    socket.on("game:closed", onClosed);
    return () => {
      socket.off("host:game", onSnapshot);
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("answer-count", onCount);
      socket.off("reaction", onReaction);
      socket.off("game:closed", onClosed);
      socket.off("connect", claim);
    };
  }, [socket, token, quizId]);

  // обратный отсчёт на вопросе
  useEffect(() => {
    if (secondsLeft == null || secondsLeft <= 0) return undefined;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  useEffect(() => {
    if (canvasRef.current && joinUrl) {
      QRCode.toCanvas(canvasRef.current, joinUrl, { width: 220, margin: 1 }, () => {});
    }
  }, [joinUrl, game?.state]);

  // салют на большом экране, когда игра завершена
  useEffect(() => {
    if (!final) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    confetti({ particleCount: 160, spread: 110, origin: { y: 0.5 } });
  }, [final]);

  // presenter mode: класс на body живёт, пока экран хоста в fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      document.body.classList.toggle("presenter-mode", active);
    };
    // начальная синхронизация (remount в уже активном fullscreen, HMR)
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.body.classList.remove("presenter-mode");
      // уход со страницы хоста — гасим fullscreen, чтобы не остаться в нём на дашборде
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  const toggleFullscreen = () => {
    // iPhone Safari: API для не-видео элементов нет — без guard будет синхронный TypeError
    if (!document.documentElement.requestFullscreen) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

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
  const showReactions = phase === "lobby" || phase === "finished";

  const hostAction = (event) => () => socket.emit(event);

  // кик из лобби: тост только по ack сервера (иначе мог бы соврать при гонке со стартом)
  const kickPlayer = (p) => {
    socket.emit("kick-player", { playerId: p.id }, (res) => {
      if (res?.ok) showToast(`${p.name} исключён(а)`, "info");
    });
  };

  const endGame = () => {
    socket.emit("host:end");
    sessionStorage.removeItem(pinKey);
    navigate("/dashboard");
  };

  return (
    <div className="host-screen">
      <header className="host-header">
        <Logo>{game.title}</Logo>
        <div className="spacer" />
        <button className="btn btn-ghost" onClick={toggleFullscreen}>
          {isFullscreen ? <MinimizeIcon className="inline-icon" /> : <ExpandIcon className="inline-icon" />}
          {isFullscreen ? "Выйти из полноэкрана" : "Во весь экран"}
        </button>
        <button className="btn btn-ghost hide-in-presenter" onClick={() => setConfirmEnd(true)}>
          Завершить игру
        </button>
      </header>

      {confirmEnd && (
        <ConfirmDialog
          title="Завершить игру?"
          text="Игра закончится для всех игроков, результаты сохранятся в истории."
          confirmLabel="Завершить"
          onConfirm={() => {
            setConfirmEnd(false);
            endGame();
          }}
          onCancel={() => setConfirmEnd(false)}
        />
      )}

      {showReactions && (
        <div className="reaction-layer">
          {reactions.map((r) => (
            <div key={r.id} className="reaction-float" style={{ left: `${r.left}%` }}>
              <span className="reaction-emoji">{r.emoji}</span>
              <span className="reaction-name" style={{ color: NAME_COLORS[r.color] || "#fff" }}>
                <PlayerAvatar avatar={r.avatar} size={22} /> {r.name}
              </span>
            </div>
          ))}
        </div>
      )}

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
                <PlayerChip p={p} key={p.id} onKick={kickPlayer} />
              ))}
            </div>
            <p className="muted lobby-hint">
              Пока ждём — игроки могут отправлять реакции (👍 ❤️ 😂 🎉 🔥 👏), они появятся на этом экране.
            </p>
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
            Вопрос {question.index + 1} / {question.total} · ответили: {answered} /{" "}
            {game.players.filter((p) => p.online !== false).length}
          </div>
          <div className="answer-progress" aria-hidden="true">
            <div
              className="answer-progress-fill"
              style={{
                /* Math.min: offline-игрок мог ответить до отключения — answered может быть больше знаменателя */
                width: `${Math.min(100, (answered / Math.max(1, game.players.filter((p) => p.online !== false).length)) * 100)}%`,
              }}
            />
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
          <h1 className="q-text">{question.text}</h1>
          <div className="answers-grid big">
            {question.answers.map((a, i) => {
              const total = Math.max(1, counts.reduce((s, c) => s + c, 0));
              const pct = Math.round(((counts[i] || 0) / total) * 100);
              return (
                <div className={`answer-tile c${i}`} key={i}>
                  <div className="tile-top">
                    <b>{ANSWER_LABELS[i]}</b>
                    <span className="answer-tile-text">{a.text}</span>
                    {live && (
                      <span className="answer-live">
                        {counts[i] || 0} · {pct}%
                      </span>
                    )}
                  </div>
                  {live && (
                    <div className="tile-live-bar">
                      <div className="tile-live-fill" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="host-question-actions">
            <button className="btn btn-primary btn-xl" onClick={hostAction("host:reveal")}>
              Показать результаты
            </button>
            <button className="btn btn-outline btn-xl" onClick={hostAction("host:skip")}>
              Пропустить вопрос
            </button>
          </div>
        </div>
      )}

      {phase === "reveal" && reveal && (
        <div className="host-reveal">
          <h2>{game.type === "quiz" ? "Правильные ответы и очки" : "Результаты голосования"}</h2>
          <RevealRows
            reveal={reveal}
            correctIndex={reveal.correctIndex}
            isQuiz={game.type === "quiz"}
            question={question}
          />
          {game.type === "quiz" && (
            <div className="board">
              <h3>Промежуточные результаты</h3>
              {reveal.leaderboard.map((p, i) => (
                <div className="board-row" key={p.name}>
                  <PlayerName p={p} />
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
          <h1><TrophyIcon className="h1-icon" /> Игра завершена!</h1>
          {final.leaderboard.length >= 3 ? (
            <>
              {/* подиум 2-1-3 (спека §6.4): 2-е слева, 1-е по центру крупнее, 3-е справа */}
              <div className="podium">
                {[1, 0, 2].map((place, col) => {
                  const p = final.leaderboard[place];
                  return (
                    <div className={`podium-place p${place + 1}`} key={p.name} style={{ animationDelay: `${col * 120}ms` }}>
                      <span className="podium-medal" aria-hidden="true">
                        {place === 0 ? "👑" : place === 1 ? "🥈" : "🥉"}
                      </span>
                      <PlayerName p={p} />
                      <b className="podium-score">{p.score}</b>
                    </div>
                  );
                })}
              </div>
              {final.leaderboard.length > 3 && (
                <div className="board">
                  {final.leaderboard.slice(3).map((p, i) => (
                    <div className="board-row" key={p.name}>
                      <span className="board-player">
                        {i + 4}. <PlayerName p={p} />
                      </span>
                      <b>{p.score}</b>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="board">
              {final.leaderboard.map((p, i) => (
                <div className={`board-row ${i === 0 ? "winner" : ""}`} key={p.name}>
                  <span className="board-player">
                    {["🥇", "🥈", "🥉"][i] || `${i + 1}.`} <PlayerName p={p} />
                  </span>
                  <b>{p.score}</b>
                </div>
              ))}
            </div>
          )}
          <div className="editor-actions center">
            <button className="btn btn-primary btn-lg" onClick={hostAction("host:play-again")}>
              Играть снова
            </button>
            <button className="btn btn-outline btn-lg" onClick={endGame}>
              В кабинет
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
