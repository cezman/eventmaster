import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getSocket } from "../socket";
import { useAuth } from "../auth";
import { NAME_COLORS } from "../customize";
import Logo from "../components/Logo";
import { PlayerChip, PlayerName } from "../components/AudienceView";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";

// EM-36: пульт ведущего — управление идущей игрой. Зал (/screen/<pin>) показывает,
// пульт управляет. Работает на ноуте и телефоне (главное действие — sticky bottom).

export default function HostPanel() {
  const { quizId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const socket = getSocket();
  const showToast = useToast();

  // connecting — стучимся к сохранённой партии; connected; pin-entry — пульт без партии
  // (нет сохранённого PIN или игра не нашлась): ввод PIN идущей игры
  const [status, setStatus] = useState("connecting");
  const [attachError, setAttachError] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [game, setGame] = useState(null); // {pin,title,type,state,qIndex,total,players}
  const [question, setQuestion] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const [answered, setAnswered] = useState(0);
  const [online, setOnline] = useState(socket.connected);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const pinKey = `hostpin-${quizId}`;

  useEffect(() => {
    // Подключение к сохранённой партии (reclaim-семантика сервера). Партию без
    // сохранённого PIN НЕ создаём молча: иначе второе устройство ведущего заводит
    // вторую игру. Явное создание — кнопка «Создать новую партию» (решение владельца
    // про host:attach, EM-36). На «connect» повторяем: hostSocketId протухает.
    const claim = () => {
      setOnline(true);
      const savedPin = sessionStorage.getItem(pinKey);
      if (!savedPin) {
        setStatus((st) => (st === "connected" ? st : "pin-entry"));
        return;
      }
      socket.emit("host:attach", { token, pin: savedPin }, (res) => {
        if (res.error) {
          // партия не дожилась — PIN больше не валиден, предлагаем ввод вручную
          sessionStorage.removeItem(pinKey);
          setAttachError(res.error);
          setStatus("pin-entry");
        }
      });
    };
    if (socket.connected) claim();
    socket.on("connect", claim);
    const onDisconnect = () => setOnline(false);
    socket.on("disconnect", onDisconnect);
    // роль хоста перехватил другой пульт (второе устройство) — возвращаемся в ввод PIN
    const onDetached = () => {
      sessionStorage.removeItem(pinKey);
      setAttachError("Управление этой партией перехвачено другим пультом.");
      setStatus("pin-entry");
    };
    socket.on("host:detached", onDetached);

    const onSnapshot = (snap) => {
      setStatus("connected");
      setAttachError("");
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
    const onReveal = (r) => {
      setReveal(r);
    };
    const onFinished = (f) => {
      setFinal(f);
      setQuestion(null);
      setReveal(null);
    };
    const onCount = (d) => setAnswered(d.answered);
    const onClosed = () => {
      sessionStorage.removeItem(pinKey);
      navigate("/dashboard");
    };

    socket.on("host:game", onSnapshot);
    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    socket.on("finished", onFinished);
    socket.on("answer-count", onCount);
    socket.on("game:closed", onClosed);
    return () => {
      socket.off("connect", claim);
      socket.off("disconnect", onDisconnect);
      socket.off("host:detached", onDetached);
      socket.off("host:game", onSnapshot);
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("answer-count", onCount);
      socket.off("game:closed", onClosed);
    };
  }, [socket, token, quizId, pinKey, navigate]);

  const phase = final ? "finished" : question ? (reveal ? "reveal" : "question") : game?.state;

  const hostAction = (event) => () => socket.emit(event);

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

  const attachByPin = (e) => {
    e.preventDefault();
    setAttachError("");
    const pin = pinInput.replace(/\D/g, "");
    if (pin.length !== 6) return setAttachError("PIN состоит из 6 цифр");
    socket.emit("host:attach", { token, pin }, (res) => {
      if (res.error) return setAttachError(res.error);
      sessionStorage.setItem(pinKey, res.pin);
      // снапшот прилетит событием host:game
    });
  };

  // явное создание новой партии — только по кнопке, чтобы второе устройство
  // ведущего случайно не завело вторую игру
  const createGame = () => {
    setAttachError("");
    socket.emit("host:create-game", { token, quizId }, (res) => {
      if (res.error) return setAttachError(res.error);
      sessionStorage.setItem(pinKey, res.pin);
      // снапшот прилетит событием host:game
    });
  };

  const onlinePlayers = game ? game.players.filter((p) => p.online !== false).length : 0;
  const allAnswered = question && answered >= onlinePlayers && onlinePlayers > 0;

  const header = (
    <div className="panel-header">
      <Logo />
      {status === "connected" && (
        <div className="panel-header-actions">
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmEnd(true)}>
            Завершить
          </button>
        </div>
      )}
    </div>
  );

  const connectionStatus = (
    <div className="panel-status" role="status">
      <span className={`panel-status-dot ${online ? "on" : "off"}`} aria-hidden="true" />
      {online ? "Онлайн" : "Нет связи — переподключаемся…"}
    </div>
  );

  if (status === "pin-entry" || status === "connecting") {
    return (
      <div className="host-panel">
        {header}
        {connectionStatus}
        <div className="panel-body">
          <h1 className="panel-title">
            {status === "connecting" ? "Подключение к игре…" : "Подключение к игре"}
          </h1>
          {status === "pin-entry" && (
            <form className="panel-pin-form" onSubmit={attachByPin}>
              {attachError && (
                <div className="error" role="alert">
                  {attachError}
                </div>
              )}
              <input
                className="pin-input"
                placeholder="000000"
                inputMode="numeric"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-label="PIN игры"
              />
              <button className="btn btn-primary btn-lg">Подключиться</button>
              <p className="muted small">Введите PIN партии, открытой на экране зала, или откройте новую.</p>
              <button type="button" className="btn btn-outline" onClick={createGame}>
                Создать новую партию
              </button>
              <Link to="/dashboard" className="btn btn-ghost">
                ← В кабинет
              </Link>
            </form>
          )}
        </div>
      </div>
    );
  }
  if (!game)
    return (
      <div className="host-panel">
        {header}
        {connectionStatus}
        <p className="muted">Подключение…</p>
      </div>
    );

  return (
    <div className="host-panel">
      {header}
      {connectionStatus}
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

      {phase === "lobby" && (
        <div className="panel-body">
          <div className="panel-pin">PIN: <b>{game.pin}</b></div>
          <h2 className="panel-counter">
            Игроков: {game.players.length}
          </h2>
          <div className="players-grid">
            {game.players.map((p) => (
              <PlayerChip p={p} key={p.id} onKick={kickPlayer} />
            ))}
          </div>
          {game.players.length > 0 && (
            <div className="panel-main-action">
              <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:start")}>
                Начать игру
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "question" && question && (
        <div className="panel-body">
          <div className="q-meta">
            Вопрос {question.index + 1} / {question.total}
          </div>
          <h2 className={`panel-counter ${allAnswered ? "brand" : ""}`}>
            Ответили: {answered} / {onlinePlayers}
          </h2>
          <div className="panel-main-action">
            <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:reveal")}>
              Показать результаты
            </button>
          </div>
          <div className="panel-secondary-action">
            <button className="btn btn-outline btn-block" onClick={hostAction("host:skip")}>
              Пропустить вопрос
            </button>
          </div>
        </div>
      )}

      {phase === "reveal" && reveal && (
        <div className="panel-body">
          <div className="board mini">
            <h3>{game.type === "quiz" ? "Лидеры" : "Промежуточные результаты"}</h3>
            {reveal.leaderboard.slice(0, 3).map((p, i) => (
              <div className="board-row" key={p.name}>
                <span className="board-player">
                  {i + 1}. <PlayerName p={p} size={22} />
                </span>
                <b>{p.score}</b>
              </div>
            ))}
          </div>
          <div className="panel-main-action">
            <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:next")}>
              {question && question.index + 1 < question.total ? "Следующий →" : "Финальные результаты"}
            </button>
          </div>
        </div>
      )}

      {phase === "finished" && final && (
        <div className="panel-body">
          <h2 className="panel-counter">Игра завершена!</h2>
          <div className="board mini">
            {final.leaderboard.slice(0, 3).map((p, i) => (
              <div className="board-row" key={p.name}>
                <span className="board-player">
                  {["🥇", "🥈", "🥉"][i] || `${i + 1}.`} <PlayerName p={p} size={22} />
                </span>
                <b>{p.score}</b>
              </div>
            ))}
          </div>
          <div className="panel-main-action">
            <button className="btn btn-primary btn-xl btn-block" onClick={hostAction("host:play-again")}>
              Играть снова
            </button>
          </div>
          <div className="panel-secondary-action">
            <button className="btn btn-outline btn-block" onClick={endGame}>
              В кабинет
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
