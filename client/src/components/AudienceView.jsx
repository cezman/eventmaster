import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { NAME_COLORS } from "../customize";
import PlayerAvatar from "./PlayerAvatar";
import { TrophyIcon } from "./icons";

// EM-36: всё, что видит ЗАЛ на проекторе — чистый рендер без единого контрола.
// Используется страницей /screen/<pin>; пульт (/host/<quizId>) рисует только управление.

const ANSWER_LABELS = ["A", "B", "C", "D"];
const RING_CIRC = 2 * Math.PI * 34; // длина окружности ring-таймера (r=34)

export function PlayerName({ p, size = 26 }) {
  return (
    <span className="board-player-name" style={{ color: NAME_COLORS[p.color] || "#fff" }}>
      <PlayerAvatar avatar={p.avatar} size={size} /> {p.name}
    </span>
  );
}

// строки reveal (спека §6.4/§6.6): появление со stagger i×200ms,
// бары анимируются от нуля после монтирования
export function RevealRows({ reveal, correctIndex, isQuiz, question }) {
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

// чип игрока: с кик-аффордансом в пульте (onKick передан) и без него — на зале.
// Кик: на десктопе × по hover, на таче long-press 500 мс → меню; онлайн-игроку —
// мини-confirm, оффлайн — сразу
export function PlayerChip({ p, onKick }) {
  const [menuOpen, setMenuOpen] = useState(false); // меню long-press (тач)
  const [confirmOpen, setConfirmOpen] = useState(false); // мини-confirm для онлайн-игрока
  const ref = useRef(null);
  const pressTimer = useRef(null);
  const offline = p.online === false;
  const kickable = typeof onKick === "function";

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
    if (!kickable || e.pointerType !== "touch") return;
    if (e.target.closest("button")) return; // нажатия кнопок поповера — не long-press
    clearPress();
    pressTimer.current = setTimeout(() => setMenuOpen(true), 500);
  };

  return (
    <div
      ref={ref}
      className={`player-chip${kickable ? " kickable" : ""}${offline ? " offline" : ""}`}
      data-kickable={kickable ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerUp={clearPress}
      onPointerMove={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
    >
      <PlayerName p={p} />
      {offline && <span className="chip-offline">нет связи</span>}
      {kickable && (
        <button type="button" className="chip-kick" aria-label={`Кикнуть ${p.name}`} onClick={startKick}>
          ×
        </button>
      )}
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

export default function AudienceView({ game, question, reveal, final, answered, counts, live, secondsLeft, reactions, joinUrl }) {
  const canvasRef = useRef(null);
  const phase = final ? "finished" : question ? (reveal ? "reveal" : "question") : game.state;
  const showReactions = phase === "lobby" || phase === "finished";

  useEffect(() => {
    if (canvasRef.current && joinUrl) {
      QRCode.toCanvas(canvasRef.current, joinUrl, { width: 220, margin: 1 }, () => {});
    }
  }, [joinUrl, phase]);

  return (
    <>
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
                <PlayerChip p={p} key={p.id} />
              ))}
            </div>
            <p className="muted lobby-hint">
              Пока ждём — игроки могут отправлять реакции (👍 ❤️ 😂 🎉 🔥 👏), они появятся на этом экране.
            </p>
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
        </div>
      )}
    </>
  );
}
