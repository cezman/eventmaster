import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { getSocket } from "../socket";
import { useAuth } from "../auth";
import { NAME_COLORS } from "../customize";
import Logo from "../components/Logo";
import { PlayerChip, PlayerName } from "../components/AudienceView";
import ConfirmDialog from "../components/ConfirmDialog";
import ReconnectOverlay, { useReconnectStatus } from "../components/ReconnectOverlay";
import { useToast } from "../components/Toast";

// EM-36: пульт ведущего — управление идущей игрой. Зал (/screen/<pin>) показывает,
// пульт управляет. Работает на ноуте и телефоне (главное действие — sticky bottom).

export default function HostPanel() {
  const { quizId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const socket = getSocket();
  const showToast = useToast();

  // connecting — стучимся на сервер; connected — пульт управляет партией;
  // error — запуститься не удалось (например, квиз не найден)
  const [status, setStatus] = useState("connecting");
  const [attachError, setAttachError] = useState("");
  const [game, setGame] = useState(null); // {pin,title,type,state,qIndex,total,players,screenOpen}
  const [question, setQuestion] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [final, setFinal] = useState(null);
  const [answered, setAnswered] = useState(0);
  const [online, setOnline] = useState(socket.connected);
  // EM-48: открыт ли экран зала (screen:presence) — им управляет сервер
  const [screenOpen, setScreenOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // EM-46: сервер сам подключает пульт к живой партии своего квиза, а при её
  // отсутствии создаёт новую — запуск в один клик, вторая партия не плодится.
  // На уровне компонента: кнопка «Попробовать снова» на экране ошибки зовёт её же.
  const claim = useCallback(() => {
    setOnline(true);
    socket.emit("host:create-game", { token, quizId }, (res) => {
      if (res.error) {
        setAttachError(res.error);
        setStatus("error");
      }
    });
  }, [socket, token, quizId]);

  useEffect(() => {
    if (socket.connected) claim();
    socket.on("connect", claim);
    const onDisconnect = () => setOnline(false);
    socket.on("disconnect", onDisconnect);

    const onSnapshot = (snap) => {
      setStatus("connected");
      setAttachError("");
      setScreenOpen(!!snap.screenOpen);
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
    const onClosed = () => navigate("/dashboard");
    // зал открыли в новой вкладке или закрыли — лаунчпад лобби переключается (EM-48)
    const onScreenPresence = (d) => setScreenOpen(!!d.open);

    socket.on("host:game", onSnapshot);
    socket.on("screen:presence", onScreenPresence);
    socket.on("players", onPlayers);
    socket.on("question", onQuestion);
    socket.on("reveal", onReveal);
    socket.on("finished", onFinished);
    socket.on("answer-count", onCount);
    socket.on("game:closed", onClosed);
    return () => {
      socket.off("connect", claim);
      socket.off("disconnect", onDisconnect);
      socket.off("host:game", onSnapshot);
      socket.off("screen:presence", onScreenPresence);
      socket.off("players", onPlayers);
      socket.off("question", onQuestion);
      socket.off("reveal", onReveal);
      socket.off("finished", onFinished);
      socket.off("answer-count", onCount);
      socket.off("game:closed", onClosed);
    };
  }, [socket, token, quizId, navigate, claim]);

  const phase = final ? "finished" : question ? (reveal ? "reveal" : "question") : game?.state;
  // EM-45: оверлей переподключения — только пока пульт подключён к партии
  const reconnect = useReconnectStatus(socket, status === "connected");
  const reconnectOverlay = (
    <ReconnectOverlay
      state={reconnect.state}
      secondsLeft={reconnect.secondsLeft}
      retryLabel="Переподключить"
      onRetry={() => window.location.reload()}
      onHome={() => navigate("/")}
    />
  );

  const hostAction = (event) => () => socket.emit(event);

  const kickPlayer = (p) => {
    socket.emit("kick-player", { playerId: p.id }, (res) => {
      if (res?.ok) showToast(`${p.name} исключён(а)`, "info");
    });
  };

  const endGame = () => {
    socket.emit("host:end");
    navigate("/dashboard");
  };

  const openScreen = () => window.open(`${window.location.origin}/screen/${game.pin}`, "_blank");

  // EM-50: QR пульта в лобби — телефон сканирует с экрана десктопа и открывает
  // /host/<quizId>; при живой сессии на телефоне пульт сразу цепляется к этой партии.
  // Ref-callback: перерисовка при каждом монтировании canvas (возврат в лобби и т.п.)
  const qrRef = useCallback(
    (canvas) => {
      if (!canvas) return;
      QRCode.toCanvas(canvas, `${window.location.origin}/host/${quizId}`, { width: 160, margin: 1 }, (e) => {
        if (e) console.warn("QR пульта не сгенерировался:", e);
      });
    },
    [quizId]
  );

  const onlinePlayers = game ? game.players.filter((p) => p.online !== false).length : 0;
  const allAnswered = question && answered >= onlinePlayers && onlinePlayers > 0;

  const header = (
    <div className="panel-header">
      <Logo>{game ? game.title : undefined}</Logo>
      <div className="panel-header-actions">
        {status === "connected" && game && (
          <button className="btn btn-ghost btn-sm" onClick={openScreen}>
            Зал ↗
          </button>
        )}
        {status === "connected" && (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmEnd(true)}>
            Завершить
          </button>
        )}
      </div>
    </div>
  );

  const connectionStatus = (
    <div className="panel-status" role="status">
      <span className={`panel-status-dot ${online ? "on" : "off"}`} aria-hidden="true" />
      {online ? "Онлайн" : "Нет связи — переподключаемся…"}
    </div>
  );

  if (status === "error") {
    return (
      <div className="host-panel">
        {header}
        {connectionStatus}
        <div className="panel-body">
          <h1 className="panel-title">Пульт не подключён</h1>
          <div className="error" role="alert">
            {attachError}
          </div>
          <button className="btn btn-primary" onClick={claim}>
            Попробовать снова
          </button>
          <Link to="/dashboard" className="btn btn-outline">
            ← В кабинет
          </Link>
        </div>
      </div>
    );
  }
  if (status !== "connected" || !game) {
    return (
      <div className="host-panel">
        {header}
        {connectionStatus}
        <p className="muted">Подключение…</p>
      </div>
    );
  }

  return (
    <div className="host-panel">
      {reconnectOverlay}
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
          <div className="panel-lobby-top">
            {/* EM-48: лаунчпад виден только пока зал не открыт; после — ghost «Зал ↗» в шапке */}
            {!screenOpen && (
              <div className="panel-launch">
                <div className="panel-launch-label">Экран зала для проектора:</div>
                <button className="btn btn-primary btn-block" onClick={openScreen}>
                  Открыть экран зала ↗
                </button>
                <div className="panel-launch-url">…/screen/{game.pin}</div>
              </div>
            )}
            {/* EM-50: QR — на приватном пульте, не на зале (зал остаётся без элементов ведущего) */}
            <div className="panel-qr">
              <div className="panel-qr-label">Пульт на телефоне</div>
              <canvas ref={qrRef} role="img" aria-label="QR-код: открыть пульт на телефоне" />
              <div className="panel-qr-hint">
                Отсканируйте камерой. На телефоне нужно один раз войти в тот же аккаунт ведущего.
              </div>
            </div>
          </div>
          <div className="panel-pin">
            PIN игроков: <b>{game.pin}</b>
          </div>
          <h2 className="panel-counter">Игроков: {game.players.length}</h2>
          {game.players.length === 0 && (
            <p className="muted small">
              Нужен хотя бы 1 игрок: пусть отсканирует QR на экране зала или введёт PIN на главной.
            </p>
          )}
          {game.players.length > 0 && (
            <div className="players-grid">
              {game.players.map((p) => (
                <PlayerChip p={p} key={p.id} onKick={kickPlayer} />
              ))}
            </div>
          )}
          <div className="panel-main-action">
            {/* EM-48: пустую игру начать нельзя — кнопка видима, но заблокирована */}
            <button
              className="btn btn-primary btn-xl btn-block"
              disabled={game.players.length === 0}
              onClick={hostAction("host:start")}
            >
              Начать игру
            </button>
          </div>
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
